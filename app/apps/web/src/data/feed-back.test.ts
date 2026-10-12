import "../test/setup";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FEED_BACK_DEFAULT_MIX,
  feedBackEstimate,
} from "@onepercent/config/feed-back";

type Preview = { onepercentPreview?: { modes: Record<string, string> } };
const fresh = async () => {
  vi.resetModules();
  return import("./feed-back");
};

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Preview).onepercentPreview;
});

describe("Feed back estimate", () => {
  it("defaults to the documented edition mix", async () => {
    const { DEFAULT_FEED_BACK_ESTIMATE } = await fresh();
    expect(DEFAULT_FEED_BACK_ESTIMATE).toBe(
      feedBackEstimate(FEED_BACK_DEFAULT_MIX),
    );
    // 2% of (50 × 0.1 + 25 × 0.25 + 15 × 0.5 + 10 × 1 SOL) / 100.
    expect(DEFAULT_FEED_BACK_ESTIMATE).toBe(5_750_000n);
  });

  it("shows the live machine's estimate", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            feedBack: { estimate: "4000000", mix: [7, 1, 1, 1] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const { useFeedBackEstimate } = await fresh();
    const { result } = renderHook(() => useFeedBackEstimate());
    await waitFor(() => expect(result.current).toBe(4_000_000n));
    expect(fetch).toHaveBeenCalledWith("/api/machine", expect.anything());
  });

  it("falls back to the default mix without the machine", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    const { useFeedBackEstimate } = await fresh();
    const { result } = renderHook(() => useFeedBackEstimate());
    await waitFor(() => expect(result.current).toBe(5_750_000n));
  });

  it("uses the demo machine's estimate, unfetched, while Feed runs on its demo adapter", async () => {
    vi.stubEnv("VITE_PREVIEW", "1");
    (globalThis as Preview).onepercentPreview = { modes: { feed: "demo" } };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { useFeedBackEstimate } = await fresh();
    const { result } = renderHook(() => useFeedBackEstimate());
    await waitFor(() => expect(result.current).toBe(5_750_000n));
    expect(fetch).not.toHaveBeenCalled();
  });
});
