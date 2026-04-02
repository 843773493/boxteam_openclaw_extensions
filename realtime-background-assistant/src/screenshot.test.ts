import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDesktopScreenshotCommand } from "./screenshot.js";

describe("captureDesktopScreenshot tmp-dir resolution", () => {
  it("prefers infra-runtime helper when available", async () => {
    const importer = vi.fn(async (moduleName: string) => {
      if (moduleName === "openclaw/plugin-sdk/infra-runtime") {
        return {
          resolvePreferredOpenClawTmpDir: () => "/tmp/openclaw-preferred",
        };
      }
      return {};
    });

    const { __test_only__resolvePreferredOpenClawTmpDirCompat, __test_only__resetPreferredTmpDirCache } =
      await import("./screenshot.js");

    __test_only__resetPreferredTmpDirCache();
    const resolved = await __test_only__resolvePreferredOpenClawTmpDirCompat({ importer });

    expect(resolved).toBe("/tmp/openclaw-preferred");
    expect(importer).toHaveBeenCalled();
  });

  it("falls back to os.tmpdir when helper is missing", async () => {
    const importer = vi.fn(async () => ({
      resolvePreferredOpenClawTmpDir: undefined,
    }));

    const { __test_only__resolvePreferredOpenClawTmpDirCompat, __test_only__resetPreferredTmpDirCache } =
      await import("./screenshot.js");

    __test_only__resetPreferredTmpDirCache();
    const resolved = await __test_only__resolvePreferredOpenClawTmpDirCompat({ importer });

    expect(resolved).toBe(os.tmpdir());
  });
});

describe("resolveDesktopScreenshotCommand", () => {
  it("builds a Windows PowerShell command", () => {
    const command = resolveDesktopScreenshotCommand({
      platform: "win32",
      outputPath: "C:/tmp/out.png",
    });

    expect(command[0]).toBe("powershell.exe");
    expect(command.join(" ")).toContain("CopyFromScreen");
    expect(command.join(" ")).toContain("SetProcessDPIAware");
    expect(command.join(" ")).toContain("GetSystemMetrics");
  });

  it("builds a macOS screencapture command", () => {
    const command = resolveDesktopScreenshotCommand({
      platform: "darwin",
      outputPath: "/tmp/out.png",
    });

    expect(command).toEqual(["screencapture", "-x", "-t", "png", "/tmp/out.png"]);
  });

  it("builds a Linux shell command chain", () => {
    const command = resolveDesktopScreenshotCommand({
      platform: "linux",
      outputPath: "/tmp/out.png",
    });

    expect(command[0]).toBe("bash");
    expect(command[2]).toContain("gnome-screenshot");
    expect(command[2]).toContain("grim");
  });
});
