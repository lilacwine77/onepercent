/* eslint-disable */
// Synced from experience/lab/src/rip/overlay.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/** DOM layer above the canvas: captions, result, counter, progress pips, card actions, tips, notices. */
import type { CardAction } from "./types";
import {
  countUp,
  gsap,
  pressable,
  pulse,
  reducedUI,
  revealTitle,
} from "./ui-motion";

const CSS = /* css */ `
.rip-root { position: relative; width: 100%; height: 100%; overflow: hidden; isolation: isolate;
  background: var(--rip-bg, radial-gradient(120% 90% at 50% 34%, #fffaf2 0%, #fff1e7 46%, #f4e1d9 100%)); }
.rip-root > canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; touch-action: pan-y; }
.rip-poster { position: absolute; left: 0; top: 0; max-width: none; pointer-events: none; user-select: none; opacity: 1; transition: opacity .45s ease; }
.rip-poster.is-out { opacity: 0; }
.rip-root.is-reduced .rip-poster { transition-duration: .15s; }
.rip-overlay { position: absolute; inset: 0; pointer-events: none; color: #26062e; font-family: "DM Sans", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }
.rip-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.rip-caption, .rip-result, .rip-counter, .rip-pips, .rip-skip, .rip-notice, .rip-tip { will-change: opacity, transform; backface-visibility: hidden; }
.rip-caption { position: absolute; left: 50%; top: var(--rip-top, 6%); transform: translate(-50%, -10px); opacity: 0;
  transition: opacity .25s ease, transform .5s cubic-bezier(.22,1,.36,1);
  padding: 11px 20px 12px; border-radius: 999px; font: 500 17px/1.2 "DM Sans", system-ui, sans-serif; white-space: nowrap; }
.rip-caption.is-on { opacity: 1; transform: translate(-50%, 0); }
.rip-caption.is-xray { background: #fff1e7; color: #26062e; box-shadow: inset 0 0 0 1.5px #26062e; }
.rip-caption.is-xray::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 10px; border-radius: 50%;
  background: #d5a2f1; box-shadow: 0 0 0 1.5px #26062e; vertical-align: 1px; animation: rip-pulse .47s ease-in-out infinite alternate; will-change: opacity; }
.rip-caption.is-cream { background: #fff1e7; color: #26062e; box-shadow: inset 0 0 0 1.5px #26062e; }
.rip-caption.is-primed { opacity: .001; }
.rip-caption.is-tap::after { content: ""; display: inline-block; width: 7px; height: 7px; margin-left: 10px; border-radius: 50%; background: #d5a2f1;
  vertical-align: 1px; animation: rip-pulse 1.1s ease-in-out infinite; }
@keyframes rip-pulse { 50% { opacity: .35; } }
.rip-result { position: absolute; left: 50%; top: var(--rip-top, 6%); transform: translate(-50%, -12px); opacity: 0;
  display: flex; flex-direction: column; align-items: center; gap: 10px; white-space: nowrap;
  transition: opacity .3s ease, transform .55s cubic-bezier(.175,.885,.32,1.6); }
.rip-result.is-on { opacity: 1; transform: translate(-50%, 0); }
/* The title is centred on its own; the value chip (when there is one) gets its own line under it. */
.rip-result-row { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.rip-result h2 { margin: 0; font: 700 clamp(28px, 2.6vw, 42px)/1.08 "Fraunces", Georgia, serif; letter-spacing: -0.045em; color: #26062e;
  font-variant-numeric: lining-nums proportional-nums; font-feature-settings: "lnum" 1; text-align: center; }
.rip-result.on-dark h2 { color: #f6d272; }
.rip-result-sub { display: flex; align-items: center; gap: 10px; min-height: 30px; }
.rip-result-sub[hidden] { display: none; }
.rip-chip { display: inline-flex; align-items: center; background: linear-gradient(#f6d272, #d9a441); color: #26062e;
  font: 700 16px/1 "DM Sans", system-ui, sans-serif; padding: 9px 13px 10px; border-radius: 6px 6px 16px 6px;
  font-variant-numeric: tabular-nums; box-shadow: inset 0 0 0 1px #a8701f66; white-space: nowrap; }
.rip-chip.is-small { font-size: 14px; padding: 7px 10px 8px; }
.rip-result-row .rip-chip { transition: opacity .25s ease, transform .4s cubic-bezier(.22,1,.36,1); }
.rip-result-row .rip-chip.is-off { display: none; }
.rip-result h2 { transition: color .3s ease; }
.rip-verify { pointer-events: auto; font: 500 15px/1 "DM Sans", system-ui, sans-serif; color: #26062e; text-decoration: underline;
  text-underline-offset: 3px; display: inline-flex; align-items: center; gap: 4px; padding: 8px 6px; border-radius: 8px; }
.rip-verify:hover { text-decoration-thickness: 2px; }
.rip-verify:focus-visible { outline: none; background: #efddee; box-shadow: inset 0 0 0 2px #26062e; }
.rip-group-title { grid-column: 1 / -1; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 2px 4px;
  font: 700 20px/1.15 "Fraunces", Georgia, serif; letter-spacing: -0.04em; color: #26062e; font-feature-settings: "lnum" 1; }
.rip-group-title small { font: 500 14px/1.2 "DM Sans", system-ui, sans-serif; letter-spacing: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rip-btn[data-state="pending"] { pointer-events: none; }
.rip-btn[data-state="pending"] > span:first-child::after { content: ""; display: inline-block; width: 11px; height: 11px; margin-left: 8px; vertical-align: -1px;
  border-radius: 50%; box-shadow: inset 0 0 0 2px currentColor; clip-path: polygon(50% 0, 100% 0, 100% 100%, 0 100%, 0 50%, 50% 50%);
  animation: rip-spin .7s linear infinite; }
@keyframes rip-spin { to { transform: rotate(360deg); } }
.rip-btn[data-state="done"]::before { background: #efddee; }
.rip-btn.is-primary[data-state="done"] { color: #26062e; }
.rip-btn.is-primary[data-state="done"]::after { opacity: 0; }
.rip-btn[data-state="done"] > span:first-child::before { content: "✓ "; }
.rip-btn[data-state="failed"] { animation: rip-shake .36s ease; }
.rip-btn[data-state="failed"] > span:first-child::after { content: " · Retry"; }
@keyframes rip-shake { 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
.rip-pack-total { font: 500 15px/1 "DM Sans", system-ui, sans-serif; color: #26062e; display: inline-flex; align-items: center; gap: 8px; }
.rip-counter { position: absolute; left: 50%; top: calc(var(--rip-top, 6%) + 8%); transform: translate(-50%, 8px); opacity: 0; text-align: center;
  transition: opacity .3s ease, transform .5s cubic-bezier(.22,1,.36,1);
  font: 700 clamp(44px, 5.4vw, 86px)/1 "Fraunces", Georgia, serif; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; color: #26062e; }
.rip-counter.is-on { opacity: 1; transform: translate(-50%, 0); }
.rip-counter small { display: block; margin-top: 8px; font: 700 17px/1.2 "DM Sans", system-ui, sans-serif; letter-spacing: .16em; }
.rip-pips { position: absolute; left: 50%; bottom: max(18px, 3.5%); transform: translate(-50%, 8px); opacity: 0; display: flex; gap: 8px; align-items: flex-end;
  transition: opacity .3s ease, transform .5s cubic-bezier(.22,1,.36,1); }
.rip-pips.is-on { opacity: 1; transform: translate(-50%, 0); }
.rip-pip { width: 14px; height: 20px; border-radius: 3px; box-shadow: inset 0 0 0 1.5px #26062e; position: relative; overflow: hidden; }
.rip-pip::after { content: ""; position: absolute; inset: 0; background: #d5a2f1; transform: scaleY(0); transform-origin: 50% 100%;
  transition: transform .45s cubic-bezier(.175,.885,.32,1.6); }
.rip-pip.is-up::after { transform: scaleY(1); }
.rip-pip.is-hit { width: 17px; height: 24px; box-shadow: inset 0 0 0 1.5px #a8701f; }
.rip-pip.is-hit::after { background: linear-gradient(#f6d272, #d9a441); }
.rip-pip.is-next { animation: rip-next 1s ease-in-out infinite; }
@keyframes rip-next { 50% { transform: translateY(-3px); } }
.rip-group-help { grid-column: 1 / -1; font: 500 14px/1.35 "DM Sans", system-ui, sans-serif; color: #26062e; text-align: left;
  min-height: 2.7em; margin-top: 4px; padding: 0 2px; }
.rip-btn.rip-skip { position: absolute; right: max(16px, 2%); bottom: max(16px, 3%); pointer-events: auto; opacity: 0;
  transition: opacity .25s ease; }
.rip-btn.rip-skip.is-on { opacity: 1; }
.rip-btn.rip-skip[hidden] { display: none; }
.rip-actions { position: absolute; inset: 0; }
/* The selected card's actions: one clean paper panel, beside the hit (landscape) or under the cards
   (portrait), never over the machine's chute. */
.rip-card-actions { position: absolute; left: 0; top: 0; width: var(--w, 300px); display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 8px;
  padding: 14px 14px 12px; border-radius: 18px 18px 40px 18px; background: rgba(255,249,238,.94);
  box-shadow: inset 0 0 0 1.5px #26062e, 0 26px 50px -34px #26062e;
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  pointer-events: auto; opacity: 0; transform: translate(0, calc(-50% + 8px)); transition: opacity .3s ease, transform .45s cubic-bezier(.22,1,.36,1); }
.rip-card-actions.is-on { opacity: 1; transform: translate(0, -50%); }
.rip-card-actions[hidden], .rip-card-actions.is-off { display: none; }
.rip-root.is-portrait .rip-card-actions { left: 16px !important; right: 16px; width: auto; padding: 12px 12px 10px; transform: translateY(8px); }
.rip-root.is-portrait .rip-card-actions.is-on { transform: none; }
.rip-root.is-portrait .rip-group-title { font-size: 18px; }
.rip-root.is-short .rip-group-help { display: none; }
@media (max-width: 379px) { .rip-wide { display: none; } }
.rip-card-actions .rip-btn { width: 100%; padding: 0 14px; gap: 6px; }
.rip-card-actions .rip-btn.is-primary { padding: 0 6px 0 16px; }
.rip-root.is-portrait .rip-card-actions .rip-btn .rip-chip { font-size: 13px; padding: 5px 6px 6px; }
.rip-root.is-portrait .rip-card-actions { grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); }
.rip-card-actions .rip-btn > span:first-child { overflow: hidden; text-overflow: ellipsis; }
.rip-root.is-portrait .rip-group-help { min-height: 0; font-size: 13.5px; }
.rip-btn { appearance: none; margin: 0; border: 0; background: none; color: #26062e; cursor: pointer; position: relative; isolation: isolate;
  font: 500 15px/1 "DM Sans", system-ui, sans-serif; height: 44px; padding: 0 18px; border-radius: 999px; min-width: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; white-space: nowrap;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation; user-select: none; -webkit-user-select: none;
  backface-visibility: hidden; transform: translateZ(0); }
.rip-btn::before { content: ""; position: absolute; inset: 0; border-radius: inherit; z-index: -1; background: #fff1e7; box-shadow: inset 0 0 0 1.5px #26062e; }
.rip-btn::after { content: ""; position: absolute; inset: 0; border-radius: inherit; z-index: -1; background: #d5a2f1; opacity: 0;
  transition: opacity .18s ease; box-shadow: inset 0 0 0 1.5px #26062e; }
.rip-btn:hover::after { opacity: .55; }
.rip-btn[data-pressed]::after { opacity: 1; transition-duration: .05s; }
.rip-btn:focus-visible { outline: none; }
.rip-btn:focus-visible::before { box-shadow: inset 0 0 0 2.5px #26062e; background: #efddee; }
.rip-btn.is-wide { grid-column: 1 / -1; }
/* End actions: the label left, the Sell figure or the arrow right. The host dock's "Rip again" stays the ink oval. */
.rip-btn.is-money, .rip-btn.is-link { justify-content: space-between; padding: 0 6px 0 18px; border-radius: 9px 9px 25px 9px; }
.rip-btn.is-link:hover .rip-arrow { transform: translateX(2px); }
.rip-btn.is-closed { cursor: default; color: rgb(38 6 46 / .5); }
.rip-btn.is-closed::before { background: transparent; box-shadow: inset 0 0 0 1.5px rgb(38 6 46 / .25); }
.rip-btn.is-closed::after { display: none; }
/* Primary = the DA oval: ink face, radius 9/9/25/9, lilac arrow chip (6/6/19/6). */
.rip-btn.is-primary { color: #fff1e7; border-radius: 9px 9px 25px 9px; justify-content: space-between; padding: 0 6px 0 18px; }
.rip-btn.is-primary::before { background: #26062e; box-shadow: none; }
.rip-btn.is-primary::after { background: #4c2459; box-shadow: none; }
.rip-btn.is-primary:hover::after { opacity: 1; }
.rip-btn .rip-arrow { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 6px 6px 16px 6px; background: #d5a2f1; color: #26062e;
  font-size: 18px; transition: transform .3s cubic-bezier(.175,.885,.32,1.6); }
.rip-btn.is-primary:hover .rip-arrow { transform: translateX(2px); }
.rip-btn.is-primary:focus-visible::before { box-shadow: inset 0 0 0 2px #d5a2f1; background: #26062e; }
.rip-btn.is-done::before { background: #efddee; }
.rip-btn.is-done { cursor: default; }
.rip-btn .rip-chip { padding: 6px 8px 7px; font-size: 14px; border-radius: 4px 4px 10px 4px; }
.rip-btn.is-share { height: 36px; font-size: 14px; padding: 0 14px; }
.rip-btn.is-share svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.rip-tip { position: fixed; left: 0; top: 0; z-index: 30; max-width: 240px; padding: 9px 12px 10px; border-radius: 10px 10px 18px 10px;
  background: #26062e; color: #fff1e7; font: 500 14px/1.35 "DM Sans", system-ui, sans-serif; white-space: normal; pointer-events: none;
  opacity: 0; transform: translate(-50%, calc(-100% - 4px)) scale(.96); transition: opacity .16s ease, transform .3s cubic-bezier(.175,.885,.32,1.6); }
.rip-tip.is-on { opacity: 1; transform: translate(-50%, calc(-100% - 10px)) scale(1); }
.rip-toast { position: absolute; left: 0; top: 0; transform: translate(-50%, 8px) scale(.9); opacity: 0;
  transition: opacity .3s ease, transform .5s cubic-bezier(.175,.885,.32,1.6); display: flex; flex-direction: column; align-items: center; gap: 8px;
  font: 500 15px/1.2 "DM Sans", system-ui, sans-serif; white-space: nowrap; }
.rip-toast.is-on { opacity: 1; transform: translate(-50%, 0) scale(1); }
@media (max-width: 640px) { .rip-chip.rip-pop { font-size: 12.5px; padding: 6px 8px 7px; } }
.rip-pop { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); pointer-events: none; will-change: transform, opacity;
  animation: rip-pop 1.15s cubic-bezier(.22,1,.36,1) forwards; }
@keyframes rip-pop { 0% { opacity: 0; transform: translate(-50%, -60%) scale(.8); } 18% { opacity: 1; transform: translate(-50%, -100%) scale(1); }
  70% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -160%) scale(1); } }
.rip-notice { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -46%); opacity: 0; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 22px 26px; max-width: min(420px, 88%);
  background: #fff9ee; border-radius: 18px 18px 48px 18px; box-shadow: inset 0 0 0 1.5px #26062e, 0 24px 60px -30px #26062e;
  text-align: center; transition: opacity .25s ease, transform .5s cubic-bezier(.22,1,.36,1); }
.rip-notice.is-on { opacity: 1; transform: translate(-50%, -50%); pointer-events: auto; }
.rip-notice p { margin: 0; font: 500 17px/1.4 "DM Sans", system-ui, sans-serif; }
.rip-notice strong { display: block; font: 700 26px/1.1 "Fraunces", Georgia, serif; letter-spacing: -0.05em; margin-bottom: 6px; }
@media (max-width: 640px) {
  .rip-result { white-space: normal; width: calc(100% - 32px); gap: 8px; text-align: center; }
  .rip-result-row { gap: 8px; }
  .rip-result h2 { font-size: 26px; text-wrap: balance; }
  .rip-caption { font-size: 15px; }
  .rip-counter { font-size: 44px; }
}
@media (pointer: coarse) { .rip-btn { height: 48px; font-size: 16px; } .rip-btn.is-share { height: 44px; } .rip-btn .rip-arrow { width: 36px; height: 36px; } }
@media (prefers-reduced-motion: reduce) {
  .rip-caption, .rip-result, .rip-counter, .rip-card-actions, .rip-toast, .rip-pips, .rip-skip, .rip-notice { transition: opacity .15s ease; }
  .rip-caption.is-xray::before, .rip-caption.is-tap::after, .rip-pip.is-next { animation: none; }
}
.rip-root.is-reduced .rip-caption, .rip-root.is-reduced .rip-result, .rip-root.is-reduced .rip-counter,
.rip-root.is-reduced .rip-card-actions, .rip-root.is-reduced .rip-toast, .rip-root.is-reduced .rip-pips { transition: opacity .15s ease; }
.rip-root.is-reduced .rip-caption.is-xray::before, .rip-root.is-reduced .rip-pip.is-next { animation: none; }
`;

let injected = false;
function injectCSS() {
  if (injected) return;
  injected = true;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

export interface ActionSpec {
  action: CardAction;
  label: string;
  chip?: string;
  /** An arrow chip: the action continues elsewhere (Go to My cards). */
  arrow?: boolean;
  /** Shown but closed (Sell refused): `hint` says why. */
  disabled?: boolean;
  /** Spans the whole group width. */
  wide?: boolean;
  /** Line under the buttons on hover / focus. */
  hint?: string;
}

export interface OverlayHandlers {
  action: (
    index: number,
    action: CardAction,
    button: HTMLButtonElement,
  ) => void;
  share: () => void;
  verify: () => void;
  /** The one "Reveal all" button (the host decides: turn the rest over, or cut to the end). */
  skip: () => void;
  retry: () => void;
}

const SHARE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 8.5 12 4l4.5 4.5M5 13v6h14v-6"/></svg>';

export class Overlay {
  el: HTMLDivElement;
  private caption: HTMLDivElement;
  private result: HTMLDivElement;
  private resultTitle: HTMLHeadingElement;
  private resultChip: HTMLSpanElement;
  private resultSub: HTMLDivElement;
  private counter: HTMLDivElement;
  private counterValue: HTMLSpanElement;
  private counterUnit: HTMLElement;
  private pips: HTMLDivElement;
  private actions: HTMLDivElement;
  private skipBtn: HTMLButtonElement;
  private notice: HTMLDivElement;
  private tip: HTMLDivElement;
  private live: HTMLDivElement;
  private groups: HTMLDivElement[] = [];
  private toasts: HTMLDivElement[] = [];
  private cleanups: (() => void)[] = [];
  private lastTitle = "";

  constructor(
    parent: HTMLElement,
    private on: OverlayHandlers,
  ) {
    injectCSS();
    this.el = document.createElement("div");
    this.el.className = "rip-overlay";
    this.el.innerHTML = `
      <div class="rip-caption" aria-hidden="true"></div>
      <div class="rip-result" aria-hidden="true">
        <div class="rip-result-row"><h2></h2><span class="rip-chip"></span></div>
        <div class="rip-result-sub" hidden></div>
      </div>
      <div class="rip-counter" aria-hidden="true"><span></span><small></small></div>
      <div class="rip-pips" aria-hidden="true"></div>
      <div class="rip-actions"></div>
      <button class="rip-btn rip-skip" type="button" hidden>Reveal all</button>
      <div class="rip-notice" role="alertdialog" aria-live="assertive"><p></p></div>
      <div class="rip-tip" role="tooltip"></div>
      <div class="rip-sr" aria-live="polite" aria-atomic="true"></div>`;
    parent.appendChild(this.el);
    const q = <T extends Element>(s: string) => this.el.querySelector(s) as T;
    this.caption = q(".rip-caption");
    this.result = q(".rip-result");
    this.resultTitle = q(".rip-result h2");
    this.resultChip = q(".rip-result-row .rip-chip");
    this.resultSub = q(".rip-result-sub");
    this.counter = q(".rip-counter");
    this.counterValue = q(".rip-counter span");
    this.counterUnit = q(".rip-counter small");
    this.pips = q(".rip-pips");
    this.actions = q(".rip-actions");
    this.skipBtn = q(".rip-skip");
    this.notice = q(".rip-notice");
    this.tip = q(".rip-tip");
    this.live = q(".rip-sr");
    this.cleanups.push(pressable(this.skipBtn));
    // Pre-raster the Cranking caption once (an invisible, composited layer), so its first real
    // appearance costs no paint over the WebGL canvas.
    this.caption.textContent = "Cranking…";
    this.caption.classList.add("is-xray", "is-primed");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => this.caption.classList.remove("is-primed")),
    );
    this.skipBtn.addEventListener("click", () => this.on.skip());
  }

  setCaption(text: string | null, kind: "xray" | "cream" | "tap" = "xray") {
    if (!text) {
      this.caption.classList.remove("is-on");
      return;
    }
    this.caption.textContent = text;
    this.caption.classList.toggle("is-xray", kind === "xray");
    this.caption.classList.toggle("is-cream", kind !== "xray");
    this.caption.classList.toggle("is-tap", kind === "tap");
    this.caption.classList.add("is-on");
  }

  setResult(
    title: string | null,
    chip?: string,
    opts: { onDark?: boolean; share?: boolean; verify?: string | true } = {},
  ) {
    if (!title) {
      this.result.classList.remove("is-on");
      this.lastTitle = "";
      return;
    }
    // Once the result is on screen there is nothing left to skip.
    this.showSkip(false);
    if (title !== this.lastTitle) {
      revealTitle(this.resultTitle, title);
      if (chip) countUp(this.resultChip, chip, 0.7);
    } else if (chip && this.resultChip.textContent !== chip)
      this.resultChip.textContent = chip;
    this.lastTitle = title;
    this.resultChip.classList.toggle("is-off", !chip);
    this.result.classList.toggle("on-dark", !!opts.onDark);
    this.resultSub.innerHTML = "";
    if (opts.verify) {
      const a = document.createElement("a");
      a.className = "rip-verify";
      a.textContent = "Verify ↗";
      if (typeof opts.verify === "string") {
        a.href = opts.verify;
        a.target = "_blank";
        a.rel = "noopener";
      } else {
        a.href = "#";
        a.addEventListener("click", (e) => {
          e.preventDefault();
          this.on.verify();
        });
      }
      this.resultSub.appendChild(a);
    }
    if (opts.share) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rip-btn is-share";
      b.innerHTML = `${SHARE_ICON}<span>Share</span>`;
      b.style.pointerEvents = "auto";
      b.addEventListener("click", () => {
        pulse(b);
        this.on.share();
      });
      this.cleanups.push(pressable(b));
      this.resultSub.appendChild(b);
    }
    this.resultSub.hidden = !this.resultSub.childElementCount;
    this.result.classList.add("is-on");
  }

  setCounter(value: string | null, unit = "") {
    if (value === null) {
      this.counter.classList.remove("is-on");
      return;
    }
    this.counterValue.textContent = value;
    this.counterUnit.textContent = unit;
    this.counter.classList.add("is-on");
  }

  /** Progress: one pip per card (`up` = revealed), the hit last; `next` pulses in tap mode. */
  setPips(state: { up: boolean[]; hit: number; next?: number } | null) {
    if (!state) {
      this.pips.classList.remove("is-on");
      return;
    }
    if (this.pips.childElementCount !== state.up.length) {
      this.pips.innerHTML = state.up
        .map(
          (_, i) =>
            `<span class="rip-pip${i === state.hit ? " is-hit" : ""}"></span>`,
        )
        .join("");
    }
    [...this.pips.children].forEach((p, i) => {
      p.classList.toggle("is-up", state.up[i]);
      p.classList.toggle("is-next", state.next === i);
    });
    this.pips.classList.add("is-on");
  }

  showSkip(on: boolean) {
    if (on) {
      this.skipBtn.hidden = false;
      requestAnimationFrame(() => this.skipBtn.classList.add("is-on"));
    } else {
      this.skipBtn.classList.remove("is-on");
      this.skipBtn.hidden = true;
    }
  }

  showNotice(title: string | null, text = "", actionLabel = "Try again") {
    if (!title) {
      this.notice.classList.remove("is-on");
      return;
    }
    this.notice.innerHTML = `<p><strong></strong><span></span></p>`;
    (this.notice.querySelector("strong") as HTMLElement).textContent = title;
    (this.notice.querySelector("span") as HTMLElement).textContent = text;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rip-btn is-primary";
    b.style.height = "44px";
    b.style.padding = "0 22px";
    b.textContent = actionLabel;
    b.addEventListener("click", () => {
      this.notice.classList.remove("is-on");
      this.on.retry();
    });
    this.cleanups.push(pressable(b));
    this.notice.appendChild(b);
    this.notice.classList.add("is-on");
    requestAnimationFrame(() => b.focus({ preventScroll: true }));
  }

  announce(text: string) {
    this.live.textContent = "";
    requestAnimationFrame(() => {
      this.live.textContent = text;
    });
  }

  buildActions(
    cards: {
      index: number;
      label: string;
      title?: string;
      sub?: string;
      help?: string;
      specs: ActionSpec[];
    }[],
  ) {
    this.clearActions();
    for (const card of cards) {
      const g = document.createElement("div");
      g.className = "rip-card-actions";
      g.setAttribute("role", "group");
      g.setAttribute("aria-label", card.label);
      if (card.title) {
        const t = document.createElement("div");
        t.className = "rip-group-title";
        const name = document.createElement("span");
        name.textContent = card.title;
        t.appendChild(name);
        if (card.sub) {
          const sub = document.createElement("small");
          sub.textContent = card.sub;
          t.appendChild(sub);
        }
        g.appendChild(t);
      }
      for (const spec of card.specs) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "rip-btn";
        if (spec.wide) b.classList.add("is-wide");
        if (spec.arrow) b.classList.add("is-link");
        if (spec.chip) b.classList.add("is-money");
        b.dataset.action = spec.action;
        b.innerHTML = `<span>${spec.label}</span>${spec.chip ? `<span class="rip-chip">${spec.chip}</span>` : ""}${spec.arrow ? '<b class="rip-arrow" aria-hidden="true">→</b>' : ""}`;
        if (spec.disabled) {
          b.disabled = true;
          b.classList.add("is-closed");
        }
        if (spec.hint) {
          b.dataset.hint = spec.hint;
          b.setAttribute("aria-description", spec.hint);
        }
        if (spec.label.includes("<") || spec.chip)
          b.setAttribute(
            "aria-label",
            spec.label.replace(/<[^>]+>/g, "") +
              (spec.chip ? `, ${spec.chip}` : ""),
          );
        b.addEventListener("click", () =>
          this.on.action(card.index, spec.action, b),
        );
        this.cleanups.push(pressable(b));
        g.appendChild(b);
      }
      // One plain line under the buttons says what each one does (hover / focus / touch).
      if (card.help) {
        const help = document.createElement("div");
        help.className = "rip-group-help";
        help.textContent = card.help;
        help.setAttribute("aria-hidden", "true");
        g.appendChild(help);
        const def = card.help;
        g.querySelectorAll<HTMLButtonElement>(".rip-btn").forEach((b) => {
          const show = () => {
            if (b.dataset.hint) help.textContent = b.dataset.hint;
          };
          const reset = () => {
            help.textContent = def;
          };
          b.addEventListener("pointerenter", show);
          b.addEventListener("focus", show);
          b.addEventListener("pointerdown", show);
          b.addEventListener("pointerleave", reset);
          b.addEventListener("blur", reset);
        });
      }
      this.actions.appendChild(g);
      this.groups[card.index] = g;
    }
  }

  setActionState(
    index: number,
    action: CardAction,
    state: "idle" | "pending" | "done" | "failed",
  ) {
    const b = this.groups[index]?.querySelector<HTMLButtonElement>(
      `[data-action="${action}"]`,
    );
    if (!b) return;
    if (state === "idle") delete b.dataset.state;
    else b.dataset.state = state;
    b.disabled = state === "pending";
    b.setAttribute("aria-busy", String(state === "pending"));
    if (state === "failed") {
      b.style.animation = "none";
      void b.offsetWidth;
      b.style.animation = "";
    }
  }

  /** Updates the money chip of one action button (e.g. a Sell quote that arrived late). */
  setActionChip(
    index: number,
    action: CardAction,
    chip: string | null,
    hint?: string,
  ) {
    const b = this.groups[index]?.querySelector<HTMLButtonElement>(
      `[data-action="${action}"]`,
    );
    if (!b) return;
    let c = b.querySelector(".rip-chip");
    if (chip && !c) {
      c = document.createElement("span");
      c.className = "rip-chip";
      b.appendChild(c);
    }
    if (c) {
      if (chip) c.textContent = chip;
      else c.remove();
    }
    if (chip)
      b.setAttribute(
        "aria-label",
        `${b.querySelector("span")?.textContent ?? ""}, ${chip}`,
      );
    if (hint) {
      b.dataset.hint = hint;
      b.setAttribute("aria-description", hint);
    }
  }

  setResultChip(chip: string | null) {
    if (chip) this.resultChip.textContent = chip;
    this.resultChip.classList.toggle("is-off", !chip);
  }

  showActions(on: boolean) {
    this.groups.forEach((g) => {
      if (!g) return;
      g.classList.toggle("is-on", on);
      if (on && !reducedUI() && !g.classList.contains("is-off"))
        gsap.from(g.children, {
          y: 8,
          opacity: 0,
          duration: 0.4,
          ease: "power3.out",
          stagger: 0.035,
          clearProps: "opacity,transform",
        });
    });
  }

  /** Shows a single card's action group, or all groups when `index` is null. */
  private shown: number | null = -1;
  showOnly(index: number | null) {
    if (index === this.shown) return;
    this.shown = index;
    this.groups.forEach((g, i) => {
      if (!g) return;
      const off = index !== null && i !== index;
      const was = g.classList.contains("is-off");
      g.classList.toggle("is-off", off);
      if (was && !off && g.classList.contains("is-on") && !reducedUI()) {
        // The panel fades in as a whole (never an empty box), its rows rise in after it.
        gsap.fromTo(
          g,
          { opacity: 0 },
          {
            opacity: 1,
            duration: 0.24,
            ease: "power2.out",
            clearProps: "opacity",
          },
        );
        gsap.from(g.children, {
          y: 6,
          opacity: 0,
          duration: 0.3,
          ease: "power3.out",
          stagger: 0.03,
          delay: 0.04,
          clearProps: "opacity,transform",
        });
      }
    });
  }

  /** Landscape: (x, y) is the panel's left edge and vertical centre. Portrait: y is its top (16 px gutters). */
  positionActions(index: number, x: number, y: number, width: number) {
    const g = this.groups[index];
    if (!g) return;
    g.style.left = `${Math.round(x)}px`;
    g.style.top = `${Math.round(y)}px`;
    g.style.setProperty("--w", `${Math.round(Math.max(220, width))}px`);
  }

  /**
   * Bottom of the title block (px from the stage top): what is laid out now, and never less than
   * the room a one-line title and its Verify / Share row take (so every flow frames the same).
   */
  resultBottom(): number {
    const r = this.result;
    const top = r.offsetTop;
    const h2 =
      parseFloat(getComputedStyle(this.resultTitle).fontSize || "28") * 1.08;
    const sub = window.matchMedia("(pointer: coarse)").matches ? 44 : 36;
    const est = top + h2 + 10 + sub;
    const measured =
      this.lastTitle && r.classList.contains("is-on")
        ? top + r.offsetHeight
        : 0;
    return Math.max(est, measured);
  }

  /** Height of a card's action panel as laid out now (for the portrait framing). */
  actionsHeight(index: number): number {
    const g = this.groups[index];
    if (!g) return 0;
    const was = g.classList.contains("is-off");
    if (was) g.classList.remove("is-off");
    const h = g.offsetHeight;
    if (was) g.classList.add("is-off");
    return h;
  }

  hideActionsFor(index: number) {
    const g = this.groups[index];
    if (g) {
      g.classList.remove("is-on");
      setTimeout(() => (g.hidden = true), 300);
    }
  }

  /** A small gold chip that rises and fades (a Dust Card's own quote on its flip). */
  pop(x: number, y: number, text: string) {
    const p = document.createElement("span");
    p.className = "rip-chip is-small rip-pop";
    p.textContent = text;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    if (reducedUI()) p.style.animation = "none";
    this.el.appendChild(p);
    this.pops.add(p);
    setTimeout(() => this.pops.delete(p), 1250);
    setTimeout(() => p.remove(), reducedUI() ? 1200 : 1200);
  }

  private pops = new Set<HTMLElement>();
  /** Fades the quote chips out at once (their cards are about to move). */
  clearPops() {
    this.pops.forEach((p) => {
      // Freeze the rise where it is and fade (a script animation sits above the CSS one).
      const o = getComputedStyle(p).opacity;
      p.getAnimations().forEach((a) => a.pause());
      p.animate([{ opacity: o }, { opacity: 0 }], {
        duration: 150,
        easing: "ease-out",
        fill: "forwards",
      });
    });
    this.pops.clear();
  }

  toast(x: number, y: number, html: string) {
    const t = document.createElement("div");
    t.className = "rip-toast";
    t.innerHTML = html;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
    this.el.appendChild(t);
    this.toasts.push(t);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => t.classList.add("is-on")),
    );
    return t;
  }

  clearToasts() {
    this.toasts.forEach((t) => {
      t.classList.remove("is-on");
      setTimeout(() => t.remove(), 300);
    });
    this.toasts = [];
  }

  clearActions() {
    this.actions.innerHTML = "";
    this.groups = [];
    this.shown = -1;
    this.toasts.forEach((t) => t.remove());
    this.toasts = [];
    this.tip.classList.remove("is-on");
  }

  clear() {
    this.setCaption(null);
    this.setResult(null);
    this.setCounter(null);
    this.setPips(null);
    this.showSkip(false);
    this.showNotice(null);
    this.clearActions();
  }

  destroy() {
    this.cleanups.forEach((c) => c());
    this.el.remove();
  }
}
