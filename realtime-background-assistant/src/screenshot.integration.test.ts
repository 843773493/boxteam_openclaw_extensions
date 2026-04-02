import { spawnSync } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { captureDesktopScreenshot } from "./screenshot.js";

function createMockRuntime(): PluginRuntime {
  return {
    system: {
      runCommandWithTimeout: vi.fn(
        (command: string[], options: { timeoutMs: number; env?: Record<string, string> }) => {
          const result = spawnSync(command[0], command.slice(1), {
            env: {
              ...process.env,
              ...options.env,
            },
            shell: false,
            stdio: "inherit",
            timeout: options.timeoutMs,
          });

          if (result.error) {
            throw result.error;
          }

          if (result.status !== 0) {
            throw new Error(`screenshot command failed with exit code ${result.status ?? "unknown"}`);
          }
        },
      ),
    },
    media: {
      getImageMetadata: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as PluginRuntime;
}

describe("captureDesktopScreenshot integration", () => {
  it("captures a desktop screenshot and copies it into output", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const runtime = createMockRuntime();

    const runCommandWithTimeout = runtime.system.runCommandWithTimeout as ReturnType<typeof vi.fn>;
    const getImageMetadata = runtime.media.getImageMetadata as ReturnType<typeof vi.fn>;

    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const outputDir = path.join(packageRoot, "output");

    await mkdir(outputDir, { recursive: true });

    const result = await captureDesktopScreenshot({
      runtime,
      config: {
        timeoutMs: 30_000,
        maxBytes: 20 * 1024 * 1024,
      },
    });

    expect(runCommandWithTimeout).toHaveBeenCalledTimes(1);
    expect(getImageMetadata).toHaveBeenCalledTimes(1);

    const outputPath = path.join(outputDir, `integration-${Date.now()}.png`);
    await copyFile(result.path, outputPath);

    const outputStat = await stat(outputPath);
    expect(outputStat.size).toBeGreaterThan(0);
  });
});
