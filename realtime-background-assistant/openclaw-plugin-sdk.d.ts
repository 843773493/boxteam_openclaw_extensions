declare module "openclaw/plugin-sdk/core" {
  export type OpenClawPluginApi = any;
  export type OpenClawPluginService = any;
  export type PluginRuntime = any;
}

declare module "openclaw/plugin-sdk/routing" {
  export function buildAgentMainSessionKey(params: { agentId: string; mainKey: string }): string;
  export function normalizeAgentId(agentId: string): string;
}