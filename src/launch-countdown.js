export const MACHINE_OPENS_AT = Date.parse("2026-10-13T17:45:00Z");

export function countdownAt(now) {
  const seconds = Math.max(0, Math.ceil((MACHINE_OPENS_AT - now) / 1000));
  return {
    live: seconds === 0,
    parts: [
      Math.floor(seconds / 3600),
      Math.floor((seconds % 3600) / 60),
      seconds % 60,
    ].map((part) => String(part).padStart(2, "0")),
  };
}

export function initLaunchCountdown(root) {
  const label = root.querySelector("[data-countdown-label]");
  const timer = root.querySelector("[data-countdown-timer]");
  const link = root.querySelector("[data-countdown-link]");
  const digits = [...root.querySelectorAll("[data-countdown-part]")];
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let timeout;
  let initialized = false;
  let live = false;

  function update() {
    clearTimeout(timeout);
    const now = Date.now();
    const state = countdownAt(now);
    if (state.live) {
      if (!live) {
        label.textContent = "The Machine is live";
        timer.hidden = true;
        link.hidden = false;
        live = true;
      }
    } else {
      timer.setAttribute(
        "aria-label",
        `${state.parts[0]} hours, ${state.parts[1]} minutes, ${state.parts[2]} seconds until the Machine opens`,
      );
      digits.forEach((digit, index) => {
        if (digit.textContent === state.parts[index]) return;
        digit.textContent = state.parts[index];
        if (initialized && !motion.matches && !document.hidden) {
          digit.animate(
            [
              { opacity: 0.55, transform: "translateY(3px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: 240, easing: "ease-out" },
          );
        }
      });
      // Recompute from the wall clock after sleep or throttling; never count ticks.
      if (!document.hidden) timeout = setTimeout(update, 1000 - (now % 1000));
    }
    initialized = true;
    root.hidden = false;
  }

  document.addEventListener("visibilitychange", update);
  update();
  return () => {
    clearTimeout(timeout);
    document.removeEventListener("visibilitychange", update);
    digits.forEach((digit) =>
      digit.getAnimations().forEach((animation) => animation.cancel()),
    );
  };
}
