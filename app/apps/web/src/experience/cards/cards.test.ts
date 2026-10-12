import "../../test/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en, t, type CopyKey, type CopyVars } from "@onepercent/copy";
import { bulkOptions, choicesFor, defaultChoice } from "./module/actions";
import { ISSUE_1, ISSUE_2, PROPOSED } from "./module/copy";
import { END_COPY, endActions } from "../rip/module/end";
import type { CardKind, CardRow, CardsController } from "./module/types";

const open = { open: true, reason: null };
const refilling = {
  open: false,
  reason: { key: "cards.sell.refusal.refilling" },
};
function row(kind: CardKind, id: string, over: Partial<CardRow> = {}): CardRow {
  const hit = ["silver", "blue", "holo", "black"].includes(kind);
  return {
    cardId: id,
    kind,
    edition: "original",
    seq: "48213",
    coin: { mint: `mint-${id}`, ticker: "WIFHAT", name: "Dog", logoUrl: null },
    amountUi: "1,204,331",
    stockedLamports: hit ? 400_000_000n : null,
    value: { kind: "est", lamports: hit ? 388_000_000n : 300_000n },
    sellBack: hit ? { kind: "now", lamports: 348_000_000n } : null,
    actions: {
      redeem: open,
      sellBack: hit ? open : { open: false, reason: null },
      feedBack: kind === "dust" ? open : { open: false, reason: null },
    },
    ...over,
  };
}

describe("My cards actions", () => {
  it("offers at most two actions per card: hits Sell or Redeem, Dust Cards Feed back or Redeem, specials Redeem", () => {
    for (const kind of ["silver", "blue", "holo", "black"] as const)
      expect(choicesFor(kind)).toEqual(["sell_back", "redeem"]);
    expect(choicesFor("dust")).toEqual(["feed_back", "redeem"]);
    for (const kind of ["jackpot", "one_pct", "final", "spotlight"] as const)
      expect(choicesFor(kind)).toEqual(["redeem"]);
  });

  it("leads with Sell for a hit and Feed back for a Dust Card, and falls back to Redeem when closed", () => {
    expect(defaultChoice(row("holo", "a"))).toBe("sell_back");
    expect(defaultChoice(row("dust", "b"))).toBe("feed_back");
    expect(defaultChoice(row("jackpot", "c"))).toBe("redeem");
    const refused = row("holo", "d");
    refused.actions.sellBack = refilling;
    expect(defaultChoice(refused)).toBe("redeem");
  });

  it("builds the bulk bar from the cards that apply: Sell all hits, Feed back all dust, Redeem all", () => {
    const cards = [
      row("holo", "h1"),
      row("silver", "h2", { sellBack: { kind: "now", lamports: 52_000_000n } }),
      row("dust", "d1"),
      row("dust", "d2"),
      row("dust", "d3"),
      row("one_pct", "p1"),
    ];
    expect(bulkOptions(cards, 5_750_000n)).toEqual([
      { action: "sell_back", ids: ["h1", "h2"], of: 2, lamports: 400_000_000n },
      {
        action: "feed_back",
        ids: ["d1", "d2", "d3"],
        of: 3,
        lamports: 17_250_000n,
      },
      {
        action: "redeem",
        ids: ["h1", "h2", "d1", "d2", "d3", "p1"],
        of: 6,
        lamports: null,
      },
    ]);
    // Only those that apply: a refused Sell leaves its hit out; no dust, no Feed back.
    cards[0]!.actions.sellBack = refilling;
    const [sell, ...rest] = bulkOptions(cards.slice(0, 2), 5_750_000n);
    expect(sell).toEqual({
      action: "sell_back",
      ids: ["h2"],
      of: 2,
      lamports: 52_000_000n,
    });
    expect(rest.map((o) => o.action)).toEqual(["redeem"]);
    expect(
      bulkOptions([row("jackpot", "j")], 5_750_000n).map((o) => o.action),
    ).toEqual(["redeem"]);
  });

  it("ends a pull with Sell and Go to My cards for a hit, Go to My cards for a special, nothing for dust", () => {
    expect(endActions({ hit: true, tier: "black" })).toEqual([
      "sell_back",
      "my_cards",
    ]);
    expect(endActions({ hit: true, tier: "jackpot" })).toEqual(["my_cards"]);
    expect(endActions({ hit: true, tier: "one_pct" })).toEqual(["my_cards"]);
    expect(endActions({ hit: false })).toEqual([]);
  });
});

describe("My cards and Rip end copy", () => {
  const deck = en as Record<string, string>;
  it("holds the COPY.md keys byte for byte (issue 1 and §6)", () => {
    for (const [key, text] of Object.entries({ ...ISSUE_1, ...ISSUE_2 }))
      expect(deck[key], key).toBe(text);
    for (const [key, text] of Object.entries(END_COPY))
      expect(deck[key], key).toBe(text);
  });
  it("matches the authorized issue 2 draft and excludes retired actions and em dashes", () => {
    for (const [key, text] of Object.entries(PROPOSED))
      expect(deck[key], key).toBe(text);
    const all = { ...ISSUE_1, ...ISSUE_2, ...PROPOSED, ...END_COPY };
    for (const [key, text] of Object.entries(all)) {
      expect(text, key).not.toMatch(/—|at market|Sell back|\bKeep\b/);
    }
    expect(Object.keys(deck).filter((key) => key.startsWith("sell."))).toEqual(
      [],
    );
  });
});

describe("My cards sheet", () => {
  let cards: CardsController | null = null;
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
  });
  afterEach(() => {
    cards?.destroy();
    cards = null;
    document.body.replaceChildren();
  });
  async function mount(rows: CardRow[]) {
    const { mountCards } = await import("./module/index");
    const host = document.createElement("div");
    document.body.append(host);
    cards = mountCards(host, {
      reducedMotion: true,
      t: (key, vars) => t(key as CopyKey, (vars ?? {}) as CopyVars<CopyKey>),
      data: {
        status: "ready",
        cards: rows,
        pending: [],
        owedLamports: 0n,
        closeMyCards: null,
        config: { feedBackEstimateLamports: 5_750_000n, royaltyPct: "2%" },
      },
    });
    return cards;
  }
  const choices = () =>
    [...document.querySelectorAll<HTMLElement>(".mc-sheet .mc-choice")].map(
      (el) => ({
        name: el.querySelector(".mc-choice-name")?.textContent,
        fig: el.querySelector(".mc-choice-fig")?.textContent,
        line: el.querySelector(".mc-choice-line")?.textContent,
        off: el.classList.contains("is-off"),
        on: el.classList.contains("is-on"),
      }),
    );

  it("shows a hit's Sell with its price alone, and Redeem, and nothing that repeats them", async () => {
    const view = await mount([row("holo", "h")]);
    view.open("h");
    expect(choices()).toEqual([
      {
        name: "Sell",
        fig: "+0.34 SOL · instant",
        line: "",
        off: false,
        on: true,
      },
      {
        name: "Redeem",
        fig: "",
        line: "Tokens to your wallet.",
        off: false,
        on: false,
      },
    ]);
    const sheet = document.querySelector(".mc-sheet")!;
    expect(sheet.textContent).not.toMatch(
      /if sold now|at market|Keep|Cards stay here|You sign everything/,
    );
    // The card itself shows its amount only: no market value beside Sell.
    expect(sheet.querySelector(".mc-card .mc-panel")).toHaveClass("is-amount");
    expect(sheet.querySelector(".mc-card .mc-valrow")).toBeNull();
    // The row already has the number: no sentence repeats it.
    expect(sheet.querySelector(".mc-presign-lead")).toBeNull();
  });

  it("closes Sell with its one-line reason and keeps Redeem", async () => {
    const refused = row("black", "b");
    refused.actions.sellBack = refilling;
    const view = await mount([refused]);
    view.open("b");
    const [sell, redeem] = choices();
    expect(sell).toMatchObject({
      name: "Sell",
      fig: "",
      line: "The machine is refilling. Try again soon.",
      off: true,
      on: false,
    });
    expect(redeem).toMatchObject({ name: "Redeem", on: true });
  });

  it("shows a Dust Card's Feed back as one estimate, and Redeem", async () => {
    const view = await mount([row("dust", "d")]);
    view.open("d");
    expect(
      choices().map(({ name, fig, line }) => ({ name, fig, line })),
    ).toEqual([
      {
        name: "Feed back",
        fig: "≈0.0057 SOL when it’s pulled",
        line: "",
      },
      {
        name: "Redeem",
        fig: "",
        line: "Tokens to your wallet.",
      },
    ]);
    expect(document.querySelector(".mc-trust")).toHaveTextContent(
      "You sign everything. Take any card back until it’s pulled.",
    );
  });

  it("never presents a list estimate as an executable Feed back comparison", async () => {
    const view = await mount([
      row("dust", "d", {
        value: { kind: "est", lamports: 900_000_000n },
        feedBackNeedsConfirm: true,
      }),
    ]);
    view.open("d");
    view.setPreview("feed_back", ["d"], {
      lines: [],
      feedBackValues: { d: { value: { kind: "none" }, needsConfirm: true } },
    });
    const button = document.querySelector<HTMLButtonElement>(
      ".mc-sheet-foot > .mc-oval",
    )!;
    expect(button).toBeEnabled();
    button.click();
    const guard = document.querySelector(".mc-confirm")!;
    expect(guard).toHaveTextContent(t("cards.feedBack.confirm.unavailable"));
    expect(guard.textContent).not.toContain("0.90");
    expect(guard.textContent).not.toContain("if sold now");
  });

  it("uses only the preview quote and can raise confirmation after a low list estimate", async () => {
    const view = await mount([
      row("dust", "d", {
        value: { kind: "est", lamports: 1n },
        feedBackNeedsConfirm: false,
      }),
    ]);
    view.open("d");
    view.setPreview("feed_back", ["d"], {
      lines: [],
      feedBackValues: {
        d: {
          value: { kind: "now", lamports: 800_000_000n },
          needsConfirm: true,
        },
      },
    });
    document
      .querySelector<HTMLButtonElement>(".mc-sheet-foot > .mc-oval")!
      .click();
    const guard = document.querySelector(".mc-confirm")!;
    expect(guard).toHaveTextContent("0.80");
    expect(guard).toHaveTextContent("sells for now");
    expect(guard.textContent).not.toContain(
      t("cards.feedBack.confirm.unavailable"),
    );
  });

  it("offers a special Redeem only", async () => {
    const view = await mount([row("one_pct", "p")]);
    view.open("p");
    expect(choices().map((c) => c.name)).toEqual(["Redeem"]);
  });

  it("shows the total line, the bulk bar and Rip again", async () => {
    const view = await mount([
      row("holo", "h"),
      row("dust", "d1"),
      row("dust", "d2"),
      row("jackpot", "j"),
    ]);
    const rip = vi.fn();
    view.on("rip", rip);
    // The hit at its Sell value, the dust at the Feed back estimate, the Jackpot at its own value.
    expect(document.querySelector(".mc-total")).toHaveAttribute(
      "aria-label",
      "≈0.35 SOL in your cards",
    );
    expect(
      document.querySelector('.mc-cell[data-kind="holo"] .mc-valrow'),
    ).toBeNull();
    expect(
      document.querySelector('.mc-cell[data-kind="holo"] .mc-tile'),
    ).toHaveAttribute("aria-label", "Holo Foil 4×, 1,204,331 $WIFHAT");
    expect(
      document.querySelector('.mc-cell[data-kind="dust"] .mc-val'),
    ).toHaveTextContent("≈0.0003 SOL est.");
    const bulk = [...document.querySelectorAll(".mc-bulk-btn")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(bulk).toEqual([
      "Sell all hits · +0.34 SOL",
      "Feed back all dust · ≈0.011 SOL",
      "Redeem all",
    ]);
    const again = document.querySelector<HTMLButtonElement>(".mc-dock-rip")!;
    expect(again).toHaveTextContent("Rip again");
    again.click();
    expect(rip).toHaveBeenCalledOnce();
    expect(document.querySelector(".mc-seltoggle")).toBeNull();
  });

  it("puts the best pull first and lights a highlighted card", async () => {
    const view = await mount([
      row("dust", "d"),
      row("silver", "s"),
      row("one_pct", "p"),
      row("holo", "h"),
    ]);
    const order = [...document.querySelectorAll<HTMLElement>(".mc-cell")].map(
      (c) => c.dataset.id,
    );
    expect(order).toEqual(["p", "h", "s", "d"]);
    view.highlight("s");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelector('.mc-cell[data-id="s"]')).toHaveClass(
      "is-highlight",
    );
  });
});
