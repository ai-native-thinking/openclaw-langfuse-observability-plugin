import { describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  it("uses safe defaults", () => {
    const config = resolveConfig({}, {});
    expect(config).toMatchObject({
      enabled: true,
      baseUrl: "https://cloud.langfuse.com",
      captureInput: true,
      captureOutput: true,
      redactSensitiveData: true,
      maxChars: 20_000,
      debug: false,
    });
  });

  it("lets scoped environment variables override plugin config", () => {
    const config = resolveConfig(
      {
        publicKey: "plugin-pk",
        tags: ["plugin"],
        captureInput: true,
      },
      {
        LANGFUSE_PUBLIC_KEY: "standard-pk",
        LANGFUSE_OPENCLAW_PUBLIC_KEY: "scoped-pk",
        LANGFUSE_OPENCLAW_SECRET_KEY: "scoped-sk",
        LANGFUSE_OPENCLAW_TAGS: '["openclaw","test"]',
        LANGFUSE_OPENCLAW_CAPTURE_INPUT: "false",
        LANGFUSE_OPENCLAW_METADATA: '{"team":"agents"}',
      },
    );

    expect(config.publicKey).toBe("scoped-pk");
    expect(config.secretKey).toBe("scoped-sk");
    expect(config.tags).toEqual(["openclaw", "test"]);
    expect(config.captureInput).toBe(false);
    expect(config.metadata).toEqual({ team: "agents" });
  });
});
