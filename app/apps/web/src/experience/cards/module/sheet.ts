/* eslint-disable */
// Synced from experience/cards-lab/src/cards/sheet.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * The sheet: a dialog on desktop, a bottom sheet on phones. Three modes:
 *  - card: one card large (live foil), its actions (at most two: hits Sell or Redeem, Dust Cards Feed back
 *    or Redeem, specials Redeem), one sentence on what the chosen action does and when it pays, the
 *    technical details in a small row, and the confirm button. Closing it keeps the card;
 *  - bulk: the cards of a bulk bar action fanned, the same sentence and details, and confirm;
 *  - machine: "In the machine" (fed cards, Take back, vault deposits).
 * The card flies from its grid slot into the sheet and back (shared element, spring physics).
 */
import { choicesFor, defaultChoice, gateFor, type Choice } from "./actions";
import { KINDS, EDITIONS } from "./brand";
import { msg } from "./copy";
import type { Ctx } from "./ctx";
import { h, icon, nextId, setText } from "./dom";
import { buildFace, updateFaceValue, valueParts } from "./face";
import { count, sol, sumValues, ticker } from "./format";
import { gsap, pressable, SPRINGS } from "./motion";
import { Tilt } from "./tilt";
import type {
  ActionInfo,
  ActionPreview,
  ActionState,
  CardRow,
  CardsAction,
  CardsData,
  Gate,
  InTheMachineEntry,
  Value,
  VaultDeposit,
} from "./types";

export type { Choice };
type Mode = "card" | "bulk" | "machine";

export interface SheetHost {
  ctx: Ctx;
  card(id: string): CardRow | undefined;
  data(): CardsData;
  preview(
    action: CardsAction,
    ids: string[],
  ): { preview: ActionPreview; at: number } | null;
  stateOf(
    action: CardsAction,
    ids: string[],
  ): { state: ActionState; info?: ActionInfo } | null;
  /** The grid tile's face and its rect, for the shared-element flight. */
  tile(id: string): { face: HTMLElement; lift: HTMLElement } | null;
  choose(action: Choice, ids: string[]): void;
  confirm(action: CardsAction, ids: string[]): void;
  closed(how: "keep" | "dismiss" | "done", mode: Mode, ids: string[]): void;
  verify(seq: string): void;
  takeBack(ids: string[]): void;
  /** Elements made inert while the sheet is open. */
  inertTargets(): HTMLElement[];
  /** The dock's rect (a card landing under it dissolves into place instead of popping behind it). */
  dockRect(): DOMRect | null;
}

const ICON: Record<Choice, string> = {
  sell_back: "sell",
  feed_back: "feed",
  redeem: "redeem",
};
const NAME: Record<Choice, string> = {
  sell_back: "cards.choice.sell",
  feed_back: "cards.choice.feedBack",
  redeem: "cards.choice.redeem",
};
const BULK_TITLE: Record<Choice, string> = {
  sell_back: "cards.bulk.title.sell",
  feed_back: "cards.bulk.title.feedBack",
  redeem: "cards.bulk.redeem",
};

export class Sheet {
  readonly layer: HTMLElement;
  private backdrop: HTMLElement;
  private panel: HTMLElement;
  private stage: HTMLElement;
  private slot: HTMLElement;
  private body: HTMLElement;
  private mode: Mode | null = null;
  private ids: string[] = [];
  private choice: Choice | null = null;
  private bulkAction: Choice | null = null;
  private stageCard: HTMLElement | null = null;
  private tilt: Tilt | null = null;
  private restoreFocus: HTMLElement | null = null;
  private refs: Record<string, HTMLElement> = {};
  private rows = new Map<
    Choice,
    {
      row: HTMLElement;
      input: HTMLInputElement;
      fig: HTMLElement;
      line: HTMLElement;
    }
  >();
  private ttlTimer = 0;
  private confirming = false;
  private cleanups: (() => void)[] = [];
  private openTl: gsap.core.Timeline | null = null;
  private flying: HTMLElement | null = null;

  constructor(
    private host: SheetHost,
    parent: HTMLElement,
  ) {
    this.backdrop = h("div", {
      cls: "mc-backdrop",
      on: { click: () => this.close("keep") },
    });
    this.slot = h("div", "mc-sheet-slot");
    this.stage = h("div", "mc-sheet-stage", [
      h("span", "mc-sheet-floor"),
      this.slot,
    ]);
    this.body = h("div", "mc-sheet-body");
    this.panel = h(
      "div",
      { cls: "mc-sheet", attrs: { role: "dialog", "aria-modal": "true" } },
      [
        h("span", { cls: "mc-grab", attrs: { "aria-hidden": "true" } }),
        this.stage,
        this.body,
      ],
    );
    this.layer = h("div", { cls: "mc-layer" }, [this.backdrop, this.panel]);
    this.layer.hidden = true;
    parent.append(this.layer);
    this.layer.addEventListener("keydown", (e) => this.onKey(e));
    this.dragToClose();
  }

  get isOpen() {
    return this.mode !== null;
  }
  get openMode() {
    return this.mode;
  }
  get openIds() {
    return this.ids;
  }
  get currentChoice() {
    return this.choice;
  }

  // ===================================================================== open
  openCard(id: string) {
    const card = this.host.card(id);
    if (!card) return;
    this.prepare("card", [id]);
    this.panel.dataset.mode = "card";
    this.panel.dataset.kind = card.kind;
    this.choice = defaultChoice(card);
    this.buildCardBody(card);
    const face = buildFace(card, this.host.ctx);
    this.stageCard = face;
    this.slot.replaceChildren(face);
    this.show(this.host.tile(id));
    this.host.choose(this.choice, [id]);
  }

  /**
   * Idle-time warm-up: lays out a card sheet once, invisibly, so the first real open does not pay the
   * first-time style and layout cost (≈ 25 ms on a laptop, 4× that on a mid-range phone).
   */
  prewarm(id: string) {
    if (this.mode) return;
    const card = this.host.card(id);
    if (!card) return;
    this.prepare("card", [id]);
    this.panel.dataset.mode = "card";
    this.panel.dataset.kind = card.kind;
    this.choice = defaultChoice(card);
    this.buildCardBody(card);
    this.slot.replaceChildren(buildFace(card, this.host.ctx));
    this.layer.classList.add("is-warm");
    this.layer.hidden = false;
    void this.panel.getBoundingClientRect();
    this.layer.hidden = true;
    this.layer.classList.remove("is-warm");
    this.teardown();
  }

  /** A bulk bar action on `ids` (the open ones); `of` cards of its kind in all (a note says when some stay). */
  openBulk(action: Choice, ids: string[], of = ids.length) {
    this.prepare("bulk", ids);
    this.panel.dataset.mode = "bulk";
    delete this.panel.dataset.kind;
    this.bulkAction = action;
    this.choice = action;
    const cards = ids
      .map((i) => this.host.card(i))
      .filter((c): c is CardRow => !!c);
    const fan = h("div", "mc-fan");
    const shown = cards.slice(0, 5);
    shown.forEach((c, i) => {
      const f = buildFace(c, this.host.ctx);
      const w = h("span", "mc-fan-card", [f]);
      const k = i - (shown.length - 1) / 2;
      w.style.setProperty("--r", `${k * 7}deg`);
      w.style.setProperty("--x", `${k * 20}%`);
      w.style.setProperty("--y", `${Math.abs(k) * 5}%`);
      w.style.zIndex = String(10 - Math.abs(Math.round(k)));
      fan.append(w);
    });
    if (cards.length > shown.length)
      fan.append(
        h("span", {
          cls: "mc-fan-more",
          text: `+${count(cards.length - shown.length)}`,
        }),
      );
    this.slot.replaceChildren(fan);
    this.stageCard = null;
    this.buildBulkBody(action, cards, of);
    this.show(null);
    this.host.choose(action, ids);
  }

  openMachine() {
    this.prepare("machine", []);
    this.panel.dataset.mode = "machine";
    delete this.panel.dataset.kind;
    this.slot.replaceChildren();
    this.stageCard = null;
    this.buildMachineBody();
    this.show(null);
  }

  private prepare(mode: Mode, ids: string[]) {
    if (this.mode) this.teardown();
    this.mode = mode;
    this.ids = ids;
    this.confirming = false;
    this.rows.clear();
    this.refs = {};
    this.restoreFocus = (document.activeElement as HTMLElement) ?? null;
  }

  // ===================================================================== card body
  private buildCardBody(card: CardRow) {
    const { t } = this.host.ctx;
    const info = KINDS[card.kind];
    const titleId = nextId("mc-sheet-title");
    this.panel.setAttribute("aria-labelledby", titleId);
    const name = info.mult
      ? t("cards.kindWithMult", { name: t(info.name), mult: info.mult })
      : t(info.name);
    const verify = card.edition
      ? h(
          "button",
          {
            cls: "mc-link",
            attrs: { type: "button" },
            on: { click: () => this.host.verify(card.seq) },
          },
          [t("common.verify"), icon("verify", "mc-icon mc-icon-sm")],
        )
      : null;
    const from = card.edition
      ? t("cards.from", {
          edition: EDITIONS[card.edition].name,
          seq: Number(card.seq).toLocaleString("en-US"),
        })
      : "";
    const close = h(
      "button",
      {
        cls: "mc-round mc-sheet-close",
        attrs: { type: "button", "aria-label": t("common.close") },
        on: { click: () => this.close("keep") },
      },
      [icon("close")],
    );
    // The card's own figure is on its face: the sheet sets no other price next to the actions' numbers.
    const head = h("div", "mc-sheet-head", [
      from
        ? h("p", "mc-sheet-eyebrow", [
            h("span", { text: from }),
            verify
              ? h("span", {
                  cls: "mc-dotsep",
                  text: "·",
                  attrs: { "aria-hidden": "true" },
                })
              : null,
            verify,
          ])
        : null,
      h("h2", {
        cls: "mc-sheet-title",
        attrs: { id: titleId, tabindex: "-1" },
        text: name,
      }),
      h("p", {
        cls: "mc-sheet-amount",
        text: t("cards.figure.tokens", {
          amount: card.amountUi,
          ticker: ticker(card.coin.ticker),
        }),
      }),
    ]);
    const group = h("div", {
      cls: "mc-choices",
      attrs: { role: "radiogroup", "aria-label": t("cards.choose") },
    });
    const gname = nextId("mc-choice");
    for (const c of choicesFor(card.kind))
      group.append(this.choiceRow(c, gname));
    this.refs.presign = h("div", {
      cls: "mc-presign",
      attrs: { "aria-live": "polite" },
    });
    this.body.replaceChildren(
      close,
      h("div", "mc-sheet-top", [head]),
      this.scrollArea([group, this.refs.presign]),
      this.footer(),
    );
    this.cleanups.push(pressable(close, () => this.host.ctx.reduced()));
    this.refreshCard();
  }

  /** The only scrolling part of the sheet: the header and the confirm button stay put. */
  private scrollArea(children: (HTMLElement | null)[]) {
    const el = h(
      "div",
      "mc-sheet-scroll",
      children.filter((c): c is HTMLElement => !!c),
    );
    this.refs.scroll = el;
    return el;
  }

  private choiceRow(c: Choice, name: string) {
    const { t } = this.host.ctx;
    const input = h("input", {
      cls: "mc-choice-input",
      attrs: { type: "radio", name, value: c },
    });
    input.addEventListener("change", () => {
      if (input.checked) this.select(c);
    });
    const line = h("span", "mc-choice-line");
    const fig = h("span", "mc-choice-fig");
    const row = h("label", { cls: "mc-choice", data: { choice: c } }, [
      input,
      h("span", "mc-choice-ico", [icon(ICON[c])]),
      h("span", { cls: "mc-choice-name", text: t(NAME[c]) }),
      fig,
      line,
    ]);
    this.rows.set(c, { row, input, fig, line });
    return row;
  }

  /** The card's gate for an action; a preview's gate wins (a refused Sell quote closes Sell with its reason). */
  private gateOf(card: CardRow, c: Choice): Gate {
    return this.host.preview(c, this.ids)?.preview.gate ?? gateFor(card, c);
  }

  /** Re-renders every dynamic part of the card sheet from the latest data, preview and state. */
  refreshCard() {
    if (this.mode !== "card") return;
    const card = this.host.card(this.ids[0]);
    if (!card) return;
    const { t } = this.host.ctx;
    const config = this.host.data().config;
    if (this.stageCard) updateFaceValue(this.stageCard, card, t);
    for (const [c, r] of this.rows) {
      const gate = this.gateOf(card, c);
      r.input.disabled = !gate.open;
      r.row.classList.toggle("is-off", !gate.open);
      let line = "";
      let fig: { text: string; tone: "gold" | "lilac" } | null = null;
      // Each action: its name and one number; a line only where the name needs one (Redeem)
      // or where the action is closed (its reason).
      switch (c) {
        case "redeem":
          line = t("cards.choice.redeem.line");
          break;
        case "sell_back": {
          // The Sell price on its own: "+3.48 SOL · instant", never a market price next to it.
          const recv =
            this.host.preview("sell_back", this.ids)?.preview.receive ??
            card.sellBack;
          if (recv && recv.kind !== "none")
            fig = {
              text: t("cards.figure.sell", { sol: sol(recv.lamports) }),
              tone: "gold",
            };
          break;
        }
        case "feed_back": {
          // One estimate, never a range: "≈0.0057 SOL when it’s pulled".
          const est = config?.feedBackEstimateLamports;
          if (est !== undefined && est !== null)
            fig = {
              text: t("cards.figure.feedBack", { sol: sol(est) }),
              tone: "lilac",
            };
          break;
        }
      }
      setText(r.line, gate.open ? line : msg(t, gate.reason) || line);
      r.fig.replaceChildren();
      if (fig && gate.open)
        r.fig.append(
          h("span", { cls: `mc-fig is-${fig.tone}`, text: fig.text }),
        );
    }
    // A closed action cannot stay selected: the next open one takes over (Redeem never closes).
    if (this.choice && this.rows.get(this.choice)?.input.disabled) {
      const next =
        [...this.rows.keys()].find((c) => !this.rows.get(c)!.input.disabled) ??
        "redeem";
      if (next !== this.choice) {
        this.choice = next;
        this.confirming = false;
        this.host.choose(next, this.ids);
      }
    }
    for (const [c, r] of this.rows) {
      r.input.checked = c === this.choice;
      r.row.classList.toggle("is-on", c === this.choice);
    }
    this.renderPresign();
    this.renderFooter();
  }

  private select(c: Choice) {
    if (this.choice === c) return;
    this.choice = c;
    this.confirming = false;
    this.host.ctx.sound("select");
    this.host.choose(c, this.ids);
    if (this.mode === "card") this.refreshCard();
  }

  // ===================================================================== summary and footer
  /** One sentence: what the action does and when it pays ("…+3.48 SOL lands in your wallet with the transaction."). */
  private lead(
    action: Choice,
    cards: CardRow[],
    pv: ActionPreview | null,
  ): string {
    const { t } = this.host.ctx;
    const n = cards.length;
    if (!n) return "";
    const one = n === 1;
    switch (action) {
      case "sell_back": {
        const recv: Value | null =
          pv?.receive ?? sumValues(cards.map((c) => c.sellBack)).value;
        if (!recv || recv.kind === "none") return "";
        return t(one ? "cards.lead.sell.one" : "cards.lead.sell.other", {
          n: count(n),
          sol: sol(recv.lamports),
        });
      }
      case "redeem":
        return one
          ? t("cards.lead.redeem.one", {
              amount: cards[0].amountUi,
              ticker: ticker(cards[0].coin.ticker),
            })
          : t("cards.lead.redeem.other", { n: count(n) });
      case "feed_back": {
        const est = this.host.data().config?.feedBackEstimateLamports;
        if (est === undefined || est === null) return "";
        return t(
          one ? "cards.lead.feedBack.one" : "cards.lead.feedBack.other",
          { n: count(n), sol: sol(est * BigInt(n)) },
        );
      }
    }
  }

  private cardsInView(): CardRow[] {
    return this.ids
      .map((i) => this.host.card(i))
      .filter((c): c is CardRow => !!c);
  }

  private eligibleIds(): string[] {
    if (this.mode !== "bulk" || !this.bulkAction) return this.ids;
    const action = this.bulkAction;
    return this.cardsInView()
      .filter((c) => gateFor(c, action).open)
      .map((c) => c.cardId);
  }

  private renderPresign() {
    const box = this.refs.presign;
    if (!box || !this.choice) return;
    const { t } = this.host.ctx;
    const ids = this.eligibleIds();
    const cards = ids
      .map((i) => this.host.card(i))
      .filter((c): c is CardRow => !!c);
    const pv = this.host.preview(this.choice, ids);
    const lead =
      this.mode === "bulk"
        ? this.lead(this.choice, cards, pv?.preview ?? null)
        : "";
    const out: HTMLElement[] = [];
    if (lead) out.push(h("p", { cls: "mc-presign-lead", text: lead }));
    // The technical lines: one small row, never main copy.
    const details = pv
      ? pv.preview.lines.map((m) => msg(t, m)).filter(Boolean)
      : [];
    if (details.length)
      out.push(
        h("p", { cls: "mc-presign-details", text: details.join(" ✳ ") }),
      );
    else if (!pv)
      out.push(
        h("p", {
          cls: "mc-presign-details is-quoting",
          text: t("feed.quoting"),
        }),
      );
    box.replaceChildren(...out);
    this.renderTtl();
  }

  /** Quote countdown, next to the confirm button (the Sell quote's validity). */
  private renderTtl() {
    const el = this.refs.ttl;
    if (!el) return;
    clearTimeout(this.ttlTimer);
    const { t } = this.host.ctx;
    const pv = this.choice
      ? this.host.preview(this.choice, this.eligibleIds())
      : null;
    const st = this.choice
      ? this.host.stateOf(this.choice, this.eligibleIds())
      : null;
    if (!pv?.preview.ttlSeconds || (st && st.state !== "failed")) {
      setText(el, "");
      return;
    }
    const left = Math.max(
      0,
      Math.ceil(pv.preview.ttlSeconds - (performance.now() - pv.at) / 1000),
    );
    setText(
      el,
      left
        ? t("feed.state.ready", { s: count(left) })
        : t("feed.state.quoteExpired"),
    );
    el.classList.toggle("is-expired", !left);
    if (left) this.ttlTimer = window.setTimeout(() => this.renderTtl(), 1000);
    else this.renderFooter();
  }

  private quoteExpired(): boolean {
    if (!this.choice) return false;
    const pv = this.host.preview(this.choice, this.eligibleIds());
    if (!pv?.preview.ttlSeconds) return false;
    return (performance.now() - pv.at) / 1000 >= pv.preview.ttlSeconds;
  }

  private footer(): HTMLElement {
    const label = h("em", "mc-oval-label");
    const btn = h(
      "button",
      {
        cls: "mc-oval",
        attrs: { type: "button" },
        on: { click: () => this.onPrimary() },
      },
      [
        h("span", "mc-oval-face", [
          label,
          h("b", {
            cls: "mc-oval-chip",
            attrs: { "aria-hidden": "true" },
            text: "→",
          }),
        ]),
      ],
    );
    this.cleanups.push(pressable(btn, () => this.host.ctx.reduced()));
    this.refs.primary = btn;
    this.refs.primaryLabel = label;
    this.refs.flow = h("p", { cls: "mc-flowmsg", attrs: { role: "status" } });
    this.refs.ttl = h("p", { cls: "mc-presign-ttl" });
    this.refs.confirmBox = h("div", "mc-confirm");
    this.refs.trust = h("p", { cls: "mc-trust" });
    return h("div", "mc-sheet-foot", [
      this.refs.confirmBox,
      btn,
      this.refs.flow,
      this.refs.ttl,
      this.refs.trust,
    ]);
  }

  private primaryLabel(): string {
    const { t } = this.host.ctx;
    const ids = this.eligibleIds();
    const n = ids.length;
    const cardsFrag = t(n === 1 ? "count.cards.one" : "count.cards.other", {
      n: count(n),
    });
    const many = this.mode === "bulk";
    if (this.quoteExpired()) return t("feed.refresh");
    switch (this.choice) {
      case "sell_back": {
        const recv = this.host.preview("sell_back", ids)?.preview.receive;
        if (recv && recv.kind !== "none")
          return many
            ? t("cards.button.sellMany", {
                cards: cardsFrag,
                sol: sol(recv.lamports),
              })
            : t("cards.button.sell", { sol: sol(recv.lamports) });
        return t("cards.button.sellQuoting");
      }
      case "feed_back":
        return many
          ? t("cards.button.feedBackMany", { cards: cardsFrag })
          : t("cards.button.feedBack");
      default:
        return many
          ? t("cards.button.redeemMany", { cards: cardsFrag })
          : t("cards.button.redeem");
    }
  }

  renderFooter() {
    if (!this.refs.primary || !this.choice) return;
    const { t } = this.host.ctx;
    const ids = this.eligibleIds();
    const st = this.host.stateOf(this.choice, ids);
    const btn = this.refs.primary as HTMLButtonElement;
    const busy = st?.state === "signing" || st?.state === "sending";
    btn.dataset.state = st?.state ?? "idle";
    btn.classList.toggle("is-money", this.choice === "sell_back");
    const quoting =
      (this.choice === "sell_back" || this.choice === "feed_back") &&
      !this.host.preview(this.choice, ids);
    btn.disabled = busy || !ids.length || (quoting && !this.quoteExpired());
    setText(
      this.refs.primaryLabel,
      st?.state === "failed" ? t("common.retry") : this.primaryLabel(),
    );
    let flow = "";
    if (st?.state === "signing")
      flow = msg(t, st.info?.message) || t("wallet.check");
    else if (st?.state === "sending")
      flow =
        msg(t, st.info?.message) ||
        t("cards.state.sending", {
          c: count(st.info?.progress?.confirmed ?? 0),
          t: count(st.info?.progress?.total ?? 1),
        });
    else if (st?.state === "failed")
      flow = msg(t, st.info?.message) || t("errors.generic");
    setText(this.refs.flow, flow);
    this.refs.flow.classList.toggle("is-error", st?.state === "failed");
    // Feed back: a fed card can be taken back until it is pulled.
    setText(
      this.refs.trust,
      this.choice === "feed_back" ? t("feed.trust") : "",
    );
    this.refs.trust.hidden = this.choice !== "feed_back";
    if (this.refs.ttl) this.refs.ttl.hidden = !!st && st.state !== "failed";
    // The Feed back guard (SPEC §2.2): a Dust Card that sells for more than it pays when pulled asks first.
    const box = this.refs.confirmBox;
    if (this.confirming && this.choice === "feed_back") {
      const flagged = this.confirmCards();
      const many = flagged.length > 1;
      const est = this.host.data().config?.feedBackEstimateLamports;
      const values = this.host.preview("feed_back", this.eligibleIds())?.preview
        .feedBackValues;
      const quoted = sumValues(
        flagged.map((card) => values?.[card.cardId]?.value),
      );
      const v = quoted.value;
      const parts: HTMLElement[] = [
        h("p", {
          cls: "mc-confirm-title",
          text: t(
            many
              ? "cards.feedBack.confirm.titleMany"
              : "cards.feedBack.confirm.title",
          ),
        }),
      ];
      if (
        est !== undefined &&
        est !== null &&
        v.kind === "now" &&
        quoted.missing === 0
      ) {
        const vars = {
          sol: sol(est * BigInt(flagged.length)),
          value: sol(v.lamports),
          n: count(flagged.length),
        };
        parts.push(
          h("p", {
            cls: "mc-confirm-body",
            text: t(
              many
                ? "cards.feedBack.confirm.bodyMany"
                : "cards.feedBack.confirm.body",
              vars,
            ),
          }),
        );
      }
      if (v.kind !== "now" || quoted.missing > 0)
        parts.push(
          h("p", {
            cls: "mc-confirm-body",
            text: t("cards.feedBack.confirm.unavailable"),
          }),
        );
      box.replaceChildren(...parts);
      box.hidden = false;
      setText(
        this.refs.primaryLabel,
        t(
          many
            ? "cards.feedBack.confirm.yesMany"
            : "cards.feedBack.confirm.yes",
        ),
      );
    } else {
      box.hidden = true;
      box.replaceChildren();
    }
  }

  /** Cards of the pending Feed back whose value is above `FEED_RULES.confirmAboveLamports` (SPEC §2.2). */
  private confirmCards(): CardRow[] {
    const values = this.host.preview("feed_back", this.eligibleIds())?.preview
      .feedBackValues;
    return this.eligibleIds()
      .map((i) => this.host.card(i))
      .filter(
        (c): c is CardRow =>
          !!c &&
          (values
            ? (values[c.cardId]?.needsConfirm ?? true)
            : !!c.feedBackNeedsConfirm),
      );
  }

  private needsConfirm(): boolean {
    return this.choice === "feed_back" && this.confirmCards().length > 0;
  }

  private onPrimary() {
    if (!this.choice) return;
    if (this.quoteExpired()) {
      this.host.choose(this.choice, this.eligibleIds());
      return;
    }
    if (this.needsConfirm() && !this.confirming) {
      this.confirming = true;
      this.renderFooter();
      (this.refs.primary as HTMLButtonElement).focus();
      return;
    }
    this.confirming = false;
    this.host.confirm(this.choice, this.eligibleIds());
  }

  /** Host progress for the open action (spinner, wallet prompt, errors). */
  syncState() {
    if (this.mode === "card") this.refreshCard();
    else if (this.mode === "bulk") {
      this.renderPresign();
      this.renderFooter();
    } else if (this.mode === "machine") this.refreshMachine();
  }

  // ===================================================================== bulk body
  private buildBulkBody(action: Choice, cards: CardRow[], of: number) {
    const { t } = this.host.ctx;
    const titleId = nextId("mc-sheet-title");
    this.panel.setAttribute("aria-labelledby", titleId);
    const close = h(
      "button",
      {
        cls: "mc-round mc-sheet-close",
        attrs: { type: "button", "aria-label": t("common.close") },
        on: { click: () => this.close("dismiss") },
      },
      [icon("close")],
    );
    const title = h("h2", {
      cls: "mc-sheet-title",
      attrs: { id: titleId, tabindex: "-1" },
      text: t(BULK_TITLE[action]),
    });
    const sel = h("p", {
      cls: "mc-sheet-amount",
      text: t(cards.length === 1 ? "count.cards.one" : "count.cards.other", {
        n: count(cards.length),
      }),
    });
    const partial =
      cards.length < of
        ? h("p", {
            cls: "mc-sheet-note",
            text: t("cards.bulk.partial", {
              ok: count(cards.length),
              t: count(of),
            }),
          })
        : null;
    this.refs.presign = h("div", {
      cls: "mc-presign",
      attrs: { "aria-live": "polite" },
    });
    this.body.replaceChildren(
      close,
      h("div", "mc-sheet-top", [
        h("div", "mc-sheet-head", [title, sel, partial]),
      ]),
      this.scrollArea([this.refs.presign]),
      this.footer(),
    );
    this.cleanups.push(pressable(close, () => this.host.ctx.reduced()));
    this.renderPresign();
    this.renderFooter();
  }

  // ===================================================================== machine body
  private buildMachineBody() {
    const { t } = this.host.ctx;
    const titleId = nextId("mc-sheet-title");
    this.panel.setAttribute("aria-labelledby", titleId);
    const close = h(
      "button",
      {
        cls: "mc-round mc-sheet-close",
        attrs: { type: "button", "aria-label": t("common.close") },
        on: { click: () => this.close("dismiss") },
      },
      [icon("close")],
    );
    this.refs.machineList = h("ul", "mc-mlist");
    this.refs.vaults = h("div", "mc-vaults");
    this.body.replaceChildren(
      close,
      h("div", "mc-sheet-top", [
        h("div", "mc-sheet-head", [
          h("h2", {
            cls: "mc-sheet-title",
            attrs: { id: titleId, tabindex: "-1" },
            text: t("takeBack.title"),
          }),
          h("p", { cls: "mc-sheet-note", text: t("takeBack.always") }),
        ]),
      ]),
      this.scrollArea([this.refs.machineList, this.refs.vaults]),
    );
    this.cleanups.push(pressable(close, () => this.host.ctx.reduced()));
    this.refreshMachine();
  }

  refreshMachine() {
    if (this.mode !== "machine") return;
    const { t } = this.host.ctx;
    const itm = this.host.data().inTheMachine;
    const entries: InTheMachineEntry[] = itm?.entries ?? [];
    const list = this.refs.machineList;
    list.replaceChildren();
    if (!entries.length)
      list.append(h("li", { cls: "mc-mempty", text: t("takeBack.empty") }));
    for (const e of entries) {
      const st = this.host.stateOf("take_back", [e.entryId]);
      const busy = st?.state === "signing" || st?.state === "sending";
      const btn = h(
        "button",
        {
          cls: "mc-pill mc-mbtn",
          data: { state: st?.state ?? "idle" },
          attrs: { type: "button" },
          on: { click: () => this.host.takeBack([e.entryId]) },
        },
        [
          h("span", {
            text:
              st?.state === "failed" ? t("common.retry") : t("takeBack.button"),
          }),
        ],
      );
      btn.disabled = busy;
      const tk = ticker(e.coin.ticker);
      const coin = h("span", "mc-mcoin", [
        h(
          "span",
          { cls: "mc-coin is-xray", attrs: { "aria-hidden": "true" } },
          [
            h("span", "mc-coin-edge"),
            h("span", "mc-coin-rim"),
            h("span", "mc-coin-face", [
              e.coin.logoUrl
                ? h("img", {
                    attrs: { src: e.coin.logoUrl, alt: "", decoding: "async" },
                  })
                : h("b", { cls: "mc-mono", text: tk.slice(1, 2) }),
            ]),
          ],
        ),
      ]);
      const row = h("li", { cls: "mc-mrow", data: { entry: e.entryId } }, [
        coin,
        h("span", "mc-mtext", [
          h("span", {
            cls: "mc-mname",
            text: t("takeBack.row", { ticker: tk, amount: e.amountUi }),
          }),
          h("span", {
            cls: "mc-mline",
            text: busy
              ? st?.state === "signing"
                ? t("wallet.check")
                : t("cards.state.sending", { c: "0", t: "1" })
              : st?.state === "failed"
                ? msg(t, st.info?.message) || t("errors.generic")
                : e.refed
                  ? t("takeBack.refed")
                  : t("takeBack.presign.one", {
                      ticker: tk,
                      amount: e.amountUi,
                      deposit: sol(e.depositLamports),
                    }),
          }),
        ]),
        btn,
      ]);
      list.append(row);
    }
    const deps: VaultDeposit[] = itm?.vaultDeposits ?? [];
    this.refs.vaults.replaceChildren(
      ...(deps.length
        ? [
            h("h3", { cls: "mc-vaults-title", text: t("vault.title") }),
            ...deps.map((d) =>
              h("p", {
                cls: "mc-vault",
                text: t(d.state === "held" ? "vault.held" : "vault.returned", {
                  ticker: ticker(d.coin.ticker),
                  sol: sol(d.lamports),
                }),
              }),
            ),
          ]
        : []),
    );
  }

  /** The row of a machine entry (Take back moment source). */
  machineRow(entryId: string): HTMLElement | null {
    return (
      this.refs.machineList?.querySelector<HTMLElement>(
        `[data-entry="${CSS.escape(entryId)}"]`,
      ) ?? null
    );
  }

  // ===================================================================== show / close
  private show(from: { face: HTMLElement; lift: HTMLElement } | null) {
    const ctx = this.host.ctx;
    const rm = ctx.reduced();
    const fromRect = from?.face.getBoundingClientRect() ?? null;
    this.layer.hidden = false;
    this.panel.style.visibility = "hidden";
    gsap.set(this.panel, { clearProps: "transform,opacity" });
    const slotRect = this.stageCard?.getBoundingClientRect();
    const slotRest = this.slot.getBoundingClientRect();
    this.panel.style.visibility = "";
    this.lockScroll(true);
    for (const el of this.host.inertTargets()) el.inert = true;
    this.openTl?.kill();
    const tl = gsap.timeline();
    this.openTl = tl;
    gsap.fromTo(
      this.backdrop,
      { opacity: 0 },
      { opacity: 1, duration: rm ? 0.15 : 0.32, ease: "power1.out" },
    );
    const sheet = ctx.mobile() ? SPRINGS.sheet() : SPRINGS.travel();
    if (rm)
      tl.fromTo(this.panel, { opacity: 0 }, { opacity: 1, duration: 0.15 });
    else if (ctx.mobile())
      tl.fromTo(
        this.panel,
        { yPercent: 100 },
        { yPercent: 0, duration: sheet.duration, ease: sheet.ease },
      );
    else
      tl.fromTo(
        this.panel,
        { opacity: 0, y: 26, scale: 0.97 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: sheet.duration * 0.8,
          ease: sheet.ease,
        },
      );

    // Shared element: the grid card flies into the stage.
    if (from && fromRect && this.stageCard && slotRect && !rm) {
      const fr = fromRect;
      const clone = from.face.cloneNode(true) as HTMLElement;
      clone.classList.remove("is-live");
      clone.style.transform = "";
      clone.classList.add("mc-fly");
      clone.style.width = `${slotRect.width}px`;
      clone.style.left = `${slotRect.left}px`;
      clone.style.top = `${slotRect.top}px`;
      this.layer.append(clone);
      this.flying = clone;
      from.lift.style.visibility = "hidden";
      this.stageCard.style.visibility = "hidden";
      const s = SPRINGS.travel();
      // The landing point follows the slot while the sheet slides in, so the card never sits outside the sheet.
      const x0 = fr.left - slotRect.left,
        y0 = fr.top - slotRect.top,
        k0 = fr.width / slotRect.width;
      const p = { u: 0 };
      gsap.set(clone, { x: x0, y: y0, scale: k0 });
      gsap.to(p, {
        u: 1,
        duration: s.duration,
        ease: s.ease,
        onUpdate: () => {
          const live = this.slot.getBoundingClientRect();
          const tx = live.left - slotRest.left,
            ty = live.top - slotRest.top;
          gsap.set(clone, {
            x: x0 + (tx - x0) * p.u,
            y: y0 + (ty - y0) * p.u,
            scale: k0 + (1 - k0) * p.u,
          });
        },
        onComplete: () => {
          if (this.stageCard) this.stageCard.style.visibility = "";
          clone.remove();
          if (this.flying === clone) this.flying = null;
        },
      });
      gsap.fromTo(
        clone,
        { rotation: 0 },
        {
          keyframes: [
            { rotation: -3, duration: s.duration * 0.35, ease: "power2.out" },
            { rotation: 0, duration: s.duration * 0.65, ease: "power2.inOut" },
          ],
        },
      );
      ctx.sound("card.lift");
    } else if (from) {
      from.lift.style.visibility = "hidden";
    }
    if (this.stageCard) {
      this.tilt?.destroy();
      this.tilt = new Tilt(this.stage, this.stageCard, {
        reduced: () => ctx.reduced(),
        drift: true,
        max: [9, 12],
      });
    }
    requestAnimationFrame(() =>
      this.body
        .querySelector<HTMLElement>(".mc-sheet-title")
        ?.focus({ preventScroll: true }),
    );
  }

  /**
   * Closes the sheet. `keep`/`dismiss`: the card flies back to its slot and settles.
   * `done`: the view takes over the card (action moment) and gets its rect.
   */
  close(
    how: "keep" | "dismiss" | "done" = "dismiss",
  ): { rect: DOMRect; face: HTMLElement } | null {
    if (!this.mode) return null;
    const ctx = this.host.ctx;
    const rm = ctx.reduced();
    const mode = this.mode;
    const ids = this.ids;
    const stageCard = this.stageCard;
    this.tilt?.destroy();
    this.tilt = null;
    if (stageCard) stageCard.style.transform = "";
    const result = stageCard
      ? { rect: stageCard.getBoundingClientRect(), face: stageCard }
      : null;
    clearTimeout(this.ttlTimer);
    this.openTl?.kill();
    this.flying?.remove();
    this.flying = null;
    const tile = mode === "card" ? this.host.tile(ids[0]) : null;
    const finish = () => {
      this.layer.hidden = true;
      this.backdrop.classList.remove("is-leaving");
      gsap.set([this.panel, this.backdrop], { clearProps: "all" });
      this.teardown();
      this.lockScroll(false);
      for (const el of this.host.inertTargets()) el.inert = false;
      const target = tile?.lift.closest("button") ?? this.restoreFocus;
      if (how !== "done" && target && document.contains(target))
        target.focus({ preventScroll: true });
    };
    const sheet = ctx.mobile() ? SPRINGS.sheet() : null;
    // Phones: the blur goes at once (only the dim fades), so moments under it don't pay for a live blur.
    this.backdrop.classList.add("is-leaving");
    gsap.to(this.backdrop, {
      opacity: 0,
      duration: rm ? 0.12 : 0.28,
      ease: "power1.in",
    });
    const panelOut = rm
      ? { opacity: 0, duration: 0.12 }
      : ctx.mobile()
        ? {
            yPercent: 100,
            duration: (sheet?.duration ?? 0.4) * 0.7,
            ease: "power3.in",
          }
        : { opacity: 0, y: 18, scale: 0.98, duration: 0.24, ease: "power2.in" };

    if (how === "done" || !tile || !stageCard || rm || mode !== "card") {
      if (tile && how !== "done") tile.lift.style.visibility = "";
      if (how === "done" && stageCard) stageCard.style.visibility = "hidden";
      gsap.to(this.panel, { ...panelOut, onComplete: finish });
      this.host.closed(how, mode, ids);
      return result;
    }
    // Keep: the card flies back to its slot and settles (springy wobble on landing).
    const from = stageCard.getBoundingClientRect();
    const dockR = this.host.dockRect(); // read now: after the flight the layout is dirty
    const clone = stageCard.cloneNode(true) as HTMLElement;
    clone.classList.remove("is-live");
    clone.classList.add("mc-fly");
    clone.style.width = `${from.width}px`;
    clone.style.left = `${from.left}px`;
    clone.style.top = `${from.top}px`;
    this.layer.parentElement!.querySelector(".mc-fx")!.append(clone);
    stageCard.style.visibility = "hidden";
    gsap.to(this.panel, { ...panelOut, onComplete: finish });
    const to = tile.face.getBoundingClientRect();
    const s = SPRINGS.travel();
    gsap.to(clone, {
      x: to.left - from.left,
      y: to.top - from.top,
      scale: to.width / from.width,
      duration: s.duration,
      ease: s.ease,
      onComplete: () => {
        tile.lift.style.visibility = "";
        const d = dockR;
        const under =
          d &&
          to.bottom > d.top &&
          to.top < d.bottom &&
          to.right > d.left &&
          to.left < d.right;
        if (under)
          gsap.to(clone, {
            opacity: 0,
            duration: 0.2,
            ease: "power1.out",
            onComplete: () => clone.remove(),
          });
        else clone.remove();
        const st = SPRINGS.settle();
        const cell = tile.lift.closest(".mc-cell");
        if (cell)
          gsap.fromTo(
            cell,
            { scale: 1.03, rotation: 1.2 },
            {
              scale: 1,
              rotation: 0,
              duration: st.duration,
              ease: st.ease,
              clearProps: "transform",
            },
          );
        ctx.sound("card.settle");
      },
    });
    this.host.closed(how, mode, ids);
    return null;
  }

  private teardown() {
    this.cleanups.forEach((f) => f());
    this.cleanups = [];
    this.mode = null;
    this.ids = [];
    this.choice = null;
    this.bulkAction = null;
    this.stageCard = null;
    this.slot.replaceChildren();
    this.body.replaceChildren();
    this.rows.clear();
    this.refs = {};
  }

  /**
   * Scroll lock without touching <html> (toggling its overflow would relayout every card): wheel and touch
   * scrolling are stopped on the layer, except inside the sheet body, which contains its own overscroll.
   */
  private lockScroll(on: boolean) {
    if (on && !this.unlock) {
      const stop = (e: Event) => {
        const body = (e.target as HTMLElement).closest?.(
          ".mc-sheet-scroll",
        ) as HTMLElement | null;
        if (body && body.scrollHeight > body.clientHeight + 1) return;
        if (e.cancelable) e.preventDefault();
      };
      const keys = (e: KeyboardEvent) => {
        if (
          [
            "PageDown",
            "PageUp",
            "Home",
            "End",
            " ",
            "ArrowDown",
            "ArrowUp",
          ].includes(e.key) &&
          !(e.target as HTMLElement).closest?.(".mc-sheet")
        )
          e.preventDefault();
      };
      this.layer.addEventListener("wheel", stop, { passive: false });
      this.layer.addEventListener("touchmove", stop, { passive: false });
      window.addEventListener("keydown", keys);
      this.unlock = () => {
        this.layer.removeEventListener("wheel", stop);
        this.layer.removeEventListener("touchmove", stop);
        window.removeEventListener("keydown", keys);
      };
    } else if (!on && this.unlock) {
      this.unlock();
      this.unlock = null;
    }
  }
  private unlock: (() => void) | null = null;

  private onKey(e: KeyboardEvent) {
    if (!this.mode) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.close(this.mode === "card" ? "keep" : "dismiss");
      return;
    }
    if (e.key !== "Tab") return;
    const items = [
      ...this.panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (el) =>
        el.offsetParent !== null &&
        !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked),
    );
    if (!items.length) return;
    const first = items[0],
      last = items[items.length - 1];
    if (
      e.shiftKey &&
      (document.activeElement === first ||
        !this.panel.contains(document.activeElement))
    ) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** Phones: drag the sheet down to close it (Keep). */
  private dragToClose() {
    let y0 = 0,
      dy = 0,
      t0 = 0,
      dragging = false;
    const down = (e: PointerEvent) => {
      if (!this.host.ctx.mobile() || e.pointerType === "mouse") return;
      const onGrab = (e.target as HTMLElement).closest(
        ".mc-grab, .mc-sheet-stage, .mc-sheet-top",
      );
      if (!onGrab) return;
      dragging = true;
      y0 = e.clientY;
      dy = 0;
      t0 = performance.now();
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - y0);
      if (dy > 4) gsap.set(this.panel, { y: dy });
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      const v = dy / Math.max(1, performance.now() - t0);
      if (dy > 120 || v > 0.65) {
        this.close(this.mode === "card" ? "keep" : "dismiss");
        return;
      }
      const s = SPRINGS.sheet();
      gsap.to(this.panel, { y: 0, duration: s.duration, ease: s.ease });
    };
    this.panel.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.cleanups.push(() => {});
    this.destroyDrag = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }
  private destroyDrag: () => void = () => {};

  destroy() {
    this.teardown();
    this.destroyDrag();
    this.layer.remove();
  }
}

export { valueParts };
export type { Value };
