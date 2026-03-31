#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..", "..");
const upgradeScriptPath = path.join(projectDir, "scripts", "upgrade-via-source.mjs");
const defaultHost = "127.0.0.1";
const defaultPort = 18189;
const defaultTimeoutMs = 120_000;

function printUsage() {
  console.log("用法: node ./scripts/agent/bootstrap-local-e2e.mjs [--host=127.0.0.1] [--port=18189] [--timeout-ms=120000]");
  console.log("");
  console.log("说明:");
  console.log("  1. 先执行 openclaw gateway stop");
  console.log("  2. 再执行 node ./scripts/upgrade-via-source.mjs");
  console.log("  3. 最后启动 openclaw gateway 并等待 /health 可用");
}

function escapeWindowsArg(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\"", "\\\"")}"`;
}

function shouldUseWindowsCmd(command) {
  return process.platform === "win32" && !path.isAbsolute(command) && !command.includes("\\") && !command.includes("/");
}

function writeFilteredOutput(text, writer = console.log) {
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("Config observe anomaly:")) {
      continue;
    }
    writer(line);
  }
}

function run(command, args, options = {}) {
  const isWindows = process.platform === "win32";
  const useWindowsCmd = shouldUseWindowsCmd(command);
  const finalCommand = isWindows && useWindowsCmd ? "cmd" : command;
  const finalArgs = isWindows && useWindowsCmd ? ["/d", "/s", "/c", [command, ...args].map(escapeWindowsArg).join(" ")] : args;

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

function spawnProcess(command, args, options = {}) {
  const isWindows = process.platform === "win32";
  const finalCommand = isWindows ? "cmd" : command;
  const finalArgs = isWindows ? ["/d", "/s", "/c", [command, ...args].map(escapeWindowsArg).join(" ")] : args;
  const child = spawn(finalCommand, finalArgs, {
    cwd: options.cwd ?? projectDir,
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  });

  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  let stdoutRemainder = "";
  let stderrRemainder = "";

  const forwardFiltered = (chunk, decoder, writer, remainder) => {
    const text = remainder + decoder.write(chunk);
    const lines = text.split(/\r?\n/);
    const nextRemainder = lines.pop() ?? "";
    for (const line of lines) {
      if (!line || line.startsWith("Config observe anomaly:")) {
        continue;
      }
      writer(`${line}\n`);
    }
    return nextRemainder;
  };

  child.stdout?.on("data", (chunk) => {
    stdoutRemainder = forwardFiltered(chunk, stdoutDecoder, process.stdout.write.bind(process.stdout), stdoutRemainder);
  });

  child.stderr?.on("data", (chunk) => {
    stderrRemainder = forwardFiltered(chunk, stderrDecoder, process.stderr.write.bind(process.stderr), stderrRemainder);
  });

  child.once("close", () => {
    const stdoutTail = stdoutRemainder + stdoutDecoder.end();
    const stderrTail = stderrRemainder + stderrDecoder.end();
    writeFilteredOutput(stdoutTail, (line) => process.stdout.write(`${line}\n`));
    writeFilteredOutput(stderrTail, (line) => process.stderr.write(`${line}\n`));
  });

  return child;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function checkHealth(host, port) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host,
        port,
        path: "/health",
        method: "GET",
        timeout: 1000,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );

    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });

    request.once("error", () => {
      resolve(false);
    });

    request.end();
  });
}

async function waitForHealth(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await checkHealth(host, port)) {
      return;
    }

    await delay(500);
  }

  throw new Error(`等待 http://${host}:${port}/health 超时`);
}

function parseArgs(argv) {
  const options = {
    host: defaultHost,
    port: defaultPort,
    timeoutMs: defaultTimeoutMs,
  };

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length) || defaultHost;
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length)) || defaultPort;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length)) || defaultTimeoutMs;
      continue;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return 0;
  }

  console.log("[一键联调] 1/3 先停止 OpenClaw gateway...");
  const stopCode = run("openclaw", ["gateway", "stop"]);
  if (stopCode !== 0) {
    console.log(`[一键联调] gateway stop 返回 ${stopCode}，继续执行后续步骤`);
  }

  console.log("[一键联调] 2/3 执行 realtime-background-assistant 源码升级...");
  const upgradeCode = run(process.execPath, [upgradeScriptPath]);
  if (upgradeCode !== 0) {
    return upgradeCode;
  }

  console.log("[一键联调] 3/3 启动 OpenClaw gateway 并等待 HTTP 服务就绪...");
  const gatewayProcess = spawnProcess("openclaw", ["gateway"]);
  let gatewayExited = false;
  let gatewayExitCode = 0;
  const gatewayExitPromise = new Promise((resolve) => {
    gatewayProcess.once("exit", (code, signal) => {
      gatewayExited = true;
      gatewayExitCode = typeof code === "number" ? code : signal ? 1 : 0;
      resolve(gatewayExitCode);
    });
  });

  gatewayProcess.once("error", (error) => {
    console.error("[一键联调] 启动 gateway 失败:");
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });

  await waitForHealth(options.host, options.port, options.timeoutMs);
  console.log(`[一键联调] http://${options.host}:${options.port}/health 已可用，插件服务已准备好`);

  if (gatewayExited) {
    return gatewayExitCode;
  }

  console.log("[一键联调] gateway 仍在运行，保持当前终端会话以便继续观察日志和状态变化");
  return await gatewayExitPromise;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });