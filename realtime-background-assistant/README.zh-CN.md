# 实时后台助手

OpenClaw 插件提供：

- 桌面截图工具
- 用于后台助手的本地 HTTP 聊天桥

## HTTP 接口

该插件启动一个本地 HTTP 服务器。默认监听 `127.0.0.1:18189` 并暴露：

- `GET /health` - 健康检查
- `POST /chat` - 向助手发送消息

## `POST /chat`

请求体字段：

- `message` - 必须，用户消息
- `agentId` - 可选，代理 ID，默认为 `main`
- `conversationId` - 可选，会话 ID，默认为 `main`
- `sessionKey` - 可选，显式会话键
- `systemPrompt` - 可选，额外系统提示
- `lane` - 可选，传递给子代理运行时的路线名称
- `deliver` - 可选布尔值，默认为 `false`
- `timeoutMs` - 可选，等待超时时间（毫秒）
- `includeMessages` - 可选布尔值，设为 `true` 时返回会话消息
- `maxMessages` - 可选，读取的最大消息数
- `idempotencyKey` - 可选，请求键用于重试安全如果省略 `idempotencyKey`，插件现在会在调用子代理运行时之前自动生成一个。

### 示例

```bash
curl -X POST http://127.0.0.1:18189/chat ^
  -H "content-type: application/json" ^
  -d "{\"message\":\"你好\"}"
```

对于支持重试安全的客户端，也可以明确发送相同请求：

```bash
curl -X POST http://127.0.0.1:18189/chat ^
  -H "content-type: application/json" ^
  -d "{\"message\":\"你好\",\"idempotencyKey\":\"chat-001\"}"
```

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
- `defaultSystemPrompt` - 可选的额外系统提示`runTimeoutMs` - 助手运行的等待超时
- `maxMessages` - 从会话中读取的消息数量

### `screenshot`

- `timeoutMs` - 截图捕获超时
- `maxBytes` - 截图的最大字节数
