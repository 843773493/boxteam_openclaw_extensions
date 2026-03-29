# 实时后台助手智能体开发规范

本文档定义 `realtime-background-assistant` 这个 OpenClaw 插件的开发约束、消息流设计和验收标准。后续实现、联调和回归测试都以本规范为准。

## 1. 目标

该插件的核心目标是把 OpenClaw 的子代理能力暴露为一个本地后台服务，让外部客户端可以通过 HTTP 把消息送入 OpenClaw，并拿到稳定、可重试、可验证的回复。

必须满足以下能力：

- 提供本地 HTTP 聊天入口，默认监听 `127.0.0.1:18189`
- 支持 `GET /health` 健康检查
- 支持 `POST /chat` 发送消息并等待助手回复
- 支持返回会话上下文中的消息列表，便于调试和验收
- 支持可选的文本转语音转发，但不得影响主链路成功率
- 支持桌面截图能力，作为辅助工具能力保留

## 2. 实现原则

### 2.1 单一职责

插件只负责消息接入、会话路由、结果输出和最小必要的转发，不在插件层塞入复杂业务逻辑。复杂的推理、工具调用和回复编排交给 OpenClaw 的子代理运行时。

### 2.2 稳定优先

主链路必须优先保证可用性和可验收性。任何附加功能，尤其是 speak 转发、额外上下文收集和调试信息输出，都不能阻塞 `/chat` 的成功响应。

### 2.3 幂等与可重试

HTTP 请求应尽量支持幂等语义。若客户端未传 `idempotencyKey`，插件应自动补齐，以便同一消息在重试场景下保持一致的运行标识。

### 2.4 与 OpenClaw 运行时对齐

消息输入和输出的组织方式应参考 `reference_repo/openclaw-qqbot` 的 channel 实现，而不是简单把请求体直接透传给模型。对于需要进入会话系统的消息，必须先构造标准上下文，再交给运行时完成记录、调度和回复分发。

### 2.5 插件加载模式

`realtime-background-assistant` 必须按普通 full plugin 加载，入口只注册 service 和工具，不要在 manifest 里声明 `channels`。

否则框架会跳过 `registerService()` 的实际注册，`startPluginServices()` 不会启动 HTTP 监听。

## 3. 消息输入规范

### 3.1 HTTP 请求入口

`POST /chat` 是唯一的消息入口。请求体至少包含：

- `message`：用户消息，必填
- `agentId`：代理 ID，可选，默认 `main`
- `conversationId`：会话 ID，可选，默认 `main`
- `sessionKey`：显式会话键，可选
- `systemPrompt`：额外系统提示，可选
- `lane`：子代理运行路线，可选
- `deliver`：是否让运行时执行投递，可选，默认 `false`
- `timeoutMs`：等待超时，可选
- `includeMessages`：是否返回会话消息，可选
- `maxMessages`：返回的最大消息数，可选
- `idempotencyKey`：请求幂等键，可选

### 3.2 会话键规则

优先使用显式 `sessionKey`。如果没有显式值，则按 `agentId + conversationId` 构造稳定的会话键。这样可以保证同一个代理在同一会话中的上下文连续。

### 3.3 上下文构造规则

消息进入运行时前，必须构造完整的消息上下文，至少包含：

- 原始消息正文
- 发送者标识
- 会话标识
- 代理标识
- 运行来源标识
- 幂等消息 ID
- 发送时间戳

如果后续要扩展消息来源字段，也要保持这些基础字段的语义稳定。

## 4. 消息输出规范

### 4.1 输出形态

`/chat` 的成功响应必须能让调用方直接判断本次请求是否成功、是否超时，以及最后一次助手回复是什么。

成功响应至少包含：

- `ok`
- `status`
- `agentId`
- `conversationId`
- `sessionKey`
- `runId`
- `assistantText`
- `messageCount`

当请求要求返回消息列表时，还应返回 `messages`。

### 4.2 语义要求

- `assistantText` 应尽量提取最后一条助手消息的可读文本
- `messageCount` 用于表征当前会话读取到的消息数量
- `status` 的取值必须和运行结果一致，至少区分 `ok`、`timeout`、`error`
- 即使发生 speak 转发失败，只要主回复已经成功生成，主响应仍应保持成功

### 4.3 错误输出

错误响应必须携带可读错误信息，并保留代理和会话标识，便于排查。输入缺失时应返回清晰的参数错误信息，不得返回模糊的通用失败。

## 5. 参考实现要求

消息输入输出的实现方式应参考 `reference_repo/openclaw-qqbot` 的 channel 处理方式，重点是以下两个步骤：

1. 先把外部输入记录成标准会话上下文
2. 再交给回复分发器生成并收集输出文本

换句话说，插件不应只把 HTTP body 直接当成回答结果，而应走和通道消息一致的处理链路。这样可以保证后续扩展命令、工具调用、流式块回复和会话追踪时不需要重写输入输出层。

## 6. 配置要求

### 6.1 HTTP 配置

- `host`：绑定主机，默认 `127.0.0.1`
- `port`：绑定端口，默认 `18189`
- `basePath`：聊天路径，默认 `/chat`

### 6.2 助手配置

- `defaultAgentId`：默认代理 ID，默认 `main`
- `defaultConversationId`：默认会话 ID，默认 `main`
- `defaultSystemPrompt`：默认系统提示
- `runTimeoutMs`：运行等待超时
- `maxMessages`：会话读取条数
- `speak.endpoint`：文本转语音转发端点
- `speak.agentIds`：触发转发的代理 ID 列表
- `speak.timeoutMs`：转发超时

### 6.3 截图能力

截图能力作为辅助工具保留，配置只需要保证截图超时和最大字节数可控即可。截图本身不是 `/chat` 验收的主路径，但不能破坏聊天链路。

## 7. 验收标准

实现完成后，必须满足下面的终端验收命令：

1. 启动 OpenClaw gateway，并确保 `realtime-background-assistant` 插件已加载
2. 执行下面的请求

```bat
curl.exe -sS -X POST "http://127.0.0.1:18189/chat" -H "content-type: application/json" --data-raw "{\"message\":\"[curl-test] 请回复: tester已收到这条消息\",\"agentId\":\"tester\",\"conversationId\":\"curl-check\",\"includeMessages\":true,\"maxMessages\":10,\"idempotencyKey\":\"curl-test-001\"}"
```

1. 返回结果必须是成功响应，且 `assistantText` 中能看到预期的回复语义
2. `includeMessages=true` 时，响应中应带回消息列表，便于确认会话状态
3. 若同一请求重复发送，幂等键不应破坏会话稳定性

## 8. 日志要求

- 所有调试与联调日志必须写入 `~/.openclaw/logs/realtime-background-assistant.log`
- 终端输出只保留核心任务消息，例如插件启动、停止和关键状态变更
- 后续 agent 调试、排障和回归确认优先查看上述日志文件，不以 console 细节作为主要依据
- 日志内容应尽量包含代理、会话、运行 ID 和错误摘要，便于直接定位到具体请求

### 8.1 启动判定

联调时如果只有 `realtime-background-assistant 插件启动成功`，而没有 `HTTP chat 服务准备启动` 和 `HTTP chat listening`，先检查是否误声明了 `channels`，再查核心配置是否异常。

## 9. 开发约束

- 不要为了通过测试而把消息链路写成一次性的硬编码回包
- 不要让 speak 转发失败影响主响应
- 不要把会话上下文构造成非标准格式，后续扩展会依赖标准字段
- 不要忽略 `idempotencyKey`，它是重复请求和回归测试的重要定位点
- 不要改变默认端口和路径语义，除非同步更新文档和验收脚本

## 10. 交付说明

本规范的交付重点不是“写一段能跑的示例代码”，而是让后续实现具备稳定的消息入口、稳定的消息输出、明确的测试命令，以及和 OpenClaw 通道实现一致的上下文处理方式。

如果后续需要继续扩展，优先补充：

- 事件级调试日志约定
- 流式回复与块分发约定
- 多代理路由规则
- 工具调用与截图能力的协作规范
