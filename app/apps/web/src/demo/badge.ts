/**
 * PREVIEW builds only: the header badge. It names the current page's mode (Live,
 * Demo, or Preview off the flows) and opens the progress panel: every flow's
 * mode, the demo wallet, the demo balance and a reset.
 */
import { PREVIEW_FLOWS } from "@onepercent/web-api";
import { sol } from "@onepercent/copy";
import { DEMO_COPY } from "./copy";
import { flowOfPath, machineFlows, type Modes } from "./modes";
import { demo } from "./store";
import { demoAddress, isAddress, setDemoAddress } from "./wallet";

export const DEMO_MARKER = "onepercent-demo-build";
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function badge(modes: Modes) {
  const root = el("div", "demo-badge");
  root.dataset.build = DEMO_MARKER;
  const toggle = el("button");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  const panel = el("div", "demo-panel");
  panel.hidden = true;
  panel.append(
    el("p", "demo-panel-title", DEMO_COPY.title),
    el("p", "demo-panel-line", DEMO_COPY.line),
  );
  const flows = el("ul", "demo-flows");
  for (const flow of PREVIEW_FLOWS) {
    const item = el("li");
    const mode = el(
      "span",
      `demo-mode is-${modes[flow]}`,
      modes[flow] === "live" ? DEMO_COPY.live : DEMO_COPY.demo,
    );
    item.append(el("span", undefined, DEMO_COPY.flows[flow]), mode);
    flows.append(item);
  }
  panel.append(flows);
  if (modes.wallet === "demo") {
    const form = el("form", "demo-wallet");
    const label = el("label", undefined, DEMO_COPY.wallet);
    const input = el("input");
    input.id = "demo-wallet-address";
    label.htmlFor = input.id;
    input.value = demoAddress();
    input.spellcheck = false;
    input.autocomplete = "off";
    const use = el("button", undefined, DEMO_COPY.walletUse);
    use.type = "submit";
    const hint = el("p", "demo-hint", DEMO_COPY.walletHint);
    form.append(label, input, use, hint);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const address = input.value.trim();
      if (!isAddress(address)) {
        hint.textContent = DEMO_COPY.walletInvalid;
        return;
      }
      setDemoAddress(address);
      window.location.reload();
    });
    panel.append(form);
  }
  if (machineFlows(modes)) {
    const balance = el("p", "demo-balance");
    const paint = () =>
      balance.replaceChildren(
        `${DEMO_COPY.balance} `,
        el("b", undefined, `${sol(demo.get().lamports)} SOL`),
      );
    demo.subscribe(paint);
    paint();
    const reset = el("button", "demo-reset", DEMO_COPY.reset);
    reset.type = "button";
    reset.addEventListener("click", () => {
      demo.reset();
      window.location.assign("/");
    });
    panel.append(balance, reset);
  }
  const label = () => {
    const flow = flowOfPath(window.location.pathname);
    const mode = flow ? modes[flow] : null;
    root.dataset.mode = mode ?? "preview";
    toggle.textContent =
      mode === "live"
        ? DEMO_COPY.live
        : mode === "demo"
          ? DEMO_COPY.demo
          : DEMO_COPY.preview;
  };
  label();
  window.addEventListener("popstate", label);
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
  });
  root.append(panel, toggle);
  document.body.append(root);
}
