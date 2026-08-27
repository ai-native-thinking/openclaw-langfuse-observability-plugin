# OpenClaw Langfuse Observability Plugin

This OpenClaw plugin exports one Langfuse trace per agent run. Each trace contains an agent observation, a model generation, tool observations, token usage, errors, and nested subagent runs when the parent is still active.

It uses OpenClaw's typed lifecycle hooks (`llm_input`, `llm_output`, `before_tool_call`, `after_tool_call`, and `agent_end`) rather than scraping logs or transcripts. Export failures are fail-open and never block an OpenClaw run.

## Requirements

- OpenClaw 2026.7.1 or newer
- Node.js 22.22.3 or newer
- A Langfuse project and its public/secret keys

## Build and install locally

```bash
cd /Users/xuwei/workspace/plugins/openclaw-langfuse-observability-plugin
pnpm install
pnpm check
openclaw plugins install --link \
  /Users/xuwei/workspace/plugins/openclaw-langfuse-observability-plugin
openclaw plugins enable openclaw-langfuse-observability-plugin
```

If another Langfuse exporter is enabled, disable it first to avoid duplicate traces:

```bash
openclaw plugins disable langfuse-bridge
```

Set credentials in the environment used by the OpenClaw Gateway:

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
export LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

For a managed Gateway, put the variables in the service environment rather than only in an interactive shell, then restart the Gateway.

Alternatively, configure the plugin directly (environment variables take precedence):

```json
{
  "plugins": {
    "entries": {
      "openclaw-langfuse-observability-plugin": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true
        },
        "config": {
          "publicKey": "pk-lf-...",
          "secretKey": "sk-lf-...",
          "baseUrl": "https://cloud.langfuse.com",
          "environment": "development",
          "tags": ["openclaw"],
          "captureInput": true,
          "captureOutput": true,
          "redactSensitiveData": true,
          "maxChars": 20000
        }
      }
    }
  }
}
```

Storing credentials in environment variables is preferred over writing them to `openclaw.json`.

`hooks.allowConversationAccess: true` is required. OpenClaw blocks `llm_input`, `llm_output`, and `agent_end` for third-party plugins unless the operator explicitly grants this permission. Without it, tool spans can load but agent/model traces cannot be completed.

## Environment variables

Plugin-specific variables override config. Standard Langfuse credentials are also supported.

| Variable | Purpose |
| --- | --- |
| `LANGFUSE_OPENCLAW_ENABLED` | Enable or disable tracing |
| `LANGFUSE_OPENCLAW_PUBLIC_KEY` / `LANGFUSE_PUBLIC_KEY` | Public key |
| `LANGFUSE_OPENCLAW_SECRET_KEY` / `LANGFUSE_SECRET_KEY` | Secret key |
| `LANGFUSE_OPENCLAW_BASE_URL` / `LANGFUSE_BASE_URL` | Langfuse host |
| `LANGFUSE_OPENCLAW_ENVIRONMENT` / `LANGFUSE_TRACING_ENVIRONMENT` | Environment name |
| `LANGFUSE_OPENCLAW_USER_ID` | Trace user id |
| `LANGFUSE_OPENCLAW_TAGS` | JSON array or comma-separated tags |
| `LANGFUSE_OPENCLAW_METADATA` | JSON object with trace metadata |
| `LANGFUSE_OPENCLAW_CAPTURE_INPUT` | Capture prompts and tool parameters |
| `LANGFUSE_OPENCLAW_CAPTURE_OUTPUT` | Capture responses and tool results |
| `LANGFUSE_OPENCLAW_REDACT_SENSITIVE_DATA` | Redact credential-like object fields |
| `LANGFUSE_OPENCLAW_MAX_CHARS` | Per-string capture limit |
| `LANGFUSE_OPENCLAW_DEBUG` | Verbose plugin logging |

## Verification

```bash
openclaw config validate
openclaw plugins inspect openclaw-langfuse-observability-plugin
openclaw doctor
```

After restarting the Gateway, run an agent turn that uses a tool. Langfuse should show `OpenClaw Agent Run` with a model generation and nested tool observations.

## Privacy

Prompt, history, response, tool parameters, and tool results can contain sensitive data. `redactSensitiveData` is enabled by default and masks credential-like object keys, but it cannot recognize every secret embedded in free-form text. Set `captureInput` and/or `captureOutput` to `false` when content capture is not appropriate.
