import "./test-setup";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { count, sol, solToLamports, t } from "@onepercent/copy";
import { FEED_BACK_RANGE } from "@onepercent/config/feed-back";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { feedableLabel } from "@onepercent/eligibility/copy";
import { strings } from "./strings";
import { XrayPage, XrayRoute } from "./xray-page";
import { XrayView } from "./XrayView";
import { REFERRAL_SESSION_KEY } from "./referral";
import { XrayField } from "./xray-field";
import rawResult from "./__fixtures__/result.json";
import { readFileSync } from "node:fs";
const stylesheet = "./xray.css";
const css = readFileSync(new URL(stylesheet, import.meta.url), "utf8");

vi.mock("../wallet/WalletProvider", () => ({
  useWallet: () => ({ account: null, open: vi.fn() }),
}));
vi.mock("../data/config", () => ({
  useConfig: () => ({ data: undefined, loading: false }),
}));
vi.mock("../data/feed-back", () => ({
  useFeedBackEstimate: () => 5_750_000n,
}));
const result = XrayResultSchema.parse(rawResult);
/** The default edition mix's estimate (@onepercent/config feedBackEstimate). */
const ESTIMATE = 5_750_000n;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
beforeEach(() => {
  window.history.replaceState(null, "", "/x");
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("XrayView", () => {
  it("shows the outlook of feeding the bags that can go to Feed under the stats", () => {
    render(
      <XrayView
        result={result}
        onShareX={vi.fn()}
        onCopyLink={vi.fn()}
        feedBackEstimate={ESTIMATE}
      />,
    );
    const toFeed = result.bags.filter((bag) =>
      bag.buckets.includes("feedable"),
    );
    const soldNow = toFeed.reduce(
      (sum, bag) => sum + (bag.valueSol ? solToLamports(bag.valueSol) : 0n),
      0n,
    );
    // The hero: "up to N×" for these bags together (the ones with a value), then
    // the expected amount; the X-ray's values are estimates: never "if sold now"
    // (COPY §0.4). The rent of the empty accounts stays in its own section.
    const valued = toFeed.filter((bag) => bag.valueSol !== undefined);
    const upTo = Number(
      (BigInt(valued.length) * FEED_BACK_RANGE.max) / soldNow,
    );
    expect(upTo).toBeGreaterThanOrEqual(2);
    const tiles = [...document.querySelectorAll(".feed-outlook .feed-tile")];
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      `${t("feed.outlook.upTo", { n: count(upTo) })} ${t("feed.outlook.whenPulled")} ${t(
        "feed.outlook.expected",
        { sol: sol(ESTIMATE * BigInt(toFeed.length)) },
      )}`,
      t("feed.outlook.soldEst", { sol: sol(soldNow) }),
    ]);
    expect(tiles.map((tile) => tile.className)).toEqual([
      "feed-tile is-hero",
      "feed-tile is-sold",
    ]);
    expect(
      document.querySelector(".feed-outlook .feed-outlook-note"),
    ).toHaveTextContent(t("feed.outlook.note"));
  });

  it("shows a few stats, each reason once and estimates in gold chips; the personality stays on the share card", () => {
    const share = vi.fn();
    const copy = vi.fn();
    render(
      <XrayView
        result={result}
        onShareX={share}
        onCopyLink={copy}
        feedBackEstimate={ESTIMATE}
      />,
    );
    // The share card carries the one personality element (its title): no
    // condition, one-liner or title in the page's own text.
    expect(screen.queryByText(result.card.title)).not.toBeInTheDocument();
    expect(screen.queryByText(/Condition/)).not.toBeInTheDocument();
    expect(screen.queryByText(result.card.oneLiner)).not.toBeInTheDocument();
    expect(screen.getByText(feedableLabel())).toBeInTheDocument();
    // Each reason once, as its list's note; "To check at Feed" says its own.
    for (const bag of result.bags.filter((bag) => bag.reason))
      if (bag.reasonCode === "snapshot_at_feed")
        expect(screen.queryByText(bag.reason!)).not.toBeInTheDocument();
      else expect(screen.getAllByText(bag.reason!)).toHaveLength(1);
    const bag = result.bags.find((bag) => bag.buckets.includes("sell"));
    expect(
      screen.getAllByText(strings.estimatedValue(bag!.valueSol!))[0],
    ).toHaveClass("xray-gold-chip");
    // The stats: bags to feed, the bids' estimate, the empty accounts' refund.
    const stats = [...document.querySelectorAll(".xray-stats li")].map(
      (tile) => tile.textContent,
    );
    expect(stats).toEqual([
      `${result.counts.feedable + result.counts.checkAtFeed} bags to feed`,
      `${strings.estimatedValue(result.totals.sellValueSol)} ${result.counts.sellable} bags with a bid`,
      `${strings.rent(result.totals.rentBackSol)} ${strings.emptyCount(result.counts.empty)}`,
    ]);
    // Not in the set: closed behind its count.
    const out = document.querySelector<HTMLDetailsElement>("details.xray-out")!;
    expect(out.open).toBe(false);
    expect(out.querySelector("summary")).toHaveTextContent(
      `${result.counts.notInSet} not eligible · why?`,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      result.share.landscapeUrl,
    );
    fireEvent.click(screen.getByRole("button", { name: strings.share }));
    fireEvent.click(screen.getByRole("button", { name: strings.copy }));
    expect(share).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledOnce();
  });
  it("keeps unchecked bags out of the verified Feedable section", () => {
    const bag = result.bags.find((entry) =>
      entry.buckets.includes("feedable"),
    )!;
    const pending = {
      ...result,
      counts: { ...result.counts, feedable: 0, checkAtFeed: 1 },
      bags: [
        {
          ...bag,
          reasonCode: "snapshot_at_feed" as const,
          reason: "Final check when you Feed",
        },
      ],
    };
    render(
      <XrayView
        result={pending}
        onShareX={vi.fn()}
        onCopyLink={vi.fn()}
        feedBackEstimate={ESTIMATE}
      />,
    );
    expect(
      screen.queryByRole("heading", { name: strings.feedable }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: strings.checkAtFeed }),
    ).toBeInTheDocument();
    expect(document.querySelector(".xray-stats")).toHaveTextContent(
      "1 bag to feed",
    );
  });
  it("shows an unavailable amount for an unreadable mint without inventing a value", () => {
    const missing = XrayResultSchema.parse({
      ...result,
      bags: [
        {
          ...result.bags[0],
          amountUi: null,
          decimals: null,
          buckets: ["not_in_set"],
          reasonCode: "mint_missing",
          reason: "Not supported",
          valueSol: undefined,
        },
      ],
    });
    render(
      <XrayView
        result={missing}
        onShareX={vi.fn()}
        onCopyLink={vi.fn()}
        feedBackEstimate={ESTIMATE}
      />,
    );
    expect(screen.getByText(strings.amountUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(strings.noValue)).not.toBeInTheDocument();
    expect(screen.queryByText(/if sold now/)).not.toBeInTheDocument();
  });
  it("shows a missing-value dash only inside Has a bid", () => {
    const unvalued = XrayResultSchema.parse({
      ...result,
      bags: [
        {
          ...result.bags.find((bag) => bag.buckets.includes("sell"))!,
          buckets: ["feedable", "sell"],
          reasonCode: undefined,
          reason: undefined,
          valueSol: undefined,
        },
      ],
    });
    render(
      <XrayView
        result={unvalued}
        onShareX={vi.fn()}
        onCopyLink={vi.fn()}
        feedBackEstimate={ESTIMATE}
      />,
    );
    const bids = screen
      .getByRole("heading", { name: strings.sellable })
      .closest("section")!;
    const feedable = screen
      .getByRole("heading", { name: strings.feedable })
      .closest("section")!;
    expect(within(bids).getByText(strings.noValue)).toBeInTheDocument();
    expect(
      within(feedable).queryByText(strings.noValue),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(strings.noValue)).toHaveLength(1);
  });
});

describe("XrayPage", () => {
  it("keeps partial scans visible and announces missing values with approved copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ ...result, valuesPartial: true })),
    );
    render(<XrayPage input={result.address} />);
    expect(
      await screen.findByRole("button", { name: strings.copy }),
    ).toBeInTheDocument();
    expect(screen.getByText(t("xray.result.partial"))).toHaveAttribute(
      "role",
      "status",
    );
    expect(
      screen.queryByText(t("xray.error.prices_unavailable")),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.share })).toBeEnabled();
  });
  it("loads and validates a scan and supports both share actions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(result));
    vi.stubGlobal("fetch", fetchMock);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<XrayPage input={result.address} />);
    expect(screen.getByText(strings.loading)).toHaveAttribute("role", "status");
    expect(
      await screen.findByRole("button", { name: strings.copy }),
    ).toBeInTheDocument();
    expect(screen.queryByText(strings.valuesPartial)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/xray/${result.address}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByRole("button", { name: strings.share }));
    expect(open).toHaveBeenCalledWith(
      result.share.xIntentUrl,
      "_blank",
      "noopener",
    );
    fireEvent.click(screen.getByRole("button", { name: strings.copy }));
    expect(await screen.findByText(strings.copied)).toHaveAttribute(
      "role",
      "status",
    );
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/x/${result.address}?ref=${result.address}`,
    );
  });

  it("forwards and stores an incoming referral and includes it when copying", async () => {
    window.history.replaceState(
      null,
      "",
      `/x/${result.address}?ref=shared_alias`,
    );
    const fetchMock = vi.fn().mockResolvedValue(response(result));
    vi.stubGlobal("fetch", fetchMock);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<XrayPage />);
    await screen.findByRole("button", { name: strings.copy });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/xray/${result.address}?ref=shared_alias`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(window.sessionStorage.getItem(REFERRAL_SESSION_KEY)).toBe(
      "shared_alias",
    );
    fireEvent.click(screen.getByRole("button", { name: strings.copy }));
    await screen.findByText(strings.copied);
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/x/${result.address}?ref=shared_alias`,
    );
  });
  it("follows query-only popstate changes while preserving the first session referral", async () => {
    window.history.replaceState(
      null,
      "",
      `/x/${result.address}?ref=first_alias`,
    );
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(response(result)));
    vi.stubGlobal("fetch", fetchMock);
    render(<XrayRoute fallback={null} />);
    await screen.findByRole("button", { name: strings.copy });
    window.history.replaceState(
      null,
      "",
      `/x/${result.address}?ref=second_alias`,
    );
    fireEvent.popState(window);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/xray/${result.address}?ref=second_alias`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(window.sessionStorage.getItem(REFERRAL_SESSION_KEY)).toBe(
      "first_alias",
    );
  });
  it("shows the API's EVM message", async () => {
    const message = "Solana wallets only for now.";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ error: "evm_not_supported", message }, 400),
        ),
    );
    render(<XrayPage input="0x52908400098527886E0F7030069857D2E4169EE7" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
  it("shows safe copy for an HTML error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Upstream server detail</html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    render(<XrayPage input={result.address} />);
    expect((await screen.findByRole("alert")).textContent).toBe(strings.error);
  });
  it("does not expose raw network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Private transport detail")),
    );
    render(<XrayPage input={result.address} />);
    expect((await screen.findByRole("alert")).textContent).toBe(strings.error);
  });
  it("rejects a schema-invalid success body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ address: result.address })),
    );
    render(<XrayPage input={result.address} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(strings.error);
  });
  it("aborts a previous scan when the input changes", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<XrayPage input={result.address} />);
    const firstSignal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    rerender(<XrayPage input="onepercent.sns" />);
    expect(firstSignal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("navigates the field and follows popstate without a router library", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(result)));
    render(<XrayRoute fallback={<div data-testid="fallback" />} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: ` ${result.address} ` },
    });
    fireEvent.click(screen.getByRole("button", { name: strings.submit }));
    await screen.findByRole("button", { name: strings.copy });
    expect(window.location.pathname).toBe(`/x/${result.address}`);
    window.history.replaceState(null, "", "/");
    fireEvent.popState(window);
    await waitFor(() =>
      expect(screen.getByTestId("fallback")).toBeInTheDocument(),
    );
  });
});

describe("XrayField", () => {
  it("keeps focus within a single control without an outline or ring", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    render(
      <div className="xray">
        <XrayField input="" onSubmit={vi.fn()} />
      </div>,
    );
    const input = screen.getByRole("textbox");
    input.focus();
    expect(input).toHaveFocus();
    expect(getComputedStyle(input).outline).toBe("none");
    expect(getComputedStyle(input).boxShadow).toBe("none");
    expect(getComputedStyle(input).borderWidth).toBe("0px");
    style.remove();
  });
});
