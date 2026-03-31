import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "openclaw/plugin-sdk/core": path.join(rootDir, "test", "openclaw-stub.ts"),
      "openclaw/plugin-sdk/routing": path.join(rootDir, "test", "openclaw-stub.ts"),
      "openclaw/plugin-sdk/webhook-ingress": path.join(rootDir, "test", "openclaw-stub.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
    exclude: ["node_modules", "output"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
