import { describe, expect, it, vi } from "vitest";
import { processChatRequest } from "./channel.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

function createMockApi() {
  const finalizeInboundContext = vi.fn((ctx: unknown) => ctx);
  const recordInboundSession = vi.fn().mockResolvedValue(undefined);
  const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async (params: any) => {
    expect(params.replyOptions?.images).toHaveLength(1);
    expect(params.replyOptions?.images?.[0]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: PNG_1X1,
    });
    await params.dispatcherOptions.deliver({ text: "图片已收到" });
  });
  const getSessionMessages = vi.fn().mockResolvedValue({ messages: [] });

  return {
    config: { session: { store: "tmp" } },
    pluginConfig: {},
    runtime: {
      channel: {
        reply: {
          finalizeInboundContext,
          dispatchReplyWithBufferedBlockDispatcher,
        },
        session: {
          resolveStorePath: vi.fn(() => "C:\\temp\\store"),
          recordInboundSession,
        },
      },
      subagent: {
        getSessionMessages,
      },
    },
  } as any;
}

describe("processChatRequest", () => {
  it("passes image attachments to the runtime as local media paths", async () => {
    const api = createMockApi();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any;

    const result = await processChatRequest({
      api,
      cfg: {
        assistant: {
          defaultAgentId: "main",
          defaultConversationId: "main",
        },
      },
      body: {
        message: "请看图",
        agentId: "tester",
        conversationId: "image-check",
        attachments: [
          {
            type: "image",
            mimeType: "image/png",
            fileName: "test_desktop.png",
            content: PNG_1X1,
          },
        ],
      },
      logger,
    });

    expect(result.ok).toBe(true);
    expect(result.assistantText).toBe("图片已收到");

    expect(api.runtime.channel.reply.finalizeInboundContext).toHaveBeenCalledTimes(1);
    const input = api.runtime.channel.reply.finalizeInboundContext.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.Body).toBe("请看图");
    expect(input.BodyForAgent).toBe("请看图");
    expect(input.MediaPath).toEqual(expect.stringContaining("test_desktop.png"));
    expect(input.MediaPaths).toEqual([input.MediaPath]);
    expect(input.MediaUrl).toEqual(input.MediaPath);
    expect(input.MediaUrls).toEqual([input.MediaPath]);
  });
});