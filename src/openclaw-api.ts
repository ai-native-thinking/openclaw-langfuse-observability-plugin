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

export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type PluginService = {
  id: string;
  start: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
};

export type OpenClawPluginApiLike = {
  pluginConfig?: unknown;
  logger: PluginLogger;
  registerService: (service: PluginService) => void;
  on(hookName: "llm_input", handler: (event: LlmInputEvent, ctx: AgentContext) => void): void;
  on(hookName: "llm_output", handler: (event: LlmOutputEvent, ctx: AgentContext) => void): void;
  on(
    hookName: "before_tool_call",
    handler: (event: BeforeToolCallEvent, ctx: ToolContext) => void,
  ): void;
  on(
    hookName: "after_tool_call",
    handler: (event: AfterToolCallEvent, ctx: ToolContext) => void,
  ): void;
  on(hookName: "agent_end", handler: (event: AgentEndEvent, ctx: AgentContext) => void): void;
  on(
    hookName: "subagent_spawned",
    handler: (event: SubagentSpawnedEvent, ctx: SubagentContext) => void,
  ): void;
  on(
    hookName: "subagent_ended",
    handler: (event: SubagentEndedEvent, ctx: SubagentContext) => void,
  ): void;
};
