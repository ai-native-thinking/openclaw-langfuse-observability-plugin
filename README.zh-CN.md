# OpenClaw Langfuse 可观测性插件

[English](README.md) | [简体中文](README.zh-CN.md)

将 OpenClaw Agent 的运行数据导出到 [Langfuse](https://langfuse.com)，以 Trace 树的形式展示模型调用、工具调用、Token 用量、错误和子代理活动。

插件使用 OpenClaw 的类型化生命周期 Hook，不解析日志或会话文件。Trace 导出采用 fail-open 策略：即使导出失败，也只会记录插件日志，不会阻塞 OpenClaw 对话。

## 功能特性

- 每次 Agent 运行生成一个 `OpenClaw Agent Run` Trace
- 支持 Agent、Generation、Tool 和嵌套 Subagent Observation
- 记录模型输出和 Token 用量，包括缓存读写 Token
- 支持 Session ID、User ID、Tags、Environment 和自定义 Metadata
- 可单独控制 Prompt、Response 和工具参数/结果的采集
- 支持基于字段名的敏感数据脱敏和单字符串截断
- 使用 Langfuse OpenTelemetry SDK 批量导出

如果子代理启动时父 Agent 仍在运行，子代理会嵌套在父 Trace 中；否则会作为独立 Trace 导出。

## 环境要求

- OpenClaw 2026.6.6 或更高版本
- Node.js 22.22.3 或更高版本
- pnpm 11 或更高版本
- Langfuse 项目、API Key，以及与项目区域匹配的访问地址

## 快速开始

克隆并构建插件：

```bash
git clone https://github.com/ai-native-thinking/openclaw-langfuse-observability-plugin.git
cd openclaw-langfuse-observability-plugin
pnpm install --frozen-lockfile
pnpm check
```

以本地链接方式安装：

```bash
openclaw plugins install --link "$PWD"
openclaw plugins enable openclaw-langfuse-observability-plugin
```

如果已经启用了其他 Langfuse 导出插件，请先禁用，避免重复 Trace：

```bash
openclaw plugins disable langfuse-bridge
```

## 配置

### 方式一：环境变量

在 OpenClaw Gateway 进程的运行环境中配置：

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"
export LANGFUSE_TRACING_ENVIRONMENT="development"
```

如果 Gateway 由系统服务管理，只在交互式终端中执行 `export` 通常不会生效。请把变量配置到实际启动 OpenClaw 的服务环境中。

### 方式二：`openclaw.json`

在 `plugins.entries` 对象中加入以下配置：

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

第三方插件必须设置 `hooks.allowConversationAccess: true`，才能收到 `llm_input`、`llm_output` 和 `agent_end`。缺少该权限时，插件无法生成完整的 Agent/Model Trace。

环境变量的优先级高于 `openclaw.json`。建议使用环境变量保存密钥，因为 JSON 配置会以明文形式存储密钥。

### 配置字段说明

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否启用 Trace 导出。 |
| `publicKey` | — | Langfuse Public Key。 |
| `secretKey` | — | Langfuse Secret Key。 |
| `baseUrl` | `https://cloud.langfuse.com` | Langfuse 项目地址，需要与项目区域或私有化部署地址一致。 |
| `environment` | — | Trace 所属环境，例如 `development` 或 `production`。 |
| `userId` | — | 写入每个 Trace 的可选用户标识。 |
| `tags` | — | 写入每个 Trace 的标签。 |
| `metadata` | — | 合并到根 Agent Observation 的自定义元数据。 |
| `captureInput` | `true` | 采集 System Prompt、历史消息、当前 Prompt 和工具参数。 |
| `captureOutput` | `true` | 采集 Assistant 回复和工具执行结果。 |
| `redactSensitiveData` | `true` | 将字段名看起来像密钥或凭据的值替换为 `[REDACTED]`。 |
| `maxChars` | `20000` | 每个字符串最多保留的字符数，超出部分会被截断。 |
| `debug` | `false` | 启用插件生命周期和运行级调试日志。 |

### 环境变量说明

插件专用环境变量的优先级高于 Langfuse 标准环境变量。

| 环境变量 | 说明 |
| --- | --- |
| `LANGFUSE_OPENCLAW_ENABLED` | 启用或禁用 Trace。 |
| `LANGFUSE_OPENCLAW_PUBLIC_KEY` / `LANGFUSE_PUBLIC_KEY` | Public Key。 |
| `LANGFUSE_OPENCLAW_SECRET_KEY` / `LANGFUSE_SECRET_KEY` | Secret Key。 |
| `LANGFUSE_OPENCLAW_BASE_URL` / `LANGFUSE_BASE_URL` | Langfuse 地址。 |
| `LANGFUSE_OPENCLAW_ENVIRONMENT` / `LANGFUSE_TRACING_ENVIRONMENT` | Environment 名称。 |
| `LANGFUSE_OPENCLAW_USER_ID` | Trace User ID。 |
| `LANGFUSE_OPENCLAW_TAGS` | JSON 数组或逗号分隔的 Tags。 |
| `LANGFUSE_OPENCLAW_METADATA` | 包含自定义 Metadata 的 JSON 对象。 |
| `LANGFUSE_OPENCLAW_CAPTURE_INPUT` | 是否采集输入。 |
| `LANGFUSE_OPENCLAW_CAPTURE_OUTPUT` | 是否采集输出。 |
| `LANGFUSE_OPENCLAW_REDACT_SENSITIVE_DATA` | 是否启用基于字段名的脱敏。 |
| `LANGFUSE_OPENCLAW_MAX_CHARS` | 单字符串采集长度限制。 |
| `LANGFUSE_OPENCLAW_DEBUG` | 是否启用调试日志。 |

布尔类型环境变量支持 `1`、`true`、`yes`、`on`，以及 `0`、`false`、`no`、`off`。

## 验证安装

校验配置、检查插件状态并重启 Gateway：

```bash
openclaw config validate
openclaw plugins inspect openclaw-langfuse-observability-plugin
openclaw gateway restart
```

在 OpenClaw 中发起一个新对话。Langfuse 对应 Environment 下应出现 `OpenClaw Agent Run`，其中包含模型 Generation，以及该次运行产生的 Tool 或 Subagent Observation。批量导出和 Langfuse 入库可能带来数秒延迟。

## 常见问题

### Langfuse 中没有 Trace

1. 确认 `plugins inspect` 显示 `Status: loaded`。
2. 确认插件策略中的 `allowConversationAccess` 为 `true`。
3. 确认 Gateway 进程能够读取 API Key，并且 `baseUrl` 与项目区域一致。
4. 修改配置或重新构建链接插件后，重启 Gateway。
5. 检查 Langfuse 的 Environment 筛选条件，例如 `development` 和 `production`。
6. 等待数秒，让批量导出和服务端入库完成。

### 出现重复 Trace

禁用其他监听相同 OpenClaw Hook 的 Langfuse/OpenTelemetry 导出插件，例如 `langfuse-bridge`。

### 出现 disabled plugin 配置警告

如果 `langfuse-bridge` 已禁用，但旧配置仍保留在 `openclaw.json` 中，OpenClaw 会显示警告。该警告不影响本插件；确认不再需要旧插件后，可以删除 `plugins.entries.langfuse-bridge` 配置项。

### 出现 Plugin API 版本不兼容

本插件声明的最低 OpenClaw Plugin API 版本为 `2026.6.6`。如果运行时暴露的 API 版本更低，需要升级 OpenClaw。

随后出现的 `package.json missing openclaw.hooks` 是原生插件校验失败后，安装器尝试按 Hook Pack 解析时产生的回退错误。本项目通过 `openclaw.extensions` 声明为原生插件，并不是 Hook Pack；不要为了消除该提示而添加 `openclaw.hooks`。

### 修改链接目录中的代码后没有生效

重新构建并重启 Gateway：

```bash
pnpm build
openclaw gateway restart
```

## 隐私与安全

Prompt、历史消息、回复、工具参数和工具结果都可能包含敏感数据。`redactSensitiveData` 只能识别对象中看起来像密钥或凭据的字段名，无法可靠识别自由文本中的密钥和个人信息。

对于敏感场景，可以关闭 `captureInput` 和/或 `captureOutput`，调低 `maxChars`，并把 Langfuse 密钥保存在 Gateway 服务环境中，而不是写入 `openclaw.json`。

## 开发

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

运行全部检查：

```bash
pnpm check
```

## License

[MIT](LICENSE)
