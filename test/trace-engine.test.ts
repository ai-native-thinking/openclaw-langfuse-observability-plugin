import { describe, expect, it } from "vitest";

import type { LangfusePluginConfig } from "../src/config.js";
import { TraceEngine, type Observation, type Tracing } from "../src/trace-engine.js";

type RecordedObservation = Observation & {
  name: string;
  type: string;
  attributes: Record<string, unknown>;
  updates: Record<string, unknown>[];
  ended: boolean;
  children: RecordedObservation[];
  traceIO?: { input?: unknown; output?: unknown };
  spanAttributes: Record<string, string | string[]>;
};

function createRecorder() {
  const roots: RecordedObservation[] = [];

  function make(
    name: string,
    attributes: Record<string, unknown>,
    options: { asType: string },
  ): RecordedObservation {
    const observation: RecordedObservation = {
      name,
      type: options.asType,
      attributes,
      updates: [],
      ended: false,
      children: [],
      spanAttributes: {},
      update(update) {
        observation.updates.push(update);
        return observation;
      },
      end() {
        observation.ended = true;
      },
      startObservation(childName, childAttributes, childOptions) {
        const child = make(childName, childAttributes, childOptions);
        observation.children.push(child);
        return child;
      },
      setTraceIO(io) {
        observation.traceIO = io;
      },
      otelSpan: {
        setAttribute(key, value) {
          observation.spanAttributes[key] = value;
        },
      },
    };
    return observation;
  }

  const tracing: Tracing = {
    startObservation(name, attributes, options) {
      const root = make(name, attributes, options);
      roots.push(root);
      return root;
    },
  };
  return { tracing, roots };
}

const config: LangfusePluginConfig = {
  enabled: true,
  publicKey: "pk",
  secretKey: "sk",
  baseUrl: "https://cloud.langfuse.com",
  userId: "user-1",
  tags: ["openclaw"],
  metadata: { team: "agents" },
  captureInput: true,
  captureOutput: true,
  redactSensitiveData: true,
  maxChars: 1000,
  debug: false,
};

describe("TraceEngine", () => {
  it("builds an agent → generation → tool tree and records usage", () => {
    const { tracing, roots } = createRecorder();
    const engine = new TraceEngine(tracing, config, {});
    const agentContext = { sessionId: "session-1", sessionKey: "agent:main", agentId: "main" };

    engine.onLlmInput(
      {
        runId: "run-1",
        sessionId: "session-1",
        provider: "openai",
        model: "gpt-5",
        systemPrompt: "system",
        prompt: "hello",
        historyMessages: [],
        imagesCount: 0,
      },
      agentContext,
    );
    engine.onBeforeToolCall(
      {
        runId: "run-1",
        toolCallId: "call-1",
        toolName: "web_search",
        params: { query: "Langfuse", apiKey: "do-not-send" },
      },
      { ...agentContext, runId: "run-1", toolName: "web_search", toolCallId: "call-1" },
    );
    engine.onAfterToolCall(
      {
        runId: "run-1",
        toolCallId: "call-1",
        toolName: "web_search",
        params: { query: "Langfuse" },
        result: { count: 2 },
        durationMs: 50,
      },
      { ...agentContext, runId: "run-1", toolName: "web_search", toolCallId: "call-1" },
    );
    engine.onLlmOutput({
      runId: "run-1",
      sessionId: "session-1",
      provider: "openai",
      model: "gpt-5",
      assistantTexts: ["done"],
      usage: { input: 10, output: 5, cacheRead: 3, total: 15 },
    });
    engine.onAgentEnd(
      { messages: [{ role: "assistant", content: "done" }], success: true, durationMs: 100 },
      agentContext,
    );

    expect(engine.activeRunCount()).toBe(0);
    expect(roots).toHaveLength(1);
    const root = roots[0]!;
    expect(root.name).toBe("OpenClaw Agent Run");
    expect(root.ended).toBe(true);
    expect(root.spanAttributes["session.id"]).toBe("session-1");
    expect(root.spanAttributes["user.id"]).toBe("user-1");
    expect(root.traceIO?.output).toBe("done");

    const generation = root.children[0]!;
    expect(generation.type).toBe("generation");
    expect(generation.ended).toBe(true);
    expect(generation.updates[0]).toMatchObject({
      output: "done",
      usageDetails: { input: 10, output: 5, cache_read: 3, total: 15 },
    });

    const tool = generation.children[0]!;
    expect(tool.type).toBe("tool");
    expect(tool.ended).toBe(true);
    expect(tool.attributes.input).toEqual({ query: "Langfuse", apiKey: "[REDACTED]" });
    expect(tool.updates[0]).toMatchObject({ output: { count: 2 } });
  });

  it("marks unfinished observations as errors during shutdown", () => {
    const { tracing, roots } = createRecorder();
    const engine = new TraceEngine(tracing, config, {});
    engine.onLlmInput(
      {
        runId: "run-2",
        sessionId: "session-2",
        provider: "anthropic",
        model: "claude",
        prompt: "hello",
        historyMessages: [],
        imagesCount: 0,
      },
      { sessionId: "session-2", sessionKey: "agent:main:2" },
    );

    engine.flushAll();

    expect(engine.activeRunCount()).toBe(0);
    expect(roots[0]?.ended).toBe(true);
    expect(roots[0]?.updates.at(-1)).toMatchObject({
      level: "ERROR",
      statusMessage: "Gateway stopped before the run completed",
    });
  });
});
