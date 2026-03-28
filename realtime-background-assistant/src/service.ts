import { randomUUID } from "node:crypto";
import http from "node:http";
import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk/core";
import { buildAgentMainSessionKey, normalizeAgentId } from "openclaw/plugin-sdk/routing";
import type { RealtimeBackgroundAssistantPluginConfig } from "./config.js";

type ChatRequestBody = {
  message?: string;
  agentId?: string;
  conversationId?: string;
  sessionKey?: string;
  systemPrompt?: string;
  lane?: string;
  deliver?: boolean;
  timeoutMs?: number;
  includeMessages?: boolean;
  maxMessages?: number;
  idempotencyKey?: string;
};

type ChatResponse = {
  ok: boolean;
  status: "ok" | "timeout" | "error";
  agentId: string;
  conversationId: string;
  sessionKey: string;
  runId?: string;
  assistantText: string | null;
  messageCount: number;
  messages?: unknown[];
  error?: string;
};

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readJsonBody(req: http.IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buf.byteLength;
      if (received > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: ChatResponse | Record<string, unknown>) {
  const json = JSON.stringify(payload, null, 2);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(json));
  res.end(json);
}

function extractTextFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const rec = message as Record<string, unknown>;
  if (typeof rec.text === "string" && rec.text.trim()) {
    return rec.text.trim();
  }
  const content = rec.content;
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const texts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const block = part as Record<string, unknown>;
    if (typeof block.text === "string" && block.text.trim()) {
      texts.push(block.text.trim());
    }
  }
  const joined = texts.join("\n").trim();
  return joined || null;
}

function resolveChatSessionKey(params: {
  agentId: string;
  conversationId?: string;
  explicitSessionKey?: string;
}): string {
  const explicit = params.explicitSessionKey?.trim();
  if (explicit) {
    return explicit;
  }
  const conversationId = params.conversationId?.trim() || "main";
  return buildAgentMainSessionKey({ agentId: params.agentId, mainKey: conversationId });
}

async function handleChatRequest(params: {
  api: OpenClawPluginApi;
  cfg: RealtimeBackgroundAssistantPluginConfig;
  req: http.IncomingMessage;
  res: http.ServerResponse;
}): Promise<void> {
  const body = (await readJsonBody(params.req)) as ChatRequestBody;
  const message = asTrimmedString(body.message);
  if (!message) {
    sendJson(params.res, 400, { ok: false, error: "message is required" });
    return;
  }

  const agentId = normalizeAgentId(
    asTrimmedString(body.agentId) ?? params.cfg.assistant?.defaultAgentId ?? "main",
  );
  const conversationId =
    asTrimmedString(body.conversationId) ?? params.cfg.assistant?.defaultConversationId ?? "main";
  const sessionKey = resolveChatSessionKey({
    agentId,
    conversationId,
    explicitSessionKey: asTrimmedString(body.sessionKey),
  });
  const systemPrompt =
    asTrimmedString(body.systemPrompt) ?? params.cfg.assistant?.defaultSystemPrompt ?? undefined;
  const timeoutMs =
    typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs) && body.timeoutMs > 0
      ? body.timeoutMs
      : params.cfg.assistant?.runTimeoutMs ?? 120_000;
  const maxMessages =
    typeof body.maxMessages === "number" && Number.isFinite(body.maxMessages) && body.maxMessages > 0
      ? body.maxMessages
      : params.cfg.assistant?.maxMessages ?? 50;
  const idempotencyKey = asTrimmedString(body.idempotencyKey) ?? randomUUID();

  try {
    const run = await params.api.runtime.subagent.run({
      sessionKey,
      message,
      deliver: body.deliver ?? false,
      ...(systemPrompt ? { extraSystemPrompt: systemPrompt } : {}),
      ...(body.lane ? { lane: body.lane } : {}),
      idempotencyKey,
    });

    const wait = await params.api.runtime.subagent.waitForRun({
      runId: run.runId,
      timeoutMs,
    });

    const session = await params.api.runtime.subagent.getSessionMessages({
      sessionKey,
      limit: maxMessages,
    });
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((entry) => {
        if (!entry || typeof entry !== "object") {
          return false;
        }
        return (entry as Record<string, unknown>).role === "assistant";
      });
    const replyText = extractTextFromMessage(lastAssistantMessage);

    const response: ChatResponse = {
      ok: wait.status !== "error",
      status: wait.status,
      agentId,
      conversationId,
      sessionKey,
      runId: run.runId,
      assistantText: replyText,
      messageCount: messages.length,
      ...(body.includeMessages ? { messages } : {}),
      ...(wait.error ? { error: wait.error } : {}),
    };

    sendJson(params.res, wait.status === "error" ? 500 : wait.status === "timeout" ? 202 : 200, response);
  } catch (error) {
    sendJson(params.res, 500, {
      ok: false,
      status: "error",
      agentId,
      conversationId,
      sessionKey,
      assistantText: null,
      messageCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createRealtimeBackgroundAssistantService(api: OpenClawPluginApi): OpenClawPluginService {
  let server: http.Server | null = null;
  let currentAddress: string | null = null;

  return {
    id: "realtime-background-assistant-http",
    async start(ctx) {
      const cfg = (api.pluginConfig ?? {}) as RealtimeBackgroundAssistantPluginConfig;
      const host = asTrimmedString(cfg.http?.host) ?? "127.0.0.1";
      const port = typeof cfg.http?.port === "number" ? cfg.http.port : 18_189;
      const basePath = (asTrimmedString(cfg.http?.basePath) ?? "/chat").replace(/\/$/, "") || "/chat";

      server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://${host}:${port || 0}`);
        if (req.method === "GET" && url.pathname === "/health") {
          sendJson(res, 200, {
            ok: true,
            plugin: api.id,
            name: api.name,
            address: currentAddress,
          });
          return;
        }
        if (req.method === "POST" && url.pathname === basePath) {
          await handleChatRequest({ api, cfg, req, res });
          return;
        }
        if (req.method !== "GET" && req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("allow", "GET, POST");
          res.end("Method Not Allowed");
          return;
        }
        res.statusCode = 404;
        res.end("Not Found");
      });

      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(port, host, () => {
          const address = server?.address();
          if (typeof address === "object" && address) {
            currentAddress = `${address.address}:${address.port}`;
          } else {
            currentAddress = `${host}:${port}`;
          }
          ctx.logger.info(
            `realtime-background-assistant: HTTP chat listening on ${currentAddress}${basePath}`,
          );
          resolve();
        });
      });
    },
    async stop(ctx) {
      if (!server) {
        return;
      }
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = null;
      currentAddress = null;
      ctx.logger.info("realtime-background-assistant: HTTP chat stopped");
    },
  };
}
