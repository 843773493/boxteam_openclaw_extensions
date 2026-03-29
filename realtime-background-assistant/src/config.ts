export const RealtimeBackgroundAssistantConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    http: {
      type: "object",
      additionalProperties: false,
      properties: {
        host: { type: "string", default: "127.0.0.1" },
        port: { type: "number", minimum: 0, maximum: 65_535, default: 18_189 },
        basePath: { type: "string", default: "/chat" },
      },
    },
    assistant: {
      type: "object",
      additionalProperties: false,
      properties: {
        defaultAgentId: { type: "string", default: "main" },
        defaultConversationId: { type: "string", default: "main" },
        defaultSystemPrompt: { type: "string" },
        runTimeoutMs: { type: "number", minimum: 1_000, default: 120_000 },
        maxMessages: { type: "number", minimum: 1, maximum: 200, default: 50 },
        speak: {
          type: "object",
          additionalProperties: false,
          properties: {
            endpoint: { type: "string", default: "http://127.0.0.1:8787/speak" },
            agentIds: { type: "array", items: { type: "string" } },
            timeoutMs: { type: "number", minimum: 100, default: 3_000 },
          },
        },
      },
    },
    screenshot: {
      type: "object",
      additionalProperties: false,
      properties: {
        timeoutMs: { type: "number", minimum: 1_000, default: 15_000 },
        maxBytes: { type: "number", minimum: 1, default: 6_291_456 },
      },
    },
  },
} as const;

export type RealtimeBackgroundAssistantPluginConfig = {
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
};
