import { describe, expect, it, vi } from "vitest";

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
        if (!observation.ended) observation.updates.push(update);
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
          if (!observation.ended) observation.spanAttributes[key] = value;
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
    expect(root.spanAttributes["langfuse.session.id"]).toBe("session-1");
    expect(root.spanAttributes["langfuse.user.id"]).toBe("user-1");
    expect(root.spanAttributes["langfuse.trace.name"]).toBe("OpenClaw Agent Run");
    expect(root.spanAttributes["langfuse.trace.tags"]).toEqual(["openclaw"]);
    expect(root.traceIO?.output).toBe("done");

    const generation = root.children[0]!;
    expect(generation.type).toBe("generation");
    expect(generation.ended).toBe(true);
    expect(generation.spanAttributes).toMatchObject(root.spanAttributes);
    expect(generation.updates[0]).toMatchObject({
      output: "done",
      usageDetails: { input: 10, output: 5, cache_read: 3, total: 15 },
    });

    const tool = generation.children[0]!;
    expect(tool.type).toBe("tool");
    expect(tool.ended).toBe(true);
    expect(tool.spanAttributes).toMatchObject(root.spanAttributes);
    expect(tool.attributes.input).toEqual({ query: "Langfuse", apiKey: "[REDACTED]" });
    expect(tool.updates[0]).toMatchObject({ output: { count: 2 } });
  });

  it("waits for a trailing llm_output before ending spans", () => {
    const { tracing, roots } = createRecorder();
    const engine = new TraceEngine(tracing, config, {});
    const agentContext = { sessionId: "session-late", sessionKey: "agent:main:late" };

    engine.onLlmInput(
      {
        runId: "run-late",
        sessionId: "session-late",
        provider: "openai",
        model: "gpt-5",
        prompt: "hello",
        historyMessages: [],
        imagesCount: 0,
      },
      agentContext,
    );
    engine.onAgentEnd(
      { messages: [{ role: "assistant", content: "done" }], success: true, durationMs: 100 },
      agentContext,
    );

    const root = roots[0]!;
    const generation = root.children[0]!;
    expect(engine.activeRunCount()).toBe(1);
    expect(root.ended).toBe(false);
    expect(generation.ended).toBe(false);

    engine.onLlmOutput({
      runId: "run-late",
      sessionId: "session-late",
      provider: "openai",
      model: "gpt-5",
      assistantTexts: ["done"],
      usage: { input: 20, output: 7, total: 27 },
    });

    expect(engine.activeRunCount()).toBe(0);
    expect(root.ended).toBe(true);
    expect(generation.ended).toBe(true);
    expect(generation.updates.at(-1)).toMatchObject({
      output: "done",
      usageDetails: { input: 20, output: 7, total: 27 },
    });
  });

  it("finishes after a grace period when llm_output never arrives", () => {
    vi.useFakeTimers();
    try {
      const { tracing, roots } = createRecorder();
      const engine = new TraceEngine(tracing, config, {});
      const agentContext = { sessionId: "session-timeout", sessionKey: "agent:main:timeout" };

      engine.onLlmInput(
        {
          runId: "run-timeout",
          sessionId: "session-timeout",
          provider: "openai",
          model: "gpt-5",
          prompt: "hello",
          historyMessages: [],
          imagesCount: 0,
        },
        agentContext,
      );
      engine.onAgentEnd(
        { messages: [{ role: "assistant", content: "done" }], success: true },
        agentContext,
      );

      expect(engine.activeRunCount()).toBe(1);
      vi.advanceTimersByTime(1_000);
      expect(engine.activeRunCount()).toBe(0);
      expect(roots[0]?.ended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for llm_output when subagent_ended arrives first", () => {
    const { tracing, roots } = createRecorder();
    const engine = new TraceEngine(tracing, config, {});

    engine.onLlmInput(
      {
        runId: "subagent-run",
        sessionId: "subagent-session",
        provider: "openai",
        model: "gpt-5-mini",
        prompt: "child",
        historyMessages: [],
        imagesCount: 0,
      },
      { sessionId: "subagent-session", sessionKey: "agent:child:standalone" },
    );
    engine.onSubagentEnded({
      targetSessionKey: "agent:child:standalone",
      targetKind: "subagent",
      reason: "completed",
      runId: "subagent-run",
      outcome: "ok",
    });

    expect(engine.activeRunCount()).toBe(1);
    engine.onLlmOutput({
      runId: "subagent-run",
      sessionId: "subagent-session",
      provider: "openai",
      model: "gpt-5-mini",
      assistantTexts: ["child done"],
      usage: { input: 8, output: 3, total: 11 },
    });

    expect(engine.activeRunCount()).toBe(0);
    expect(roots[0]?.children[0]?.updates.at(-1)).toMatchObject({
      usageDetails: { input: 8, output: 3, total: 11 },
    });
  });

  it("keeps parent trace attributes on nested subagent spans", () => {
    const { tracing, roots } = createRecorder();
    const engine = new TraceEngine(tracing, config, {});
    const parentContext = { sessionId: "parent-session", sessionKey: "agent:main" };

    engine.onLlmInput(
      {
        runId: "parent-run",
        sessionId: "parent-session",
        provider: "openai",
        model: "gpt-5",
        prompt: "parent",
        historyMessages: [],
        imagesCount: 0,
      },
      parentContext,
    );
    engine.onSubagentSpawned(
      {
        childSessionKey: "agent:child",
        agentId: "child",
        mode: "run",
        threadRequested: false,
        runId: "child-run",
      },
      { requesterSessionKey: "agent:main" },
    );
    engine.onLlmInput(
      {
        runId: "child-run",
        sessionId: "child-session",
        provider: "openai",
        model: "gpt-5-mini",
        prompt: "child",
        historyMessages: [],
        imagesCount: 0,
      },
      { sessionId: "child-session", sessionKey: "agent:child" },
    );

    const parent = roots[0]!;
    const subagent = parent.children.find((child) => child.name === "OpenClaw Subagent Run")!;
    const childGeneration = subagent.children[0]!;
    expect(subagent.spanAttributes["langfuse.session.id"]).toBe("parent-session");
    expect(childGeneration.spanAttributes["langfuse.session.id"]).toBe("parent-session");

    engine.flushAll();
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
