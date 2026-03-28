# Realtime Background Assistant

OpenClaw plugin that provides:

- a desktop screenshot tool
- a local HTTP chat bridge for a background assistant

## HTTP endpoints

The plugin starts a local HTTP server. By default it listens on `127.0.0.1:18189` and exposes:

- `GET /health` - health check
- `POST /chat` - send a message to the assistant

## `POST /chat`

Request body fields:

- `message` - required user message
- `agentId` - optional agent id, defaults to `main`
- `conversationId` - optional conversation id, defaults to `main`
- `sessionKey` - optional explicit session key
- `systemPrompt` - optional extra system prompt
- `lane` - optional lane name passed to the subagent runtime
- `deliver` - optional boolean, defaults to `false`
- `timeoutMs` - optional wait timeout in milliseconds
- `includeMessages` - optional boolean, returns session messages when `true`
- `maxMessages` - optional max number of messages to read back
- `idempotencyKey` - optional request key for retry safety

If `idempotencyKey` is omitted, the plugin now generates one automatically before calling the subagent runtime.

### Example

```bash
curl -X POST http://127.0.0.1:18189/chat ^
  -H "content-type: application/json" ^
  -d "{\"message\":\"你好\"}"
```

The same request can also be made explicit for retry-safe clients:

```bash
curl -X POST http://127.0.0.1:18189/chat ^
  -H "content-type: application/json" ^
  -d "{\"message\":\"你好\",\"idempotencyKey\":\"chat-001\"}"
```

### Response

Successful responses include:

- `ok`
- `status`
- `agentId`
- `conversationId`
- `sessionKey`
- `runId`
- `assistantText`
- `messageCount`

## Configuration

### `http`

- `host` - bind host, default `127.0.0.1`
- `port` - bind port, default `18189`
- `basePath` - chat route path, default `/chat`

### `assistant`

- `defaultAgentId` - default agent id, default `main`
- `defaultConversationId` - default conversation id, default `main`
- `defaultSystemPrompt` - optional additional system prompt
- `runTimeoutMs` - wait timeout for the assistant run
- `maxMessages` - number of messages read back from the session

### `screenshot`

- `timeoutMs` - screenshot capture timeout
- `maxBytes` - maximum screenshot size in bytes
