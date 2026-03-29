import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type LogLevel = "info" | "warn" | "error" | "debug";

type ConsoleSink = Partial<Record<LogLevel, (message: string) => void>>;

type LogOptions = {
  console?: boolean;
  context?: Record<string, unknown>;
};

export type AssistantLogger = {
  filePath: string;
  info(message: string, options?: LogOptions): void;
  warn(message: string, options?: LogOptions): void;
  error(message: string, options?: LogOptions): void;
  debug(message: string, options?: LogOptions): void;
};

function resolveStateDir(): string {
  return path.join(os.homedir(), ".openclaw");
}

export function resolveAssistantLogFilePath(): string {
  return path.join(resolveStateDir(), "logs", "realtime-background-assistant.log");
}

function ensureLogDirectory(logFilePath: string): void {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
}

function writeLogLine(params: {
  filePath: string;
  level: LogLevel;
  scope: string;
  message: string;
  context?: Record<string, unknown>;
}): void {
  ensureLogDirectory(params.filePath);
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: params.level,
    scope: params.scope,
    message: params.message,
  };
  if (params.context && Object.keys(params.context).length > 0) {
    entry.context = params.context;
  }
  fs.appendFileSync(params.filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function resolveConsoleWriter(consoleSink: ConsoleSink | undefined, level: LogLevel): (message: string) => void {
  if (consoleSink?.[level]) {
    return consoleSink[level]!.bind(consoleSink);
  }
  if (consoleSink?.info) {
    return consoleSink.info.bind(consoleSink);
  }
  if (level === "warn") {
    return console.warn.bind(console);
  }
  if (level === "error") {
    return console.error.bind(console);
  }
  if (level === "debug") {
    return console.debug.bind(console);
  }
  return console.info.bind(console);
}

function createEmitter(params: {
  filePath: string;
  scope: string;
  consoleSink?: ConsoleSink;
}): AssistantLogger {
  const emit = (level: LogLevel, message: string, options?: LogOptions): void => {
    writeLogLine({
      filePath: params.filePath,
      level,
      scope: params.scope,
      message,
      context: options?.context,
    });
    if (options?.console) {
      resolveConsoleWriter(params.consoleSink, level)(`[${params.scope}] ${message}`);
    }
  };

  return {
    filePath: params.filePath,
    info: (message, options) => emit("info", message, options),
    warn: (message, options) => emit("warn", message, options),
    error: (message, options) => emit("error", message, options),
    debug: (message, options) => emit("debug", message, options),
  };
}

export function createAssistantLogger(params?: {
  consoleSink?: ConsoleSink;
  scope?: string;
  filePath?: string;
}): AssistantLogger {
  return createEmitter({
    filePath: params?.filePath ?? resolveAssistantLogFilePath(),
    scope: params?.scope ?? "realtime-background-assistant",
    consoleSink: params?.consoleSink,
  });
}