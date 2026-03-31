export function createChannelPluginBase(options: unknown): unknown {
  return options;
}

export function normalizeAgentId(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "main";
}

export function buildAgentMainSessionKey(params: { agentId: string; mainKey: string }): string {
  return `agent:${normalizeAgentId(params.agentId)}:${params.mainKey}`;
}

export function normalizePluginHttpPath(value: unknown, defaultPath: string): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : defaultPath;
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/$/, "") || defaultPath;
}

export function registerPluginHttpRoute(): void {
  return undefined;
}