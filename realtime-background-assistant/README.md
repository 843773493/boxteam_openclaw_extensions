# Realtime Background Assistant

OpenClaw plugin that provides:

- a desktop screenshot tool
- a local HTTP chat bridge for a background assistant

Important: this plugin must be loaded as a normal full plugin. Do not declare it as a channel plugin in `openclaw.plugin.json`, or `registerService()` will not be activated and the HTTP server will never start.

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

For `cmd.exe`, prefer a single line to avoid caret/newline parsing issues:

```bat
curl.exe -sS -X POST "http://127.0.0.1:18189/chat" -H "content-type: application/json" --data-raw "{\"message\":\"[curl-test] 请回复: tester已收到这条消息\",\"agentId\":\"tester\",\"conversationId\":\"curl-check\",\"includeMessages\":true,\"maxMessages\":10,\"idempotencyKey\":\"curl-test-001\"}"
```

If you do split lines with `^`, make sure the caret is the very last character on the line and the next line starts immediately with the next flag, with no spaces before it.

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
- `speak.endpoint` - local text-to-speech endpoint, default `http://127.0.0.1:8787/speak`
- `speak.agentIds` - agent ids that should forward assistant reply text to the speak endpoint
- `speak.timeoutMs` - timeout for the speak request in milliseconds

### `screenshot`

- `timeoutMs` - screenshot capture timeout
- `maxBytes` - maximum screenshot size in bytes
