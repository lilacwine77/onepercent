import "./test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import config from "../../../packages/web-api/fixtures/config.json";
import webConfig from "../../../packages/web-api/fixtures/web-config.json";
import { configResource, webConfigResource } from "./data/config";
const response = (body: unknown) => new Response(JSON.stringify(body));
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  configResource.invalidate();
  webConfigResource.invalidate();
});
describe("shell boot", () => {
  it("renders the home immediately, and X-ray on /x from parsed config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(
          url === "/api/config"
            ? config
            : url === "/api/web/config"
              ? webConfig
              : { result: 100 },
        ),
      ),
    );
    const { unmount } = render(<App />);
    expect(
      screen.getByRole("heading", { name: "Dust in, Packs out." }),
    ).toBeVisible();
    // The home hero is the landing's: no X-ray field (the header leads to /x).
    expect(screen.queryByRole("textbox")).toBeNull();
    await waitFor(() =>
      expect(document.title).toBe("Onepercent · Dust in, Packs out."),
    );
    unmount();
    window.history.replaceState(null, "", "/x");
    render(<App />);
    expect(await screen.findByRole("textbox")).toBeVisible();
  });
  it.each([404, 503])(
    "keeps X-ray available before machine launch (%s), without offline copy or RPC",
    async (status) => {
      const requests: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          requests.push(url);
          if (url === "/api/config")
            return new Response(
              status === 404
                ? "Not Found"
                : JSON.stringify({ error: "not_configured" }),
              { status },
            );
          if (url === "/api/web/config") return response(webConfig);
          throw new Error("Unexpected request");
        }),
      );
      window.history.replaceState(null, "", "/x");
      render(<App />);
      expect(await screen.findByRole("textbox")).toBeVisible();
      await waitFor(() => expect(configResource.snapshot().data).toBeNull());
      expect(
        screen.queryByText(
          "The machine’s data is offline. Your exits still work.",
        ),
      ).toBeNull();
      expect(requests).not.toContain("/api/rpc");
    },
  );
  it("keeps the machine outage visible without disabling independently configured X-ray", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/web/config"
          ? response(webConfig)
          : new Response(JSON.stringify({ error: "unavailable" }), {
              status: 503,
            }),
      ),
    );
    window.history.replaceState(null, "", "/x");
    render(<App />);
    expect(await screen.findByRole("textbox")).toBeVisible();
    expect(
      await screen.findByText(
        "The machine’s data is offline. Your exits still work.",
      ),
    ).toBeVisible();
  });
  it("closes flags on failure, keeps cards/fairness and rescue links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    window.history.replaceState(null, "", "/x");
    render(<App />);
    expect(
      await screen.findByText(
        "The machine’s data is offline. Your exits still work.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "My cards" })).toHaveAttribute(
      "href",
      "/cards",
    );
    for (const link of screen.getAllByRole("link", { name: "Odds and verify" }))
      expect(link).toHaveAttribute("href", "/fairness");
    expect(
      screen.getAllByRole("link", { name: "Rescue page ↗" }).length,
    ).toBeGreaterThan(0);
  });
});
