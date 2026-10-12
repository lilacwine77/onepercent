import "../../test/setup";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { short, t } from "@onepercent/copy";
import PublicView from "./PublicView";
import type { PublicBase, PublicViewProps, VerifyData } from "./types";

const base: PublicBase = {
  cluster: "devnet",
  loading: false,
  error: false,
  stale: false,
  asOfSlot: 90,
  trust: null,
  onRefresh: vi.fn(),
};
const proof: VerifyData = {
  seq: "42",
  source: "rpc",
  refunded: false,
  matches: true,
  seed: null,
  slot: 90,
  order: null,
  tableHash: "table-hash",
  paramsHash: "params-hash",
  request: "request-signature",
  callback: "callback-signature",
  settles: ["settle-signature"],
  packs: [
    {
      index: 0,
      kind: "silver",
      matches: true,
      draw: 7000,
      widths: [1, 0, 2],
      bucket: 3,
      dust: [{ slot: 0, computed: 2, matches: true }],
    },
  ],
};
describe("public read-only experiences", () => {
  it("keeps the requested Pull address visible when evidence is unavailable", () => {
    const identifier = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
    render(
      <PublicView
        {...base}
        kind="verify"
        identifier={identifier}
        data={null}
        error
      />,
    );
    expect(screen.getByText(short(identifier))).toBeVisible();
  });
  it("distinguishes draw math from request-seed and provider-proof verification", () => {
    render(<PublicView {...base} kind="verify" identifier="42" data={proof} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Verify pull #42",
    );
    expect(screen.getByText(t("verify.passed"))).toBeVisible();
    expect(screen.getByText(t("verify.unchecked"))).toBeVisible();
    expect(screen.getByText(t("verify.proof"))).toBeVisible();
    expect(screen.getByText(t("verify.bucketNote"))).toBeVisible();
    expect(screen.getByRole("link", { name: /VRF request/ })).toHaveAttribute(
      "href",
      "https://solscan.io/tx/request-signature?cluster=devnet",
    );
    expect(screen.getByRole("link", { name: /Settle 1/ })).toHaveAttribute(
      "href",
      "https://solscan.io/tx/settle-signature?cluster=devnet",
    );
    expect(screen.queryByText(t("public.sealed"))).not.toBeInTheDocument();
  });
  it("labels indexer evidence and a mismatched result explicitly", () => {
    render(
      <PublicView
        {...base}
        kind="verify"
        identifier="42"
        data={{ ...proof, source: "indexer", matches: false }}
      />,
    );
    expect(screen.getByText(t("verify.indexer"))).toBeVisible();
    expect(screen.getByText(t("verify.failed"))).toBeVisible();
  });
  it("keeps fairness available with an explicit unknown current state", () => {
    const onEdition = vi.fn();
    render(
      <PublicView
        {...base}
        kind="fairness"
        error
        data={{
          edition: 0,
          liveKnown: false,
          rows: [
            {
              id: "one_pct",
              probability: "0.01%",
              holderProbability: null,
              live: true,
              transferredToSilver: false,
            },
          ],
          tableHash: null,
          paramsHash: null,
          onEdition,
        }}
      />,
    );
    expect(screen.getByText(t("public.baseOdds"))).toBeVisible();
    expect(screen.queryByText(t("public.liveNow"))).not.toBeInTheDocument();
    const disclosure = screen.getByText(t("fairness.vrf"));
    expect(disclosure).not.toBeVisible();
    fireEvent.click(screen.getByText(t("fairness.vrf.title")));
    expect(disclosure).toBeVisible();
    expect(screen.getByText(t("fairness.creator.title"))).toBeVisible();
    expect(
      screen.queryByText(/Creator fees|lower of|Lower quotes|87.0%|62.5%/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(t("fairness.sell.title")));
    expect(screen.getByText(t("fairness.sell"))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "After Hours" }));
    expect(onEdition).toHaveBeenCalledWith(3);
  });
  it("never invents a token address, current market value or release date", () => {
    render(
      <PublicView
        {...base}
        kind="token"
        data={{
          mint: null,
          burnedTokens: 0n,
          jackpot: {
            tokens: 2500000n,
            costLamports: 1000000n,
            conversionLamports: 0n,
          },
          onePct: [
            {
              index: 0,
              amount: 100000000n,
              live: false,
              state: 0,
              releaseTs: null,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(t("token.before"))).toBeVisible();
    expect(screen.getByText(t("token.releasePending"))).toBeVisible();
    expect(screen.getByText(t("token.noEstimate"))).toBeVisible();
    expect(screen.queryByRole("link", { name: /Buy/ })).not.toBeInTheDocument();
  });
  it("pauses visible TV entries and announces only high-tier arrivals", () => {
    const first: Extract<PublicViewProps, { kind: "live" }> = {
      kind: "live",
      ...base,
      data: {
        totals: null,
        highlights: [],
        window: "today",
        onWindow: vi.fn(),
        tv: {
          enabled: true,
          onAir: true,
          state: "onAir",
          countdown: null,
          events: [
            {
              id: "1",
              kind: "pull",
              who: "abc…de",
              tier: "silver",
              sig: "sig-1",
              announce: false,
            },
          ],
        },
      },
    };
    const { rerender } = render(<PublicView {...first} />);
    const tv = screen.getByRole("region", { name: t("live.tv") });
    expect(within(tv).getByRole("log")).toBeEmptyDOMElement();
    fireEvent.click(
      within(tv).getByRole("button", { name: t("common.pause") }),
    );
    const next = {
      ...first,
      data: {
        ...first.data,
        tv: {
          ...first.data.tv,
          events: [
            ...first.data.tv.events,
            {
              id: "2",
              kind: "pull" as const,
              who: "xyz…fg",
              tier: "holo",
              sig: "sig-2",
              announce: true,
            },
          ],
        },
      },
    };
    rerender(<PublicView {...next} />);
    expect(
      within(tv).queryByRole("link", { name: /xyz/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(tv).getByRole("button", { name: t("common.resume") }),
    );
    expect(within(tv).getByRole("link", { name: /xyz/ })).toBeVisible();
    expect(within(tv).getByRole("log")).toHaveTextContent("Holo Foil");
    expect(within(tv).getByRole("log")).not.toHaveTextContent("Silver Foil");
  });
});
