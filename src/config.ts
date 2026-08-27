export type PluginConfigInput = {
  enabled?: boolean;
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
  environment?: string;
  userId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  captureInput?: boolean;
  captureOutput?: boolean;
  redactSensitiveData?: boolean;
  maxChars?: number;
  debug?: boolean;
};

export type LangfusePluginConfig = {
  enabled: boolean;
  publicKey?: string;
  secretKey?: string;
  baseUrl: string;
  environment?: string;
  userId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  captureInput: boolean;
  captureOutput: boolean;
  redactSensitiveData: boolean;
  maxChars: number;
  debug: boolean;
};

const DEFAULT_BASE_URL = "https://cloud.langfuse.com";
const DEFAULT_MAX_CHARS = 20_000;

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseTags(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // Fall through to comma-separated parsing.
    }
  }
  return trimmed.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Plugin config is the baseline; environment variables intentionally win. */
export function resolveConfig(
  input: PluginConfigInput | undefined,
  env: NodeJS.ProcessEnv = process.env,
): LangfusePluginConfig {
  const cfg = input ?? {};
  const configuredMaxChars =
    typeof cfg.maxChars === "number" && Number.isSafeInteger(cfg.maxChars) && cfg.maxChars > 0
      ? cfg.maxChars
      : DEFAULT_MAX_CHARS;
  return {
    enabled: parseBoolean(env.LANGFUSE_OPENCLAW_ENABLED) ?? cfg.enabled ?? true,
    publicKey:
      nonEmpty(env.LANGFUSE_OPENCLAW_PUBLIC_KEY) ??
      nonEmpty(env.LANGFUSE_PUBLIC_KEY) ??
      nonEmpty(cfg.publicKey),
    secretKey:
      nonEmpty(env.LANGFUSE_OPENCLAW_SECRET_KEY) ??
      nonEmpty(env.LANGFUSE_SECRET_KEY) ??
      nonEmpty(cfg.secretKey),
    baseUrl:
      nonEmpty(env.LANGFUSE_OPENCLAW_BASE_URL) ??
      nonEmpty(env.LANGFUSE_BASE_URL) ??
      nonEmpty(cfg.baseUrl) ??
      DEFAULT_BASE_URL,
    environment:
      nonEmpty(env.LANGFUSE_OPENCLAW_ENVIRONMENT) ??
      nonEmpty(env.LANGFUSE_TRACING_ENVIRONMENT) ??
      nonEmpty(cfg.environment),
    userId: nonEmpty(env.LANGFUSE_OPENCLAW_USER_ID) ?? nonEmpty(cfg.userId),
    tags: parseTags(env.LANGFUSE_OPENCLAW_TAGS) ?? cfg.tags,
    metadata: parseMetadata(env.LANGFUSE_OPENCLAW_METADATA) ?? cfg.metadata,
    captureInput:
      parseBoolean(env.LANGFUSE_OPENCLAW_CAPTURE_INPUT) ?? cfg.captureInput ?? true,
    captureOutput:
      parseBoolean(env.LANGFUSE_OPENCLAW_CAPTURE_OUTPUT) ?? cfg.captureOutput ?? true,
    redactSensitiveData:
      parseBoolean(env.LANGFUSE_OPENCLAW_REDACT_SENSITIVE_DATA) ??
      cfg.redactSensitiveData ??
      true,
    maxChars:
      parsePositiveInteger(env.LANGFUSE_OPENCLAW_MAX_CHARS) ??
      configuredMaxChars,
    debug: parseBoolean(env.LANGFUSE_OPENCLAW_DEBUG) ?? cfg.debug ?? false,
  };
}
