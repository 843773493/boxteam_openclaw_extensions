import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveSessionFilePath } from "../../../src/config/sessions/paths.js";
import { loadSessionStore, resolveSessionStoreEntry } from "../../../src/config/sessions/store.js";
import { createRealtimeBackgroundAssistantService } from "./src/service.js";

function createApi(overrides: Record<string, unknown> = {}) {
  const subagent = {
    run: vi.fn(async () => ({ runId: "run-123" })),
    waitForRun: vi.fn(async () => ({ status: "ok" as const })),
    getSessionMessages: vi.fn(async () => ({ messages: [] as unknown[] })),
  };

  return {
    id: "realtime-background-assistant",
    name: "Realtime Background Assistant",
    source: "test",
    config: { agents: { list: [{ id: "main" }] } },
    pluginConfig: {},
    runtime: {
      version: "test",
      system: { runCommandWithTimeout: vi.fn() },
      media: { getImageMetadata: vi.fn(), resizeToJpeg: vi.fn(), loadWebMedia: vi.fn() },
      subagent,
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerTool: vi.fn(),
    registerService: vi.fn(),
    ...overrides,
  };
}

describe("realtime background assistant service", () => {
  it("starts a local HTTP chat server and returns assistant text", async () => {
    const tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-rba-"));
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    const api = createApi({
      pluginConfig: {
        http: { host: "127.0.0.1", port: 0, basePath: "/chat" },
        assistant: { defaultAgentId: "main", defaultConversationId: "desk" },
      },
    });

    const service = createRealtimeBackgroundAssistantService(api as never);
    await service.start({ config: {} as never, stateDir: "", logger: api.logger as never });

    try {
      const chatLog = (api.logger.info as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
        String(call[0]).includes("HTTP chat listening"),
      )?.[0] as string | undefined;
      expect(chatLog).toMatch(/HTTP chat listening on 127\.0\.0\.1:\d+\/chat/);

      const portMatch = chatLog?.match(/127\.0\.0\.1:(\d+)\/chat/);
      expect(portMatch?.[1]).toBeDefined();
      const port = Number(portMatch?.[1]);

      const runtime = api.runtime as {
        subagent: {
          run: ReturnType<typeof vi.fn>;
          waitForRun: ReturnType<typeof vi.fn>;
          getSessionMessages: ReturnType<typeof vi.fn>;
        };
      };
      runtime.subagent.run.mockResolvedValueOnce({ runId: "run-123" });
      runtime.subagent.waitForRun.mockResolvedValueOnce({ status: "ok" as const });
      runtime.subagent.getSessionMessages.mockResolvedValueOnce({
        messages: [
          { role: "user", content: [{ type: "text", text: "hello" }] },
          { role: "assistant", content: [{ type: "text", text: "world" }] },
        ],
      });

      const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
      expect(healthResponse.status).toBe(200);

      const chatResponse = await fetch(`http://127.0.0.1:${port}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });
      expect(chatResponse.status).toBe(200);
      const json = (await chatResponse.json()) as { assistantText?: string; sessionKey?: string };
      expect(json.assistantText).toBe("world");
      expect(json.sessionKey).toBe("agent:main:desk");

      expect(runtime.subagent.run).toHaveBeenCalledOnce();
      expect(runtime.subagent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey: "agent:main:desk",
          message: "hello",
          deliver: false,
          idempotencyKey: expect.any(String),
        }),
      );
      expect(runtime.subagent.waitForRun).toHaveBeenCalledOnce();
      expect(runtime.subagent.getSessionMessages).toHaveBeenCalledOnce();

      const storePath = path.join(tempStateDir, "agents", "main", "sessions", "sessions.json");
      const store = loadSessionStore(storePath, { skipCache: true });
      const sessionEntry = resolveSessionStoreEntry({ store, sessionKey: "agent:main:desk" });
      expect(sessionEntry.existing?.sessionId).toBeDefined();

      const transcriptPath = resolveSessionFilePath(sessionEntry.existing!.sessionId, sessionEntry.existing, {
        agentId: "main",
        sessionsDir: path.dirname(storePath),
      });
      const transcript = await fs.readFile(transcriptPath, "utf8");
      expect(transcript).toContain('"role":"user"');
      expect(transcript).toContain("hello");
    } finally {
      await service.stop?.({ config: {} as never, stateDir: "", logger: api.logger as never });
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
  });
});
