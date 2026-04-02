# 本地 HTTP 测试技能

## 功能概述

这是一个专门用于测试 openclaw 插件本地 HTTP 端口可用性的测试技能。它基于 realtime-background-assistant 项目中的 `runTextTest` 测试函数，提供了简单而有效的端口健康检查功能。

## 核心功能

### 1. 纯文本聊天链路验证

- 向本地 `/chat` 端点发送最小化 JSON 请求
- 验证 HTTP 端口是否正常响应
- 检查 JSON 解析和响应处理是否正常

### 2. 服务可用性检查

- 测试本地服务是否正在运行
- 验证 tester 代理是否可用
- 确认网络连接是否正常

### 3. 灵活的配置支持

- 支持环境变量配置端口、主机和端点
- 提供合理的默认值
- 允许自定义测试参数

## 技术实现

### 基于 e2e 测试的简化版本

这个技能的代码来源于 realtime-background-assistant 项目的端到端测试套件。主要特点：

1. **精简的请求结构**：只包含必要的字段 (`agentId`, `conversationId`, `message`)
2. **通用的发送逻辑**：复用了原始测试中的 `sendChatRequest` 函数设计
3. **完整的错误处理**：处理网络错误、JSON 解析错误和 HTTP 错误

### 请求示例

```json
{
  "agentId": "tester",
  "conversationId": "curl-check",
  "includeMessages": true,
  "maxMessages": 10,
  "message": "[curl-test] 请回复: tester已收到这条消息",
  "idempotencyKey": "curl-test-1234567890"
}
```

### 响应示例

成功响应：
```json
{
  "status": 200,
  "ok": true,
  "response": {
    "message": "tester已收到这条消息"
  }
}
```

失败响应：
```json
{
  "status": 0,
  "ok": false,
  "error": "connect ECONNREFUSED 127.0.0.1:18189",
  "code": "ECONNREFUSED"
}
```

## 使用场景

### 开发调试

在开发 openclaw 插件时，可以使用这个技能快速验证本地 HTTP 服务是否正常启动。

### 环境验证

在部署或配置新环境时，使用此技能检查端口配置是否正确。

### 故障排查

当遇到连接问题时，可以使用此技能进行初步诊断。

## 扩展建议

这个基础技能可以扩展为更完整的测试套件，例如：

1. **图片测试**：添加图片附件支持，验证文件上传功能
2. **流式测试**：添加 `speakMode=stream` 参数，测试流式响应
3. **并发测试**：同时发送多个请求，测试服务并发处理能力
4. **性能测试**：记录响应时间，评估服务性能

## 相关文件

- `SKILL.md`：技能使用说明和配置指南
- `scripts/test-local-http.mjs`：主要的测试脚本
- `README.md`：本文件，提供功能概述和技术细节