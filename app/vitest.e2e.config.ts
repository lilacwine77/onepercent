import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
