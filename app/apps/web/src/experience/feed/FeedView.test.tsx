import "../../test/setup";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FEED_BACK_RANGE } from "@onepercent/config/feed-back";
import { sol, t } from "@onepercent/copy";
import FeedView from "./FeedView";
import type { FeedPanelProps, FeedRow, InTheMachineProps } from "./types";

const ESTIMATE = 5_750_000n;
const checkAtFeed = { key: "feed.row.checkAtFeed" } as const;
const row = (ticker: string, over: Partial<FeedRow> = {}): FeedRow => ({
  coin: { mint: `mint-${ticker}`, ticker, name: ticker, logoUrl: null },
  amountUi: "1,000",
  drawdownPct: null,
  value: { kind: "now", lamports: 300_000n },
  feed: true,
  canFeed: { open: true, reason: null },
  needsConfirm: false,
  confirmed: true,
  note: null,
  ...over,
});
function panel(over: Partial<FeedPanelProps> = {}): FeedPanelProps {
  return {
    wallet: "J4aGiHemVzcxxjcwMKm77A9uUpB4Yf32KbEBrwtKG31a",
    rentBack: { accounts: 39, lamports: 70_000_000n },
    estimateLamports: ESTIMATE,
    rows: [
      row("boss"),
      row("trol", { feed: false, value: { kind: "now", lamports: 250_000n } }),
      row("rugga", { value: { kind: "none" } }),
      row("held", {
        feed: false,
        canFeed: { open: false, reason: { key: "xray.reason.not_pump_fun" } },
      }),
    ],
    deposits: { totalLamports: 0n, lines: [] },
    emptiedRentBackLamports: 0n,
    machineToday: null,
    plan: { bags: 2, transactions: 1, approvals: 1 },
    explainer: { key: "feed.trust" },
    trust: { key: "feed.trust" },
    flow: {
      phase: "ready",
      confirmed: 0,
      total: 1,
      approvals: 1,
      message: null,
    },
    gate: { open: true, reason: null },
    onToggle: vi.fn(),
    onConfirmBag: vi.fn(),
    onFeed: vi.fn(),
    onFeedOneFirst: vi.fn(),
    onRefreshQuotes: vi.fn(),
    onRetry: vi.fn(),
    ...over,
  };
}
const machine: InTheMachineProps = {
  entries: [],
  vaultDeposits: [],
  flow: { phase: "idle", confirmed: 0, total: 0, approvals: 0, message: null },
  onTakeBack: vi.fn(),
};
const show = (props: FeedPanelProps) =>
  render(
    <FeedView
      panel={props}
      machine={machine}
      soundOn={false}
      reducedMotion
      onRip={vi.fn()}
    />,
  );
const rowOf = (ticker: string) =>
  document.querySelector(
    `.feed-row[data-mint="mint-${ticker}"]`,
  ) as HTMLElement;

describe("Feed panel", () => {
  it("gives every bag that can be fed one Feed checkbox, on by default", () => {
    const props = panel();
    show(props);
    expect(screen.getByRole("checkbox", { name: "Feed $boss" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Feed $rugga" })).toBeChecked();
    const trol = screen.getByRole("checkbox", { name: "Feed $trol" });
    expect(trol).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Feed $boss" }));
    expect(props.onToggle).toHaveBeenCalledWith("mint-boss", false);
    fireEvent.click(trol);
    expect(props.onToggle).toHaveBeenCalledWith("mint-trol", true);
    // No Sell and no Keep in wallet on this page.
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("Keep in wallet")).toBeNull();
  });

  it("keeps the bags that can't be fed closed behind their count, each reason once", () => {
    show(panel());
    const out = document.querySelector<HTMLDetailsElement>("details.feed-out")!;
    expect(out.open).toBe(false);
    expect(out.querySelector("summary")).toHaveTextContent(
      t("feed.group.out.one"),
    );
    expect(
      within(out).getAllByText(t("xray.reason.not_pump_fun")),
    ).toHaveLength(1);
    expect(within(out).getByText("$held")).toBeInTheDocument();
    expect(within(out).queryByRole("checkbox")).toBeNull();
  });

  it("puts each bag on one line: what it sells for now, and its multiple", () => {
    show(panel());
    expect(
      screen.getByRole("heading", {
        name: t("feed.group.feed.other", { n: "2" }),
      }),
    ).toBeInTheDocument();
    const boss = rowOf("boss");
    expect(boss.querySelector(".feed-roi > span")).toHaveTextContent(
      t("feed.row.roi", { sol: sol(300_000n) }),
    );
    // 0.02 SOL over 0.0003 SOL, rounded down: a bold badge.
    expect(boss.querySelector("b.feed-times")).toHaveTextContent(
      t("feed.row.multiple", { n: "66" }),
    );
    // Without a sold-now value: no multiple.
    const rugga = rowOf("rugga");
    expect(rugga.querySelector(".feed-roi > span")).toHaveTextContent(
      t("feed.row.noBid"),
    );
    expect(rugga.querySelector(".feed-times")).toBeNull();
  });

  it("states the final check once, under the list", () => {
    const all = panel({
      rows: [
        row("boss", { note: checkAtFeed }),
        row("doge", { note: checkAtFeed }),
      ],
    });
    const { unmount } = show(all);
    expect(document.querySelectorAll(".feed-row .feed-note")).toHaveLength(0);
    expect(document.querySelectorAll(".feed-mark")).toHaveLength(0);
    expect(document.querySelector(".feed-footnote")?.textContent).toBe(
      t("feed.row.checkAtFeed"),
    );
    unmount();
    // Only some bags get it: a * marks them.
    show(panel({ rows: [row("boss", { note: checkAtFeed }), row("doge")] }));
    expect(rowOf("boss").querySelector(".feed-mark")).toBeInTheDocument();
    expect(rowOf("doge").querySelector(".feed-mark")).toBeNull();
    expect(document.querySelector(".feed-footnote")?.textContent).toBe(
      `* ${t("feed.row.checkAtFeed")}`,
    );
  });

  it("leads with the biggest multiple when pulled, the expected amount under it, then a muted sold now", () => {
    const { unmount } = show(panel());
    // $boss and $rugga are checked; $rugga has no sold-now value, so the hero is
    // $boss's 0.02 SOL over 0.0003 SOL (66×), its row's badge.
    const upTo = Number(FEED_BACK_RANGE.max / 300_000n);
    const tiles = [...document.querySelectorAll(".feed-outlook .feed-tile")];
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      `${t("feed.outlook.upTo", { n: String(upTo) })} ${t("feed.outlook.whenPulled")} ${t("feed.outlook.expected", { sol: sol(ESTIMATE * 2n) })}`,
      t("feed.outlook.soldNow", { sol: sol(300_000n) }),
    ]);
    expect(tiles.map((tile) => tile.className)).toEqual([
      "feed-tile is-hero",
      "feed-tile is-sold",
    ]);
    expect(tiles[0]!.querySelector("b")).toHaveTextContent(
      t("feed.row.multiple", { n: String(upTo) }),
    );
    expect(document.querySelector(".feed-outlook-note")).toHaveTextContent(
      t("feed.outlook.note"),
    );
    // The rent refund is one quiet line under the list, not an outlook stat.
    expect(
      screen.getByText(t("feed.rentRefund", { sol: sol(70_000_000n) })),
    ).toHaveClass("feed-rent");
    expect(document.querySelector(".feed-outlook")).not.toHaveTextContent(
      sol(70_000_000n),
    );
    unmount();
    // Two checked bags with a value (badges 66× and 80×): together, 2 × 0.02 SOL
    // over 0.00055 SOL, rounded down.
    show(
      panel({
        rows: [
          row("boss"),
          row("trol", { value: { kind: "now", lamports: 250_000n } }),
        ],
      }),
    );
    expect(document.querySelector(".feed-tile.is-hero b")).toHaveTextContent(
      t("feed.outlook.upTo", {
        n: String(Number((2n * FEED_BACK_RANGE.max) / 550_000n)),
      }),
    );
  });

  it("makes the expected amount the hero when no bag shows a multiple", () => {
    show(panel({ rows: [row("rugga", { value: { kind: "none" } })] }));
    const hero = document.querySelector(".feed-tile.is-hero")!;
    expect(hero.querySelector("b")).toHaveTextContent(`≈${sol(ESTIMATE)} SOL`);
    expect(hero.textContent).toBe(
      `${t("feed.outlook.expected", { sol: sol(ESTIMATE) })} ${t("feed.outlook.whenPulled")}`,
    );
  });

  it("feeds the checked bags with a button that names the bags only", () => {
    const props = panel();
    show(props);
    const button = screen.getByRole("button", {
      name: t("feed.button.feed", { bags: "2 bags" }),
    });
    expect(
      screen.getByText(
        t("feed.plan", {
          transactions: "1 transaction",
          approvals: "1 approval",
        }),
      ),
    ).toBeInTheDocument();
    fireEvent.click(button);
    expect(props.onFeed).toHaveBeenCalledWith({
      feed: ["mint-boss", "mint-rugga"],
    });
  });

  it("drops the rent line without empty accounts, and closes them alone without bags", () => {
    const { unmount } = show(
      panel({ rentBack: { accounts: 0, lamports: 0n } }),
    );
    expect(
      screen.getByRole("button", {
        name: t("feed.button.feed", { bags: "2 bags" }),
      }),
    ).toBeInTheDocument();
    expect(document.querySelector(".feed-rent")).toBeNull();
    unmount();
    show(
      panel({
        rows: [row("boss", { feed: false })],
        plan: { bags: 0, transactions: 1, approvals: 1 },
      }),
    );
    expect(
      screen.getByRole("button", {
        name: t("feed.button.rentOnly", { sol: sol(70_000_000n) }),
      }),
    ).toBeInTheDocument();
    // The button already says it: no "also refunds" line.
    expect(document.querySelector(".feed-rent")).toBeNull();
  });
});
