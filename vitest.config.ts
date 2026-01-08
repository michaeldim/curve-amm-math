import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/index.ts"],
      thresholds: {
        // Core math modules should have high coverage
        "src/stableswap.ts": {
          statements: 95,
          branches: 80,
          functions: 95,
        },
        "src/cryptoswap.ts": {
          statements: 90,
          branches: 70,
          functions: 95,
        },
      },
    },
  },
});
