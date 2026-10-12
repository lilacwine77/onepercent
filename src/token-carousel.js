import "./token-carousel.css";

/** Continuous token lineup: hold to inspect, release to keep discovering. */
export function initTokenCarousel() {
  const root = document.querySelector(".token-lineup");
  if (!root) return () => {};
  const viewport = root.querySelector(".token-window");
  const group = root.querySelector(".token-group");
  const duplicate = group.cloneNode(true);
  duplicate.setAttribute("aria-hidden", "true");
  duplicate.querySelectorAll("img").forEach((img) => img.alt = "");
  group.parentElement.append(duplicate);

  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const pointers = new Set();
  const touches = new Set();
  const keys = new Set();
  let drag = null;
  let visible = false;
  let raf = 0;
  let last = 0;
  let position = viewport.scrollLeft;

  function canMove() {
    return visible && !document.hidden && !pointers.size && !touches.size && !keys.size && !motion.matches;
  }
  function tick(now) {
    raf = 0;
    if (!canMove()) { last = 0; return; }
    const width = group.getBoundingClientRect().width;
    if (width) {
      if (!last || Math.abs(viewport.scrollLeft - position) > 2) position = viewport.scrollLeft;
      const delta = last ? Math.min(now - last, 48) : 0;
      // Keep fractional travel between frames; some browsers round scrollLeft.
      position = (position + delta * 0.035) % width;
      viewport.scrollLeft = position;
    }
    last = now;
    raf = requestAnimationFrame(tick);
  }
  function sync() {
    if (canMove() && !raf) raf = requestAnimationFrame(tick);
    if (!canMove()) { cancelAnimationFrame(raf); raf = 0; last = 0; }
  }
  function manualScroll(direction) {
    const width = group.getBoundingClientRect().width;
    if (!width) return;
    const step = direction * Math.min(viewport.clientWidth * 0.7, 620);
    position = ((viewport.scrollLeft + step) % width + width) % width;
    viewport.scrollLeft = position;
    last = 0;
    sync();
  }
  function releasePointer(event) {
    pointers.delete(event.pointerId);
    if (drag?.id === event.pointerId) drag = null;
    root.classList.toggle("is-held", pointers.size > 0 || touches.size > 0);
    sync();
  }
  function releaseAll() {
    pointers.clear();
    touches.clear();
    keys.clear();
    drag = null;
    root.classList.remove("is-held");
    sync();
  }
  root.querySelector(".token-prev").addEventListener("click", () => manualScroll(-1), options);
  root.querySelector(".token-next").addEventListener("click", () => manualScroll(1), options);
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointers.add(event.pointerId);
    root.classList.add("is-held");
    if (event.pointerType === "mouse" && viewport.contains(event.target)) {
      drag = { id: event.pointerId, x: event.clientX, scroll: viewport.scrollLeft };
      viewport.setPointerCapture(event.pointerId);
    }
    sync();
  }, options);
  viewport.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    viewport.scrollLeft = drag.scroll + drag.x - event.clientX;
  }, options);
  window.addEventListener("pointerup", releasePointer, { ...options, capture: true });
  window.addEventListener("pointercancel", releasePointer, { ...options, capture: true });
  root.addEventListener("lostpointercapture", releasePointer, options);
  // Native horizontal swipes cancel pointer events. Keep holding until the
  // actual touch ends, without preventing vertical page scrolling.
  root.addEventListener("touchstart", (event) => {
    for (const touch of event.changedTouches) touches.add(touch.identifier);
    sync();
  }, { ...options, passive: true });
  function releaseTouches(event) {
    for (const touch of event.changedTouches) touches.delete(touch.identifier);
    root.classList.toggle("is-held", pointers.size > 0 || touches.size > 0);
    sync();
  }
  window.addEventListener("touchend", releaseTouches, { ...options, passive: true, capture: true });
  window.addEventListener("touchcancel", releaseTouches, { ...options, passive: true, capture: true });
  viewport.addEventListener("keydown", (event) => {
    if (!["Space", "ArrowLeft", "ArrowRight"].includes(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
    sync();
    if (event.code !== "Space") manualScroll(event.code === "ArrowLeft" ? -1 : 1);
  }, options);
  window.addEventListener("keyup", (event) => { keys.delete(event.code); sync(); }, options);
  viewport.addEventListener("blur", () => { keys.clear(); sync(); }, options);
  window.addEventListener("blur", releaseAll, options);
  document.addEventListener("visibilitychange", () => document.hidden ? releaseAll() : sync(), options);
  motion.addEventListener("change", sync, options);
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
  observer.observe(root);
  return () => { controller.abort(); observer.disconnect(); cancelAnimationFrame(raf); duplicate.remove(); };
}
