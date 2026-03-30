export type SpeakForwardMode = "batch" | "stream";

export function resolveSpeakForwardMode(mode: unknown): SpeakForwardMode {
  return mode === "stream" ? "stream" : "batch";
}

export function createSpeakForwardStrategy(params: {
  mode: SpeakForwardMode;
  forward: (text: string) => Promise<void>;
}) {
  let sawStreamChunk = false;

  return {
    onChunk(text: string): Promise<void> | void {
      if (params.mode !== "stream") {
        return;
      }
      sawStreamChunk = true;
      return params.forward(text);
    },
    async onFinal(text: string): Promise<void> {
      if (params.mode === "batch" || !sawStreamChunk) {
        await params.forward(text);
      }
    },
  };
}
