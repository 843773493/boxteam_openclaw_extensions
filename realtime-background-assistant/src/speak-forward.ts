import type { AssistantLogger } from "./logger.js";

export type SpeakForwardMode = "batch" | "stream";

export function resolveSpeakForwardMode(mode: unknown): SpeakForwardMode {
  return mode === "stream" ? "stream" : "batch";
}

export function createSpeakForwardStrategy(params: {
  mode: SpeakForwardMode;
  forward: (text: string) => Promise<void>;
  logger?: AssistantLogger;
}) {
  let sawStreamChunk = false;

  return {
    onChunk(text: string): Promise<void> | void {
      if (params.mode !== "stream") {
        params.logger?.debug("speak forward onChunk 跳过非流式模式", {
          context: {
            mode: params.mode,
            text,
          },
        });
        return;
      }
      sawStreamChunk = true;
      params.logger?.debug("speak forward onChunk 执行流式转发", {
        context: {
          mode: params.mode,
          text,
        },
      });
      return params.forward(text);
    },
    async onFinal(text: string): Promise<void> {
      if (params.mode === "batch" || !sawStreamChunk) {
        params.logger?.debug("speak forward onFinal 执行最终转发", {
          context: {
            mode: params.mode,
            sawStreamChunk,
            text,
          },
        });
        await params.forward(text);
        return;
      }
      params.logger?.debug("speak forward onFinal 跳过最终转发", {
        context: {
          mode: params.mode,
          sawStreamChunk,
          text,
        },
      });
    },
  };
}
