import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["development"], preserveSymlinks: true },
  test: {
    environment: "node",
    include: ["tests/onepercent.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
