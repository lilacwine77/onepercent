/* eslint-disable */
// Synced from experience/cards-lab/src/cards/view.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * My cards: the controller behind mountCards(). Owns the state (tab, sort, view, previews, action
 * states), renders the portfolio header (the total in your cards, the bulk bar), the toolbar, the binder
 * grid (or list), pending pulls, the dock ("Rip again") and the sheet, and plays each action's moment
 * once the host says `done`.
 */
import { bulkOptions, type BulkOption, type Choice } from "./actions";
import { EDITIONS, KINDS, SELL_BACK_KINDS } from "./brand";
import { defaultT, msg, type Translate } from "./copy";
import type { Ctx } from "./ctx";
import { Dock } from "./dock";
import { h, icon, nextId, setAttr, setText, sr } from "./dom";
import { buildBack, buildFace, updateFaceValue, valueText } from "./face";
import { Fx, center } from "./fx";
import { count, lamportsOf, sol, sumValues, ticker } from "./format";
import { flip, gsap, prefersReducedMotion, pressable, SPRINGS } from "./motion";
import { Sheet } from "./sheet";
import { Tilt } from "./tilt";
import type {
  ActionInfo,
  ActionPreview,
  ActionState,
  CardRow,
  CardsAction,
  CardsController,
  CardsData,
  CardsEventMap,
  MountCardsOptions,
  PendingPull,
  SortKey,
  SoundCue,
  Tab,
  Value,
  ViewMode,
} from "./types";

interface Tile {
  id: string;
  card: CardRow;
  li: HTMLLIElement;
  btn: HTMLButtonElement;
  lift: HTMLElement;
  face: HTMLElement;
  tilt: Tilt | null;
  name: HTMLElement;
  sub: HTMLElement;
  val: HTMLElement;
  busy: HTMLElement;
  sig: string;
  cleanup: () => void;
}

const prevFigText = (el: HTMLElement) =>
  el.dataset.final ?? el.textContent ?? "";
const EMPTY: CardsData = {
  status: "loading",
  cards: [],
  pending: [],
  owedLamports: 0n,
  closeMyCards: null,
};
const TABS: Tab[] = ["all", "hits", "dust", "pending"];
const keyOf = (action: CardsAction, ids: string[]) =>
  `${action}|${[...ids].sort().join(",")}`;
const sigOf = (c: CardRow) =>
  `${c.kind}|${c.amountUi}|${c.coin.ticker}|${c.coin.logoUrl}|${c.edition}`;

export class CardsView implements CardsController {
  readonly root: HTMLElement;
  private ctx: Ctx;
  private t: Translate;
  private data: CardsData = EMPTY;
  private tab: Tab;
  private sort: SortKey;
  private view: ViewMode;
  /** A card to bring into view and light once it is on the board (highlight()). */
  private pendingHighlight: string | null = null;
  /** Cards that left with an action: hidden until the host's data drops them. */
  private gone = new Set<string>();
  private previews = new Map<string, { preview: ActionPreview; at: number }>();
  private states = new Map<string, { state: ActionState; info?: ActionInfo }>();
  private tiles = new Map<string, Tile>();
  private listeners = new Map<
    keyof CardsEventMap,
    Set<(...a: unknown[]) => void>
  >();
  private reducedOverride: boolean | null;
  private wasLoading = true;
  private dealt = false;
  private cleanups: (() => void)[] = [];
  private insets = { top: 0, bottom: 0 };
  private maxParticles?: number;
  private onSoundOpt?: MountCardsOptions["onSound"];
  private rescueUrl?: string;

  // DOM
  private main!: HTMLElement;
  private heading!: HTMLElement;
  private totalFig!: HTMLElement;
  private totalUnit!: HTMLElement;
  private totalEl!: HTMLElement;
  private refreshBtn!: HTMLButtonElement;
  private stats!: HTMLElement;
  private owed!: HTMLElement;
  private bulkBar!: HTMLElement;
  private fan!: HTMLElement;
  private notice!: HTMLElement;
  private toolbar!: HTMLElement;
  private tabsEl!: HTMLElement;
  private tabInd!: HTMLElement;
  private tabBtns = new Map<Tab, HTMLButtonElement>();
  private tabCounts = new Map<Tab, HTMLElement>();
  private sortSel!: HTMLSelectElement;
  private viewBtns = new Map<ViewMode, HTMLButtonElement>();
  private panel!: HTMLElement;
  private grid!: HTMLUListElement;
  private emptyEl!: HTMLElement;
  private live!: HTMLElement;
  private toastEl!: HTMLElement;
  private dock!: Dock;
  private sheet!: Sheet;
  private fx!: Fx;
  private sentinel!: HTMLElement;
  private pendingCells = new Map<string, HTMLLIElement>();
  private uid = nextId("mc");

  constructor(
    container: HTMLElement,
    private opts: MountCardsOptions = {},
  ) {
    this.t = opts.t ?? defaultT;
    this.tab = opts.tab ?? "all";
    this.sort = opts.sort ?? "tier";
    this.view = opts.view ?? "grid";
    this.reducedOverride = opts.reducedMotion ?? null;
    this.maxParticles = opts.maxParticles;
    this.onSoundOpt = opts.onSound;
    this.rescueUrl = opts.rescueUrl;
    const self = this;
    this.ctx = {
      t: this.t,
      assetsBase: (opts.assetsBase ?? "./assets/").replace(/\/?$/, "/"),
      reduced: () => self.reducedOverride ?? prefersReducedMotion(),
      mobile: () => window.innerWidth < 720,
      emit: (e, ...args) => self.emit(e, ...args),
      sound: (cue, index) => self.sound(cue, index),
      announce: (text) => self.announce(text),
    };
    this.root = h("div", { cls: "mc-root", data: { view: this.view } });
    this.applyAssets();
    this.build();
    container.append(this.root);
    this.setInsets(opts.insets ?? {});
    this.setData(opts.data ?? EMPTY);
  }

  // =========================================================== events
  on<E extends keyof CardsEventMap>(
    event: E,
    cb: CardsEventMap[E],
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb as (...a: unknown[]) => void);
    return () => set!.delete(cb as (...a: unknown[]) => void);
  }
  private emit<E extends keyof CardsEventMap>(
    event: E,
    ...args: Parameters<CardsEventMap[E]>
  ) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch (err) {
        console.error(err);
      }
    });
  }
  private sound(cue: SoundCue, index?: number) {
    const e = { cue, index };
    this.onSoundOpt?.(e);
    this.emit("sound", e);
  }
  private announce(text: string) {
    this.live.textContent = "";
    requestAnimationFrame(() => {
      this.live.textContent = text;
    });
  }

  // =========================================================== build
  private applyAssets() {
    // Absolute: a relative url() inside a custom property resolves against the stylesheet that uses it.
    const b = new URL(this.ctx.assetsBase, document.baseURI).href;
    for (const f of ["silver", "blue", "holo", "black", "gold"])
      this.root.style.setProperty(
        `--mc-foil-${f}`,
        `url("${b}foil/${f}.webp")`,
      );
  }

  private build() {
    const { t } = this;
    const level = this.opts.headingLevel ?? 1;
    // ---------- header
    this.heading = h(level === 1 ? "h1" : "h2", {
      cls: "mc-h1",
      attrs: { tabindex: "-1" },
      text: t("cards.title"),
    });
    this.totalFig = h("span", "mc-total-fig");
    this.totalUnit = h("span", "mc-total-unit");
    this.totalEl = h("p", { cls: "mc-total" }, [this.totalFig, this.totalUnit]);
    const refresh = h(
      "button",
      {
        cls: "mc-round mc-round-dark",
        attrs: { type: "button", "aria-label": t("feed.refresh") },
        on: {
          click: () => {
            this.announceTotal = true;
            this.emit("refresh");
            this.spin(refresh);
          },
        },
      },
      [icon("refresh")],
    );
    this.stats = h("ul", "mc-stats");
    this.owed = h("div", "mc-owed");
    this.bulkBar = h("div", {
      cls: "mc-bulkbar",
      attrs: { role: "group", "aria-label": t("cards.bulk.label") },
    });
    this.fan = h("div", {
      cls: "mc-showcase",
      attrs: { "aria-hidden": "true" },
    });
    const hero = h("header", "mc-hero", [
      h("div", "mc-hero-main", [
        this.heading,
        // The total and its refresh, side by side: the cover's one number and its one control.
        h("div", "mc-total-row", [this.totalEl, refresh]),
        this.stats,
        this.owed,
      ]),
      this.fan,
      // The bulk bar spans the cover under the total and the showcase: one row on desktop.
      this.bulkBar,
    ]);
    this.refreshBtn = refresh as HTMLButtonElement;
    this.cleanups.push(pressable(refresh, () => this.ctx.reduced()));
    this.notice = h("p", { cls: "mc-notice", attrs: { role: "status" } });
    this.notice.hidden = true;

    // ---------- toolbar
    this.tabInd = h("span", {
      cls: "mc-tab-ind",
      attrs: { "aria-hidden": "true" },
    });
    this.tabsEl = h(
      "div",
      {
        cls: "mc-tabs",
        attrs: { role: "tablist", "aria-label": t("cards.tabs.label") },
      },
      [this.tabInd],
    );
    for (const tab of TABS) {
      const countEl = h("span", "mc-tab-count");
      const b = h(
        "button",
        {
          cls: "mc-tab",
          attrs: {
            type: "button",
            role: "tab",
            id: `${this.uid}-tab-${tab}`,
            "aria-controls": `${this.uid}-panel`,
            "aria-selected": String(tab === this.tab),
            tabindex: tab === this.tab ? "0" : "-1",
          },
          on: { click: () => this.setTab(tab) },
        },
        [h("span", { text: t(`cards.tab.${tab}`) }), " ", countEl],
      );
      this.tabBtns.set(tab, b);
      this.tabCounts.set(tab, countEl);
      this.tabsEl.append(b);
    }
    this.tabsEl.addEventListener("keydown", (e) => this.onTabsKey(e));
    this.sortSel = h(
      "select",
      { cls: "mc-sort-select", attrs: { "aria-label": t("cards.sort.label") } },
      (["value", "newest", "tier"] as SortKey[]).map((k) =>
        h("option", {
          attrs: { value: k, selected: k === this.sort },
          text: t(`cards.sort.${k}`),
        }),
      ),
    );
    this.sortSel.addEventListener("change", () =>
      this.setSort(this.sortSel.value as SortKey),
    );
    const sortWrap = h("label", "mc-sort", [
      h("span", { cls: "mc-sort-label", text: t("cards.sort.label") }),
      this.sortSel,
      icon("chevron", "mc-icon mc-sort-chev"),
    ]);
    const viewGroup = h("div", {
      cls: "mc-viewtoggle",
      attrs: {
        role: "group",
        "aria-label": `${t("cards.view.grid")} / ${t("cards.view.list")}`,
      },
    });
    for (const v of ["grid", "list"] as ViewMode[]) {
      const b = h(
        "button",
        {
          cls: "mc-vbtn",
          attrs: {
            type: "button",
            "aria-pressed": String(v === this.view),
            "aria-label": t(`cards.view.${v}`),
          },
          on: { click: () => this.setView(v) },
        },
        [icon(v)],
      );
      this.viewBtns.set(v, b);
      viewGroup.append(b);
    }
    this.toolbar = h("div", "mc-toolbar", [
      this.tabsEl,
      h("div", "mc-tools", [sortWrap, viewGroup]),
    ]);
    this.sentinel = h("div", {
      cls: "mc-sentinel",
      attrs: { "aria-hidden": "true" },
    });

    // ---------- panel
    this.grid = h("ul", { cls: "mc-grid", attrs: { role: "list" } });
    this.grid.addEventListener("keydown", (e) => this.onGridKey(e));
    this.emptyEl = h("div", "mc-empty");
    this.emptyEl.hidden = true;
    this.panel = h(
      "section",
      {
        cls: "mc-board",
        attrs: {
          id: `${this.uid}-panel`,
          role: "tabpanel",
          "aria-labelledby": `${this.uid}-tab-${this.tab}`,
        },
      },
      [this.grid, this.emptyEl],
    );
    this.main = h("div", "mc-main", [
      hero,
      this.notice,
      this.sentinel,
      this.toolbar,
      this.panel,
    ]);

    // ---------- dock, sheet, fx, live
    this.dock = new Dock(this.ctx, {
      machine: () => this.sheet.openMachine(),
      rip: () => this.emit("rip"),
    });
    this.live = h("div", {
      cls: "mc-sr",
      attrs: { "aria-live": "polite", "aria-atomic": "true" },
    });
    this.toastEl = h("div", {
      cls: "mc-toast",
      attrs: { "aria-hidden": "true" },
    });
    const floor = h("div", {
      cls: "mc-dock-floor",
      attrs: { "aria-hidden": "true" },
    });
    this.root.append(this.main, floor, this.dock.el, this.toastEl, this.live);
    // The page ends one dock height + 24 px above the dock, whatever the dock shows (wallet, bulk bar).
    const measureDock = () => {
      const r = this.dock.el.getBoundingClientRect();
      const space =
        this.dock.el.hidden || !r.height
          ? 0
          : Math.ceil(window.innerHeight - r.top);
      this.root.style.setProperty("--mc-dock-space", `${space}px`);
      floor.hidden = !space;
    };
    // While the dock morphs (wallet ↔ bulk bar) its size changes every frame: measure once it has settled,
    // so the page is not re-laid out on every frame of the morph.
    let settle = 0;
    const dockRo = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = window.setTimeout(measureDock, 260);
    });
    dockRo.observe(this.dock.el);
    window.addEventListener("resize", measureDock);
    this.cleanups.push(() => {
      clearTimeout(settle);
      dockRo.disconnect();
      window.removeEventListener("resize", measureDock);
    });
    this.measureDock = measureDock;
    this.sheet = new Sheet(
      {
        ctx: this.ctx,
        card: (id) => this.data.cards.find((c) => c.cardId === id),
        data: () => this.data,
        preview: (a, ids) => this.previews.get(keyOf(a, ids)) ?? null,
        stateOf: (a, ids) => this.states.get(keyOf(a, ids)) ?? null,
        tile: (id) => {
          const tl = this.tiles.get(id);
          return tl && tl.li.isConnected
            ? { face: tl.face, lift: tl.lift }
            : null;
        },
        choose: (a, ids) => this.emit("preview", { action: a, ids }),
        confirm: (a, ids) => this.confirm(a, ids),
        closed: (how, mode, ids) => {
          if (mode === "card") {
            this.emit("open", { cardId: null });
            if (how !== "done") this.tileBusy(ids[0]);
          }
        },
        verify: (seq) => this.emit("verify", { seq }),
        takeBack: (ids) => this.confirm("take_back", ids),
        inertTargets: () => [this.main, this.dock.el],
        dockRect: () =>
          this.dock.el.hidden ? null : this.dock.el.getBoundingClientRect(),
      },
      this.root,
    );
    this.fx = new Fx(this.root, {
      reduced: () => this.ctx.reduced(),
      budget: () => this.maxParticles ?? (this.ctx.mobile() ? 24 : 60),
      mobile: () => this.ctx.mobile(),
    });

    // Sticky toolbar shadow once it sticks.
    const io = new IntersectionObserver(
      ([e]) => this.toolbar.classList.toggle("is-stuck", !e.isIntersecting),
      { rootMargin: `-${this.insets.top + 1}px 0px 0px 0px` },
    );
    io.observe(this.sentinel);
    this.cleanups.push(() => io.disconnect());
    const ro = new ResizeObserver(() => this.placeTabInd(false));
    ro.observe(this.tabsEl);
    this.cleanups.push(() => ro.disconnect());
    document.fonts?.ready.then(() => this.placeTabInd(false));
  }

  // =========================================================== data
  setData(data: CardsData) {
    const prev = this.data;
    this.data = data;
    const ids = new Set(data.cards.map((c) => c.cardId));
    for (const id of [...this.gone]) if (!ids.has(id)) this.gone.delete(id);
    this.root.dataset.status = data.status;
    this.root.classList.toggle(
      "is-bare",
      data.status === "error" ||
        (data.status === "ready" &&
          !data.cards.some((c) => !this.gone.has(c.cardId)) &&
          !data.pending.length),
    );
    this.renderHeader();
    this.renderNotice();
    this.renderTabs();
    const dealing =
      this.wasLoading &&
      data.status === "ready" &&
      prev.status === "loading" &&
      this.dealt;
    // Cards that just landed (a draw settled while the page is open) flip in face-down → face-up.
    const known = new Set(prev.cards.map((c) => c.cardId));
    const landed =
      prev.status === "ready" && data.status === "ready"
        ? data.cards.filter((c) => !known.has(c.cardId)).map((c) => c.cardId)
        : [];
    this.renderPanel(
      dealing
        ? "deal"
        : landed.length && landed.length <= 6
          ? "flip"
          : "update",
    );
    if (landed.length && !this.ctx.reduced()) {
      const cells = landed
        .map((id) => this.tiles.get(id)?.li)
        .filter((li): li is HTMLLIElement => !!li && li.isConnected);
      this.deal(cells);
    }
    this.dock.setWallet(data.status === "ready" ? data.wallet : null, true);
    this.dock.setMachine(data.inTheMachine?.entries.length ?? 0, true);
    this.dock.el.hidden = data.status !== "ready";
    this.dock.setRip(this.liveCards().length > 0 || data.pending.length > 0);
    this.measureDock();
    this.sheet.syncState();
    this.applyHighlight();
    if (
      this.sheet.openMode === "card" &&
      !this.data.cards.some((c) => c.cardId === this.sheet.openIds[0])
    )
      this.sheet.close("dismiss");
    this.wasLoading = data.status === "loading";
    if (data.status === "ready" && data.cards.length && !this.warmed) {
      this.warmed = true;
      const w = window as unknown as {
        requestIdleCallback?: (
          cb: () => void,
          o?: { timeout: number },
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      const warm = () => {
        const hit =
          this.data.cards.find((c) => c.kind !== "dust") ?? this.data.cards[0];
        if (hit) this.sheet.prewarm(hit.cardId);
        this.fx.prewarm();
      };
      // Cancelled by destroy(): a page left before the browser idles never warms a torn-down view.
      if (w.requestIdleCallback) {
        const id = w.requestIdleCallback(warm, { timeout: 2500 });
        this.cleanups.push(() => w.cancelIdleCallback?.(id));
      } else {
        const id = window.setTimeout(warm, 600);
        this.cleanups.push(() => clearTimeout(id));
      }
    }
  }
  private warmed = false;
  private announceTotal = false;
  private sheetWasBulk = false;
  private measureDock: () => void = () => {};
  private slowTimers = new Map<string, number>();
  private activeTile: string | null = null;

  setPreview(
    action: CardsAction,
    ids: string[],
    preview: ActionPreview | null,
  ) {
    const k = keyOf(action, ids);
    if (preview) this.previews.set(k, { preview, at: performance.now() });
    else this.previews.delete(k);
    this.sheet.syncState();
  }

  setActionState(
    ids: string[],
    action: CardsAction,
    state: ActionState,
    info?: ActionInfo,
  ) {
    const k = keyOf(action, ids);
    if (state === "idle") this.states.delete(k);
    else this.states.set(k, { state, info });
    if (state === "done") {
      this.states.delete(k);
      this.previews.delete(k);
      void this.playDone(action, ids, info ?? {});
      return;
    }
    if (state === "failed") this.shake();
    for (const id of ids) this.tileBusy(id);
    this.renderPending();
    this.sheet.syncState();
  }

  // =========================================================== derived
  private visibleCards(): CardRow[] {
    const all = this.data.cards.filter((c) => !this.gone.has(c.cardId));
    const list =
      this.tab === "hits"
        ? all.filter((c) => c.kind !== "dust")
        : this.tab === "dust"
          ? all.filter((c) => c.kind === "dust")
          : this.tab === "pending"
            ? []
            : all;
    const val = (c: CardRow) => {
      const l = lamportsOf(this.worthOf(c));
      return l === null ? -1n : l;
    };
    const seq = (c: CardRow) => BigInt(c.seq || "0");
    const rank = (c: CardRow) => KINDS[c.kind].rank;
    const cmpBig = (a: bigint, b: bigint) => (a === b ? 0 : a > b ? -1 : 1);
    const by: Record<SortKey, (a: CardRow, b: CardRow) => number> = {
      value: (a, b) =>
        cmpBig(val(a), val(b)) || rank(b) - rank(a) || cmpBig(seq(a), seq(b)),
      newest: (a, b) =>
        cmpBig(seq(a), seq(b)) || rank(b) - rank(a) || cmpBig(val(a), val(b)),
      tier: (a, b) =>
        rank(b) - rank(a) || cmpBig(val(a), val(b)) || cmpBig(seq(a), seq(b)),
    };
    return list.sort(by[this.sort]);
  }
  private liveCards() {
    return this.data.cards.filter((c) => !this.gone.has(c.cardId));
  }
  /**
   * What a card counts for in "≈X SOL in your cards" and the Value sort (D30): a hit its Sell value,
   * a Dust Card the Feed back estimate, a special (it can only be redeemed) its own value.
   */
  private worthOf(c: CardRow): Value {
    if (SELL_BACK_KINDS.includes(c.kind)) return c.sellBack ?? { kind: "none" };
    if (c.kind === "dust") {
      const est = this.data.config?.feedBackEstimateLamports;
      return est === undefined || est === null
        ? { kind: "none" }
        : { kind: "est", lamports: est };
    }
    return c.value;
  }
  private pendingVisible(): PendingPull[] {
    return this.tab === "all" || this.tab === "pending"
      ? this.data.pending
      : [];
  }

  // =========================================================== header
  private renderHeader() {
    const { t } = this;
    const d = this.data;
    const loading = d.status === "loading";
    const cards = this.liveCards();
    const total = sumValues(cards.map((c) => this.worthOf(c)));
    this.totalEl.classList.toggle("is-loading", loading);
    if (loading) {
      setText(this.totalFig, "");
      setText(this.totalUnit, "");
    } else if (total.value.kind === "none") {
      setText(this.totalFig, t("common.noValue"));
      setText(this.totalUnit, "");
      this.totalEl.setAttribute("aria-label", t("common.noValue"));
    } else {
      // "≈12.40 SOL in your cards": the figure large, the rest of the line beside it.
      const full = t("cards.total", { sol: sol(total.value.lamports) });
      const at = full.indexOf(sol(total.value.lamports));
      const fig =
        at < 0 ? full : full.slice(0, at + sol(total.value.lamports).length);
      const unit = full.slice(fig.length);
      const prevFig = this.totalFig.textContent ?? "";
      this.totalEl.setAttribute("aria-label", full);
      if (this.announceTotal && prevFigText(this.totalFig) !== fig) {
        this.announceTotal = false;
        this.announce(full);
      }
      setText(this.totalUnit, unit);
      // A long total takes a smaller size (view.css), so the line never wraps and the cover keeps its height.
      this.totalFig.style.setProperty("--n", String([...fig].length));
      if (!this.ctx.reduced() && prevFig !== fig)
        this.countFig(this.totalFig, prevFig, fig);
      else setText(this.totalFig, fig);
      this.totalFig.dataset.final = fig;
    }
    // The cover holds one number, the total, and its refresh: the counts are on the tabs
    // below, and no timestamp sits under it. A total that leaves cards out says so.
    this.refreshBtn.hidden = loading;
    const missing =
      total.missing && !loading
        ? h("li", {
            cls: "mc-stat is-note",
            text: t(
              total.missing === 1
                ? "cards.unvalued.one"
                : "cards.unvalued.other",
              { n: count(total.missing) },
            ),
          })
        : null;
    this.stats.replaceChildren(...(missing ? [missing] : []));
    // Owed SOL (withdraw_owed, M2 §7.3)
    this.owed.replaceChildren();
    this.owed.hidden = loading || d.owedLamports <= 0n;
    if (!this.owed.hidden) {
      const st = this.states.get(keyOf("withdraw_owed", []));
      const busy = st?.state === "signing" || st?.state === "sending";
      const btn = h(
        "button",
        {
          cls: "mc-pill mc-pill-light",
          attrs: { type: "button" },
          data: { state: st?.state ?? "idle" },
          on: { click: () => this.confirm("withdraw_owed", []) },
        },
        [
          h("span", {
            text:
              st?.state === "failed"
                ? t("common.retry")
                : t("cards.owed.withdraw"),
          }),
        ],
      );
      btn.disabled = busy;
      this.owed.append(
        h("span", { cls: "mc-owed-label", text: t("cards.owed.label") }),
        h("span", {
          cls: "mc-owed-fig",
          text: t("common.solGain", { sol: sol(d.owedLamports) }),
        }),
        btn,
      );
      this.cleanups.push(pressable(btn, () => this.ctx.reduced()));
    }
    this.renderBulk(d.status === "ready" ? cards : []);
    this.renderShowcase(d.status === "ready" ? cards : []);
  }

  /**
   * The bulk bar: "Sell all hits · +X SOL", "Feed back all dust · ≈Y SOL", "Redeem all", only those that
   * apply (actions.ts bulkOptions). Each opens the bulk sheet: one sentence, the details, confirm.
   */
  private renderBulk(cards: CardRow[]) {
    const { t } = this;
    const busy = [...this.states.values()].some(
      (v) => v.state === "signing" || v.state === "sending",
    );
    const options = bulkOptions(
      cards,
      this.data.config?.feedBackEstimateLamports ?? null,
    );
    const label = (o: BulkOption) =>
      o.action === "sell_back"
        ? o.lamports === null
          ? t("cards.bulk.title.sell")
          : t("cards.bulk.sell", { sol: sol(o.lamports) })
        : o.action === "feed_back"
          ? t("cards.bulk.feedBack", { sol: sol(o.lamports ?? 0n) })
          : t("cards.bulk.redeem");
    const sig = `${busy}|${options.map((o) => `${o.action}:${o.ids.length}:${o.of}:${label(o)}`).join("|")}`;
    if (this.bulkBar.dataset.sig === sig) return;
    this.bulkBar.dataset.sig = sig;
    this.bulkCleanups.forEach((f) => f());
    this.bulkCleanups = [];
    const ICON: Record<Choice, string> = {
      sell_back: "sell",
      feed_back: "feed",
      redeem: "redeem",
    };
    this.bulkBar.replaceChildren(
      ...options.map((o) => {
        const text = label(o);
        // The amount sits in a chip: gold for the SOL paid now, lilac for the estimate paid when pulled.
        const amount =
          o.lamports === null
            ? ""
            : o.action === "sell_back"
              ? `+${sol(o.lamports)} SOL`
              : `≈${sol(o.lamports)} SOL`;
        const at = amount ? text.indexOf(amount) : -1;
        const parts: (HTMLElement | string)[] =
          at < 0
            ? [h("span", { text })]
            : [
                h("span", { text: text.slice(0, at).replace(/\s*·\s*$/, "") }),
                h("span", {
                  cls: `mc-bulk-amt is-${o.action === "sell_back" ? "gold" : "lilac"}`,
                  text: amount,
                }),
              ];
        const b = h(
          "button",
          {
            cls: "mc-pill mc-bulk-btn",
            data: { action: o.action },
            attrs: { type: "button", "aria-label": text },
            on: { click: () => this.openBulk(o) },
          },
          [icon(ICON[o.action]), ...parts],
        );
        b.disabled = busy;
        this.bulkCleanups.push(pressable(b, () => this.ctx.reduced()));
        return b;
      }),
    );
    this.bulkBar.hidden = !options.length;
  }
  private bulkCleanups: (() => void)[] = [];

  private openBulk(o: BulkOption) {
    if (this.sheet.isOpen || !o.ids.length) return;
    this.sheet.openBulk(o.action, o.ids, o.of);
  }

  /** The three best pulls side by side at the right of the header (desktop): rarest first, then value; click opens. */
  private renderShowcase(cards: CardRow[]) {
    const best = [...cards]
      .filter((c) => c.kind !== "dust")
      .sort((a, b) => {
        const va = lamportsOf(this.worthOf(a)) ?? -1n,
          vb = lamportsOf(this.worthOf(b)) ?? -1n;
        return (
          KINDS[b.kind].rank - KINDS[a.kind].rank ||
          (vb === va ? 0 : vb > va ? 1 : -1)
        );
      })
      .slice(0, 3);
    const sig = best.map((c) => c.cardId).join(",");
    if (this.fan.dataset.sig === sig) return;
    this.fan.dataset.sig = sig;
    const box = h("div", "mc-fanbox");
    this.fan.replaceChildren(box);
    const order = [best[1], best[0], best[2]].filter(Boolean) as CardRow[];
    order.forEach((c, i) => {
      const k = order.length === 1 ? 0 : i - (order.length - 1) / 2;
      const w = h("span", { cls: "mc-show-card", data: { id: c.cardId } }, [
        buildFace(c, this.ctx),
      ]);
      w.style.setProperty("--k", String(k));
      w.addEventListener("click", () => this.openCard(c.cardId));
      box.append(w);
    });
  }

  private countFig(el: HTMLElement, from: string, to: string) {
    const a = Number(from.replace(/[^\d.]/g, "")) || 0;
    const b = Number(to.replace(/[^\d.]/g, ""));
    const dec = (to.split(".")[1] ?? "").length;
    const prefix = to.match(/^[^\d]*/)?.[0] ?? "";
    if (!Number.isFinite(b)) {
      setText(el, to);
      return;
    }
    // The figure keeps its widest width while it counts: the words beside it never move.
    const widths = [from, to].map((text) => {
      setText(el, text);
      return el.getBoundingClientRect().width;
    });
    el.style.minWidth = `${Math.max(...widths)}px`;
    const o = { v: a };
    gsap.to(o, {
      v: b,
      duration: from ? 0.6 : 1.1,
      ease: "power3.out",
      overwrite: true,
      onUpdate: () =>
        setText(
          el,
          prefix +
            o.v.toLocaleString("en-US", {
              minimumFractionDigits: dec,
              maximumFractionDigits: dec,
            }),
        ),
      onComplete: () => {
        setText(el, to);
        el.style.minWidth = "";
      },
    });
  }

  private spin(btn: HTMLElement) {
    if (this.ctx.reduced()) return;
    gsap.fromTo(
      btn.querySelector("svg"),
      { rotation: 0 },
      { rotation: 360, duration: 0.7, ease: "power2.inOut" },
    );
  }

  private renderNotice() {
    const m = this.data.notice;
    this.notice.hidden = !m;
    setText(this.notice, m ? msg(this.t, m) : "");
  }

  // =========================================================== toolbar
  private renderTabs() {
    const cards = this.liveCards();
    const n: Record<Tab, number> = {
      all: cards.length,
      hits: cards.filter((c) => c.kind !== "dust").length,
      dust: cards.filter((c) => c.kind === "dust").length,
      pending: this.data.pending.length,
    };
    for (const tab of TABS) {
      const c = this.tabCounts.get(tab)!;
      setText(c, this.data.status === "ready" ? count(n[tab]) : "");
      c.hidden = this.data.status !== "ready";
    }
    // Pending is a tab only while a pull is pending.
    const pendingTab = this.tabBtns.get("pending")!;
    pendingTab.hidden = !n.pending && this.tab !== "pending";
    const disabled = this.data.status !== "ready";
    this.toolbar.classList.toggle("is-disabled", disabled);
    for (const b of this.tabBtns.values()) b.disabled = disabled;
    this.sortSel.disabled = disabled;
    this.placeTabInd(false);
  }

  private placeTabInd(animate: boolean) {
    const b = this.tabBtns.get(this.tab);
    if (!b || !b.offsetWidth) return;
    const x = b.offsetLeft,
      w = b.offsetWidth;
    if (animate && !this.ctx.reduced()) {
      const s = SPRINGS.snappy();
      gsap.to(this.tabInd, {
        x,
        width: w,
        duration: s.duration,
        ease: s.ease,
        overwrite: true,
      });
    } else gsap.set(this.tabInd, { x, width: w });
  }

  setTab(tab: Tab) {
    if (tab === this.tab) return;
    const prev = this.tab;
    this.tab = tab;
    for (const [k, b] of this.tabBtns) {
      setAttr(b, "aria-selected", String(k === tab));
      b.tabIndex = k === tab ? 0 : -1;
    }
    this.panel.setAttribute("aria-labelledby", `${this.uid}-tab-${tab}`);
    this.placeTabInd(true);
    this.renderPanel(
      TABS.indexOf(tab) > TABS.indexOf(prev) ? "tab-next" : "tab-prev",
    );
  }

  setSort(sort: SortKey) {
    if (sort === this.sort) return;
    this.sort = sort;
    this.sortSel.value = sort;
    this.renderPanel("flip");
  }

  setView(view: ViewMode) {
    if (view === this.view) return;
    this.view = view;
    for (const [k, b] of this.viewBtns)
      setAttr(b, "aria-pressed", String(k === view));
    // Cross-fade: the relayout of every card happens while the board is invisible.
    if (this.ctx.reduced() || this.data.status !== "ready") {
      this.root.dataset.view = view;
      return;
    }
    gsap.killTweensOf(this.grid);
    gsap.to(this.grid, {
      opacity: 0,
      y: 6,
      duration: 0.14,
      ease: "power1.in",
      onComplete: () => {
        this.root.dataset.view = view;
        gsap.set(this.grid, { opacity: 1, y: 0 });
        this.staggerIn([...this.grid.children] as HTMLElement[], 0);
      },
    });
  }

  private onTabsKey(e: KeyboardEvent) {
    const i = TABS.indexOf(this.tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    this.setTab(TABS[next]);
    this.tabBtns.get(TABS[next])!.focus();
  }

  // =========================================================== panel
  private renderSeq = 0;
  private renderPanel(
    mode: "update" | "deal" | "flip" | "tab-next" | "tab-prev" | "remove",
  ) {
    const d = this.data;
    const rm = this.ctx.reduced();
    const seq = ++this.renderSeq;
    // A newer render wins: stop a tab fade still running and restore its cells.
    const running = [...this.grid.children] as HTMLElement[];
    if (running.some((c) => gsap.isTweening(c))) {
      gsap.killTweensOf(running);
      gsap.set(running, { clearProps: "opacity,transform" });
    }
    if (d.status === "loading") {
      this.renderLoading();
      return;
    }
    if (d.status === "error") {
      this.renderError();
      return;
    }
    this.grid.classList.remove("is-loading");
    const cards = this.visibleCards();
    const pend = this.pendingVisible();
    const animateIn = (mode === "tab-next" || mode === "tab-prev") && !rm;
    const reflow = (mode === "flip" || mode === "remove") && !rm;

    // Build the ordered cells.
    const cells: HTMLElement[] = [];
    for (const p of pend) cells.push(this.pendingCell(p));
    for (const c of cards) cells.push(this.tileFor(c).li);
    // Remove tiles of cards that no longer exist.
    const alive = new Set(this.data.cards.map((c) => c.cardId));
    for (const [id, tile] of this.tiles)
      if (!alive.has(id)) {
        tile.cleanup();
        tile.li.remove();
        this.tiles.delete(id);
      }
    for (const [seq, li] of this.pendingCells)
      if (!d.pending.some((p) => p.seq === seq)) {
        li.remove();
        this.pendingCells.delete(seq);
      }

    const doSwap = () => {
      // Keyed diff: drop what left, move only what is out of place (re-attaching every card would
      // restyle every subtree; a removal then costs a layout only).
      const want = new Set<Element>(cells);
      for (const child of [...this.grid.children])
        if (!want.has(child)) child.remove();
      let ref: ChildNode | null = this.grid.firstChild;
      for (const el of cells) {
        if (el === ref) {
          ref = ref.nextSibling;
          continue;
        }
        this.grid.insertBefore(el, ref);
      }
      this.renderEmpty(cards.length + pend.length === 0);
      this.rove();
      if (this.pendingHighlight) this.applyHighlight();
    };
    if (animateIn) {
      const old = [...this.grid.children] as HTMLElement[];
      const dir = mode === "tab-next" ? 1 : -1;
      gsap.killTweensOf(old);
      if (old.length)
        gsap.to(old, {
          opacity: 0,
          x: -14 * dir,
          duration: 0.12,
          ease: "power1.in",
          overwrite: true,
          onComplete: () => {
            gsap.set(old, { clearProps: "opacity,transform" });
            if (seq !== this.renderSeq) return;
            doSwap();
            this.staggerIn(cells, dir);
          },
        });
      else {
        doSwap();
        this.staggerIn(cells, dir);
      }
      return;
    }
    if (reflow) {
      flip(
        [
          ...this.grid.children,
          ...cells.filter((c) => !c.isConnected),
        ] as HTMLElement[],
        doSwap,
        {
          spring: SPRINGS.layout(),
          onEnter: (els) =>
            gsap.fromTo(
              els,
              { opacity: 0, scale: 0.85 },
              {
                opacity: 1,
                scale: 1,
                duration: 0.35,
                ease: "back.out(2)",
                clearProps: "opacity,transform",
              },
            ),
        },
      );
      return;
    }
    doSwap();
    if (mode === "deal") this.deal(cells);
  }

  private staggerIn(cells: HTMLElement[], dir: number) {
    // Only what is on screen animates; the rest appears at once.
    const vh = window.innerHeight;
    const vis = cells
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.bottom > 0 && r.top < vh;
      })
      .slice(0, 20);
    const s = SPRINGS.travel();
    gsap.fromTo(
      vis,
      { opacity: 0, x: 18 * dir, y: dir ? 6 : 12 },
      {
        opacity: 1,
        x: 0,
        y: 0,
        duration: s.duration * 0.8,
        ease: s.ease,
        stagger: 0.022,
        clearProps: "opacity,transform",
      },
    );
  }

  /** First load: the face-down cards flip over, left to right, like the reveal (DA §8.1 D). */
  private deal(cells: HTMLElement[]) {
    if (this.ctx.reduced()) return;
    const tiles = cells
      .map((c) => c.querySelector<HTMLElement>(".mc-lift"))
      .filter((x): x is HTMLElement => !!x)
      .slice(0, 20);
    tiles.forEach((lift, i) => {
      const back = buildBack(this.t);
      back.classList.add("mc-dealback");
      lift.append(back);
      const card = lift.querySelector<HTMLElement>(".mc-card:not(.mc-back)")!;
      const s = SPRINGS.travel();
      gsap.fromTo(
        card,
        { rotationY: -180, transformPerspective: 900 },
        {
          rotationY: 0,
          duration: s.duration,
          ease: s.ease,
          delay: 0.05 + i * 0.045,
          clearProps: "transform",
        },
      );
      gsap.fromTo(
        back,
        { rotationY: 0, transformPerspective: 900 },
        {
          rotationY: 180,
          duration: s.duration,
          ease: s.ease,
          delay: 0.05 + i * 0.045,
          onComplete: () => back.remove(),
        },
      );
    });
  }

  private renderLoading() {
    this.dealt = true;
    this.grid.classList.add("is-loading");
    const n = this.ctx.mobile() ? 6 : 10;
    const cells: HTMLElement[] = [];
    for (let i = 0; i < n; i++)
      cells.push(
        h("li", { cls: "mc-cell is-back", attrs: { "aria-hidden": "true" } }, [
          h("span", "mc-lift", [buildBack(this.t)]),
        ]),
      );
    this.grid.replaceChildren(
      ...cells,
      h("li", "mc-sr", [this.t("common.loading")]),
    );
    this.renderEmpty(false);
    this.emptyEl.hidden = true;
  }

  private renderError() {
    const { t } = this;
    this.grid.replaceChildren();
    this.emptyEl.hidden = false;
    this.emptyEl.className = "mc-empty is-error";
    const retry = h(
      "button",
      {
        cls: "mc-oval mc-oval-sm",
        attrs: { type: "button" },
        on: { click: () => this.emit("refresh") },
      },
      [
        h("span", "mc-oval-face", [
          h("em", { cls: "mc-oval-label", text: t("common.retry") }),
          h("b", {
            cls: "mc-oval-chip",
            attrs: { "aria-hidden": "true" },
            text: "→",
          }),
        ]),
      ],
    );
    this.cleanups.push(pressable(retry, () => this.ctx.reduced()));
    const rescue = this.rescueUrl
      ? h("a", {
          cls: "mc-link",
          attrs: { href: this.rescueUrl, target: "_blank", rel: "noopener" },
          text: t("common.rescueLink"),
        })
      : null;
    this.emptyEl.replaceChildren(
      h(
        "div",
        { cls: "mc-empty-art is-error", attrs: { "aria-hidden": "true" } },
        [buildBack(t)],
      ),
      h("p", {
        cls: "mc-empty-title",
        attrs: { role: "alert" },
        text: msg(t, this.data.error) || t("common.networkError"),
      }),
      h("div", "mc-empty-actions", [retry, rescue]),
    );
  }

  private renderEmpty(empty: boolean) {
    const { t } = this;
    this.emptyEl.hidden = !empty;
    if (!empty) return;
    const allEmpty = !this.liveCards().length && !this.data.pending.length;
    this.emptyEl.className = `mc-empty${allEmpty ? " is-full" : ""}`;
    if (!allEmpty) {
      const key =
        this.tab === "hits"
          ? "cards.empty.hits"
          : this.tab === "dust"
            ? "cards.empty.dust"
            : "cards.empty.pending";
      this.emptyEl.replaceChildren(
        h("p", { cls: "mc-empty-line", text: t(key) }),
      );
      return;
    }
    const cta = h(
      "button",
      {
        cls: "mc-oval",
        attrs: { type: "button" },
        on: { click: () => this.emit("rip") },
      },
      [
        h("span", "mc-oval-face", [
          h("em", {
            cls: "mc-oval-label",
            text: t("footer.cta").replace(/\s*→$/, ""),
          }),
          h("b", {
            cls: "mc-oval-chip",
            attrs: { "aria-hidden": "true" },
            text: "→",
          }),
        ]),
      ],
    );
    cta.setAttribute("aria-label", t("footer.cta"));
    this.cleanups.push(pressable(cta, () => this.ctx.reduced()));
    const close = this.data.closeMyCards;
    let closeBlock: HTMLElement | null = null;
    if (close) {
      const st = this.states.get(keyOf("close_my_cards", []));
      const b = h(
        "button",
        {
          cls: "mc-pill mc-close-binder",
          attrs: { type: "button" },
          data: { state: st?.state ?? "idle" },
          on: { click: () => this.confirm("close_my_cards", []) },
        },
        [
          h("span", {
            text:
              st?.state === "failed"
                ? t("common.retry")
                : t("cards.close.button", { sol: sol(close.lamports) }),
          }),
        ],
      );
      b.disabled = st?.state === "signing" || st?.state === "sending";
      this.cleanups.push(pressable(b, () => this.ctx.reduced()));
      closeBlock = h("div", "mc-close-block", [
        h("p", { cls: "mc-empty-note", text: t("cards.close.line") }),
        b,
        st?.state === "failed"
          ? h("p", {
              cls: "mc-flowmsg is-error",
              text: msg(t, st.info?.message) || t("errors.generic"),
            })
          : null,
      ]);
    }
    const art = h(
      "div",
      { cls: "mc-empty-art", attrs: { "aria-hidden": "true" } },
      [0, 1, 2].map((i) =>
        h("span", { cls: "mc-empty-slot", vars: { "--i": i } }),
      ),
    );
    this.emptyEl.replaceChildren(
      art,
      h("p", { cls: "mc-empty-title", text: t("cards.empty.title") }),
      cta,
      ...(closeBlock ? [closeBlock] : []),
    );
  }

  // =========================================================== tiles
  private tileFor(card: CardRow): Tile {
    const existing = this.tiles.get(card.cardId);
    if (existing) {
      if (existing.sig !== sigOf(card)) {
        const face = buildFace(card, this.ctx);
        existing.tilt?.destroy();
        existing.face.replaceWith(face);
        existing.face = face;
        existing.tilt = new Tilt(existing.btn, face, {
          reduced: () => this.ctx.reduced(),
        });
        existing.sig = sigOf(card);
      } else if (existing.card.value !== card.value) {
        updateFaceValue(existing.face, card, this.t);
      }
      existing.card = card;
      this.paintTileMeta(existing);
      return existing;
    }
    const face = buildFace(card, this.ctx);
    const lift = h("span", "mc-lift", [face]);
    const name = h("span", "mc-meta-name");
    const sub = h("span", "mc-meta-sub");
    const val = h("span", "mc-meta-val");
    const busy = h("span", {
      cls: "mc-busy",
      attrs: { "aria-hidden": "true" },
    });
    const btn = h("button", { cls: "mc-tile", attrs: { type: "button" } }, [
      lift,
      h("span", "mc-meta", [name, sub]),
      val,
      busy,
    ]);
    const li = h(
      "li",
      { cls: "mc-cell", data: { id: card.cardId, kind: card.kind } },
      [btn],
    );
    const tile: Tile = {
      id: card.cardId,
      card,
      li,
      btn,
      lift,
      face,
      tilt: null,
      name,
      sub,
      val,
      busy,
      sig: sigOf(card),
      cleanup: () => {},
    };
    tile.tilt = new Tilt(btn, face, { reduced: () => this.ctx.reduced() });
    // Click opens the card's sheet (its actions); the bulk bar acts on every card at once.
    const onFocus = () => {
      tile.tilt?.focus(true);
      if (this.activeTile !== tile.id) this.rove(tile.id);
    };
    const onBlur = () => tile.tilt?.focus(false);
    btn.addEventListener("click", () => this.openCard(tile.id));
    btn.addEventListener("focus", onFocus);
    btn.addEventListener("blur", onBlur);
    const unpress = pressable(btn, () => this.ctx.reduced(), 0.975);
    tile.cleanup = () => {
      unpress();
      tile.tilt?.destroy();
    };
    this.tiles.set(card.cardId, tile);
    this.paintTileMeta(tile);
    this.tileBusy(card.cardId);
    return tile;
  }

  /** Roving tabindex: the binder is one Tab stop; arrows move between cards (onGridKey). */
  private rove(focusId?: string) {
    const tiles = [
      ...this.grid.querySelectorAll<HTMLElement>(
        ".mc-cell[data-id] > .mc-tile",
      ),
    ];
    if (!tiles.length) return;
    const ids = tiles.map((b) => (b.parentElement as HTMLElement).dataset.id!);
    if (focusId) this.activeTile = focusId;
    if (!this.activeTile || !ids.includes(this.activeTile))
      this.activeTile = ids[0];
    tiles.forEach((b, i) => {
      b.tabIndex = ids[i] === this.activeTile ? 0 : -1;
    });
  }

  private paintTileMeta(tile: Tile) {
    const { t } = this;
    const c = tile.card;
    const info = KINDS[c.kind];
    const nm = info.mult
      ? t("cards.kindWithMult", { name: t(info.name), mult: info.mult })
      : t(info.name);
    const tk = ticker(c.coin.ticker);
    setText(
      tile.name,
      t("cards.figure.tokens", { amount: c.amountUi, ticker: tk }),
    );
    setText(tile.sub, c.edition ? `${nm} ✳ ${EDITIONS[c.edition].name}` : nm);
    // A hit the machine buys back shows no market value (D30): its amount says what it holds.
    const valued = !SELL_BACK_KINDS.includes(c.kind);
    setText(tile.val, valued ? valueText(t, c.value) : "");
    tile.val.hidden = !valued;
    tile.val.classList.toggle("is-none", c.value.kind === "none");
    setAttr(
      tile.btn,
      "aria-label",
      valued
        ? t("cards.card.aria", {
            name: nm,
            amount: c.amountUi,
            ticker: tk,
            value: valueText(t, c.value),
          })
        : t("cards.card.ariaAmount", {
            name: nm,
            amount: c.amountUi,
            ticker: tk,
          }),
    );
  }

  /** Busy overlay on a tile while one of its actions is signing or sending. */
  private tileBusy(id: string) {
    const tile = this.tiles.get(id);
    if (!tile) return;
    let st: { state: ActionState; info?: ActionInfo } | null = null;
    for (const [k, v] of this.states) {
      const [, list] = k.split("|");
      if (
        list.split(",").includes(id) &&
        (v.state === "signing" || v.state === "sending")
      ) {
        st = v;
        break;
      }
    }
    tile.li.classList.toggle("is-busy", !!st);
    if (st) {
      const text =
        st.state === "signing"
          ? msg(this.t, st.info?.message) || this.t("wallet.check")
          : this.t("cards.state.sending", {
              c: count(st.info?.progress?.confirmed ?? 0),
              t: count(st.info?.progress?.total ?? 1),
            });
      tile.busy.replaceChildren(
        h("span", "mc-spinner"),
        h("span", { cls: "mc-busy-text", text }),
      );
    } else tile.busy.replaceChildren();
  }

  private pendingCell(p: PendingPull): HTMLLIElement {
    const { t } = this;
    let li = this.pendingCells.get(p.seq);
    if (!li) {
      li = h("li", { cls: "mc-cell is-pending", data: { seq: p.seq } });
      this.pendingCells.set(p.seq, li);
    }
    const st = this.states.get(
      keyOf(p.state === "refundable" ? "refund" : "settle", [p.seq]),
    );
    const busy = st?.state === "signing" || st?.state === "sending";
    const slowAfter = this.data.config?.stillCrankingAfterMs ?? 5_000;
    const slow =
      p.state === "drawing" &&
      p.createdMs !== undefined &&
      Date.now() - p.createdMs > slowAfter;
    clearTimeout(this.slowTimers.get(p.seq));
    if (p.state === "drawing" && p.createdMs !== undefined && !slow) {
      // "Still cranking. The draw is on-chain." once the draw takes longer than usual.
      this.slowTimers.set(
        p.seq,
        window.setTimeout(
          () => {
            if (this.pendingCells.has(p.seq) && this.data.pending.includes(p))
              this.pendingCell(p);
          },
          p.createdMs + slowAfter - Date.now() + 50,
        ),
      );
    }
    const title = t("cards.pending.pack", {
      edition: EDITIONS[p.edition].name,
      n: count(p.qty),
    });
    const line =
      p.state === "drawing"
        ? t(slow ? "cards.pending.slow" : "cards.pending.drawing")
        : p.state === "refundable"
          ? t("cards.pending.refundable")
          : t("cards.pending.settling");
    let action: HTMLButtonElement | null = null;
    if (p.state === "refundable" || p.state === "settling") {
      const label =
        st?.state === "failed"
          ? t("common.retry")
          : p.state === "refundable"
            ? p.refundLamports
              ? t("cards.pending.refund", { sol: sol(p.refundLamports) })
              : t("cards.pending.refundNoAmount")
            : t("cards.pending.settle");
      const chip =
        p.state === "refundable" && p.refundLamports && st?.state !== "failed"
          ? h("span", {
              cls: "mc-pillchip",
              text: t("common.solGain", { sol: sol(p.refundLamports) }),
            })
          : null;
      const text = chip ? t("cards.pending.refundNoAmount") : label;
      action = h(
        "button",
        {
          cls: "mc-pill mc-pend-btn",
          attrs: { type: "button", "aria-label": label },
          data: { state: st?.state ?? "idle" },
          on: {
            click: () =>
              this.confirm(p.state === "refundable" ? "refund" : "settle", [
                p.seq,
              ]),
          },
        },
        [h("span", { text }), chip],
      );
      action.disabled = busy;
    }
    const verify = h(
      "button",
      {
        cls: "mc-link mc-pend-verify",
        attrs: { type: "button" },
        on: { click: () => this.emit("verify", { seq: p.seq }) },
      },
      [
        t("cards.pending.pull", { seq: count(Number(p.seq)) }),
        icon("verify", "mc-icon mc-icon-sm"),
      ],
    );
    const packUrl = `${this.ctx.assetsBase}packs/${p.edition}.webp`;
    const drawing = p.state === "drawing";
    const sheen = drawing ? h("span", "mc-pend-sheen") : null;
    if (sheen)
      sheen.style.setProperty(
        "--pack",
        `url("${new URL(packUrl, document.baseURI).href}")`,
      );
    const art = h(
      "span",
      { cls: "mc-pend-art", attrs: { "aria-hidden": "true" } },
      [
        drawing ? h("span", "mc-pend-glow") : null,
        h("span", "mc-pend-packwrap", [
          h("img", {
            cls: "mc-pend-pack",
            attrs: {
              src: packUrl,
              alt: "",
              decoding: "async",
              draggable: "false",
            },
          }),
          sheen,
        ]),
        p.qty > 1
          ? h("span", { cls: "mc-pend-qty", text: `×${count(p.qty)}` })
          : null,
      ],
    );
    const flow = busy
      ? st?.state === "signing"
        ? t("wallet.check")
        : t("cards.state.sending", { c: "0", t: "1" })
      : st?.state === "failed"
        ? msg(t, st.info?.message) || t("errors.generic")
        : "";
    const box = h("div", { cls: "mc-pend", data: { state: p.state } }, [
      art,
      h("div", "mc-pend-info", [
        h("p", { cls: "mc-pend-title", text: title }),
        h("p", {
          cls: `mc-pend-line${p.state === "drawing" ? " is-live" : ""}`,
          attrs: p.state === "drawing" ? { role: "status" } : {},
          text: line,
        }),
        action,
        flow
          ? h("p", {
              cls: `mc-pend-flow${st?.state === "failed" ? " is-error" : ""}`,
              text: flow,
            })
          : null,
        verify,
      ]),
    ]);
    if (action) this.cleanups.push(pressable(action, () => this.ctx.reduced()));
    li.replaceChildren(box);
    return li;
  }

  private renderPending() {
    for (const p of this.data.pending)
      if (this.pendingCells.has(p.seq)) this.pendingCell(p);
    this.renderHeader();
    if (this.data.closeMyCards && this.emptyEl.classList.contains("is-full"))
      this.renderEmpty(true);
  }

  // =========================================================== highlight
  highlight(cardId: string) {
    this.pendingHighlight = cardId;
    this.applyHighlight();
  }

  /** Brings the pending highlight's card into view (All tab if needed), focuses it and lights it for a few seconds. */
  private applyHighlight() {
    const id = this.pendingHighlight;
    if (
      !id ||
      this.data.status !== "ready" ||
      !this.liveCards().some((c) => c.cardId === id)
    )
      return;
    if (!this.visibleCards().some((c) => c.cardId === id)) this.setTab("all");
    const tile = this.tiles.get(id);
    if (!tile || !tile.li.isConnected) return;
    this.pendingHighlight = null;
    this.rove(id);
    requestAnimationFrame(() => {
      if (!tile.li.isConnected) return;
      tile.li.scrollIntoView({
        block: "center",
        behavior: this.ctx.reduced() ? "auto" : "smooth",
      });
      tile.btn.focus({ preventScroll: true });
      tile.li.classList.remove("is-highlight");
      void tile.li.offsetWidth;
      tile.li.classList.add("is-highlight");
      clearTimeout(this.highlightTimer);
      this.highlightTimer = window.setTimeout(
        () => tile.li.classList.remove("is-highlight"),
        4200,
      );
    });
  }
  private highlightTimer = 0;

  // =========================================================== sheet
  open(cardId: string) {
    this.openCard(cardId);
  }
  private openCard(id: string) {
    if (this.sheet.isOpen) return;
    const tile = this.tiles.get(id);
    if (tile && !tile.li.isConnected) return;
    this.sheet.openCard(id);
    this.emit("open", { cardId: id });
  }
  close() {
    this.sheet.close("keep");
  }

  private confirm(a: Choice | CardsAction, ids: string[]) {
    const k = keyOf(a, ids);
    // Local "signing" until the host reports its own progress.
    this.states.set(k, { state: "signing" });
    for (const id of ids) this.tileBusy(id);
    this.sheet.syncState();
    this.renderPending();
    this.emit("action", { action: a, ids });
  }

  // =========================================================== moments
  private async playDone(action: CardsAction, ids: string[], info: ActionInfo) {
    const rm = this.ctx.reduced();
    const recv = info.receivedLamports ?? 0n;
    const fromSheet =
      this.sheet.isOpen &&
      (this.sheet.openMode === "card" || this.sheet.openMode === "bulk") &&
      ids.every(
        (id) =>
          this.sheet.openIds.includes(id) || this.sheet.openMode === "bulk",
      );
    this.sheetWasBulk = fromSheet && this.sheet.openMode === "bulk";
    let sheetCard: { rect: DOMRect; face: HTMLElement } | null = null;
    if (fromSheet) sheetCard = this.sheet.close("done");

    const cardMoments =
      action === "redeem" || action === "sell_back" || action === "feed_back";
    this.dock.hold();
    try {
      await this.playMoment(
        action,
        ids,
        info,
        sheetCard,
        cardMoments,
        recv,
        rm,
      );
    } finally {
      this.dock.release();
    }
  }

  private async playMoment(
    action: CardsAction,
    ids: string[],
    info: ActionInfo,
    sheetCard: { rect: DOMRect; face: HTMLElement } | null,
    cardMoments: boolean,
    recv: bigint,
    rm: boolean,
  ) {
    const { t } = this;
    void info;
    if (cardMoments) {
      // Sources: the sheet card (single) or the tiles on screen.
      const sources: {
        rect: DOMRect;
        face: HTMLElement;
        card: CardRow | undefined;
      }[] = [];
      if (sheetCard && ids.length === 1)
        sources.push({
          ...sheetCard,
          card: this.data.cards.find((c) => c.cardId === ids[0]),
        });
      else
        for (const id of ids) {
          const tile = this.tiles.get(id);
          if (!tile || !tile.li.isConnected) continue;
          const r = tile.face.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          sources.push({ rect: r, face: tile.face, card: tile.card });
        }
      for (const id of ids) {
        this.gone.add(id);
        const tile = this.tiles.get(id);
        if (tile) tile.lift.style.visibility = "hidden";
      }
      const doneMsg =
        action === "sell_back"
          ? t("cards.done.sell", { sol: sol(recv) })
          : action === "redeem"
            ? t(
                ids.length === 1
                  ? "cards.done.redeem.one"
                  : "cards.done.redeem.other",
                { n: count(ids.length) },
              )
            : t(
                ids.length === 1
                  ? "cards.done.feedBack.one"
                  : "cards.done.feedBack.other",
                { n: count(ids.length) },
              );
      const reflow = () => {
        this.renderHeader();
        this.renderTabs();
        this.renderPanel("remove");
        this.dock.setRip(
          this.liveCards().length > 0 || this.data.pending.length > 0,
        );
      };
      if (rm || !sources.length) {
        if (action === "sell_back") this.dock.tick(recv);
        if (action === "feed_back") this.dock.gulp(ids.length);
        reflow();
        this.toast(
          doneMsg,
          action === "sell_back" ? "gold" : "ink",
          action === "feed_back" ? "machine" : "wallet",
        );
        this.announce(doneMsg);
        return;
      }
      // From the grid (bulk), wait for the sheet to fade; close the gaps once the shards have cleared.
      const lead =
        sheetCard && ids.length === 1 ? 0 : this.sheetWasBulk ? 0.2 : 0;
      const many = sources.length > 1;
      gsap.delayedCall(
        lead +
          (action === "feed_back"
            ? 0.65
            : many
              ? 0.45 + sources.length * 0.09
              : 0.38),
        reflow,
      );
      const per = sources.length ? recv / BigInt(sources.length) : 0n;
      const runs = sources.map(
        (s, i) =>
          new Promise<void>((res) =>
            gsap.delayedCall(lead + i * 0.09, () => {
              const last = i === sources.length - 1;
              const share = last
                ? recv - per * BigInt(sources.length - 1)
                : per;
              const p =
                action === "feed_back"
                  ? this.momentFeed(s.face, s.rect)
                  : action === "redeem"
                    ? this.momentRedeem(s.face, s.rect, s.card)
                    : this.momentSell(s.face, s.rect, share, many);
              p.then(res);
            }),
          ),
      );
      await Promise.all(runs);
      this.toast(
        doneMsg,
        action === "sell_back" ? "gold" : "ink",
        action === "feed_back" ? "machine" : "wallet",
      );
      this.announce(this.withBalance(doneMsg, action === "sell_back"));
      return;
    }

    if (
      action === "withdraw_owed" ||
      action === "close_my_cards" ||
      action === "refund"
    ) {
      const srcEl =
        action === "withdraw_owed"
          ? this.owed.querySelector(".mc-owed-fig")
          : action === "close_my_cards"
            ? this.emptyEl.querySelector(".mc-close-binder")
            : this.pendingCells.get(ids[0])?.querySelector(".mc-pend-btn");
      const doneMsg =
        action === "withdraw_owed"
          ? t("cards.done.owed", { sol: sol(recv) })
          : action === "close_my_cards"
            ? t("cards.done.close", { sol: sol(recv) })
            : t("cards.done.refund", { sol: sol(recv) });
      const r = (srcEl as HTMLElement | null)?.getBoundingClientRect();
      if (r && !rm) {
        const n = Math.min(10, Math.max(5, Math.round(Number(recv) / 5e6)));
        const from = Array.from({ length: n }, () => ({
          x: r.left + Math.random() * r.width,
          y: r.top + r.height / 2,
        }));
        const per = recv / BigInt(n);
        await this.fx.coins({
          from,
          target: () => this.dock.walletPoint(),
          sprite: this.fx.solCoin(),
          size: 28,
          stagger: 0.05,
          burst: 200,
          onArrive: (i, k) => {
            this.dock.tick(i === k - 1 ? recv - per * BigInt(k - 1) : per);
            this.ctx.sound("coin.land", i);
          },
        });
      } else this.dock.tick(recv);
      this.toast(doneMsg, "gold", "wallet");
      this.announce(this.withBalance(doneMsg, true));
      return;
    }
    if (action === "take_back") {
      const row = ids.length === 1 ? this.sheet.machineRow(ids[0]) : null;
      const coin = row?.querySelector<HTMLElement>(".mc-coin");
      const r = coin?.getBoundingClientRect();
      if (r && !rm) {
        const entry = this.data.inTheMachine?.entries.find(
          (e) => e.entryId === ids[0],
        );
        const img = coin?.querySelector("img") ?? null;
        const sprite = this.fx.tokenCoin(
          entry?.coin.mint ?? ids[0],
          img,
          ticker(entry?.coin.ticker ?? "?").slice(1, 2),
        );
        const c = center(r);
        await this.fx.coins({
          from: Array.from({ length: 7 }, () => ({ x: c.x, y: c.y })),
          target: () => this.dock.walletIconPoint(),
          sprite,
          size: 26,
          stagger: 0.05,
          burst: 180,
          onArrive: () => this.dock.walletReceive(),
        });
      }
      const doneMsg = t(
        ids.length === 1 ? "takeBack.done.one" : "takeBack.done.other",
        { n: count(ids.length) },
      );
      this.toast(doneMsg, "ink", "wallet");
      this.announce(doneMsg);
      return;
    }
    if (action === "settle") {
      const doneMsg = t("cards.done.settle");
      this.toast(doneMsg, "ink", "wallet");
      this.announce(doneMsg);
    }
  }

  /** Sell: the card shatters into gold dust and SOL coins that fly into the counter. */
  private async momentSell(
    face: HTMLElement,
    rect: DOMRect,
    received: bigint,
    many = false,
  ) {
    const fx = this.fx;
    const mobile = this.ctx.mobile();
    face.style.visibility = "hidden";
    const glow = fx.glow(rect);
    const charge = fx.cloneCard(face, rect);
    gsap.set(charge, { transformOrigin: "50% 50%" });
    this.ctx.sound("card.lift");
    // The shards are built during the charge (a few per frame), at the charged size.
    const k = 1.05;
    const live = new DOMRect(
      rect.left - (rect.width * (k - 1)) / 2,
      rect.top - (rect.height * (k - 1)) / 2,
      rect.width * k,
      rect.height * k,
    );
    const prep = fx.prepareShatter(face, live, many);
    await Promise.all([
      new Promise<void>((res) =>
        gsap.to(charge, {
          scale: k,
          duration: 0.17,
          ease: "power2.out",
          onComplete: res,
        }),
      ),
      prep.ready,
    ]);
    gsap.to(glow, {
      opacity: 0,
      scale: 1.4,
      duration: 0.5,
      ease: "power2.out",
      onComplete: () => glow.remove(),
    });
    const nCoins = mobile ? 8 : 14;
    let emitted = 0;
    const per = received / BigInt(nCoins);
    const coinsDone: Promise<void>[] = [];
    const sprite = fx.solCoin();
    fx.sparkle(
      { x: live.left + live.width / 2, y: live.top + live.height * 0.42 },
      mobile ? 4 : 8,
      live.width * 0.6,
    );
    fx.dust(live, mobile ? 5 : 12, ["gold", "cream", "gold", "lilac"], {
      g: -140,
      life: 0.9,
    });
    await prep.run((p, i, n) => {
      const every = Math.max(1, Math.floor(n / nCoins));
      if (i % every === 0 && emitted < nCoins) {
        const c = emitted++;
        coinsDone.push(
          fx.coins({
            from: [p],
            target: () => this.dock.walletPoint(),
            sprite,
            size: mobile ? 28 : 36,
            burst: 380,
            pop: [0.1, 0.16],
            fly: [0.42, 0.56],
            onStart: () => this.ctx.sound("coin.pop", c),
            onArrive: () => {
              this.dock.tick(
                c === nCoins - 1 ? received - per * BigInt(nCoins - 1) : per,
              );
              this.ctx.sound("coin.land", c);
            },
          }),
        );
      }
    }, charge);
    if (emitted < nCoins)
      this.dock.tick(
        per * BigInt(nCoins - emitted) +
          (emitted ? 0n : received - per * BigInt(nCoins)),
      );
    await Promise.all(coinsDone);
    fx.ring(this.dock.walletPoint(), "#f6d272", 64);
    fx.sparkle(this.dock.walletPoint(), 8, 34);
  }

  /** Redeem: the coin lifts off the card, then streams its tokens into the wallet. */
  private async momentRedeem(
    face: HTMLElement,
    rect: DOMRect,
    card: CardRow | undefined,
  ) {
    const fx = this.fx;
    const mobile = this.ctx.mobile();
    const clone = fx.cloneCard(face, rect);
    gsap.set(clone, { transformOrigin: "50% 50%" });
    face.style.visibility = "hidden";
    const coinEl = clone.querySelector<HTMLElement>(".mc-coin");
    const cr = coinEl?.getBoundingClientRect() ?? rect;
    const lift = coinEl ? (coinEl.cloneNode(true) as HTMLElement) : null;
    if (lift && coinEl) {
      lift.classList.add("mc-fly-coin");
      lift.style.left = `${cr.left}px`;
      lift.style.top = `${cr.top}px`;
      lift.style.width = `${cr.width}px`;
      lift.style.fontSize = `${cr.width}px`;
      fx.layer.append(lift);
      coinEl.style.visibility = "hidden";
    }
    this.ctx.sound("card.lift");
    gsap.to(clone, {
      scale: 0.88,
      y: 22,
      opacity: 0,
      duration: 0.45,
      ease: "power2.in",
      onComplete: () => clone.remove(),
    });
    const s = SPRINGS.snappy();
    if (lift) {
      gsap.set(lift, { transformOrigin: "50% 50%" });
      const halo = fx.glow(cr);
      gsap.to(halo, { y: -34, duration: s.duration * 0.85, ease: s.ease });
      await new Promise<void>((res) =>
        gsap.to(lift, {
          y: -34,
          scale: 1.25,
          duration: s.duration * 0.85,
          ease: s.ease,
          onComplete: res,
        }),
      );
      gsap.to(halo, {
        opacity: 0,
        scale: 1.5,
        duration: 0.45,
        ease: "power2.out",
        onComplete: () => halo.remove(),
      });
    }
    const c = center(lift?.getBoundingClientRect() ?? cr);
    fx.ring(c, "#f6d272", (lift?.getBoundingClientRect().width ?? 80) * 1.1);
    fx.sparkle(c, mobile ? 4 : 8, 56);
    if (lift)
      gsap.to(lift, {
        scale: 0.15,
        opacity: 0,
        duration: 0.36,
        ease: "power3.in",
        onComplete: () => lift.remove(),
      });
    const img = face.querySelector<HTMLImageElement>(".mc-coin img");
    const tk = ticker(card?.coin.ticker ?? "?");
    const mono = /^\$1PCT$/.test(tk) ? "1%" : tk.slice(1, 2);
    const sprite = fx.tokenCoin(card?.coin.mint ?? tk, img, mono);
    const n = mobile ? 8 : 14;
    this.ctx.sound("token.stream");
    await fx.coins({
      from: Array.from({ length: n }, () => ({ x: c.x, y: c.y })),
      target: () => this.dock.walletIconPoint(),
      sprite,
      size: mobile ? 28 : 34,
      stagger: 0.04,
      burst: 300,
      pop: [0.1, 0.16],
      fly: [0.44, 0.58],
      onArrive: (i) => {
        this.dock.walletReceive();
        this.ctx.sound("coin.land", i);
      },
    });
    fx.ring(this.dock.walletIconPoint(), "#f6d272", 56);
    fx.sparkle(this.dock.walletIconPoint(), 6, 28);
  }

  /** Feed back: the card is drawn into the machine in a swirl of dust. */
  private async momentFeed(face: HTMLElement, rect: DOMRect) {
    const fx = this.fx;
    const mobile = this.ctx.mobile();
    const clone = fx.cloneCard(face, rect);
    gsap.set(clone, { transformOrigin: "50% 50%" });
    face.style.visibility = "hidden";
    this.ctx.sound("card.lift");
    const s = SPRINGS.snappy();
    await new Promise<void>((res) =>
      gsap.to(clone, {
        scale: 1.06,
        rotation: -5,
        y: -14,
        duration: s.duration * 0.6,
        ease: s.ease,
        onComplete: res,
      }),
    );
    const target = () => this.dock.machinePoint();
    const T0 = target();
    const c0 = center(rect);
    const ctrl = {
      x: c0.x + (T0.x - c0.x) * 0.15 + (c0.x < T0.x ? -90 : 90),
      y: Math.min(c0.y, T0.y) - (mobile ? 90 : 160),
    };
    const o = { u: 0 };
    let lastEmit = 0;
    await new Promise<void>((res) =>
      gsap.to(o, {
        u: 1,
        duration: 0.9,
        ease: "power2.in",
        onUpdate: () => {
          const T = target();
          const u = o.u;
          const x =
            (1 - u) * (1 - u) * c0.x + 2 * (1 - u) * u * ctrl.x + u * u * T.x;
          const y =
            (1 - u) * (1 - u) * c0.y + 2 * (1 - u) * u * ctrl.y + u * u * T.y;
          gsap.set(clone, {
            x: x - c0.x,
            y: y - c0.y - 14 * (1 - u),
            scale: 1.06 * (1 - u) * (1 - u) + 0.04,
            rotation: -5 + u * 200,
            opacity: u > 0.92 ? (1 - u) * 12 : 1,
          });
          if (u - lastEmit > 0.07 && u < 0.88) {
            lastEmit = u;
            fx.swirl(clone.getBoundingClientRect(), mobile ? 2 : 5, target);
          }
        },
        onComplete: () => {
          clone.remove();
          res();
        },
      }),
    );
    this.ctx.sound("slot.drop");
    fx.ring(target(), "#d5a2f1", 60);
    this.dock.gulp(1);
    this.ctx.sound("crank.turn");
    fx.sparkle(target(), 5, 26);
  }

  /** "Sold. +0.13 SOL. 3.34 SOL in your wallet" (the balance the counter now shows). */
  private withBalance(text: string, sol_: boolean) {
    const b = this.dock.shown;
    return sol_ && b !== null
      ? `${text} ${this.t("cards.wallet.balance", { sol: sol(b) })}`
      : text;
  }

  /** A receipt that rises out of the wallet or the machine (and the live region says it too). */
  private toast(
    text: string,
    tone: "gold" | "ink",
    at: "wallet" | "machine" = "wallet",
  ) {
    const el = this.toastEl;
    el.className = `mc-toast is-${tone}`;
    el.replaceChildren(
      icon(tone === "gold" ? "sell" : "check"),
      h("span", { text }),
    );
    gsap.killTweensOf(el);
    // Explicit px position (no CSS translate: GSAP folds it into its own transform and would freeze it).
    const a = this.dock.el.hidden
      ? { x: window.innerWidth / 2, y: window.innerHeight - 24 }
      : this.dock.anchor(at);
    gsap.set(el, { clearProps: "transform" });
    const w = el.offsetWidth || 240,
      hgt = el.offsetHeight || 44;
    el.style.left = `${Math.round(Math.min(window.innerWidth - 12 - w, Math.max(12, a.x - w / 2)))}px`;
    el.style.top = `${Math.round(a.y - 12 - hgt)}px`;
    if (this.ctx.reduced()) {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15 });
      gsap.to(el, { opacity: 0, delay: 2.4, duration: 0.15 });
      return;
    }
    const s = SPRINGS.snappy();
    gsap.fromTo(
      el,
      { opacity: 0, y: 14, scale: 0.94 },
      { opacity: 1, y: 0, scale: 1, duration: s.duration, ease: s.ease },
    );
    gsap.to(el, {
      opacity: 0,
      y: -8,
      delay: 2.6,
      duration: 0.3,
      ease: "power2.in",
    });
  }

  private shake() {
    const b = this.sheet.isOpen
      ? this.root.querySelector<HTMLElement>(".mc-sheet .mc-oval")
      : null;
    if (!b || this.ctx.reduced()) return;
    gsap.fromTo(
      b,
      { x: 0 },
      {
        keyframes: [{ x: -5 }, { x: 5 }, { x: -3 }, { x: 0 }],
        duration: 0.36,
        ease: "power1.inOut",
      },
    );
  }

  // =========================================================== keyboard (grid)
  private onGridKey(e: KeyboardEvent) {
    const keys = [
      "ArrowRight",
      "ArrowLeft",
      "ArrowDown",
      "ArrowUp",
      "Home",
      "End",
    ];
    if (!keys.includes(e.key)) return;
    // One item per cell (a card, or a pending pull's first button), so arrows follow the grid geometry.
    const items = [...this.grid.children]
      .map(
        (li) =>
          li.querySelector<HTMLElement>(".mc-tile") ??
          li.querySelector<HTMLElement>("button"),
      )
      .filter((b): b is HTMLElement => !!b);
    const active = document.activeElement as HTMLElement;
    const i = items.findIndex(
      (b) =>
        b === active || b.closest(".mc-cell") === active.closest(".mc-cell"),
    );
    if (i < 0) return;
    const step = Math.max(
      1,
      getComputedStyle(this.grid).gridTemplateColumns.split(" ").filter(Boolean)
        .length,
    );
    let j = i;
    if (e.key === "ArrowRight") j = i + 1;
    else if (e.key === "ArrowLeft") j = i - 1;
    else if (e.key === "ArrowDown") j = i + step;
    else if (e.key === "ArrowUp") j = i - step;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = items.length - 1;
    j = Math.max(0, Math.min(items.length - 1, j));
    e.preventDefault();
    if (j !== i) {
      items[j].focus({ preventScroll: true });
      items[j].scrollIntoView({
        block: "nearest",
        behavior: this.ctx.reduced() ? "auto" : "smooth",
      });
    }
  }

  // =========================================================== misc API
  setInsets(insets: { top?: number; bottom?: number }) {
    this.insets = {
      top: insets.top ?? this.insets.top,
      bottom: insets.bottom ?? this.insets.bottom,
    };
    this.root.style.setProperty("--mc-top", `${this.insets.top}px`);
    this.root.style.setProperty("--mc-bottom", `${this.insets.bottom}px`);
  }
  setReducedMotion(v: boolean) {
    this.reducedOverride = v;
    this.root.classList.toggle("is-reduced", v);
  }
  focusHeading() {
    this.heading.focus({ preventScroll: false });
  }

  destroy() {
    for (const t of this.slowTimers.values()) clearTimeout(t);
    clearTimeout(this.highlightTimer);
    this.sheet.destroy();
    this.fx.destroy();
    this.dock.destroy();
    for (const tile of this.tiles.values()) tile.cleanup();
    this.tiles.clear();
    this.cleanups.forEach((f) => f());
    this.cleanups = [];
    this.listeners.clear();
    gsap.killTweensOf(this.root.querySelectorAll("*"));
    this.root.remove();
  }
}

export { nextId, sr };
