import { resolveConfig, type PluginConfigInput } from "./config.js";
import { PLUGIN_ID } from "./constants.js";
import type { OpenClawPluginApiLike } from "./openclaw-api.js";
import { LangfuseRuntime } from "./runtime.js";

const plugin = {
  id: PLUGIN_ID,
  name: "Langfuse Observability",
  description: "Trace OpenClaw agent runs, model calls, tools, and subagents to Langfuse.",
  register(api: OpenClawPluginApiLike) {
    const config = resolveConfig(api.pluginConfig as PluginConfigInput | undefined);
    const runtime = new LangfuseRuntime(config, api.logger);

    api.registerService(runtime.service());
    api.on("llm_input", (event, ctx) => runtime.onLlmInput(event, ctx));
    api.on("llm_output", (event) => runtime.onLlmOutput(event));
    api.on("before_tool_call", (event, ctx) => runtime.onBeforeToolCall(event, ctx));
    api.on("after_tool_call", (event, ctx) => runtime.onAfterToolCall(event, ctx));
    api.on("agent_end", (event, ctx) => runtime.onAgentEnd(event, ctx));
    api.on("subagent_spawned", (event, ctx) => runtime.onSubagentSpawned(event, ctx));
    api.on("subagent_ended", (event) => runtime.onSubagentEnded(event));
  },
};

export default plugin;
export { resolveConfig } from "./config.js";
export { TraceEngine } from "./trace-engine.js";
