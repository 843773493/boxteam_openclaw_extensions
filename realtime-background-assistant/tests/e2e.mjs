#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { sendChatRequest } from '../src/utils/e2e-request.js';

/**
 * 这个文件专门放本地 e2e 测试场景，职责尽量收敛。
 *
 * 这里的写法遵循两个原则：
 * 1. 每个测试场景的核心参数直接写在本文件里，方便一眼看出这次到底在测什么。
 * 2. 通用的 HTTP 发送逻辑放到 src/utils/e2e-request.js，避免重复代码散落到多个测试里。
 *
 * 这样做之后，这个文件就只需要描述“测试场景是什么、请求长什么样、
 * 以及运行时怎么选择场景”，不会被通用工具代码淹没。
 */
const chatEndpointUrl = 'http://127.0.0.1:18189/chat';

function createPayloadForLog(payload) {
    if (!payload?.attachments?.length) {
        return payload;
    }

    return {
        ...payload,
        attachments: payload.attachments.map((attachment) => ({
            ...attachment,
            content: '<base64 omitted>',
            contentLength: typeof attachment.content === 'string' ? attachment.content.length : undefined,
        })),
    };
}

/**
 * 打印一个测试场景的请求体和结果。
 *
 * 这个函数相当于单个场景的统一执行壳：
 * - 先打印场景名，方便在终端里区分多个测试块。
 * - 再打印人类可读的场景说明，避免只看 JSON 时忘记这条请求的目的。
 * - 然后打印完整 payload，便于复制、排查和对比差异。
 * - 最后打印服务端返回结果，方便直接确认测试是否命中预期。
 */
async function runScenario(name, description, payload) {
    console.log(`=== ${name} ===`);
    console.log(description);
    console.log(JSON.stringify(createPayloadForLog(payload), null, 2));

    const result = await sendChatRequest(payload, { endpointUrl: chatEndpointUrl });
    console.log(JSON.stringify(result, null, 2));
    console.log();

    return result;
}

/**
 * 图片测试：验证本地截图是否能被作为附件发送，并且 tester 能读出右下角时间。
 *
 * 这里的关键点是把本地图片直接读成 base64 后放进 attachments，
 * 这样可以验证插件是否真的接收到了图像数据，而不是只收到了文本。
 *
 * 这个场景通常用于检查：
 * - 图片附件是否能从本地文件正确读取。
 * - 请求体中的 attachments 结构是否符合服务端预期。
 * - tester 是否能基于图像内容回答截图右下角的时间。
 */
async function runImageTest() {
    // 这里直接定位仓库内的测试图片，确保本地 e2e 不依赖外部资源。
    const imagePath = fileURLToPath(new URL('../asset/img/test_desktop.png', import.meta.url));
    // 读取图片原始二进制内容，再转成 base64 作为附件 payload 的 content。
    const imageBuffer = await readFile(imagePath);

    // 图片测试的核心参数尽量集中写在这里，方便后续修改题目或附件文件时只改一个地方。
    const payload = {
        agentId: 'tester',
        conversationId: 'curl-check',
        includeMessages: true,
        maxMessages: 10,
        // 这条消息本身说明了测试目标：让 tester 直接回答图片里的时间。
        message: '[curl-test] 不调用任何tool，直接回答，请回复: tester是否已收到这条消息和图片？然后告诉我图中是否为完整屏幕截图，打开的软件叫什么，标签页中的仓库叫什么名称,图中右下角的时间是不是1:59，3月31日？',
        // idempotencyKey: 'curl-test-003',
        attachments: [
            {
                type: 'image',
                mimeType: 'image/png',
                fileName: 'test_desktop.png',
                content: imageBuffer.toString('base64'),
            },
        ],
    };

    return runScenario(
        'image',
        '验证图片附件是否能正常进入 /chat，并让 tester 读取截图右下角时间。',
        payload
    );
}

/**
 * 纯文本测试：验证最小聊天闭环。
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
        agentId: 'tester',
        conversationId: 'curl-check',
        includeMessages: true,
        maxMessages: 10,
        message: '[curl-test] 请回复: tester已收到这条消息',
        idempotencyKey: 'curl-test-001',
    };

    return runScenario(
        'text',
        '验证最基础的纯文本聊天链路，确认本地服务和 tester 代理可用。',
        payload
    );
}

/**
 * 流式测试：验证 speakMode=stream 的路径。
 *
 * 这个场景和纯文本测试几乎相同，只是额外带上 speakMode=stream，
 * 用来确认后端会进入流式回复分支，而不是普通一次性返回分支。
 */
async function runStreamTest() {
    // 这里刻意只在基础文本请求上加一个 speakMode 字段，方便观察它带来的行为差异。
    const payload = {
        agentId: 'tester',
        conversationId: 'curl-check',
        includeMessages: true,
        maxMessages: 10,
        message: '[curl-test] 请回复: tester已收到这条消息',
        idempotencyKey: 'curl-test-stream-001',
        speakMode: 'stream',
    };

    return runScenario(
        'stream',
        '验证 speakMode=stream 的流式回复链路。',
        payload
    );
}

/**
 * 测试函数注册表。
 *
 * 这里直接用函数名作为键，命令行传入什么函数名，就运行什么函数。
 * 这样后续新增测试时，只要把新函数挂到这个对象里，就不需要再改
 * 一长串 if/else 或 mode 映射逻辑。
 */
const testRunners = {
    runImageTest,
    runTextTest,
    runStreamTest,
};

/**
 * 根据命令行参数选择并运行测试函数。
 *
 * 运行方式改成“函数名直传”之后，脚本的调用方式会更直观：
 * - node tests/e2e.js runTextTest
 * - node tests/e2e.js runStreamTest
 * - node tests/e2e.js runImageTest
 *
 * 如果不传参数，则按注册表顺序把所有测试都跑一遍，方便一次性回归。
 */
async function main() {
    const runnerName = process.argv[2];

    if (!runnerName) {
        for (const runner of Object.values(testRunners)) {
            await runner();
        }
        return;
    }

    const runner = testRunners[runnerName];
    if (!runner) {
        console.error(`未找到测试函数: ${runnerName}`);
        console.error(`可用函数: ${Object.keys(testRunners).join(', ')}`);
        process.exitCode = 1;
        return;
    }

    await runner();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

export { runImageTest, runStreamTest, runTextTest, testRunners };

