#!/usr/bin/env node

/**
 * 本地 HTTP 端口测试脚本
 *
 * 这个脚本基于 runTextTest 函数的测试逻辑，用于验证 openclaw 插件的本地 HTTP 端口是否正常工作。
 * 它会向 /chat 端点发送一个简单的纯文本测试请求，并验证响应。
 */

import { pathToFileURL } from 'node:url';

// 配置默认值
const config = {
    port: process.env.PORT || '18189',
    host: process.env.HOST || '127.0.0.1',
    endpointUrl: process.env.ENDPOINT_URL || null,
    agentId: process.env.AGENT_ID || 'tester',
    conversationId: process.env.CONVERSATION_ID || 'curl-check',
};

// 如果没有指定完整的端点 URL，根据 host 和 port 构建
if (!config.endpointUrl) {
    config.endpointUrl = `http://${config.host}:${config.port}/chat`;
}

/**
 * 向本地 /chat 接口发送请求，并统一整理返回结果。
 *
 * 这个函数是通用的发送层，上层只需要提供 payload。
 * 它会把响应尽量解析成 JSON；如果服务端返回的是纯文本，
 * 就保留原文，方便直接看报错内容。
 */
async function sendChatRequest(payload, options = {}) {
    const endpointUrl = options.endpointUrl ?? config.endpointUrl;
    
    try {
        const response = await fetch(endpointUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const responseText = await response.text();
        let parsedResponse = responseText;

        try {
            parsedResponse = JSON.parse(responseText);
        } catch {
            // 非 JSON 响应保留原文，便于排查接口错误。
        }

        return {
            status: response.status,
            ok: response.ok,
            response: parsedResponse,
        };
    } catch (error) {
        return {
            status: 0,
            ok: false,
            error: error.message,
            code: error.code,
        };
    }
}

/**
 * 运行纯文本测试场景
 *
 * 这个场景不带任何附件，只验证最基础的消息发送和回复路径。
 * 它适合用来快速确认：
 * - 本地 /chat 接口是否可达。
 * - JSON 请求体是否能被正确解析。
 * - tester 代理是否能返回基础响应。
 */
async function runTextTest() {
    // 纯文本场景尽量只保留最小必要字段，减少干扰项。
    const payload = {
        agentId: config.agentId,
        conversationId: config.conversationId,
        includeMessages: true,
        maxMessages: 10,
        message: '[curl-test] 请回复: tester已收到这条消息',
        idempotencyKey: `curl-test-${Date.now()}`,
    };

    console.log('=== 本地 HTTP 端口测试 ===');
    console.log('验证最基础的纯文本聊天链路，确认本地服务和 tester 代理可用。');
    console.log(`端点: ${config.endpointUrl}`);
    console.log(`请求体: ${JSON.stringify(payload, null, 2)}`);

    const result = await sendChatRequest(payload, { endpointUrl: config.endpointUrl });
    console.log(`响应: ${JSON.stringify(result, null, 2)}`);

    return result;
}

/**
 * 主函数
 */
async function main() {
    console.log('开始本地 HTTP 端口测试...');
    console.log(`目标端点: ${config.endpointUrl}`);
    console.log();

    const result = await runTextTest();
    console.log();

    // 根据结果判断测试是否成功
    if (result.ok) {
        console.log('✓ 测试成功：本地 HTTP 端口正常响应');
        process.exitCode = 0;
    } else {
        console.log('✗ 测试失败：无法连接到本地 HTTP 服务');
        if (result.error) {
            console.log(`错误信息: ${result.error}`);
        }
        process.exitCode = 1;
    }
}

// 只在直接运行时执行主函数
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
    main().catch((error) => {
        console.error('测试执行出错:', error);
        process.exitCode = 1;
    });
}

export { runTextTest, sendChatRequest, config };