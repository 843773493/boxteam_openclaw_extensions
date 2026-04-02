import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
    exclude: ["node_modules", "output"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
