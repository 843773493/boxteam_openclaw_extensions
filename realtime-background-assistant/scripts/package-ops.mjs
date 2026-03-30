#!/usr/bin/env node

/*
  这个文件是 realtime-background-assistant 当前唯一的“打包/发布”脚本入口。

  设计目标：
  1. 把原来散落在多个壳文件里的逻辑集中到一个地方，减少脚本文件数量。
  2. 让 package.json 只保留很薄的命令映射，不再维护多层转发脚本。
  3. 同时兼容三类操作：
     - pack-npm：生成 npm 发行包
     - pack-plugin：清理旧 tgz 后重新打包插件
     - publish-npm：先打包，再发布到 npm registry

  兼容性说明：
  - 这里统一封装了 npm 的启动方式，避免在 Windows、npm run、直接 node 执行等场景下出现命令解析差异。
  - 文件底部实现了一个很小的子命令 CLI，因此既可以被 package.json 调用，也可以直接手工执行排查问题。

  这个文件本身不承载业务逻辑，只负责把“打包/发布”这几种动作组织起来。
*/

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(scriptDir, "../output");

function resolveNpmInvocation(args) {
  // 优先使用 npm 自己注入的执行入口，这样在 npm run / pnpm / 本地直接执行时都更稳。
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, ...args],
    };
  }

  // Windows 下直接起 npm.cmd 容易遇到 spawn 行为差异，这里统一通过 cmd /c 执行。
  if (process.platform === "win32") {
    return {
      command: "cmd",
      args: ["/d", "/s", "/c", ["npm", ...args].join(" ")],
    };
  }

  return {
    command: "npm",
    args,
  };
}

// 统一封装脚本内最常用的“打印提示 + 执行命令”模式，避免每个入口文件重复写一遍。
export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return typeof result.status === "number" ? result.status : 1;
}

function parseEnvFile(filePath) {
  const env = {};
  const content = fs.readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadLocalEnv() {
  const envPaths = [
    path.resolve(scriptDir, "../../.env"),
    path.resolve(scriptDir, "../.env"),
    path.resolve(process.cwd(), ".env"),
  ];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const env = parseEnvFile(envPath);
    for (const [key, value] of Object.entries(env)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  if (process.env.NPM_TOKEN === undefined && process.env.npm_token !== undefined) {
    process.env.NPM_TOKEN = process.env.npm_token;
  }

  if (process.env.NODE_AUTH_TOKEN === undefined && process.env.NPM_TOKEN !== undefined) {
    process.env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
  }
}

function ensureOutputDir() {
  fs.mkdirSync(outputDir, { recursive: true });
}

function cleanupOutputTgzFiles() {
  ensureOutputDir();

  for (const fileName of fs.readdirSync(outputDir)) {
    if (fileName.endsWith(".tgz")) {
      fs.rmSync(path.join(outputDir, fileName), { force: true });
    }
  }
}

function getPackedTarballPath() {
  ensureOutputDir();

  const tarballNames = fs
    .readdirSync(outputDir)
    .filter((fileName) => fileName.endsWith(".tgz"))
    .sort();

  if (tarballNames.length === 0) {
    throw new Error("npm pack 未在 output 目录中生成 tgz 文件。");
  }

  return path.join(outputDir, tarballNames[tarballNames.length - 1]);
}

function prepareNpmPublishEnv() {
  loadLocalEnv();

  const token = process.env.NPM_TOKEN ?? process.env.npm_token;
  if (!token) {
    throw new Error(
      "未找到 npm 发布令牌。请在仓库根目录的 .env 中配置 npm_token 或 NPM_TOKEN，然后重新执行 publish:npm。",
    );
  }

  const userConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "realtime-background-assistant-npm-"));
  const userConfigPath = path.join(userConfigDir, ".npmrc");
  fs.writeFileSync(
    userConfigPath,
    [
      "registry=https://registry.npmjs.org/",
      "always-auth=true",
      "//registry.npmjs.org/:_authToken=${NPM_TOKEN}",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    ...process.env,
    NPM_TOKEN: token,
    npm_token: token,
    NODE_AUTH_TOKEN: token,
    npm_config_userconfig: userConfigPath,
  };
}

// 只保留一层很薄的命令封装，便于 package.json 直接复用而不用再写 shell 片段。
export function packNpm() {
  console.log("[打包] 生成 npm 发行包");
  cleanupOutputTgzFiles();
  const npm = resolveNpmInvocation(["pack", "--pack-destination", "output"]);
  return runCommand(npm.command, npm.args);
}

// 先删除旧的 tgz，再执行 npm pack，避免本地目录里残留多个同名产物。
export function packPlugin() {
  console.log("[发布] 清理旧 tgz 并重新打包插件");
  cleanupOutputTgzFiles();
  const npm = resolveNpmInvocation(["pack", "--pack-destination", "output"]);
  return runCommand(npm.command, npm.args);
}

// 先做本地打包，再发布到 npm registry。发布前的步骤交给公共函数，入口只负责串联。
export function publishNpm() {
  console.log("[发布] 先打包再发布到 npm registry");

  const packResult = packNpm();
  if (packResult !== 0) {
    return packResult;
  }

  const tarballPath = getPackedTarballPath();
  const npm = resolveNpmInvocation(["publish", tarballPath, "--access", "public"]);
  const publishEnv = prepareNpmPublishEnv();

  try {
    return runCommand(npm.command, npm.args, { env: publishEnv });
  } finally {
    const userConfigPath = publishEnv.npm_config_userconfig;
    if (typeof userConfigPath === "string") {
      fs.rmSync(path.dirname(userConfigPath), { recursive: true, force: true });
    }
  }
}

function printUsage() {
  console.log("用法: node ./scripts/package-ops.mjs <pack-npm|pack-plugin|publish-npm>");
}

const action = process.argv[2];
let exitCode = 0;

if (action === "pack-npm") {
  exitCode = packNpm();
} else if (action === "pack-plugin") {
  exitCode = packPlugin();
} else if (action === "publish-npm") {
  exitCode = publishNpm();
} else {
  printUsage();
  exitCode = 1;
}

process.exit(exitCode);