import { spawnSync } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { captureDesktopScreenshot } from "./screenshot.js";

function createIntegrationRuntime() {
  return {
    system: {
      runCommandWithTimeout(command: string[], options: { timeoutMs: number; env?: Record<string, string> }) {
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
    },
    media: {
      async getImageMetadata() {
        return undefined;
      },
    },
  };
}

test("captures a desktop screenshot and copies it into output", async () => {
  if (process.platform !== "win32") {
    return;
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outputDir = path.join(packageRoot, "output");

  await mkdir(outputDir, { recursive: true });

  const result = await captureDesktopScreenshot({
    runtime: createIntegrationRuntime() as never,
    config: {
      timeoutMs: 30_000,
      maxBytes: 20 * 1024 * 1024,
    },
  });

  const outputPath = path.join(outputDir, `integration-${Date.now()}.png`);
  await copyFile(result.path, outputPath);

  const outputStat = await stat(outputPath);
  expect(outputStat.size).toBeGreaterThan(0);
});
