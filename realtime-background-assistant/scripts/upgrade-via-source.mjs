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

// 把“调用系统命令”的细节统一收口，主流程只关心步骤顺序，不关心平台差异。
function run(command, args, options = {}) {
  const isWindows = process.platform === "win32";
  const finalCommand = isWindows ? "cmd" : command;
  const finalArgs = isWindows ? ["/d", "/s", "/c", [command, ...args].map(escapeWindowsArg).join(" ")] : args;

  const result = spawnSync(finalCommand, finalArgs, {
    cwd: options.cwd ?? projectDir,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
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
  const extensionsDir = path.join(homeDir, ".openclaw", "extensions");
  const installDir = path.join(extensionsDir, pluginId);

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

  // 如果 gateway 还在运行，先停掉，确保接下来的卸载、安装、校验都在稳定状态下进行。
  const gatewayWasRunning = await isTcpPortOpen("127.0.0.1", gatewayPort);
  if (gatewayWasRunning) {
    console.log(`[发布] 检测到 gateway 正在运行，先停止它，避免安装中间态触发重复加载`);
    run("openclaw", ["gateway", "stop"]);
  }

  // 非 force 模式先尝试卸载旧版本，减少和已有安装之间的冲突。
  if (!force) {
    const uninstallCode = run("openclaw", ["plugins", "uninstall", pluginId]);
    if (uninstallCode !== 0) {
      console.log("[发布] 未检测到可卸载旧版本，继续");
    }
  }

  // 清掉目标安装目录和临时备份目录，避免老文件影响本次源码安装。
  removeDirectory(installDir);
  removeMatchingDirectories(extensionsDir, (name) => name.startsWith(".openclaw-install-stage-") || name.startsWith(`.${pluginId}-backup-`) || name.startsWith(`.openclaw-${pluginId}-backup-`));

  // 执行真正的源码安装。
  const installCode = run("openclaw", ["plugins", "install", "."]);
  if (installCode !== 0) {
    return installCode;
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
      return retryCode;
    }
  }

  // 安装完成后再做一次收尾清理，尽量保证目录状态干净。
  removeMatchingDirectories(extensionsDir, (name) => name.startsWith(".openclaw-install-stage-") || name.startsWith(`.${pluginId}-backup-`) || name.startsWith(`.openclaw-${pluginId}-backup-`));

  // 最后用配置校验确认插件可以被 OpenClaw 正常识别。
  const validateCode = run("openclaw", ["config", "validate"]);
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