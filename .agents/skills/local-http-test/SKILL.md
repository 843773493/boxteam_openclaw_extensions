---
name: local-http-test
description: 验证 openclaw 插件本地 HTTP 端口是否可用的测试技能
version: 1.0.0
---

# 本地 HTTP 测试技能

## 功能描述

这个技能用于验证 openclaw 插件的本地 HTTP 端口是否正常工作。它基于 realtime-background-assistant 项目的 e2e 测试代码，专门用于测试 `/chat` 端点的基础功能。

### 主要功能

1. **纯文本聊天测试**：验证最基础的纯文本聊天链路
2. **服务可用性检查**：确认本地服务和 tester 代理可用
3. **HTTP 端口验证**：测试本地 HTTP 端口 (默认 18189) 是否正常响应

## 使用方法

### 运行测试

```bash
# 使用默认配置运行测试
node .agents/skills/local-http-test/scripts/test-local-http.mjs

# 指定自定义端口
PORT=8080 node .agents/skills/local-http-test/scripts/test-local-http.mjs

# 指定自定义端点
ENDPOINT_URL=http://127.0.0.1:8080/chat node .agents/skills/local-http-test/scripts/test-local-http.mjs
```

### 配置选项

| 环境变量 | 默认值 | 描述 |
|---------|--------|------|
| `PORT` | 18189 | HTTP 端口号 |
| `HOST` | 127.0.0.1 | HTTP 主机地址 |
| `ENDPOINT_URL` | http://127.0.0.1:18189/chat | 完整的端点 URL |
| `AGENT_ID` | tester | 测试使用的代理 ID |
| `CONVERSATION_ID` | curl-check | 测试使用的会话 ID |

## 测试流程

1. 向本地 `/chat` 端点发送纯文本 POST 请求
2. 请求体包含最小必要字段：`agentId`, `conversationId`, `message`
3. 验证响应状态码和响应内容
4. 输出测试结果

## 预期结果

测试成功时，应该收到类似以下的响应：

```json
{
  "status": 200,
  "ok": true,
  "response": {
    "message": "tester已收到这条消息"
  }
}
```

## 错误排查

### 连接失败

如果遇到 "ECONNREFUSED" 错误，说明：
- 本地 HTTP 服务未启动
- 端口配置不正确
- 防火墙阻止了连接

### 超时错误

如果请求超时，检查：
- 服务是否正常运行
- 网络连接是否稳定
- 请求处理时间是否过长

### 响应解析错误

如果无法解析 JSON 响应，检查：
- 服务端是否返回了纯文本错误信息
- Content-Type 头是否正确设置
