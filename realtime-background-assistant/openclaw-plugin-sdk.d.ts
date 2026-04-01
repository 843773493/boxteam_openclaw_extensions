declare module "openclaw/plugin-sdk/core" {
  export function createChannelPluginBase(options: unknown): any;
  export type OpenClawPluginApi = any;
  export type OpenClawPluginService = any;
  export type PluginRuntime = any;
}

declare module "openclaw/plugin-sdk/reply-payload" {
  export type OutboundReplyPayload = {
    text?: string;
    [key: string]: unknown;
  };
}

declare module "openclaw/plugin-sdk/webhook-ingress" {
  export function normalizePluginHttpPath(path: unknown, defaultPath: string): string | null;
  export function registerPluginHttpRoute(options: {
    path: string;
    auth: "plugin" | "none";
    replaceExisting?: boolean;
    pluginId: string;
    accountId?: string;
    handler: (req: any, res: any) => boolean | Promise<boolean>;
  }): () => void;
}

declare module "openclaw/auto-reply/templating" {
  export type FinalizedMsgContext = Record<string, unknown>;
}

declare module "openclaw/config/config" {
  export type OpenClawConfig = {
    session?: {
      store?: string;
    };
    http?: {
      host?: string;
      port?: number;
      basePath?: string;
    };
    assistant?: {
      defaultAgentId?: string;
      defaultConversationId?: string;
      defaultSystemPrompt?: string;
      runTimeoutMs?: number;
      maxMessages?: number;
      speak?: {
        endpoint?: string;
        agentIds?: string[];
        timeoutMs?: number;
      };
    };
    screenshot?: {
      timeoutMs?: number;
      maxBytes?: number;
    };
    [key: string]: unknown;
  };
}

declare module "openclaw/plugin-sdk/routing" {
  export function buildAgentMainSessionKey(params: { agentId: string; mainKey: string }): string;
  export function normalizeAgentId(agentId: string): string;
}