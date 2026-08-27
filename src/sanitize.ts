import type { LangfusePluginConfig } from "./config.js";

const SENSITIVE_KEY =
  /(?:^|[_-])(authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)(?:$|[_-])/i;
const MAX_DEPTH = 12;

export function sanitizeValue(
  value: unknown,
  config: Pick<LangfusePluginConfig, "maxChars" | "redactSensitiveData">,
): unknown {
  const seen = new WeakSet<object>();

  function visit(current: unknown, depth: number, key?: string): unknown {
    if (config.redactSensitiveData && key && SENSITIVE_KEY.test(`_${key}_`)) return "[REDACTED]";
    if (typeof current === "string") {
      if (current.length <= config.maxChars) return current;
      return `${current.slice(0, config.maxChars)}\n…[truncated ${current.length - config.maxChars} chars]`;
    }
    if (
      current == null ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current === "bigint") return current.toString();
    if (typeof current !== "object") return String(current);
    if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
    if (seen.has(current)) return "[CIRCULAR]";
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        return current.map((item) => visit(item, depth + 1));
      }
      const result: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(current)) {
        result[childKey] = visit(childValue, depth + 1, childKey);
      }
      return result;
    } finally {
      seen.delete(current);
    }
  }

  return visit(value, 0);
}
