import { startObservation } from "@langfuse/tracing";

import type { LangfusePluginConfig } from "./config.js";
import { PLUGIN_ID } from "./constants.js";
import { setupInstrumentation, type Instrumentation } from "./instrumentation.js";
import type { PluginLogger, PluginService } from "./openclaw-api.js";
import type {
  AgentContext,
  AgentEndEvent,
  AfterToolCallEvent,
  BeforeToolCallEvent,
  LlmInputEvent,
  LlmOutputEvent,
  SubagentContext,
  SubagentEndedEvent,
  SubagentSpawnedEvent,
  ToolContext,
} from "./openclaw-hooks.js";
import { TraceEngine, type Observation, type Tracing } from "./trace-engine.js";

const REAPER_INTERVAL_MS = 60_000;
const RUN_IDLE_TIMEOUT_MS = 5 * 60_000;

// OpenClaw loads/registers the plugin in more than one runtime domain (e.g. the
// gateway bootstrap pass and the per-conversation worker). Only the gateway
// domain invokes service.start(); the conversation-domain instance never does.
// If the engine were owned per-instance, the instance whose hooks actually fire
// would have an undefined engine and every hook would silently no-op (zero
// spans). We therefore initialize the instrumentation + engine exactly once at
// the module level and share it across every LangfuseRuntime instance.
let sharedInstrumentation: Instrumentation | undefined;
let sharedEngine: TraceEngine | undefined;
let sharedReaper: ReturnType<typeof setInterval> | undefined;
let initialized = false;

function ensureEngine(
  config: LangfusePluginConfig,
  logger: PluginLogger,
): TraceEngine | undefined {
  if (initialized) return sharedEngine;
  initialized = true;

  if (!config.enabled) {
    logger.info(`${PLUGIN_ID}: disabled by configuration`);
    return undefined;
  }
  if (!config.publicKey || !config.secretKey) {
    logger.warn(
      `${PLUGIN_ID}: missing credentials; set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY`,
    );
    return undefined;
  }
  try {
    sharedInstrumentation = setupInstrumentation(config);
    const start = startObservation as unknown as Tracing["startObservation"];
    const tracing: Tracing = {
      startObservation: (name, attributes, options) =>
        start(name, attributes, options) as Observation,
    };
    sharedEngine = new TraceEngine(tracing, config, logger);
    if (!sharedReaper) {
      sharedReaper = setInterval(
        () => sharedEngine?.sweep(RUN_IDLE_TIMEOUT_MS),
        REAPER_INTERVAL_MS,
      );
      sharedReaper.unref?.();
    }
    logger.info(`${PLUGIN_ID}: exporting traces to ${config.baseUrl}`);
  } catch (error) {
    logger.error(`${PLUGIN_ID}: failed to start: ${formatError(error)}`);
    sharedInstrumentation = undefined;
    sharedEngine = undefined;
  }
  return sharedEngine;
}

export class LangfuseRuntime {
  constructor(
    private readonly config: LangfusePluginConfig,
    private readonly logger: PluginLogger,
  ) {}

  service(): PluginService {
    return {
      id: PLUGIN_ID,
      start: async () => this.start(),
      stop: async () => this.stop(),
    };
  }

  // Retained for lifecycle parity; actual initialization is shared + idempotent
  // and is also triggered lazily by the first hook, so it does not matter which
  // runtime domain (if any) invokes start().
  async start(): Promise<void> {
    ensureEngine(this.config, this.logger);
  }

  async stop(): Promise<void> {
    if (sharedReaper) clearInterval(sharedReaper);
    sharedReaper = undefined;
    if (sharedEngine) sharedEngine.flushAll();
    const instrumentation = sharedInstrumentation;
    sharedInstrumentation = undefined;
    sharedEngine = undefined;
    initialized = false;
    if (instrumentation) {
      try {
        await instrumentation.shutdown();
      } catch (error) {
        this.logger.warn(`${PLUGIN_ID}: shutdown flush failed: ${formatError(error)}`);
      }
    }
  }

  onLlmInput(event: LlmInputEvent, ctx: AgentContext): void {
    const engine = ensureEngine(this.config, this.logger);
    if (engine) this.safe("llm_input", () => engine.onLlmInput(event, ctx));
  }

  onLlmOutput(event: LlmOutputEvent): void {
    const engine = ensureEngine(this.config, this.logger);
    if (engine) this.safe("llm_output", () => engine.onLlmOutput(event));
  }

  onBeforeToolCall(event: BeforeToolCallEvent, ctx: ToolContext): void {
    const engine = ensureEngine(this.config, this.logger);
    if (engine) this.safe("before_tool_call", () => engine.onBeforeToolCall(event, ctx));
  }

  onAfterToolCall(event: AfterToolCallEvent, ctx: ToolContext): void {
    const engine = ensureEngine(this.config, this.logger);
    if (engine) this.safe("after_tool_call", () => engine.onAfterToolCall(event, ctx));
  }

  onAgentEnd(event: AgentEndEvent, ctx: AgentContext): void {
    const engine = ensureEngine(this.config, this.logger);
    if (engine) this.safe("agent_end", () => engine.onAgentEnd(event, ctx));
  }

  onSubagentSpawned(event: SubagentSpawnedEvent, ctx: SubagentContext): void {
    const engine = ensureEngine(this.config, this.logger);
    if (engine) this.safe("subagent_spawned", () => engine.onSubagentSpawned(event, ctx));
  }

  onSubagentEnded(event: SubagentEndedEvent): void {
    const engine = ensureEngine(this.config, this.logger);
    if (engine) this.safe("subagent_ended", () => engine.onSubagentEnded(event));
  }

  private safe(name: string, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.warn(`${PLUGIN_ID}: ${name} failed: ${formatError(error)}`);
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
