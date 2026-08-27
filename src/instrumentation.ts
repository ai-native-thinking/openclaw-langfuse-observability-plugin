import { LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import type { LangfusePluginConfig } from "./config.js";

export type Instrumentation = {
  shutdown: () => Promise<void>;
};

/** Keep Langfuse on an isolated provider so OpenClaw's global OTel setup is untouched. */
export function setupInstrumentation(config: LangfusePluginConfig): Instrumentation {
  const spanProcessor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    environment: config.environment,
    exportMode: "batched",
    shouldExportSpan: () => true,
  });
  const provider = new NodeTracerProvider({ spanProcessors: [spanProcessor] });
  setLangfuseTracerProvider(provider);

  return {
    shutdown: async () => {
      setLangfuseTracerProvider(null);
      await spanProcessor.forceFlush();
      await provider.shutdown();
    },
  };
}
