import type { LangfusePluginConfig } from "./config.js";
import { PLUGIN_ID } from "./constants.js";
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
import { sanitizeValue } from "./sanitize.js";

type ObservationType = "agent" | "generation" | "tool";

export type Observation = {
  end: (endTime?: Date) => void;
  update: (attributes: Record<string, unknown>) => unknown;
  startObservation: (
    name: string,
    attributes: Record<string, unknown>,
    options: { asType: ObservationType; startTime?: Date },
  ) => Observation;
  setTraceIO?: (io: { input?: unknown; output?: unknown }) => void;
  otelSpan?: {
    setAttribute: (name: string, value: string | string[]) => unknown;
  };
};

export type Tracing = {
  startObservation: (
    name: string,
    attributes: Record<string, unknown>,
    options: { asType: ObservationType; startTime?: Date },
  ) => Observation;
};

export type TraceLogger = {
  debug?: (message: string) => void;
  warn?: (message: string) => void;
};

type ToolState = {
  key: string;
  name: string;
  observation: Observation;
  ended: boolean;
};

type RunState = {
  runId: string;
  sessionId: string;
  sessionKey?: string;
  root: Observation;
  generation: Observation;
  generationEnded: boolean;
  rootIsTrace: boolean;
  traceAttributes: TraceAttributes;
  pendingCompletion?: RunCompletion;
  input?: unknown;
  output?: unknown;
  tools: Map<string, ToolState>;
  toolOrder: ToolState[];
  nextToolId: number;
  touchedAt: number;
};

type SubagentParent = {
  requesterSessionKey?: string;
  label?: string;
};

type TraceAttributes = Record<string, string | string[]>;

type RunCompletion = {
  success: boolean;
  error?: string;
  durationMs?: number;
};

const TRACE_NAME_KEY = "langfuse.trace.name";
const TRACE_USER_ID_KEY = "langfuse.user.id";
const TRACE_SESSION_ID_KEY = "langfuse.session.id";
const TRACE_TAGS = "langfuse.trace.tags";
const TRACE_NAME_VALUE = "OpenClaw Agent Run";
const LLM_OUTPUT_GRACE_MS = 1_000;

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  ) as T;
}

function usageDetails(usage: LlmOutputEvent["usage"]): Record<string, number> | undefined {
  if (!usage) return undefined;
  const values: Record<string, number> = {};
  if (typeof usage.input === "number") values.input = usage.input;
  if (typeof usage.output === "number") values.output = usage.output;
  if (typeof usage.cacheRead === "number") values.cache_read = usage.cacheRead;
  if (typeof usage.cacheWrite === "number") values.cache_write = usage.cacheWrite;
  if (typeof usage.total === "number") values.total = usage.total;
  return Object.keys(values).length > 0 ? values : undefined;
}

function extractLastAssistantText(messages: unknown[]): unknown {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant") continue;
    return record.content ?? record.text ?? record;
  }
  return undefined;
}

export class TraceEngine {
  private readonly runs = new Map<string, RunState>();
  private readonly runIdsBySessionId = new Map<string, string>();
  private readonly runIdsBySessionKey = new Map<string, string>();
  private readonly subagentParents = new Map<string, SubagentParent>();
  private readonly finishTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly tracing: Tracing,
    private readonly config: LangfusePluginConfig,
    private readonly logger: TraceLogger,
    private readonly now: () => number = Date.now,
  ) {}

  onLlmInput(event: LlmInputEvent, ctx: AgentContext): void {
    const stale = this.runs.get(event.runId);
    if (stale) this.finishRun(stale, false, "A duplicate llm_input replaced this run");

    const input = this.config.captureInput
      ? sanitizeValue(
          {
            systemPrompt: event.systemPrompt,
            historyMessages: event.historyMessages,
            prompt: event.prompt,
            imagesCount: event.imagesCount,
          },
          this.config,
        )
      : undefined;

    const subagent = ctx.sessionKey ? this.subagentParents.get(ctx.sessionKey) : undefined;
    const parent = subagent?.requesterSessionKey
      ? this.findRunBySessionKey(subagent.requesterSessionKey)
      : undefined;
    const traceAttributes = parent?.traceAttributes ?? this.traceLevelAttributes(event, ctx);
    const rootAttributes = compact({
      input,
      metadata: compact({
        "openclaw.run_id": event.runId,
        "openclaw.session_id": event.sessionId,
        "openclaw.session_key": ctx.sessionKey,
        "openclaw.agent_id": ctx.agentId,
        "openclaw.provider": event.provider,
        "openclaw.model": event.model,
        "openclaw.trigger": ctx.trigger,
        "openclaw.channel": ctx.channelId,
        "openclaw.message_provider": ctx.messageProvider,
        "openclaw.subagent_label": subagent?.label,
        ...this.config.metadata,
      }),
    });
    const root = parent
      ? parent.root.startObservation("OpenClaw Subagent Run", rootAttributes, { asType: "agent" })
      : this.tracing.startObservation("OpenClaw Agent Run", rootAttributes, { asType: "agent" });
    const rootIsTrace = !parent;
    this.applyTraceAttributes(root, traceAttributes);

    const generation = root.startObservation(
      event.model || "LLM",
      compact({
        input,
        model: event.model,
        metadata: {
          "openclaw.provider": event.provider,
          "openclaw.run_id": event.runId,
        },
      }),
      { asType: "generation" },
    );
    this.applyTraceAttributes(generation, traceAttributes);
    const run: RunState = {
      runId: event.runId,
      sessionId: event.sessionId,
      sessionKey: ctx.sessionKey,
      root,
      generation,
      generationEnded: false,
      rootIsTrace,
      traceAttributes,
      input,
      tools: new Map(),
      toolOrder: [],
      nextToolId: 0,
      touchedAt: this.now(),
    };
    this.runs.set(run.runId, run);
    this.runIdsBySessionId.set(run.sessionId, run.runId);
    if (run.sessionKey) this.runIdsBySessionKey.set(run.sessionKey, run.runId);
    this.debug(`started run ${run.runId}`);
  }

  onLlmOutput(event: LlmOutputEvent): void {
    const run = this.runs.get(event.runId);
    if (!run) return;
    run.touchedAt = this.now();
    const output = this.config.captureOutput
      ? sanitizeValue(
          event.assistantTexts.length === 1 ? event.assistantTexts[0] : event.assistantTexts,
          this.config,
        )
      : undefined;
    run.output = output;
    run.generation.update(compact({ output, usageDetails: usageDetails(event.usage) }));
    if (!run.generationEnded) {
      run.generation.end();
      run.generationEnded = true;
    }
    if (run.pendingCompletion) {
      const completion = run.pendingCompletion;
      run.pendingCompletion = undefined;
      this.finishRun(run, completion.success, completion.error, completion.durationMs);
    }
  }

  onBeforeToolCall(event: BeforeToolCallEvent, ctx: ToolContext): void {
    const run = this.findRun(event.runId ?? ctx.runId, ctx);
    if (!run) return;
    run.touchedAt = this.now();
    const key = event.toolCallId ?? ctx.toolCallId ?? `tool-${run.nextToolId++}`;
    const parent = run.generationEnded ? run.root : run.generation;
    const observation = parent.startObservation(
      event.toolName || "tool",
      compact({
        input: this.config.captureInput
          ? sanitizeValue(event.params, this.config)
          : undefined,
        metadata: compact({
          "openclaw.run_id": event.runId ?? ctx.runId,
          "openclaw.tool_call_id": event.toolCallId ?? ctx.toolCallId,
        }),
      }),
      { asType: "tool" },
    );
    this.applyTraceAttributes(observation, run.traceAttributes);
    const tool: ToolState = {
      key,
      name: event.toolName,
      observation,
      ended: false,
    };
    run.tools.set(key, tool);
    run.toolOrder.push(tool);
  }

  onAfterToolCall(event: AfterToolCallEvent, ctx: ToolContext): void {
    const run = this.findRun(event.runId ?? ctx.runId, ctx);
    if (!run) return;
    run.touchedAt = this.now();
    const key = event.toolCallId ?? ctx.toolCallId;
    let tool = key ? run.tools.get(key) : undefined;
    tool ??= run.toolOrder.find((candidate) => !candidate.ended && candidate.name === event.toolName);
    if (!tool) {
      const parent = run.generationEnded ? run.root : run.generation;
      const startTime =
        typeof event.durationMs === "number" ? new Date(this.now() - event.durationMs) : undefined;
      tool = {
        key: key ?? `tool-${run.nextToolId++}`,
        name: event.toolName,
        observation: parent.startObservation(
          event.toolName || "tool",
          compact({
            input: this.config.captureInput
              ? sanitizeValue(event.params, this.config)
              : undefined,
          }),
          { asType: "tool", startTime },
        ),
        ended: false,
      };
      run.tools.set(tool.key, tool);
      run.toolOrder.push(tool);
      this.applyTraceAttributes(tool.observation, run.traceAttributes);
    }
    tool.observation.update(
      compact({
        output: this.config.captureOutput
          ? sanitizeValue(event.result, this.config)
          : undefined,
        level: event.error ? "ERROR" : undefined,
        statusMessage: event.error
          ? String(sanitizeValue(event.error, this.config))
          : undefined,
        metadata: compact({ "openclaw.duration_ms": event.durationMs }),
      }),
    );
    if (!tool.ended) {
      tool.observation.end();
      tool.ended = true;
    }
  }

  onAgentEnd(event: AgentEndEvent, ctx: AgentContext): void {
    const run = this.findRun(undefined, ctx);
    if (!run) return;
    if (run.output === undefined && this.config.captureOutput) {
      run.output = sanitizeValue(extractLastAssistantText(event.messages), this.config);
    }
    this.finishAfterOutput(run, event.success, event.error, event.durationMs);
  }

  onSubagentSpawned(event: SubagentSpawnedEvent, ctx: SubagentContext): void {
    this.subagentParents.set(event.childSessionKey, {
      requesterSessionKey: ctx.requesterSessionKey,
      label: event.label,
    });
  }

  onSubagentEnded(event: SubagentEndedEvent): void {
    const run = event.runId ? this.runs.get(event.runId) : undefined;
    if (run) {
      this.finishAfterOutput(
        run,
        event.outcome === undefined || event.outcome === "ok",
        event.error ?? (event.outcome && event.outcome !== "ok" ? event.outcome : undefined),
      );
    }
    this.subagentParents.delete(event.targetSessionKey);
  }

  sweep(maxIdleMs: number): void {
    const cutoff = this.now() - maxIdleMs;
    for (const run of [...this.runs.values()]) {
      if (run.touchedAt < cutoff) this.finishRun(run, false, "Observation timed out");
    }
  }

  flushAll(): void {
    for (const run of [...this.runs.values()]) {
      this.finishRun(run, false, "Gateway stopped before the run completed");
    }
  }

  activeRunCount(): number {
    return this.runs.size;
  }

  private findRun(
    runId: string | undefined,
    ctx: Pick<AgentContext & ToolContext, "sessionId" | "sessionKey">,
  ): RunState | undefined {
    if (runId) {
      const exact = this.runs.get(runId);
      if (exact) return exact;
    }
    if (ctx.sessionId) {
      const bySessionId = this.runIdsBySessionId.get(ctx.sessionId);
      if (bySessionId) return this.runs.get(bySessionId);
    }
    return ctx.sessionKey ? this.findRunBySessionKey(ctx.sessionKey) : undefined;
  }

  private findRunBySessionKey(sessionKey: string): RunState | undefined {
    const runId = this.runIdsBySessionKey.get(sessionKey);
    return runId ? this.runs.get(runId) : undefined;
  }

  private finishRun(
    run: RunState,
    success: boolean,
    error?: string,
    durationMs?: number,
  ): void {
    if (this.runs.get(run.runId) !== run) return;
    this.clearFinishTimer(run.runId);
    run.pendingCompletion = undefined;
    for (const tool of run.toolOrder) {
      if (!tool.ended) {
        tool.observation.update({
          level: "WARNING",
          statusMessage: "Tool observation ended without an after_tool_call event",
        });
        tool.observation.end();
        tool.ended = true;
      }
    }
    if (!run.generationEnded) {
      run.generation.update(
        compact({
          output: run.output,
          level: success ? undefined : "ERROR",
          statusMessage: error,
        }),
      );
      run.generation.end();
      run.generationEnded = true;
    }
    run.root.update(
      compact({
        output: run.output,
        level: success ? undefined : "ERROR",
        statusMessage: error,
        metadata: compact({
          "openclaw.duration_ms": durationMs,
          "openclaw.success": success,
        }),
      }),
    );
    if (run.rootIsTrace) run.root.setTraceIO?.({ input: run.input, output: run.output });
    run.root.end();
    this.runs.delete(run.runId);
    if (this.runIdsBySessionId.get(run.sessionId) === run.runId) {
      this.runIdsBySessionId.delete(run.sessionId);
    }
    if (run.sessionKey && this.runIdsBySessionKey.get(run.sessionKey) === run.runId) {
      this.runIdsBySessionKey.delete(run.sessionKey);
    }
    this.debug(`finished run ${run.runId}`);
  }

  private finishAfterOutput(
    run: RunState,
    success: boolean,
    error?: string,
    durationMs?: number,
  ): void {
    if (run.generationEnded) {
      this.finishRun(run, success, error, durationMs);
      return;
    }

    // OpenClaw dispatches completion hooks and llm_output concurrently. A
    // completion hook can arrive first by a few milliseconds. Keep spans open
    // briefly so llm_output can attach final output and token usage before they
    // are ended. The timer is a fail-safe for runs that never emit output.
    run.pendingCompletion = { success, error, durationMs };
    this.scheduleFinish(run);
  }

  private scheduleFinish(run: RunState): void {
    this.clearFinishTimer(run.runId);
    const timer = setTimeout(() => {
      this.finishTimers.delete(run.runId);
      const completion = run.pendingCompletion;
      if (completion) {
        this.finishRun(run, completion.success, completion.error, completion.durationMs);
      }
    }, LLM_OUTPUT_GRACE_MS);
    timer.unref?.();
    this.finishTimers.set(run.runId, timer);
  }

  private clearFinishTimer(runId: string): void {
    const timer = this.finishTimers.get(runId);
    if (timer) clearTimeout(timer);
    this.finishTimers.delete(runId);
  }

  // Trace-level attributes must be written directly to every OTel span.
  // startObservation only accepts Langfuse observation fields and discards
  // unknown top-level properties such as langfuse.session.id.
  private traceLevelAttributes(event: LlmInputEvent, ctx: AgentContext): TraceAttributes {
    const attributes: TraceAttributes = {
      [TRACE_SESSION_ID_KEY]: event.sessionId || ctx.sessionKey || event.runId,
      [TRACE_NAME_KEY]: TRACE_NAME_VALUE,
    };
    if (this.config.userId) attributes[TRACE_USER_ID_KEY] = this.config.userId;
    if (this.config.tags?.length) attributes[TRACE_TAGS] = this.config.tags;
    return attributes;
  }

  private applyTraceAttributes(observation: Observation, attributes: TraceAttributes): void {
    const span = observation.otelSpan;
    if (!span) return;
    for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
  }

  private debug(message: string): void {
    if (this.config.debug) this.logger.debug?.(`${PLUGIN_ID}: ${message}`);
  }
}
