# OpenClaw 插件调试方法

本文记录 `realtime-background-assistant` 的 VS Code 调试方式，目标是直接调试插件源码，而不是依赖 `pnpm gateway:watch` 或 `reference_repo` 的运行时。

## 调试入口

使用根目录的 [.vscode/launch.json](../.vscode/launch.json) 启动 `Debug OpenClaw with realtime-background-assistant`。

这个配置会：

- 直接启动本机 npm 安装的 OpenClaw gateway。
- 通过 `OPENCLAW_CONFIG_PATH` 指向 [.vscode/openclaw.debug.json](../.vscode/openclaw.debug.json)。
- 将运行时状态放到 [.openclaw-debug](../.openclaw-debug) 目录。
- 保持插件配置里的 `plugins.load.paths` 指向 `./realtime-background-assistant`。

## 预启动准备

预启动任务定义在 [.vscode/tasks.json](../.vscode/tasks.json)。它只做两件事：

1. 创建 `.openclaw-debug` 目录。
2. 在本地缺少依赖时安装 `@sinclair/typebox`，保证插件入口能正常解析。

## 断点位置

直接在 [realtime-background-assistant/index.ts](../realtime-background-assistant/index.ts) 里打断点即可，重点看 `register(api)` 内部的配置解析和工具注册逻辑。

不需要再保留额外的 `debugger;` 语句；只要 VS Code 已经 attach 到 gateway 进程，源码断点就会正常生效。

## HTTP / curl 联调测试

当你在另一个终端已经启动 OpenClaw gateway 后，可以直接通过插件暴露端口验证消息链路。

### 1. 健康检查

```bat
curl.exe -sS http://127.0.0.1:18189/health
```

预期返回 `ok: true`，并包含 `address: "127.0.0.1:18189"`。

### 2. 发送消息给 `tester` 智能体

```bat
curl.exe -sS -X POST http://127.0.0.1:18189/chat ^
	-H "content-type: application/json" ^
	-d "{\"message\":\"[curl-test] 请回复: tester已收到这条消息\",\"agentId\":\"tester\",\"conversationId\":\"curl-check\",\"includeMessages\":true,\"maxMessages\":10,\"idempotencyKey\":\"curl-test-001\"}"
```

### 3. 成功判定

响应 JSON 至少满足以下条件：

- `status` 为 `ok`
- `agentId` 为 `tester`
- `assistantText` 包含 `tester已收到这条消息`
- `messageCount` 大于等于 `2`（至少包含一条 user 和一条 assistant 消息）

## 常见问题

- 如果插件没有加载，先检查 [.vscode/openclaw.debug.json](../.vscode/openclaw.debug.json) 里是否还保留 `plugins.load.paths` 和 `plugins.entries.realtime-background-assistant.enabled`。
- 如果断点不命中，优先确认调试会话是否 attach 到 `openclaw.mjs` 启动的 Node 进程，而不是只启动了 gateway 但没有附加调试器。
- `.openclaw-debug` 只用于运行时状态和日志，删掉后下次启动会重新生成。
