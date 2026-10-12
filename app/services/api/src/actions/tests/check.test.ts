// Initialize the renderer before the offline per-test fetch guard is installed.
import "satori";
import "./setup.js";
import { describe, expect, it, vi } from "vitest";
import { checkBlinks, type BlinkFetcher } from "../check.js";
import { CHECK_STATES, createCheckFixture } from "./validation-fixtures.js";

const origin = "https://onepercent.test";
describe("Blinks registration checker", () => {
  it("probes every distinct Rip href using the Dialect body and n=0", async () => {
    const app = createCheckFixture("covered5");
    const fetcher = vi.fn<BlinkFetcher>(async (url, init) => {
      // This regression tests POST transport; renderer coverage is below.
      if (new URL(url).pathname.startsWith("/api/og/blink/")) {
        const image = await app.request("/fixtures/xray.png");
        image.headers.set("Cache-Control", "public, max-age=60");
        return image;
      }
      return app.request(url, init);
    });
    const result = await checkBlinks({ origin, cluster: "devnet", fetcher });
    const posts = fetcher.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(posts).toHaveLength(8);
    for (const [url, init] of posts) {
      expect(new URL(url).searchParams.get("n")).toBe("0");
      expect(JSON.parse(String(init?.body))).toEqual({
        account: "So11111111111111111111111111111111111111112",
        type: "transaction",
      });
    }
    expect(result.sheet).toContain("8 safe POST probes");
  });
  it.each(["body", "cache", "status", "headers"])(
    "rejects a broken POST probe %s",
    async (kind) => {
      const app = createCheckFixture("covered5");
      await expect(
        checkBlinks({
          origin,
          cluster: "devnet",
          fetcher: async (url, init) => {
            const response = await app.request(url, init);
            if (init?.method !== "POST") return response;
            if (kind === "cache")
              response.headers.set("Cache-Control", "public, max-age=60");
            if (kind === "headers") response.headers.delete("X-Action-Version");
            if (kind === "body" || kind === "status")
              return Response.json(
                { message: "unexpected response" },
                {
                  status: kind === "status" ? 200 : 400,
                  headers: response.headers,
                },
              );
            return response;
          },
        }),
      ).rejects.toThrow();
    },
  );
  it.each(CHECK_STATES)(
    "checks the fixture API and prints the registration sheet for %s",
    async (state) => {
      const app = createCheckFixture(state);
      const result = await checkBlinks({
        origin,
        cluster: "devnet",
        fetcher: async (url, init) => app.request(url, init),
      });
      expect(result.checked).toHaveLength(9);
      expect(result.sheet).toContain(
        "Blinks registration\nHost: onepercent.test",
      );
      expect(result.sheet).toContain("/api/actions/rip/*");
      expect(result.sheet).toContain("X-ray: Bags, bids and rent back");
      expect(result.sheet).toContain("Contact: [founder contact email]");
      const rip = result.checked.filter((item) =>
        item.path.startsWith("/api/actions/rip"),
      );
      expect(
        rip.every((sample) => sample.disabled === !state.startsWith("covered")),
      ).toBe(true);
    },
    // Each fixture renders seven real PNGs, including cold font setup.
    30_000,
  );

  it.each(["empty", "busy"] as const)(
    "checks the X-ray %s state",
    async (state) => {
      const app = createCheckFixture("covered5", origin, state);
      const result = await checkBlinks({
        origin,
        cluster: "devnet",
        fetcher: async (url, init) => app.request(url, init),
      });
      expect(result.checked).toHaveLength(9);
      expect(result.sheet).toContain("Blinks registration");
    },
    30_000,
  );

  it.each([
    [
      "CORS",
      (response: Response) =>
        response.headers.delete("Access-Control-Allow-Origin"),
      "Access-Control-Allow-Origin",
    ],
    [
      "chain",
      (response: Response) =>
        response.headers.set("X-Blockchain-Ids", "solana:invalid"),
      "X-Blockchain-Ids",
    ],
    [
      "version",
      (response: Response) => response.headers.set("X-Action-Version", "1.0"),
      "X-Action-Version",
    ],
  ] as const)("rejects a broken %s header", async (_name, change, expected) => {
    const app = createCheckFixture("covered5");
    const fetcher: BlinkFetcher = async (url, init) => {
      const response = await app.request(url, init);
      if (url.includes("/api/actions/rip")) change(response);
      return response;
    };
    await expect(
      checkBlinks({ origin, cluster: "devnet", fetcher }),
    ).rejects.toThrow(expected);
  });
  it.each(["cache", "type", "signature", "options", "spec"])(
    "rejects invalid %s",
    async (kind) => {
      const app = createCheckFixture("covered5");
      const fetcher: BlinkFetcher = async (url, init) => {
        const response = await app.request(url, init);
        if (kind === "options" && init?.method === "OPTIONS")
          return new Response(null, { status: 200, headers: response.headers });
        if (
          kind === "spec" &&
          url.endsWith("/api/actions/xray") &&
          !init?.method
        ) {
          const body = (await response.json()) as Record<string, unknown>;
          return Response.json(
            { ...body, title: "x".repeat(41) },
            { headers: response.headers },
          );
        }
        if (kind === "cache" && url.includes("/api/og/blink/rip"))
          response.headers.set("Cache-Control", "public, max-age=61");
        if (url.endsWith("/assets/pack-3d.png")) {
          if (kind === "cache")
            response.headers.set("Cache-Control", "public, max-age=61");
          if (kind === "type")
            response.headers.set("Content-Type", "image/jpeg");
          if (kind === "signature")
            return new Response("not png", { headers: response.headers });
        }
        return response;
      };
      await expect(
        checkBlinks({ origin, cluster: "devnet", fetcher }),
      ).rejects.toThrow();
    },
  );
});
