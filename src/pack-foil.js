import "./pack-foil.css";

/** Cursor lighting is separate from the orbit transform and never owns gestures. */
export function initPackFoil(cards, { signal, motion, onHover = () => {} } = {}) {
  if (signal?.aborted) return () => {};
  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const reducedMotion = motion || matchMedia("(prefers-reduced-motion: reduce)");
  const addedLayers = [];
  const states = [];
  let activeIndex = null;

  function announce(index) {
    if (activeIndex === index) return;
    activeIndex = index;
    onHover(index);
  }

  function paint(state, x = 0.5, y = 0.45) {
    const { card, index, hovering, focused } = state;
    const reduced = reducedMotion.matches;
    const active = reduced ? (focused ? 0.3 : 0) : (hovering ? 1 : focused ? 0.45 : 0);
    card.style.setProperty("--foil-rx", `${active && !reduced ? (0.5 - y) * 16 : 0}deg`);
    card.style.setProperty("--foil-ry", `${active && !reduced ? (x - 0.5) * 16 : 0}deg`);
    card.style.setProperty("--foil-x", `${(reduced ? 0.5 : x) * 100}%`);
    card.style.setProperty("--foil-y", `${(reduced ? 0.45 : y) * 100}%`);
    card.style.setProperty("--foil-active", String(active));
    card.style.setProperty("--foil-scale", String(reduced ? 1 : 1 + active * 0.03));
    if (active && !reduced) announce(index);
    else if (activeIndex === index) announce(null);
  }

  function reset(state) {
    state.hovering = false;
    paint(state);
  }

  cards.forEach((card, index) => {
    const surface = card.querySelector(".orbit-surface");
    if (!surface) return;
    card.classList.add("has-pack-foil");
    for (const name of ["orbit-iridescence", "orbit-glare"]) {
      if (surface.querySelector(`.${name}`)) continue;
      const layer = document.createElement("span");
      layer.className = name;
      layer.setAttribute("aria-hidden", "true");
      surface.append(layer);
      addedLayers.push(layer);
    }
    const state = { card, index, hovering: false, focused: false };
    states.push(state);
    paint(state);

    function follow(event) {
      if (!finePointer.matches || event.pointerType === "touch" || event.buttons) {
        reset(state);
        return;
      }
      // Read the outer hit area, not the tilted surface: cursor lighting remains
      // stable while its highlights move, and the orbit retains pointer capture.
      const bounds = card.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      state.hovering = true;
      paint(state, x, y);
    }
    card.addEventListener("pointerenter", follow, listenerOptions);
    card.addEventListener("pointermove", follow, listenerOptions);
    card.addEventListener("pointerup", follow, listenerOptions);
    card.addEventListener("pointerleave", () => reset(state), listenerOptions);
    card.addEventListener("pointercancel", () => reset(state), listenerOptions);
    card.addEventListener("pointerdown", () => reset(state), listenerOptions);
    card.addEventListener("focusin", () => {
      // Pointer focus must not relight a pack while the user is dragging it.
      state.focused = card.matches(":focus-visible");
      paint(state);
    }, listenerOptions);
    card.addEventListener("focusout", () => { state.focused = false; paint(state); }, listenerOptions);
  });

  function resetAll() {
    states.forEach(reset);
    announce(null);
  }
  finePointer.addEventListener("change", resetAll, listenerOptions);
  reducedMotion.addEventListener("change", resetAll, listenerOptions);
  window.addEventListener("blur", resetAll, listenerOptions);

  function cleanup() {
    controller.abort();
    signal?.removeEventListener("abort", cleanup);
    announce(null);
    addedLayers.forEach((layer) => layer.remove());
    states.forEach(({ card }) => {
      card.classList.remove("has-pack-foil");
      for (const property of ["--foil-rx", "--foil-ry", "--foil-x", "--foil-y", "--foil-active", "--foil-scale"]) card.style.removeProperty(property);
    });
  }
  signal?.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
