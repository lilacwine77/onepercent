import { beforeEach, vi } from "vitest";
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Unmocked network request in test");
  });
});
