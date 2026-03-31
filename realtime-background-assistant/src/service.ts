/// <reference path="../node-shims.d.ts" />
/// <reference path="../openclaw-plugin-sdk.d.ts" />

import crypto from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import http from "node:http";
import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk/core";
import { buildAgentMainSessionKey, normalizeAgentId } from "openclaw/plugin-sdk/routing";
import { processChatRequest } from "./channel.js";
import { type ChatAttachment } from "./chat-attachments.js";
import type { RealtimeBackgroundAssistantPluginConfig } from "./config.js";
import { createAssistantLogger } from "./logger.js";

type ChatRequestBody = {
  message?: string;
  attachments?: ChatAttachment[];
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

function getRequestHeaders(req: IncomingMessage): Record<string, string | string[] | undefined> {
  return (req as IncomingMessage & { headers?: Record<string, string | string[] | undefined> }).headers ?? {};
}

function readJsonBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
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

function sendJson(res: ServerResponse, statusCode: number, payload: ChatResponse | Record<string, unknown>) {
  const json = JSON.stringify(payload, null, 2);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(json));
  res.end(json);
}

async function handleChatRequest(params: {
  api: OpenClawPluginApi;
  cfg: RealtimeBackgroundAssistantPluginConfig;
  req: IncomingMessage;
  res: ServerResponse;
  logger: ReturnType<typeof createAssistantLogger>;
}): Promise<void> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    params.logger.info("/chat 请求开始处理", {
      context: {
        requestId,
        method: params.req.method ?? null,
        url: params.req.url ?? null,
        contentType: getRequestHeaders(params.req)["content-type"] ?? null,
        contentLength: getRequestHeaders(params.req)["content-length"] ?? null,
      },
    });
    const body = (await readJsonBody(params.req, 20_000_000)) as ChatRequestBody;
    params.logger.debug("/chat 请求体解析完成", {
      context: {
        requestId,
        bodyKeys: body && typeof body === "object" ? Object.keys(body as Record<string, unknown>) : [],
        hasMessage: Boolean((body as ChatRequestBody).message),
        attachmentCount: Array.isArray((body as ChatRequestBody).attachments)
          ? (body as ChatRequestBody).attachments?.length ?? 0
          : 0,
        agentId: (body as ChatRequestBody).agentId ?? null,
        conversationId: (body as ChatRequestBody).conversationId ?? null,
        sessionKey: (body as ChatRequestBody).sessionKey ?? null,
        idempotencyKey: (body as ChatRequestBody).idempotencyKey ?? null,
      },
    });
    const response = await processChatRequest({
      api: params.api,
      cfg: params.cfg,
      body,
      logger: params.logger,
    });
    const statusCode = response.status === "error" ? 500 : response.status === "timeout" ? 202 : 200;
    params.logger.info("/chat 请求处理完成并准备返回", {
      context: {
        requestId,
        statusCode,
        status: response.status,
        runId: response.runId ?? null,
        assistantTextPreview: response.assistantText?.slice(0, 160) ?? null,
        messageCount: response.messageCount,
        elapsedMs: Date.now() - startedAt,
      },
    });
    sendJson(params.res, statusCode, response);
  } catch (error) {
    params.logger.error("/chat 请求处理失败", {
      context: {
        requestId,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    const defaultAgentId = params.cfg.assistant?.defaultAgentId ?? "main";
    const defaultConversationId = params.cfg.assistant?.defaultConversationId ?? "main";
    sendJson(params.res, 500, {
      ok: false,
      status: "error",
      agentId: defaultAgentId,
      conversationId: defaultConversationId,
      sessionKey: `agent:${normalizeAgentId(defaultAgentId)}:${defaultConversationId}`,
      assistantText: null,
      messageCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createRealtimeBackgroundAssistantService(api: OpenClawPluginApi): OpenClawPluginService {
  let server: Server | null = null;
  let currentAddress: string | null = null;
  const logger = createAssistantLogger({
    consoleSink: api.logger,
    scope: "realtime-background-assistant:service",
  });

  return {
    id: "realtime-background-assistant-http",
    async start(_ctx: any) {
      const cfg = (api.pluginConfig ?? {}) as RealtimeBackgroundAssistantPluginConfig;
      const host = asTrimmedString(cfg.http?.host) ?? "127.0.0.1";
      const port = typeof cfg.http?.port === "number" ? cfg.http.port : 18_189;
      const basePath = (asTrimmedString(cfg.http?.basePath) ?? "/chat").replace(/\/$/, "") || "/chat";

      logger.info("HTTP chat 服务准备启动", {
        console: true,
        context: { host, port, basePath },
      });

      server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const requestId = crypto.randomUUID();
        try {
          const url = new URL(req.url ?? "/", `http://${host}:${port || 0}`);
          const headers = getRequestHeaders(req);
          logger.debug("收到 HTTP 请求", {
            context: {
              requestId,
              method: req.method ?? null,
              rawUrl: req.url ?? null,
              pathname: url.pathname,
              search: url.search,
              contentType: headers["content-type"] ?? null,
              contentLength: headers["content-length"] ?? null,
            },
          });
          if (req.method === "GET" && url.pathname === "/health") {
            logger.debug("命中 /health", { context: { requestId } });
            sendJson(res, 200, {
              ok: true,
              plugin: api.id,
              name: api.name,
              address: currentAddress,
            });
            return;
          }
          if (req.method === "POST" && url.pathname === basePath) {
            logger.debug("命中聊天路由", { context: { requestId, basePath } });
            await handleChatRequest({ api, cfg, req, res, logger });
            return;
          }
          if (req.method !== "GET" && req.method !== "POST") {
            logger.warn("HTTP 方法不被支持", { context: { requestId, method: req.method ?? null } });
            res.statusCode = 405;
            res.setHeader("allow", "GET, POST");
            res.end("Method Not Allowed");
            return;
          }
          logger.debug("HTTP 路径未命中任何路由", {
            context: {
              requestId,
              method: req.method ?? null,
              pathname: url.pathname,
              basePath,
            },
          });
          res.statusCode = 404;
          res.end("Not Found");
        } catch (error) {
          logger.error("HTTP 路由处理失败", {
            context: {
              requestId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          if (!res.headersSent) {
            sendJson(res, 400, {
              ok: false,
              status: "error",
              agentId: cfg.assistant?.defaultAgentId ?? "main",
              conversationId: cfg.assistant?.defaultConversationId ?? "main",
              sessionKey: buildAgentMainSessionKey({
                agentId: cfg.assistant?.defaultAgentId ?? "main",
                mainKey: cfg.assistant?.defaultConversationId ?? "main",
              }),
              assistantText: null,
              messageCount: 0,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });

      await new Promise<void>((resolve, reject) => {
        server?.once("error", (error: unknown) => {
          logger.error("HTTP 服务器监听失败", {
            context: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
          reject(error);
        });
        server?.listen(port, host, () => {
          const address = server?.address();
          if (typeof address === "object" && address) {
            currentAddress = `${address.address}:${address.port}`;
          } else {
            currentAddress = `${host}:${port}`;
          }
          logger.info(
            `realtime-background-assistant: HTTP chat listening on ${currentAddress}${basePath}`,
            { console: true },
          );
          resolve();
        });
      });
    },
    async stop(_ctx: any) {
      if (!server) {
        return;
      }
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = null;
      currentAddress = null;
      logger.info("realtime-background-assistant: HTTP chat stopped", { console: true });
    },
  };
}
