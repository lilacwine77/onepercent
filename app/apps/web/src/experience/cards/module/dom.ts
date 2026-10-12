/* eslint-disable */
// Synced from experience/cards-lab/src/cards/dom.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Tiny DOM helpers. No inline style attributes and no <style> injection: the page CSP is
 * `style-src 'self'` (03-M3 §15.3); dynamic values go through CSSOM (`style.setProperty`).
 */

type Attr = string | number | boolean | null | undefined;
export type Child = Node | string | null | undefined | false;
export interface HOpts {
  cls?: string;
  attrs?: Record<string, Attr>;
  text?: string;
  data?: Record<string, string>;
  vars?: Record<string, string | number>;
  on?: {
    [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void;
  };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: HOpts | string = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const o: HOpts = typeof opts === "string" ? { cls: opts } : opts;
  if (o.cls) el.className = o.cls;
  if (o.attrs) for (const [k, v] of Object.entries(o.attrs)) setAttr(el, k, v);
  if (o.data) for (const [k, v] of Object.entries(o.data)) el.dataset[k] = v;
  if (o.vars)
    for (const [k, v] of Object.entries(o.vars))
      el.style.setProperty(k, String(v));
  if (o.text !== undefined) el.textContent = o.text;
  if (o.on)
    for (const [k, fn] of Object.entries(o.on))
      el.addEventListener(k, fn as EventListener);
  for (const c of children)
    if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function setAttr(el: Element, k: string, v: Attr) {
  if (v === null || v === undefined || v === false) el.removeAttribute(k);
  else el.setAttribute(k, v === true ? "" : String(v));
}

export function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

/** Visually hidden, still read by screen readers. */
export const sr = (text: string) => h("span", { cls: "mc-sr", text });

let uid = 0;
export const nextId = (p: string) => `${p}-${++uid}`;

// ---------------------------------------------------------------------------
// Icons: 1.5 px strokes, round caps (DA §4.5)
// ---------------------------------------------------------------------------

const PATHS: Record<string, string> = {
  wallet:
    '<path d="M4 8.2v9.3A2.5 2.5 0 0 0 6.5 20h12a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 9H6a2 2 0 0 1-2-2v0a2 2 0 0 1 2-2h11.5"/><path d="M16.5 14.5h.01" stroke-width="2.6"/>',
  check: '<path d="M5.5 12.5 10 17l8.5-9.5"/>',
  close: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  grid: '<rect x="4.5" y="4.5" width="6" height="6" rx="1.5"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.5"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.5"/><rect x="13.5" y="13.5" width="6" height="6" rx="1.5"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" stroke-width="2.6"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  refresh:
    '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V8H16"/>',
  verify: '<path d="M8 16 16 8M10 8h6v6"/>',
  redeem:
    '<path d="M12 4v9.5M8 9.5l4 4 4-4"/><path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  sell: '<circle cx="12" cy="12" r="7.5"/><path d="M9.2 10h5.6l-1.4-1.4M14.8 14H9.2l1.4 1.4"/>',
  market:
    '<path d="M4.5 16.5 9.5 11l3.5 3.5 6.5-7"/><path d="M15 7.5h4.5V12"/>',
  feed: '<path d="M12 19.5V9.5M8 13.5l4-4 4 4"/><path d="M5 5h14"/>',
  keep: '<path d="M7.5 4.5h9a1 1 0 0 1 1 1v14l-5.5-3.6-5.5 3.6v-14a1 1 0 0 1 1-1z"/>',
  select:
    '<rect x="4.5" y="4.5" width="15" height="15" rx="4"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  sound:
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="on" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/><path class="off" d="M16 9.5l5 5M21 9.5l-5 5"/>',
  sliders:
    '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  motion: '<path d="M4 12h3l2-5 3 10 2-5h6"/>',
};

export function icon(
  name: keyof typeof PATHS | string,
  cls = "mc-icon",
): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.setAttribute("class", cls);
  s.innerHTML = PATHS[name] ?? "";
  return s;
}

/**
 * The 1% Machine, small (dock target of Feed back): lilac globe with gold coins, brass plate, crank.
 * Colours are presentation attributes (not style attributes), so the CSP holds.
 */
export function machineIcon(): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 40 40");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.setAttribute("class", "mc-machine");
  s.innerHTML = `
    <g class="mc-machine-body">
      <circle cx="20" cy="14.5" r="11" fill="#f7eefc" stroke="#26062e" stroke-width="1.6"/>
      <g class="mc-machine-coins" stroke="#a8701f" stroke-width=".9">
        <circle cx="14.6" cy="18.6" r="3" fill="#f6d272"/><circle cx="20.4" cy="20.2" r="3" fill="#e9bd5b"/>
        <circle cx="25.6" cy="17.6" r="3" fill="#f6d272"/><circle cx="17.8" cy="14.4" r="2.8" fill="#d9a441"/>
        <circle cx="23.4" cy="12.6" r="2.6" fill="#f6d272"/>
      </g>
      <path d="M13 9.4a7.6 7.6 0 0 1 5.2-3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M11.6 24.6h16.8l1.8 11.2H9.8z" fill="#d5a2f1" stroke="#26062e" stroke-width="1.6" stroke-linejoin="round"/>
      <rect x="16.2" y="30.4" width="7.6" height="3.4" rx="1.1" fill="#d9a441" stroke="#26062e" stroke-width="1.1"/>
    </g>
    <g class="mc-machine-crank">
      <circle cx="20" cy="27.6" r="1.9" fill="#f6d272" stroke="#26062e" stroke-width="1.1"/>
      <path d="M20 27.6h4.4" stroke="#26062e" stroke-width="1.6" stroke-linecap="round"/>
    </g>`;
  return s;
}
