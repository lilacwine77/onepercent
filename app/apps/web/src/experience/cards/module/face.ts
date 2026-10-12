/* eslint-disable */
// Synced from experience/cards-lab/src/cards/face.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Card faces as DOM (da-direction.md §7): text stays sharp at any DPR, and every size is in
 * container-query units of the card's own width, so a face scales exactly between the grid and
 * the sheet (the shared-element transition swaps faces of different sizes without a visible change).
 */
import { EDITIONS, KINDS, SELL_BACK_KINDS, isOnePctMint } from "./brand";
import type { Translate } from "./copy";
import { h } from "./dom";
import { sol, ticker } from "./format";
import type { CardRow, Value } from "./types";

export interface FaceCtx {
  t: Translate;
  assetsBase: string;
}

/** "≈0.40 SOL est." / "≈0.40 SOL if sold now" / "n/a". */
export function valueText(t: Translate, v: Value | null | undefined): string {
  if (!v || v.kind === "none") return t("common.noValue");
  return t(v.kind === "now" ? "common.ifSoldNow" : "common.est", {
    sol: sol(v.lamports),
  });
}

/** Splits "≈0.40 SOL est." into the figure ("≈0.40 SOL") and its label ("est."), keeping the full text. */
export function valueParts(
  t: Translate,
  v: Value | null | undefined,
): { full: string; figure: string; label: string } {
  const full = valueText(t, v);
  const m = full.match(/^(≈\S+ SOL)\s+(.+)$/);
  return m
    ? { full, figure: m[1], label: m[2] }
    : { full, figure: full, label: "" };
}

const monogram = (tk: string) =>
  isOnePctMint(tk) ? "1%" : (tk.replace(/^\$/, "")[0] ?? "?").toUpperCase();

function coin(card: CardRow, mode: "xray" | "gold"): HTMLElement {
  const tk = ticker(card.coin.ticker);
  const face = h("span", "mc-coin-face");
  if (card.coin.logoUrl && !isOnePctMint(tk)) {
    const img = h("img", {
      attrs: {
        src: card.coin.logoUrl,
        alt: "",
        decoding: "async",
        loading: "lazy",
        draggable: "false",
      },
    });
    // A logo that fails to load falls back to the monogram (03-M3 §5.1 logo proxy 404).
    img.addEventListener(
      "error",
      () => img.replaceWith(h("b", { cls: "mc-mono", text: monogram(tk) })),
      { once: true },
    );
    face.append(img);
  } else {
    face.append(
      h("b", {
        cls: `mc-mono${isOnePctMint(tk) ? " is-1pct" : ""}`,
        text: monogram(tk),
      }),
    );
  }
  return h(
    "span",
    { cls: `mc-coin is-${mode}`, attrs: { "aria-hidden": "true" } },
    [h("span", "mc-coin-edge"), h("span", "mc-coin-rim"), face],
  );
}

function valueRow(t: Translate, v: Value): HTMLElement {
  const p = valueParts(t, v);
  if (!v || v.kind === "none")
    return h("span", { cls: "mc-valrow is-none" }, [
      h("span", { cls: "mc-vnone", text: p.full }),
    ]);
  return h("span", { cls: "mc-valrow" }, [
    h("span", { cls: "mc-chip", text: p.figure }),
    " ",
    h("span", { cls: "mc-vlabel", text: p.label }),
  ]);
}

const n = (s: string) => String([...s].length);

/** The DA gold emboss (§7.2): a solid gold-ink copy underneath gives the bevel and shadow, the gradient copy sits on top. */
function emboss(text: string, cls = "") {
  return h("span", { cls: `mc-emb${cls ? ` ${cls}` : ""}` }, [
    h("span", { cls: "mc-emb-back", text }),
    h("span", { cls: "mc-emboss", text }),
  ]);
}

/** The card: `.mc-card` (tilt target) › `.mc-face` (art) + light layers. */
export function buildFace(card: CardRow, ctx: FaceCtx): HTMLElement {
  const { t } = ctx;
  const info = KINDS[card.kind];
  const tk = ticker(card.coin.ticker);
  const el = h("div", {
    cls: "mc-card",
    data: {
      kind: card.kind,
      ...(card.edition ? { ed: card.edition } : {}),
      ...(info.foil ? { foil: info.foil } : {}),
    },
    attrs: { "aria-hidden": "true" },
  });
  const face = h("div", "mc-face");
  el.append(face);

  if (card.kind === "dust" || card.kind === "spotlight") {
    face.append(
      h("span", "mc-paper"),
      h("span", "mc-edge"),
      h("span", "mc-strip", [
        h("span", { cls: "mc-tk", text: tk, vars: { "--n": n(tk) } }),
        h("span", { cls: "mc-chain", text: "SOL" }),
      ]),
      h("span", "mc-mid", [
        coin(card, "xray"),
        h("span", {
          cls: "mc-amt",
          text: card.amountUi,
          vars: { "--n": n(card.amountUi) },
        }),
        h("span", { cls: "mc-sub", text: t("cards.face.dustOrigin") }),
      ]),
      h("span", "mc-foot", [
        h("span", {
          cls: "mc-foot-ed",
          text: card.edition ? EDITIONS[card.edition].name : "",
        }),
        h("span", {
          cls: `mc-val${card.value.kind === "none" ? " is-none" : ""}`,
          text: valueText(t, card.value),
        }),
      ]),
    );
    if (card.edition)
      el.style.setProperty("--ed-edge", EDITIONS[card.edition].edge);
    el.append(h("span", "mc-glare"));
    return el;
  }

  const light = card.kind === "one_pct";
  if (light) {
    face.append(h("span", "mc-pearl"));
    face.append(h("span", "mc-shine"));
    face.append(h("span", "mc-frame"));
    face.append(emboss("1%", "mc-onepct"));
    face.append(h("span", "mc-label", [h("span", { text: t(info.name) })]));
    face.append(
      h("img", {
        cls: "mc-pepe",
        attrs: {
          src: `${ctx.assetsBase}pepe-white.webp`,
          alt: "",
          decoding: "async",
          loading: "lazy",
          draggable: "false",
        },
      }),
    );
  } else {
    face.append(
      h("span", "mc-foil"),
      h("span", "mc-shine"),
      h("span", "mc-glitter"),
      h("span", "mc-frame"),
    );
    const label = card.kind === "final" ? t("cards.face.final") : t(info.name);
    face.append(
      h("span", { cls: `mc-label${info.mult ? "" : " is-solo"}` }, [
        h("span", { text: label }),
      ]),
    );
    if (info.mult) face.append(h("span", "mc-mult", [emboss(info.mult)]));
    if (card.kind === "jackpot")
      face.append(h("span", { cls: "mc-title", text: t(info.name) }));
    face.append(coin(card, "gold"));
  }
  // A hit the machine buys back shows its amount only: no market value stands beside Sell (D30).
  const valued = !SELL_BACK_KINDS.includes(card.kind);
  face.append(
    h(
      "span",
      {
        cls: `mc-panel${light ? " is-light" : ""}${valued ? "" : " is-amount"}`,
      },
      [
        h("span", {
          cls: "mc-amt",
          text: card.amountUi,
          vars: { "--n": n(card.amountUi) },
        }),
        h("span", { cls: "mc-tk", text: tk }),
        valued ? valueRow(t, card.value) : null,
      ],
    ),
  );
  el.append(h("span", "mc-glare"));
  return el;
}

/** Updates the value line of an existing face in place (quotes refresh without rebuilding). */
export function updateFaceValue(el: HTMLElement, card: CardRow, t: Translate) {
  const dustVal = el.querySelector<HTMLElement>(".mc-val");
  if (dustVal) {
    dustVal.textContent = valueText(t, card.value);
    dustVal.classList.toggle("is-none", card.value.kind === "none");
    return;
  }
  const row = el.querySelector(".mc-valrow");
  if (row) row.replaceWith(valueRow(t, card.value));
}

/** The card back: identical for every card (no tells, DA §7), a crisp lock-up over the holo foil. */
export function buildBack(t: Translate): HTMLElement {
  return h(
    "div",
    { cls: "mc-card mc-back", attrs: { "aria-hidden": "true" } },
    [
      h("div", "mc-face", [
        h("span", "mc-foil"),
        h("span", "mc-frame"),
        h("span", "mc-backplate", [
          emboss("1%"),
          h("span", { cls: "mc-mantra", text: t("cards.face.mantra") }),
        ]),
      ]),
    ],
  );
}
