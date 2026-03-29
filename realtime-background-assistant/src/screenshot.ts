import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

export type DesktopScreenshotConfig = {
  timeoutMs: number;
  maxBytes: number;
};

export type DesktopScreenshotResult = {
  path: string;
  base64: string;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
};

type ResolvePreferredTmpDirFn = () => string;
type TmpDirSdkModule = {
  resolvePreferredOpenClawTmpDir?: unknown;
};
type TmpDirImporter = (moduleName: string) => Promise<TmpDirSdkModule>;

const sdkTmpDirModuleCandidates = [
  "openclaw/plugin-sdk/infra-runtime",
  "openclaw/plugin-sdk/temp-path",
  "openclaw/plugin-sdk/core",
] as const;

let cachedResolvePreferredTmpDirFn: ResolvePreferredTmpDirFn | null | undefined;

const importTmpDirSdkModule: TmpDirImporter = async (moduleName) =>
  (await import(moduleName)) as TmpDirSdkModule;

async function resolvePreferredOpenClawTmpDirCompat(
  importer: TmpDirImporter = importTmpDirSdkModule,
): Promise<string> {
  const shouldUseCache = importer === importTmpDirSdkModule;
  const resolverFn = shouldUseCache
    ? await resolveCachedPreferredTmpDirFn(importer)
    : await loadResolvePreferredTmpDirFn(importer);

  const resolved = resolverFn?.();
  if (typeof resolved === "string" && resolved.trim().length > 0) {
    return resolved;
  }

  return os.tmpdir();
}

async function resolveCachedPreferredTmpDirFn(
  importer: TmpDirImporter,
): Promise<ResolvePreferredTmpDirFn | null> {
  if (cachedResolvePreferredTmpDirFn === undefined) {
    cachedResolvePreferredTmpDirFn = await loadResolvePreferredTmpDirFn(importer);
  }
  return cachedResolvePreferredTmpDirFn;
}

async function loadResolvePreferredTmpDirFn(
  importer: TmpDirImporter,
): Promise<ResolvePreferredTmpDirFn | null> {
  for (const moduleName of sdkTmpDirModuleCandidates) {
    try {
      const sdkModule = await importer(moduleName);
      if (typeof sdkModule.resolvePreferredOpenClawTmpDir === "function") {
        return sdkModule.resolvePreferredOpenClawTmpDir as ResolvePreferredTmpDirFn;
      }
    } catch {
      // Ignore missing subpaths for host-version compatibility.
    }
  }

  return null;
}

export async function __test_only__resolvePreferredOpenClawTmpDirCompat(params?: {
  importer?: TmpDirImporter;
}): Promise<string> {
  return resolvePreferredOpenClawTmpDirCompat(params?.importer ?? importTmpDirSdkModule);
}

export function __test_only__resetPreferredTmpDirCache(): void {
  cachedResolvePreferredTmpDirFn = undefined;
}

function escapePowerShellSingleQuotedLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildLinuxScreenshotCommand(outputPath: string): string[] {
  const shellScript = [
    "set -euo pipefail",
    'if command -v gnome-screenshot >/dev/null 2>&1; then gnome-screenshot -f "$OUT"',
    'elif command -v spectacle >/dev/null 2>&1; then spectacle -n -b -o "$OUT"',
    'elif command -v grim >/dev/null 2>&1; then grim "$OUT"',
    'elif command -v import >/dev/null 2>&1; then import -window root "$OUT"',
    'else echo "No supported screenshot command found (gnome-screenshot, spectacle, grim, or import)." >&2; exit 127',
    "fi",
  ].join("; ");
  return ["bash", "-lc", shellScript, "--"];
}

function buildWindowsScreenshotCommand(outputPath: string): string[] {
  const escapedPath = escapePowerShellSingleQuotedLiteral(outputPath);
  const script = [
    "Add-Type -TypeDefinition @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class NativeMethods {\n  [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();\n  [DllImport(\"user32.dll\")] public static extern int GetSystemMetrics(int nIndex);\n}\n'@",
    '[void][NativeMethods]::SetProcessDPIAware()',
    "Add-Type -AssemblyName System.Drawing",
    "$left = [NativeMethods]::GetSystemMetrics(76)",
    "$top = [NativeMethods]::GetSystemMetrics(77)",
    "$width = [NativeMethods]::GetSystemMetrics(78)",
    "$height = [NativeMethods]::GetSystemMetrics(79)",
    "$bitmap = New-Object System.Drawing.Bitmap $width, $height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "try {",
    "  $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)",
    `  $bitmap.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    "} finally {",
    "  $graphics.Dispose()",
    "  $bitmap.Dispose()",
    "}",
  ].join("\n");
  return ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script];
}

export function resolveDesktopScreenshotCommand(params: {
  platform: NodeJS.Platform;
  outputPath: string;
}): string[] {
  if (params.platform === "darwin") {
    return ["screencapture", "-x", "-t", "png", params.outputPath];
  }
  if (params.platform === "win32") {
    return buildWindowsScreenshotCommand(params.outputPath);
  }
  return buildLinuxScreenshotCommand(params.outputPath);
}

async function resolveOutputDir(): Promise<string> {
  return path.join(await resolvePreferredOpenClawTmpDirCompat(), "realtime-background-assistant");
}

export async function captureDesktopScreenshot(params: {
  runtime: PluginRuntime;
  config: DesktopScreenshotConfig;
}): Promise<DesktopScreenshotResult> {
  const outputDir = await resolveOutputDir();
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(
    outputDir,
    `desktop-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`,
  );

  const command = resolveDesktopScreenshotCommand({
    platform: process.platform,
    outputPath,
  });

  const env =
    process.platform === "linux"
      ? {
          OUT: outputPath,
        }
      : undefined;

  await params.runtime.system.runCommandWithTimeout(command, {
    timeoutMs: params.config.timeoutMs,
    env,
  });

  const buffer = await fs.readFile(outputPath);
  if (buffer.byteLength > params.config.maxBytes) {
    throw new Error(
      `Desktop screenshot exceeded size limit (${buffer.byteLength} > ${params.config.maxBytes} bytes)`,
    );
  }

  const metadata = await params.runtime.media.getImageMetadata(buffer);

  return {
    path: outputPath,
    base64: buffer.toString("base64"),
    mimeType: "image/png",
    bytes: buffer.byteLength,
    width: metadata?.width ?? undefined,
    height: metadata?.height ?? undefined,
  };
}
