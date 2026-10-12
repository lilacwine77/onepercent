import { describe, expect, it, vi } from "vitest";
import { createApi } from "../app.js";
import { parseEnv } from "../env.js";

vi.mock("../cards/render.js", () => ({ renderCardPng: vi.fn() }));

describe("shared API request body bound", () => {
  it.each([
    "/api/rpc",
    "/api/feed/attest",
    "/api/sellback/quote",
    "/api/link/nonce",
    "/api/actions/xray",
  ])(
    "returns 413 for a 1 MiB body on %s before route parsing",
    async (path) => {
      const app = createApi(parseEnv({}));
      const response = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{" + " ".repeat(1024 * 1024),
      });
      expect(response.status).toBe(413);
    },
  );
  it("rejects an oversized declared body without reading the stream", async () => {
    const app = createApi(parseEnv({}));
    let read = false;
    const payload = new ReadableStream<Uint8Array>(
      {
        pull() {
          read = true;
        },
      },
      { highWaterMark: 0 },
    );
    const response = await app.request("/api/link/nonce", {
      method: "POST",
      headers: { "content-length": String(1024 * 1024) },
      body: payload,
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(read).toBe(false);
  });
});
