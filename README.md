# OpenClaw Langfuse Observability Plugin

[English](README.md) | [简体中文](README.zh-CN.md)

Export OpenClaw agent runs to [Langfuse](https://langfuse.com) with model generations, tool calls, token usage, errors, and subagent activity grouped into trace trees.

The plugin uses OpenClaw's typed lifecycle hooks instead of scraping logs or transcript files. Tracing is fail-open: an exporter failure is reported through the plugin logger but does not block the OpenClaw run.

## Features

- One `OpenClaw Agent Run` trace per agent run
- Agent, generation, tool, and nested subagent observations
- Model output and token usage, including cache read/write tokens
- Session ID, user ID, tags, environment, and custom metadata
- Optional prompt, response, and tool payload capture
- Field-name-based redaction and per-string truncation
- Batched export through the Langfuse OpenTelemetry SDK

When a subagent starts while its parent is still active, it is nested under the parent trace. Otherwise, it is exported as a separate trace.

## Requirements

- OpenClaw 2026.6.6 or newer
- Node.js 22.22.3 or newer
- pnpm 11 or newer
- A Langfuse project, API keys, and the correct project host

## Quick start

Clone and build the plugin:

```bash
git clone https://github.com/ai-native-thinking/openclaw-langfuse-observability-plugin.git
cd openclaw-langfuse-observability-plugin
pnpm install --frozen-lockfile
pnpm check
```

Install it as a linked local plugin:

```bash
openclaw plugins install --link "$PWD"
openclaw plugins enable openclaw-langfuse-observability-plugin
```

If another Langfuse exporter is enabled, disable it to avoid duplicate traces:

```bash
openclaw plugins disable langfuse-bridge
```

## Configuration

### Option A: environment variables

Set the variables in the environment of the OpenClaw Gateway process:

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"
export LANGFUSE_TRACING_ENVIRONMENT="development"
```

Variables exported only in an interactive shell are usually not inherited by a managed Gateway. Add them to the service environment used to launch OpenClaw.

### Option B: `openclaw.json`

Add the following entry to the `plugins.entries` object:

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
          "userId": "optional-user-id",
          "tags": ["openclaw"],
          "metadata": {
            "team": "agents"
          },
          "captureInput": true,
          "captureOutput": true,
          "redactSensitiveData": true,
          "maxChars": 20000,
          "debug": false
        }
      }
    }
  }
}
```

`hooks.allowConversationAccess: true` is required for third-party plugins to receive `llm_input`, `llm_output`, and `agent_end`. Without it, a complete agent/model trace cannot be produced.

Environment variables take precedence over values in `openclaw.json`. Prefer environment variables for credentials because JSON configuration stores them as plain text.

### Configuration reference

| Field | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enables or disables trace export. |
| `publicKey` | — | Langfuse public API key. |
| `secretKey` | — | Langfuse secret API key. |
| `baseUrl` | `https://cloud.langfuse.com` | Langfuse project host. Use the host that matches the project region or self-hosted deployment. |
| `environment` | — | Langfuse environment attached to exported traces, such as `development` or `production`. |
| `userId` | — | Optional user identifier attached to each trace. |
| `tags` | — | Tags attached to each trace. |
| `metadata` | — | Custom metadata merged into the root agent observation. |
| `captureInput` | `true` | Captures system prompts, message history, current prompts, and tool parameters. |
| `captureOutput` | `true` | Captures assistant responses and tool results. |
| `redactSensitiveData` | `true` | Replaces values whose object keys look credential-related with `[REDACTED]`. |
| `maxChars` | `20000` | Maximum retained length of each captured string; longer strings are truncated. |
| `debug` | `false` | Enables plugin lifecycle and run-level debug logging. |

### Environment variable reference

Plugin-scoped variables take precedence over the standard Langfuse variables.

| Variable | Purpose |
| --- | --- |
| `LANGFUSE_OPENCLAW_ENABLED` | Enable or disable tracing. |
| `LANGFUSE_OPENCLAW_PUBLIC_KEY` / `LANGFUSE_PUBLIC_KEY` | Public key. |
| `LANGFUSE_OPENCLAW_SECRET_KEY` / `LANGFUSE_SECRET_KEY` | Secret key. |
| `LANGFUSE_OPENCLAW_BASE_URL` / `LANGFUSE_BASE_URL` | Langfuse host. |
| `LANGFUSE_OPENCLAW_ENVIRONMENT` / `LANGFUSE_TRACING_ENVIRONMENT` | Environment name. |
| `LANGFUSE_OPENCLAW_USER_ID` | Trace user ID. |
| `LANGFUSE_OPENCLAW_TAGS` | JSON array or comma-separated tags. |
| `LANGFUSE_OPENCLAW_METADATA` | JSON object containing custom metadata. |
| `LANGFUSE_OPENCLAW_CAPTURE_INPUT` | Enable input capture. |
| `LANGFUSE_OPENCLAW_CAPTURE_OUTPUT` | Enable output capture. |
| `LANGFUSE_OPENCLAW_REDACT_SENSITIVE_DATA` | Enable field-name-based redaction. |
| `LANGFUSE_OPENCLAW_MAX_CHARS` | Per-string capture limit. |
| `LANGFUSE_OPENCLAW_DEBUG` | Enable debug logging. |

Boolean environment variables accept `1`, `true`, `yes`, or `on`, and `0`, `false`, `no`, or `off`.

## Verify the installation

Validate the configuration, inspect the plugin, and restart the Gateway:

```bash
openclaw config validate
openclaw plugins inspect openclaw-langfuse-observability-plugin
openclaw gateway restart
```

Start a new OpenClaw conversation. Langfuse should show an `OpenClaw Agent Run` trace in the configured environment, containing a model generation and any tool or subagent observations. Batched export and Langfuse ingestion can add a short delay.

## Troubleshooting

### No trace appears

1. Confirm that `plugins inspect` reports `Status: loaded`.
2. Confirm that `allowConversationAccess` is `true` in the plugin policy.
3. Verify that the Gateway process has the keys and the correct Langfuse host.
4. Restart the Gateway after changing configuration or rebuilding the linked plugin.
5. Check the environment filter in Langfuse, for example `development` versus `production`.
6. Wait a few seconds for batched export and ingestion.

### Duplicate traces appear

Disable other Langfuse/OpenTelemetry exporters that observe the same OpenClaw hooks, such as `langfuse-bridge`.

### A disabled-plugin configuration warning appears

OpenClaw may warn that `langfuse-bridge` is disabled while its old configuration is still present. This warning does not affect this plugin. Remove the obsolete `plugins.entries.langfuse-bridge` entry if it is no longer needed.

### A plugin API version mismatch appears

This plugin declares OpenClaw Plugin API `>=2026.6.6`. Upgrade OpenClaw if the runtime exposes an older API.

The additional `package.json missing openclaw.hooks` message is a fallback error from the installer after native plugin validation fails. This package is a native plugin declared through `openclaw.extensions`, not a Hook Pack; do not add `openclaw.hooks` to work around the message.

### Changes to linked source are not active

Rebuild and restart:

```bash
pnpm build
openclaw gateway restart
```

## Privacy and security

Prompts, history, responses, tool parameters, and tool results can contain sensitive data. `redactSensitiveData` only recognizes credential-like object field names; it cannot reliably identify secrets or personal information embedded in free-form text.

For sensitive workloads, consider disabling `captureInput` and/or `captureOutput`, lowering `maxChars`, and keeping Langfuse credentials in the Gateway service environment rather than `openclaw.json`.

## Development

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Run all checks with:

```bash
pnpm check
```

## License

[MIT](LICENSE)
