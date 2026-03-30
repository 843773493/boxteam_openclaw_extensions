import { describe, expect, it, vi } from "vitest";
import { createSpeakForwardStrategy, resolveSpeakForwardMode } from "./speak-forward.js";

describe("resolveSpeakForwardMode", () => {
  it("defaults to batch when mode is missing or invalid", () => {
    expect(resolveSpeakForwardMode(undefined)).toBe("batch");
    expect(resolveSpeakForwardMode("other")).toBe("batch");
  });

  it("accepts stream explicitly", () => {
    expect(resolveSpeakForwardMode("stream")).toBe("stream");
  });
});

describe("createSpeakForwardStrategy", () => {
  it("forwards each chunk immediately in stream mode and skips the final fallback", async () => {
    const forward = vi.fn(async () => {});
    const strategy = createSpeakForwardStrategy({
      mode: "stream",
      forward,
    });

    await strategy.onChunk("first chunk");
    await strategy.onChunk("second chunk");
    await strategy.onFinal("final text");

    expect(forward).toHaveBeenCalledTimes(2);
    expect(forward).toHaveBeenNthCalledWith(1, "first chunk");
    expect(forward).toHaveBeenNthCalledWith(2, "second chunk");
  });

  it("sends only the final text in batch mode", async () => {
    const forward = vi.fn(async () => {});
    const strategy = createSpeakForwardStrategy({
      mode: "batch",
      forward,
    });

    await strategy.onChunk("first chunk");
    await strategy.onChunk("second chunk");
    await strategy.onFinal("final text");

    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith("final text");
  });

  it("falls back to the final text when stream mode yields no chunks", async () => {
    const forward = vi.fn(async () => {});
    const strategy = createSpeakForwardStrategy({
      mode: "stream",
      forward,
    });

    await strategy.onFinal("final text");

    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith("final text");
  });
});
