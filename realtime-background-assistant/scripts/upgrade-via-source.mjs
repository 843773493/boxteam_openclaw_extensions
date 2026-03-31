#!/usr/bin/env node

/*
  这个文件是 realtime-background-assistant 的源码发布入口。

  它负责把本地源码安装到 OpenClaw 的扩展目录，并在安装前后做必要的收尾工作：
  1. 检查 openclaw.plugin.json，确认脚本是在插件源码目录里运行。
  2. 在 Windows / 非 Windows 下统一处理子命令调用差异，避免命令转义问题。
  3. 在安装前可选卸载旧版本、清理目标目录和临时备份目录。
  4. 在安装后重新校验目录完整性，并执行 openclaw config validate 作为最后确认。

  为什么保留为独立脚本：
  - 这类流程涉及多个系统命令和大量文件清理，适合单独放在一个可直接执行的入口里。
  - 保持 package.json 只负责转发，便于后续定位发布问题和单独调试。

  这个脚本不是业务代码，而是发布运维脚本；注释会尽量描述流程意图，而不是描述单行实现细节。
*/

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const manifestPath = path.join(projectDir, "openclaw.plugin.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pluginId = manifest.id;
const gatewayPort = 18789;

function resolveOpenClawConfigPath(homeDir) {
  const override = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(projectDir, override);
  }

  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) {
    return path.join(stateDir, "openclaw.json");
  }

  return path.join(homeDir, ".openclaw", "openclaw.json");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function loadJsonFile(filePath) {
  return JSON.parse(stripBom(fs.readFileSync(filePath, "utf8")));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mergeJsonLike(baseValue, overlayValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(overlayValue)) {
    return overlayValue;
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(overlayValue)) {
    merged[key] = mergeJsonLike(baseValue[key], value);
  }
  return merged;
}

function loadPluginEntryBackup(configPath, targetPluginId) {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const config = loadJsonFile(configPath);
    const entry = config?.plugins?.entries?.[targetPluginId];
    if (!isPlainObject(entry)) {
      return null;
    }
    return JSON.parse(JSON.stringify(entry));
  } catch {
    return null;
  }
}

function restorePluginEntryConfig(configPath, targetPluginId, backupEntry) {
  if (!backupEntry) {
    return true;
  }

  if (!fs.existsSync(configPath)) {
    console.error(`[发布] 未找到配置文件，无法恢复插件参数: ${configPath}`);
    return false;
  }

  try {
    const config = loadJsonFile(configPath);
    const plugins = isPlainObject(config.plugins) ? { ...config.plugins } : {};
    const entries = isPlainObject(plugins.entries) ? { ...plugins.entries } : {};
    const tempEntry = isPlainObject(entries[targetPluginId]) ? entries[targetPluginId] : {};
    const restoredEntry = { ...tempEntry };

    if (backupEntry && Object.prototype.hasOwnProperty.call(backupEntry, "config")) {
      restoredEntry.config = mergeJsonLike(tempEntry.config, backupEntry.config);
    }
    if (backupEntry && Object.prototype.hasOwnProperty.call(backupEntry, "hooks")) {
      restoredEntry.hooks = mergeJsonLike(tempEntry.hooks, backupEntry.hooks);
    }
    if (backupEntry && Object.prototype.hasOwnProperty.call(backupEntry, "subagent")) {
      restoredEntry.subagent = mergeJsonLike(tempEntry.subagent, backupEntry.subagent);
    }

    entries[targetPluginId] = restoredEntry;
    plugins.entries = entries;
    config.plugins = plugins;

    writeJsonFile(configPath, config);
    console.log(`[发布] 已恢复插件自定义配置: plugins.entries.${targetPluginId}.config`);
    return true;
  } catch (error) {
    console.error(`[发布] 恢复插件配置失败: ${configPath}`);
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    return false;
  }
}

function createTempConfigPath(homeDir) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "realtime-background-assistant-openclaw-"));
  return {
    tempDir,
    tempConfigPath: path.join(tempDir, "openclaw.json"),
  };
}

function createTempConfigForInstall(realConfigPath, pluginId) {
  if (!fs.existsSync(realConfigPath)) {
    return null;
  }

  try {
    const config = loadJsonFile(realConfigPath);
    const plugins = isPlainObject(config.plugins) ? { ...config.plugins } : {};
    const allowBackup = Array.isArray(plugins.allow) ? [...plugins.allow] : null;

    if (Array.isArray(plugins.allow)) {
      plugins.allow = plugins.allow.filter((id) => id !== pluginId);
      if (plugins.allow.length === 0) {
        delete plugins.allow;
      }
    }

    if (isPlainObject(config.plugins?.entries) && pluginId in config.plugins.entries) {
      const entries = { ...(plugins.entries ?? {}) };
      delete entries[pluginId];
      if (Object.keys(entries).length === 0) {
        delete plugins.entries;
      } else {
        plugins.entries = entries;
      }
    }

    config.plugins = plugins;

    const { tempDir, tempConfigPath } = createTempConfigPath(path.dirname(realConfigPath));
    writeJsonFile(tempConfigPath, config);
    return { tempDir, tempConfigPath, allowBackup };
  } catch (error) {
    console.error(`[发布] 创建临时配置失败，继续使用真实配置: ${realConfigPath}`);
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    return null;
  }
}

function cleanupTempConfig(tempConfig) {
  if (!tempConfig) {
    return;
  }

  removeDirectory(tempConfig.tempDir);
  if (process.env.OPENCLAW_CONFIG_PATH === tempConfig.tempConfigPath) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  }
}

function syncTempConfigToReal(realConfigPath, tempConfig, pluginId, backupEntry) {
  const tempConfigPath = tempConfig?.tempConfigPath;
  if (!fs.existsSync(tempConfigPath)) {
    return false;
  }

  try {
    const realConfig = fs.existsSync(realConfigPath) ? loadJsonFile(realConfigPath) : {};
    const tempConfig = loadJsonFile(tempConfigPath);
    const realPlugins = isPlainObject(realConfig.plugins) ? { ...realConfig.plugins } : {};
    const tempPlugins = isPlainObject(tempConfig.plugins) ? { ...tempConfig.plugins } : {};

    const mergedPlugins = mergeJsonLike(realPlugins, tempPlugins);
    const realEntries = isPlainObject(mergedPlugins.entries) ? { ...mergedPlugins.entries } : {};
    const tempEntry = isPlainObject((tempPlugins.entries ?? {})[pluginId]) ? tempPlugins.entries[pluginId] : null;
    const currentRealEntry = isPlainObject((realPlugins.entries ?? {})[pluginId]) ? realPlugins.entries[pluginId] : {};
    const restoredEntry = {
      ...(tempEntry ?? currentRealEntry),
    };

    if (backupEntry && Object.prototype.hasOwnProperty.call(backupEntry, "config")) {
      restoredEntry.config = mergeJsonLike(restoredEntry.config, backupEntry.config);
    }
    if (backupEntry && Object.prototype.hasOwnProperty.call(backupEntry, "hooks")) {
      restoredEntry.hooks = mergeJsonLike(restoredEntry.hooks, backupEntry.hooks);
    }
    if (backupEntry && Object.prototype.hasOwnProperty.call(backupEntry, "subagent")) {
      restoredEntry.subagent = mergeJsonLike(restoredEntry.subagent, backupEntry.subagent);
    }

    if (Array.isArray(tempConfig.allowBackup)) {
      mergedPlugins.allow = [...tempConfig.allowBackup];
    }

    realEntries[pluginId] = restoredEntry;
    mergedPlugins.entries = realEntries;
    realConfig.plugins = mergedPlugins;
    writeJsonFile(realConfigPath, realConfig);
    console.log(`[发布] 已将临时配置中的安装结果同步回真实配置: ${path.basename(realConfigPath)}`);
    return true;
  } catch (error) {
    console.error(`[发布] 同步临时配置到真实配置失败: ${realConfigPath}`);
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    return false;
  }
}

function printUsage() {
  console.log("用法: node ./scripts/upgrade-via-source.mjs [--force]");
  console.log("");
  console.log("说明:");
  console.log("  --force   直接清理本地扩展目录并复制源码目录，不调用 openclaw 安装机制");
}

// Windows 下通过 cmd 转发子命令时，先把参数做一层最小转义，避免空格和引号破坏整条命令。
function escapeWindowsArg(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function writeFilteredOutput(text, writer = console.log) {
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("Config observe anomaly:")) {
      continue;
    }
    writer(line);
  }
}

// 把“调用系统命令”的细节统一收口，主流程只关心步骤顺序，不关心平台差异。
function run(command, args, options = {}) {
  const isWindows = process.platform === "win32";
  const finalCommand = isWindows ? "cmd" : command;
  const finalArgs = isWindows ? ["/d", "/s", "/c", [command, ...args].map(escapeWindowsArg).join(" ")] : args;

  const result = spawnSync(finalCommand, finalArgs, {
    cwd: options.cwd ?? projectDir,
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.stdout?.length) {
    writeFilteredOutput(result.stdout.toString("utf8"));
  }
  if (result.stderr?.length) {
    writeFilteredOutput(result.stderr.toString("utf8"), console.error);
  }

  return typeof result.status === "number" ? result.status : 1;
}

// 删除单个目录时保留容错，避免清理失败直接阻断后续安装流程。
function removeDirectory(targetPath) {
  if (fs.existsSync(targetPath)) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (error) {
      console.log(`[发布] 清理目录失败，继续执行: ${targetPath}`);
      console.log(error instanceof Error ? error.message : String(error));
    }
  }
}

// 清理扩展目录下的临时缓存和备份目录，防止重复安装时留下脏数据。
function removeMatchingDirectories(baseDir, predicate) {
  if (!fs.existsSync(baseDir)) {
    return;
  }

  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (entry.isDirectory() && predicate(entry.name)) {
      try {
        fs.rmSync(path.join(baseDir, entry.name), { recursive: true, force: true });
      } catch (error) {
        console.log(`[发布] 清理临时目录失败，继续执行: ${entry.name}`);
        console.log(error instanceof Error ? error.message : String(error));
      }
    }
  }
}

// 在发布前确认 gateway 是否已经启动，必要时先停掉它，避免安装过程触发重复加载。
async function isTcpPortOpen(host, port, timeoutMs = 300) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForTcpPortClosed(host, port, timeoutMs = 8000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // 只要端口真正关闭，后续的卸载和安装才不会碰到还在使用中的扩展目录。
    if (!(await isTcpPortOpen(host, port, 300))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

async function delay(ms) {
  return await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  if (args.includes("-h") || args.includes("--help")) {
    printUsage();
    return 0;
  }

  if (!fs.existsSync(manifestPath)) {
    console.error(`[发布] 未找到 openclaw.plugin.json，脚本必须在 ${path.basename(projectDir)} 源码目录内运行`);
    return 1;
  }

  // 发布目标目录固定在用户主目录下的 `.openclaw/extensions`，这里先定位安装目录再做清理。
  const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const configPath = resolveOpenClawConfigPath(homeDir);
  const extensionsDir = path.join(homeDir, ".openclaw", "extensions");
  const installDir = path.join(extensionsDir, pluginId);
  const pluginEntryBackup = loadPluginEntryBackup(configPath, pluginId);
  let tempConfig = null;

  console.log(force ? "[发布] 直接清理本地扩展目录并复制源码目录，不调用 openclaw 安装机制" : "[发布] 先卸载旧版本并清理本地扩展目录，再从源码安装并校验");

  if (force) {
    removeDirectory(installDir);
    fs.mkdirSync(extensionsDir, { recursive: true });
    fs.cpSync(projectDir, installDir, {
      recursive: true,
      filter: (sourcePath) => {
        const relativePath = path.relative(projectDir, sourcePath);
        if (!relativePath) {
          return true;
        }

        const pathParts = relativePath.split(path.sep);
        return !pathParts.includes("node_modules") && !pathParts.includes(".git");
      },
    });
    return 0;
  }

  tempConfig = createTempConfigForInstall(configPath, pluginId);
  if (tempConfig) {
    process.env.OPENCLAW_CONFIG_PATH = tempConfig.tempConfigPath;
  }

  // 如果 gateway 还在运行，先停掉，确保接下来的卸载、安装、校验都在稳定状态下进行。
  const gatewayWasRunning = await isTcpPortOpen("127.0.0.1", gatewayPort);
  if (gatewayWasRunning) {
    console.log(`[发布] 检测到 gateway 正在运行，先停止它，避免安装中间态触发重复加载`);
    run("openclaw", ["gateway", "stop"]);
    const gatewayClosed = await waitForTcpPortClosed("127.0.0.1", gatewayPort);
    if (!gatewayClosed) {
      console.error("[发布] gateway 停止超时，当前仍在占用端口，先中止发布以避免安装失败");
      cleanupTempConfig(tempConfig);
      return 1;
    }
  }

  // 非 force 模式先尝试卸载旧版本，减少和已有安装之间的冲突。
  if (!force) {
    const uninstallCode = run("openclaw", ["plugins", "uninstall", pluginId, "--force"]);
    if (uninstallCode !== 0) {
      console.log("[发布] 未检测到可卸载旧版本，继续");
    }
  }

  // 清掉目标安装目录和临时备份目录，避免老文件影响本次源码安装。
  removeDirectory(installDir);
  removeMatchingDirectories(extensionsDir, (name) => name.startsWith(".openclaw-install-stage-") || name.startsWith(`.${pluginId}-backup-`) || name.startsWith(`.openclaw-${pluginId}-backup-`));

  // 执行真正的源码安装。
  let installCode = run("openclaw", ["plugins", "install", "."]);
  if (installCode !== 0) {
    console.log("[发布] 首次安装失败，清理残留后重试一次...");
    removeDirectory(installDir);
    removeMatchingDirectories(extensionsDir, (name) => name.startsWith(".openclaw-install-stage-") || name.startsWith(`.${pluginId}-backup-`) || name.startsWith(`.openclaw-${pluginId}-backup-`));
    await delay(800);
    installCode = run("openclaw", ["plugins", "install", "."]);
    if (installCode !== 0) {
      cleanupTempConfig(tempConfig);
      return installCode;
    }
  }

  // 有些环境里安装会留下不完整的目录，这里做一次存在性校验，不完整就重试一次。
  const installedDirExists = fs.existsSync(installDir);
  const installedManifest = path.join(installDir, "package.json");
  const installedEntry = path.join(installDir, "index.ts");
  if (!installedDirExists || !fs.existsSync(installedManifest) || !fs.existsSync(installedEntry)) {
    console.log("[发布] 安装目录未完整生成，清理残留后重试一次...");
    removeMatchingDirectories(extensionsDir, (name) => name.startsWith(".openclaw-install-stage-") || name.startsWith(`.${pluginId}-backup-`) || name.startsWith(`.openclaw-${pluginId}-backup-`));
    const retryCode = run("openclaw", ["plugins", "install", "."]);
    if (retryCode !== 0) {
      cleanupTempConfig(tempConfig);
      return retryCode;
    }
  }

  // 安装完成后再做一次收尾清理，尽量保证目录状态干净。
  removeMatchingDirectories(extensionsDir, (name) => name.startsWith(".openclaw-install-stage-") || name.startsWith(`.${pluginId}-backup-`) || name.startsWith(`.openclaw-${pluginId}-backup-`));

  // 最后用配置校验确认插件可以被 OpenClaw 正常识别。
  const validateCode = run("openclaw", ["config", "validate"]);

  // 先把临时配置的安装结果和真实配置合并，再恢复插件自定义参数。
  if (tempConfig && !syncTempConfigToReal(configPath, tempConfig, pluginId, pluginEntryBackup)) {
    cleanupTempConfig(tempConfig);
    return 1;
  }

  // 无临时配置时，仍然在真实配置上做一次兜底恢复。
  if (!tempConfig) {
    // 没创建临时配置时，仍然在真实配置上做一次兜底恢复。
    if (!restorePluginEntryConfig(configPath, pluginId, pluginEntryBackup)) {
      return 1;
    }
  }

  // 清理临时配置目录，避免残留影响后续升级。
  cleanupTempConfig(tempConfig);

  if (gatewayWasRunning) {
    console.log("[发布] gateway 先前处于运行状态，安装完成后请按需重新启动");
  }

  return validateCode;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });