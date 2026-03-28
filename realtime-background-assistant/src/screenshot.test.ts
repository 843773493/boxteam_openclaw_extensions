import os from "node:os";
import { beforeEach, describe, expect, it } from "vitest";
import {
    __test_only__resetPreferredTmpDirCache,
    __test_only__resolvePreferredOpenClawTmpDirCompat,
    resolveDesktopScreenshotCommand,
} from "./screenshot.js";

describe("captureDesktopScreenshot tmp-dir resolution", () => {
  beforeEach(() => {
    __test_only__resetPreferredTmpDirCache();
  });

  it("prefers infra-runtime helper when available", async () => {
    const resolved = await __test_only__resolvePreferredOpenClawTmpDirCompat({
      importer: async (moduleName) => {
        if (moduleName === "openclaw/plugin-sdk/infra-runtime") {
          return {
            resolvePreferredOpenClawTmpDir: () => "/tmp/openclaw-preferred",
          };
        }
        return {};
      },
    });

    expect(resolved).toBe("/tmp/openclaw-preferred");
  });

  it("falls back to os.tmpdir when helper is missing", async () => {
    const resolved = await __test_only__resolvePreferredOpenClawTmpDirCompat({
      importer: async () => {
        return {
          resolvePreferredOpenClawTmpDir: undefined,
        };
      },
    });

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
