import { describe, expect, it } from "vitest";

import { sanitizeValue } from "../src/sanitize.js";

describe("sanitizeValue", () => {
  it("redacts credential fields and truncates strings", () => {
    const result = sanitizeValue(
      {
        apiKey: "secret-value",
        nested: { authorization: "Bearer abc", safe: "123456" },
      },
      { maxChars: 4, redactSensitiveData: true },
    );

    expect(result).toEqual({
      apiKey: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        safe: "1234\n…[truncated 2 chars]",
      },
    });
  });
});
