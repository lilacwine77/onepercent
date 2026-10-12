/* eslint-disable */
// Synced from experience/cards-lab/src/cards/dock.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * The dock: a floating cream-glass bar (the Rip dock's sibling) holding the wallet's SOL counter
 * (Sell coins fly into it), the machine (Feed back cards fly into it) and "Rip again", the page's
 * main call to action (always in view; sticky at the bottom on phones).
 */
import type { Ctx } from "./ctx";
import { h, icon, machineIcon, setText } from "./dom";
import { count, short, sol } from "./format";
import { gsap, pop, pressable, SPRINGS } from "./motion";

export class Dock {
  readonly el: HTMLElement;
  private main: HTMLElement;
  private walletEl: HTMLElement;
  private walletFig: HTMLElement;
  private walletIconEl: SVGSVGElement;
  private machineBtn: HTMLButtonElement;
  private badge: HTMLElement;
  private machineSvg: SVGSVGElement;
  private ripBtn: HTMLButtonElement;
  private addr: string | null = null;
  /** Lamports currently displayed by the counter (null: no balance known). */
  shown: bigint | null = null;
  private exact: bigint | null = null;
  private machineN = 0;
  private machineExact = 0;
  private holds = 0;
  private preHold: bigint | null = null;
  private cleanups: (() => void)[] = [];

  constructor(
    private ctx: Ctx,
    private on: { machine(): void; rip(): void },
  ) {
    const { t } = ctx;
    this.walletIconEl = icon("wallet", "mc-icon mc-wallet-icon");
    this.walletFig = h("span", "mc-wallet-fig");
    this.walletEl = h(
      "div",
      { cls: "mc-wallet", attrs: { role: "status", "aria-live": "off" } },
      [h("span", "mc-wallet-ico", [this.walletIconEl]), this.walletFig],
    );
    this.machineSvg = machineIcon();
    this.badge = h("span", {
      cls: "mc-badge",
      attrs: { "aria-hidden": "true" },
    });
    this.machineBtn = h(
      "button",
      {
        cls: "mc-machine-btn",
        attrs: { type: "button" },
        on: { click: () => this.on.machine() },
      },
      [
        h("span", "mc-machine-wrap", [this.machineSvg, this.badge]),
        h("span", { cls: "mc-machine-label", text: t("takeBack.title") }),
      ],
    );
    this.ripBtn = h(
      "button",
      {
        cls: "mc-oval mc-dock-rip",
        attrs: { type: "button" },
        on: { click: () => this.on.rip() },
      },
      [
        h("span", "mc-oval-face", [
          h("em", { cls: "mc-oval-label", text: t("cards.ripAgain") }),
          h("b", {
            cls: "mc-oval-chip",
            attrs: { "aria-hidden": "true" },
            text: "→",
          }),
        ]),
      ],
    );
    this.main = h("div", "mc-dock-main", [
      this.walletEl,
      h("span", "mc-dock-sep"),
      this.machineBtn,
      this.ripBtn,
    ]);
    this.el = h(
      "div",
      {
        cls: "mc-dock",
        attrs: { role: "region", "aria-label": t("cards.dock.label") },
      },
      [this.main],
    );
    for (const b of [this.machineBtn, this.ripBtn])
      this.cleanups.push(pressable(b, () => ctx.reduced()));
  }

  /** "Rip again" shows once there are cards (an empty My cards has its own "Pick a pack →"). */
  setRip(on: boolean) {
    this.ripBtn.hidden = !on;
    this.el.classList.toggle("has-rip", on);
  }

  // ------------------------------------------------------------------ wallet counter
  /** While a moment plays, host updates wait: the counter moves with the coins, then settles. */
  hold() {
    if (!this.holds) this.preHold = this.exact;
    this.holds++;
  }
  release() {
    this.holds = Math.max(0, this.holds - 1);
    if (this.holds) return;
    if (this.machineN < this.machineExact) this.setMachine(this.machineExact);
    // The host already reported the new balance: settle on it. Otherwise keep the counted value
    // (optimistic) until the host's next, changed balance arrives.
    if (this.exact !== this.preHold) this.settle();
    else this.announceSoon();
  }
  setWallet(
    w: { address: string; lamports: bigint | null } | null | undefined,
    animate: boolean,
  ) {
    this.addr = w?.address ?? null;
    this.walletEl.hidden = !w;
    const next = w?.lamports ?? null;
    const prev = this.exact;
    this.exact = next;
    if (this.holds && this.shown !== null && next !== null) return;
    if (next === null) {
      this.shown = null;
      this.paintWallet();
      return;
    }
    if (next === prev && this.shown !== null) {
      this.paintWallet();
      return;
    }
    if (this.shown === null || !animate || this.ctx.reduced()) {
      this.shown = next;
      this.paintWallet();
      return;
    }
    if (next !== this.shown) this.tweenTo(next, 0.5);
  }
  private paintWallet() {
    const { t } = this.ctx;
    if (this.shown === null) {
      setText(
        this.walletFig,
        this.addr ? t("wallet.connected", { short: short(this.addr) }) : "",
      );
      this.walletEl.setAttribute(
        "aria-label",
        this.walletFig.textContent ?? "",
      );
      return;
    }
    setText(this.walletFig, t("common.sol", { sol: sol(this.shown) }));
    this.walletEl.setAttribute(
      "aria-label",
      t("cards.wallet.balance", { sol: sol(this.shown) }),
    );
  }
  private tweenTo(target: bigint, dur: number) {
    const from = Number(this.shown ?? 0n),
      to = Number(target);
    const o = { v: from };
    gsap.to(o, {
      v: to,
      duration: dur,
      ease: "power2.out",
      overwrite: true,
      onUpdate: () => {
        this.shown = BigInt(Math.round(o.v));
        this.paintWallet();
      },
      onComplete: () => {
        this.shown = target;
        this.paintWallet();
      },
    });
  }
  /** One coin landed: the counter ticks by `l` and bumps. */
  tick(l: bigint) {
    if (this.shown !== null) {
      this.shown += l;
      this.paintWallet();
    }
    this.bumpWallet();
  }
  bumpWallet() {
    if (this.ctx.reduced()) return;
    pop(this.walletEl, 0.07);
    this.walletEl.classList.remove("is-flash");
    void this.walletEl.offsetWidth;
    this.walletEl.classList.add("is-flash");
  }
  /** After a moment: settle on the exact balance the host reported. */
  settle() {
    if (this.exact !== null && this.shown !== null && this.exact !== this.shown)
      this.tweenTo(this.exact, 0.4);
  }
  private announceSoon() {
    /* the view announces the result with the balance */
  }
  walletPoint() {
    const r = (
      this.shown !== null ? this.walletFig : this.walletIconEl
    ).getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 };
  }
  walletIconPoint() {
    const r = this.walletIconEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /** Where receipts rise from: above the wallet or the machine. */
  anchor(which: "wallet" | "machine") {
    const el = which === "wallet" ? this.walletEl : this.machineBtn;
    const r = el.getBoundingClientRect();
    const top = this.el.getBoundingClientRect().top;
    return { x: r.left + r.width / 2, y: top };
  }
  /** Tokens landed in the wallet: the icon gulps and shows a check. */
  walletReceive() {
    if (this.ctx.reduced()) return;
    const s = SPRINGS.pop();
    gsap.fromTo(
      this.walletIconEl,
      { scale: 1.28, rotate: -8 },
      {
        scale: 1,
        rotate: 0,
        duration: s.duration,
        ease: s.ease,
        overwrite: "auto",
      },
    );
    this.walletEl.classList.remove("is-check");
    void this.walletEl.offsetWidth;
    this.walletEl.classList.add("is-check");
  }

  // ------------------------------------------------------------------ machine
  setMachine(n: number, fromHost = false) {
    if (fromHost) {
      const prev = this.machineExact;
      this.machineExact = n;
      if (this.holds || (n === prev && n <= this.machineN)) return;
    }
    this.machineN = n;
    setText(this.badge, count(n));
    this.badge.hidden = n === 0;
    this.machineBtn.setAttribute(
      "aria-label",
      this.ctx.t("cards.machine.aria", { n: count(n) }),
    );
  }
  machinePoint() {
    const r = this.machineSvg.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.36 };
  }
  /** A card fell in: squash and stretch, the crank turns once, the badge counts up. */
  gulp(added = 1) {
    this.setMachine(this.machineN + added);
    this.machineExact = Math.max(this.machineExact, this.machineN);
    if (this.ctx.reduced()) return;
    const body = this.machineSvg.querySelector(".mc-machine-body");
    const crank = this.machineSvg.querySelector(".mc-machine-crank");
    const s = SPRINGS.settle();
    gsap.fromTo(
      this.machineSvg,
      { scaleX: 1.16, scaleY: 0.86, transformOrigin: "50% 90%" },
      {
        scaleX: 1,
        scaleY: 1,
        duration: s.duration,
        ease: s.ease,
        overwrite: "auto",
      },
    );
    if (crank)
      gsap.fromTo(
        crank,
        { rotation: 0, svgOrigin: "20 27.6" },
        { rotation: 360, duration: 0.55, ease: "power2.inOut" },
      );
    if (body)
      gsap.fromTo(
        body.querySelectorAll(".mc-machine-coins circle"),
        { y: -1.6 },
        { y: 0, duration: 0.5, ease: "bounce.out", stagger: 0.03 },
      );
    pop(this.badge, 0.45);
  }

  destroy() {
    this.cleanups.forEach((f) => f());
    this.el.remove();
  }
}
