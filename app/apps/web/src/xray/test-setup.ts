import "../test/setup";
import { beforeEach, vi } from "vitest";

beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network in X-ray tests");
    }),
  ),
);
