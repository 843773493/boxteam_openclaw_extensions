# 实时后台助手

OpenClaw 插件提供：

- 桌面截图工具
- 用于后台助手的本地 HTTP 聊天桥

重要：这个插件必须按普通 full plugin 加载，不要在 `openclaw.plugin.json` 里把它声明成 channel 插件，否则 `registerService()` 不会真正生效，HTTP 服务器也不会启动。

## HTTP 接口

该插件启动一个本地 HTTP 服务器。默认监听 `127.0.0.1:18189` 并暴露：

- `GET /health` - 健康检查
- `POST /chat` - 向助手发送消息

## `POST /chat`

请求体字段：

- `message` - 必须，用户消息
- `attachments` - 可选图片附件数组，每项需要 `content`（base64 或 data URL）和 `mimeType`（`image/*`）
- `agentId` - 可选，代理 ID，默认为 `main`
- `conversationId` - 可选，会话 ID，默认为 `main`
- `sessionKey` - 可选，显式会话键
- `systemPrompt` - 可选，额外系统提示
- `lane` - 可选，传递给子代理运行时的路线名称
- `deliver` - 可选布尔值，默认为 `false`
- `timeoutMs` - 可选，等待超时时间（毫秒）
- `includeMessages` - 可选布尔值，设为 `true` 时返回会话消息
- `maxMessages` - 可选，读取的最大消息数
- `idempotencyKey` - 可选，请求键用于重试安全；如果省略，插件会在调用子代理运行时之前自动生成一个。
- `speakMode` - 可选，speak 转发模式，`batch` 表示等完整回复后一次性转发，`stream` 表示收到回复块时立即转发，默认 `batch`

### 示例

```bash
curl -X POST http://127.0.0.1:18189/chat ^
  -H "content-type: application/json" ^
  -d "{\"message\":\"你好\"}"
```

在 `cmd.exe` 里，建议直接用单行命令，避免 `^` 续行和引号转义被打坏：

```bat
curl.exe -sS -X POST "http://127.0.0.1:18189/chat" -H "content-type: application/json" --data-raw "{\"message\":\"[curl-test] 请回复: tester已收到这条消息\",\"agentId\":\"tester\",\"conversationId\":\"curl-check\",\"includeMessages\":true,\"maxMessages\":10,\"idempotencyKey\":\"curl-test-001\"}"
```

如果一定要分行，请确保 `^` 是该行最后一个字符，下一行直接从下一个参数开始，中间不要有空格。

对于支持重试安全的客户端，也可以明确发送相同请求：

```bash
curl -X POST http://127.0.0.1:18189/chat ^
  -H "content-type: application/json" ^
  -d "{\"message\":\"你好\",\"idempotencyKey\":\"chat-001\"}"
```

如果要上传图片，可以在同一个 JSON 请求里带上 `attachments`：

```bash
curl -X POST http://127.0.0.1:18189/chat ^
  -H "content-type: application/json" ^
  -d "{\"message\":\"看看这张图\",\"attachments\":[{\"type\":\"image\",\"mimeType\":\"image/png\",\"fileName\":\"screenshot.png\",\"content\":\"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=\"}]}"
```

`content` 也可以直接传 `data:image/...;base64,...` 字符串。支持多个图片附件，顺序会原样传给助手。

### 响应

成功响应包括：

- `ok`
- `status`
- `agentId`
- `conversationId`
- `sessionKey`
- `runId`
- `assistantText`
- `messageCount`

## 配置

### `http`

- `host` - 绑定主机，默认 `127.0.0.1`
- `port` - 绑定端口，默认 `18189`
- `basePath` - 聊天路由路径，默认 `/chat`

### `assistant`

- `defaultAgentId` - 默认代理 ID，默认 `main`
- `defaultConversationId` - 默认会话 ID，默认 `main`
- `defaultSystemPrompt` - 可选的额外系统提示
- `runTimeoutMs` - 助手运行的等待超时
- `maxMessages` - 从会话中读取的消息数量
- `speak.endpoint` - 本地文本转语音端点，默认 `http://127.0.0.1:8787/speak`
- `speak.agentIds` - 需要把助手回复文本转发到 speak 端点的代理 ID 列表
- `speak.timeoutMs` - speak 请求超时时间（毫秒）

### `screenshot`

- `timeoutMs` - 截图捕获超时
- `maxBytes` - 截图的最大字节数
