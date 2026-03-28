import { Type } from "@sinclair/typebox";

export const RealtimeBackgroundAssistantConfigSchema = Type.Object(
  {
    http: Type.Optional(
      Type.Object(
        {
          host: Type.Optional(Type.String({ default: "127.0.0.1" })),
          port: Type.Optional(
            Type.Number({ minimum: 0, maximum: 65_535, default: 18_189 }),
          ),
          basePath: Type.Optional(Type.String({ default: "/chat" })),
        },
        { additionalProperties: false },
      ),
    ),
    assistant: Type.Optional(
      Type.Object(
        {
          defaultAgentId: Type.Optional(Type.String({ default: "main" })),
          defaultConversationId: Type.Optional(Type.String({ default: "main" })),
          defaultSystemPrompt: Type.Optional(Type.String()),
          runTimeoutMs: Type.Optional(Type.Number({ minimum: 1_000, default: 120_000 })),
          maxMessages: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 50 })),
        },
        { additionalProperties: false },
      ),
    ),
    screenshot: Type.Optional(
      Type.Object(
        {
          timeoutMs: Type.Optional(Type.Number({ minimum: 1_000, default: 15_000 })),
          maxBytes: Type.Optional(Type.Number({ minimum: 1, default: 6_291_456 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

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
  };
  screenshot?: {
    timeoutMs?: number;
    maxBytes?: number;
  };
};
