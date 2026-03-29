import { createAssistantLogger } from "./src/logger.js";
import { captureDesktopScreenshot, type DesktopScreenshotConfig } from "./src/screenshot.js";
import { createRealtimeBackgroundAssistantService } from "./src/service.js";

type ChatRequestBody = {
  message?: string;
};

function resolveScreenshotConfig(pluginConfig: Record<string, unknown> | undefined): DesktopScreenshotConfig {
  const screenshot = (pluginConfig?.screenshot ?? {}) as Record<string, unknown>;
  return {
    timeoutMs: typeof screenshot.timeoutMs === "number" ? screenshot.timeoutMs : 15_000,
    maxBytes: typeof screenshot.maxBytes === "number" ? screenshot.maxBytes : 6_291_456,
  };
}

export default function register(api: any) {
  const logger = createAssistantLogger({
    consoleSink: api.logger,
    scope: "realtime-background-assistant:index",
  });

  api.registerService(createRealtimeBackgroundAssistantService(api));

  const screenshotConfig = resolveScreenshotConfig(api.pluginConfig);

  api.registerTool({
    name: "desktop_screenshot",
    label: "Desktop Screenshot",
    description: "Capture the full desktop and return the screenshot as an image block.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async execute() {
      const screenshot = await captureDesktopScreenshot({
        runtime: api.runtime,
        config: screenshotConfig,
      });

      return {
        content: [
          { type: "image", data: screenshot.base64, mimeType: screenshot.mimeType },
          {
            type: "text",
            text: `Desktop screenshot captured: ${screenshot.width ?? "unknown"}x${screenshot.height ?? "unknown"} (${screenshot.bytes} bytes).`,
          },
        ],
        details: {
          path: screenshot.path,
          mimeType: screenshot.mimeType,
          bytes: screenshot.bytes,
          width: screenshot.width,
          height: screenshot.height,
        },
      };
    },
  });

  logger.info("realtime-background-assistant 插件启动成功", { console: true });
}
