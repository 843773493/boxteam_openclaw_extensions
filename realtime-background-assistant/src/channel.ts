import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FinalizedMsgContext } from "openclaw/auto-reply/templating";
import type { OpenClawConfig } from "openclaw/config/config";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createChannelPluginBase } from "openclaw/plugin-sdk/core";
import type { OutboundReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import { buildAgentMainSessionKey, normalizeAgentId } from "openclaw/plugin-sdk/routing";
import { normalizePluginHttpPath, registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import type { RealtimeBackgroundAssistantPluginConfig } from "./config.js";
import { createAssistantLogger, type AssistantLogger } from "./logger.js";
import { createSpeakForwardStrategy, resolveSpeakForwardMode } from "./speak-forward.js";

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
  senderId?: string;
  provider?: string;
  surface?: string;
  speakMode?: "batch" | "stream";
};

type ChatResponse = {
  ok: boolean;
  status: "ok" | "timeout" | "error";
  agentId: string;
  conversationId: string;
  sessionKey: string;
  runId: string;
  assistantText: string | null;
  messageCount: number;
  messages?: unknown[];
  error?: string;
};

type SpeakForwardConfig = {
  endpoint: string;
  agentIds: Set<string>;
  timeoutMs: number;
};

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSpeakForwardConfig(cfg: RealtimeBackgroundAssistantPluginConfig): SpeakForwardConfig | null {
  const speak = cfg.assistant?.speak;
  if (!speak) {
    return null;
  }

  const agentIds = (Array.isArray(speak.agentIds) ? speak.agentIds : [])
    .map((value) => asTrimmedString(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeAgentId(value));
  if (agentIds.length === 0) {
    return null;
  }

  return {
    endpoint: asTrimmedString(speak.endpoint) ?? "http://127.0.0.1:8787/speak",
    agentIds: new Set(agentIds),
    timeoutMs:
      typeof speak.timeoutMs === "number" && Number.isFinite(speak.timeoutMs) && speak.timeoutMs > 0
        ? speak.timeoutMs
        : 3_000,
  };
}

async function forwardSpeakMessage(params: {
  agentId: string;
  text: string;
  cfg: SpeakForwardConfig | null;
}): Promise<void> {
  if (!params.cfg || !params.cfg.agentIds.has(params.agentId)) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.cfg.timeoutMs);
  try {
    const response = await fetch(params.cfg.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ text: params.text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`speak endpoint returned ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function resolveStorePath(api: OpenClawPluginApi, agentId: string): string {
  const cfg = api.config as OpenClawConfig;
  return api.runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId });
}

function buildChannelContext(params: {
  api: OpenClawPluginApi;
  agentId: string;
  conversationId: string;
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  body: ChatRequestBody;
}): FinalizedMsgContext {
  const ctx = params.api.runtime.channel.reply.finalizeInboundContext({
    Body: params.message,
    BodyForAgent: params.message,
    RawBody: params.message,
    CommandBody: params.message,
    BodyForCommands: params.message,
    From: params.body.senderId ?? "local-user",
    To: params.conversationId,
    SessionKey: params.sessionKey,
    AccountId: params.agentId,
    ChatType: "direct",
    ConversationLabel: params.conversationId,
    SenderId: params.body.senderId ?? "local-user",
    Provider: params.body.provider ?? "realtime-background-assistant",
    Surface: params.body.surface ?? "realtime-background-assistant",
    MessageSid: params.idempotencyKey,
    MessageSidFull: params.idempotencyKey,
    Timestamp: Date.now(),
    OriginatingChannel: params.body.provider ?? "realtime-background-assistant",
    OriginatingTo: params.conversationId,
    CommandAuthorized: true,
  });

  return ctx;
}

export async function processChatRequest(params: {
  api: OpenClawPluginApi;
  cfg: RealtimeBackgroundAssistantPluginConfig;
  body: ChatRequestBody;
  logger: AssistantLogger;
}): Promise<ChatResponse> {
  const startedAt = Date.now();
  const message = asTrimmedString(params.body.message);
  if (!message) {
    throw new Error("message is required");
  }

  const agentId = normalizeAgentId(
    asTrimmedString(params.body.agentId) ?? params.cfg.assistant?.defaultAgentId ?? "main",
  );
  const conversationId =
    asTrimmedString(params.body.conversationId) ?? params.cfg.assistant?.defaultConversationId ?? "main";
  const sessionKey =
    asTrimmedString(params.body.sessionKey) ??
    buildAgentMainSessionKey({ agentId, mainKey: conversationId });
  const idempotencyKey = asTrimmedString(params.body.idempotencyKey) ?? randomUUID();
  const maxMessages =
    typeof params.body.maxMessages === "number" && Number.isFinite(params.body.maxMessages) && params.body.maxMessages > 0
      ? params.body.maxMessages
      : params.cfg.assistant?.maxMessages ?? 50;
  const speakMode = resolveSpeakForwardMode(params.body.speakMode);
  const speakForwardConfig = resolveSpeakForwardConfig(params.cfg);
  const logger = params.logger;
  const speakForwardStrategy = createSpeakForwardStrategy({
    mode: speakMode,
    forward: async (text: string) => {
      await forwardSpeakMessage({
        agentId,
        text,
        cfg: speakForwardConfig,
      });
    },
  });

  logger.debug("收到 /chat 请求", {
    context: {
      agentId,
      conversationId,
      sessionKey,
      deliver: params.body.deliver ?? false,
      lane: params.body.lane ?? null,
      timeoutMs: params.body.timeoutMs ?? null,
      includeMessages: params.body.includeMessages ?? false,
      maxMessages: params.body.maxMessages ?? null,
      speakMode,
      idempotencyKey,
    },
  });
  logger.info("/chat 请求进入处理链路", {
    context: {
      agentId,
      conversationId,
      sessionKey,
      idempotencyKey,
      messagePreview: message.slice(0, 120),
      bodyKeys: Object.keys(params.body ?? {}),
      hasSystemPrompt: Boolean(params.body.systemPrompt),
      deliver: params.body.deliver ?? false,
      lane: params.body.lane ?? null,
      speakMode,
    },
  });
  const ctxPayload = buildChannelContext({
    api: params.api,
    agentId,
    conversationId,
    sessionKey,
    message,
    idempotencyKey,
    body: params.body,
  });

  const deliveredParts: string[] = [];
  const runtime = params.api.runtime as any;

  logger.debug("准备记录会话上下文", {
    context: {
      agentId,
      conversationId,
      sessionKey,
      storePath: resolveStorePath(params.api, agentId),
      idempotencyKey,
    },
  });
  await runtime.channel.session.recordInboundSession({
    storePath: resolveStorePath(params.api, agentId),
    sessionKey,
    ctx: ctxPayload,
    onRecordError: (error) => {
      throw error instanceof Error ? error : new Error(String(error));
    },
  });

  logger.debug("已记录会话上下文", {
    context: {
      agentId,
      conversationId,
      sessionKey,
      idempotencyKey,
      elapsedMs: Date.now() - startedAt,
    },
  });

  logger.debug("准备派发回复", {
    context: {
      agentId,
      conversationId,
      sessionKey,
      deliver: params.body.deliver ?? false,
      lane: params.body.lane ?? null,
      speakMode,
      timeoutMs: params.body.timeoutMs ?? params.cfg.assistant?.runTimeoutMs ?? null,
    },
  });

  await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: params.api.config as OpenClawConfig,
    dispatcherOptions: {
      deliver: async (payload: OutboundReplyPayload) => {
        const text = asTrimmedString(payload.text);
        if (text) {
          deliveredParts.push(text);
          const streamedForward = speakForwardStrategy.onChunk(text);
          if (streamedForward) {
            void streamedForward.catch((error: unknown) => {
              logger.warn("speak 流式转发失败", {
                context: {
                  agentId,
                  conversationId,
                  sessionKey,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            });
          }
        }
      },
      onError: (error, info) => {
        throw new Error(
          `${info.kind} dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    },
  });

  logger.debug("回复派发完成", {
    context: {
      agentId,
      conversationId,
      sessionKey,
      deliveredPartCount: deliveredParts.length,
      elapsedMs: Date.now() - startedAt,
    },
  });

  let messages: unknown[] = [];
  let assistantText: string | null = null;
  const transcriptDeadline = Date.now() + 1_000;
  do {
    const session = await params.api.runtime.subagent.getSessionMessages({
      sessionKey,
      limit: maxMessages,
    });
    messages = Array.isArray(session.messages) ? session.messages : [];
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((entry) => {
        if (!entry || typeof entry !== "object") {
          return false;
        }
        return (entry as Record<string, unknown>).role === "assistant";
      });
    assistantText = extractTextFromMessage(lastAssistantMessage) ?? (deliveredParts.join("\n").trim() || null);
    if (assistantText) {
      break;
    }
    if (Date.now() < transcriptDeadline) {
      await delay(100);
    }
  } while (Date.now() < transcriptDeadline);

  logger.debug("已回读会话消息", {
    context: {
      agentId,
      conversationId,
      sessionKey,
      messageCount: messages.length,
      assistantTextPreview: assistantText?.slice(0, 160) ?? null,
      deliveredPartCount: deliveredParts.length,
      elapsedMs: Date.now() - startedAt,
    },
  });

  if (assistantText) {
    logger.debug("已生成助手回复", {
      context: {
        agentId,
        conversationId,
        sessionKey,
        assistantTextPreview: assistantText.slice(0, 160),
        speakMode,
        elapsedMs: Date.now() - startedAt,
      },
    });
    await speakForwardStrategy.onFinal(assistantText).catch((error: unknown) => {
      logger.warn("speak 转发失败", {
        context: {
          agentId,
          conversationId,
          sessionKey,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }

  logger.info("/chat 请求处理完成", {
    context: {
      agentId,
      conversationId,
      sessionKey,
      assistantTextPreview: assistantText?.slice(0, 160) ?? null,
      messageCount: messages.length,
      includeMessages: params.body.includeMessages ?? false,
      speakMode,
      deliveredPartCount: deliveredParts.length,
      elapsedMs: Date.now() - startedAt,
    },
  });

  return {
    ok: true,
    status: "ok",
    agentId,
    conversationId,
    sessionKey,
    runId: idempotencyKey,
    assistantText,
    messageCount: messages.length,
    ...(params.body.includeMessages ? { messages } : {}),
  };
}

export function createRealtimeBackgroundAssistantChannelPlugin(api: OpenClawPluginApi) {
  const logger = createAssistantLogger({
    consoleSink: api.logger,
    scope: "realtime-background-assistant:channel",
  });

  return {
    ...createChannelPluginBase({
      id: "realtime-background-assistant",
      capabilities: {
        chatTypes: ["direct"],
        reply: true,
      },
      config: {
        listAccountIds: () => ["main"],
        resolveAccount: () => ({ accountId: "main", enabled: true }),
        defaultAccountId: () => "main",
        isConfigured: () => true,
        describeAccount: () => ({
          accountId: "main",
          configured: true,
          enabled: true,
        }),
      } as any,
      setup: async () => undefined,
    }),
    gateway: {
      startAccount: async (ctx: any) => {
        const runtimeApi = {
          config: ctx.cfg,
          runtime: api.runtime,
          logger: ctx.log,
        } as unknown as OpenClawPluginApi;

        const cfg = ctx.cfg as RealtimeBackgroundAssistantPluginConfig;
        const basePath = normalizePluginHttpPath(cfg.http?.basePath, "/chat") ?? "/chat";
        const pluginPath = `/realtime-background-assistant${basePath}`;
        const pluginNamespacePath = `/plugins${pluginPath}`;

        const registerRoute = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>) =>
          registerPluginHttpRoute({
            path,
            auth: "plugin",
            replaceExisting: true,
            pluginId: "realtime-background-assistant",
            accountId: ctx.accountId,
            handler,
          });

        const respondOk = (_req: IncomingMessage, res: ServerResponse) => {
          sendJson(res, 200, {
            ok: true,
            plugin: "realtime-background-assistant",
            name: "Realtime Background Assistant",
          });
          return Promise.resolve(true);
        };

        const respondChat = async (req: IncomingMessage, res: ServerResponse) => {
          try {
            const body = (await readJsonBody(req)) as ChatRequestBody;
            const response = await processChatRequest({
              api: runtimeApi,
              cfg,
              body,
              logger,
            });
            sendJson(res, 200, response);
            return true;
          } catch (error) {
            logger.error("通道 /chat 请求处理失败", {
              context: {
                accountId: ctx.accountId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
            const agentId = normalizeAgentId(cfg.assistant?.defaultAgentId ?? "main");
            const conversationId = cfg.assistant?.defaultConversationId ?? "main";
            sendJson(res, 500, {
              ok: false,
              status: "error",
              agentId,
              conversationId,
              sessionKey: buildAgentMainSessionKey({ agentId, mainKey: conversationId }),
              assistantText: null,
              messageCount: 0,
              error: error instanceof Error ? error.message : String(error),
            });
            return true;
          }
        };

        const unregisterRoutes = [
          registerRoute("/health", respondOk),
          registerRoute(`/realtime-background-assistant/health`, respondOk),
          registerRoute(`/plugins/realtime-background-assistant/health`, respondOk),
          registerRoute(basePath, respondChat),
          registerRoute(pluginPath, respondChat),
          registerRoute(pluginNamespacePath, respondChat),
        ];

        logger.info("通道 HTTP 路由已注册", {
          console: true,
          context: {
            accountId: ctx.accountId,
            basePath,
            pluginPath,
            pluginNamespacePath,
            routeCount: unregisterRoutes.length,
          },
        });

        void ctx.abortSignal
          .addEventListener("abort", () => {
            logger.info("通道收到 abort，开始注销 HTTP 路由", {
              console: true,
              context: {
                accountId: ctx.accountId,
                routeCount: unregisterRoutes.length,
              },
            });
            for (const unregister of unregisterRoutes) {
              unregister();
            }
          }, { once: true });
      },
    },
  } as any;
}
