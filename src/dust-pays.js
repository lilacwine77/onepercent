import "./dust-pays.css";

const SPRING = "cubic-bezier(0.175, 0.885, 0.32, 1.6)";
const FLIGHT = { delay: 320, duration: 1050 };
const LANDED = FLIGHT.delay + FLIGHT.duration;
const COUNT = { delay: LANDED + 380, duration: 850 };

/** "How dust pays.": an ANSEM bag, fed, becomes its Dust Card, and the card's payoff
 * (up to 75× when a pack pulls it) counts up. Draws the Feed arc from the coin to the
 * card, then plays the sequence once, when the stage scrolls into view after the page
 * entrance (`ready`). Without the script, or with reduced motion, the stage shows the
 * finished example. */
export function initDustPays({ root = document.querySelector("[data-dust-demo]"), ready } = {}) {
  if (!root) return () => {};
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (selector) => root.querySelector(selector);
  const coin = $("[data-dust-from]");
  const card = $("[data-dust-to]");
  const cardCoin = card.querySelector(".dust-coin");
  const host = $(".dust-demo-host");
  const svg = $(".dust-demo-path");
  const arc = svg.querySelector("[data-dust-path]");
  const trace = svg.querySelector("[data-dust-trace]");
  const label = $(".dust-demo-feed");
  const ghost = $(".dust-demo-ghost");
  const foil = $(".dust-card-foil");
  const payoff = $("[data-dust-payoff]");
  const [upto, multiple, when, range] = payoff.children;
  const count = payoff.querySelector("[data-dust-count]");
  const target = Number(count.textContent) || 0;
  let geometry = null;
  let animations = [];
  let counting = 0;
  let entered = !ready;
  let visible = false;
  let played = false;

  // Layout boxes relative to the stage: offsets ignore the transforms of the sequence.
  function box(el) {
    let x = 0, y = 0, node = el;
    while (node && node !== root) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
      if (node && node !== root) {
        x += node.clientLeft;
        y += node.clientTop;
      }
    }
    const w = el.offsetWidth, h = el.offsetHeight;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const quad = (p0, p1, p2, t) => ({
    x: lerp(lerp(p0.x, p1.x, t), lerp(p1.x, p2.x, t), t),
    y: lerp(lerp(p0.y, p1.y, t), lerp(p1.y, p2.y, t), t),
  });

  function measure() {
    const a = box(coin), c = box(card), k = box(cardCoin), h = box(host);
    if (!a.w || !c.w) return;
    // From 900 px Pepe stands between the coin and the card and the arc clears his
    // head into the card's side; stacked, it peaks in the gap under him onto the card.
    const beside = h.x >= a.x + a.w && h.x + h.w <= c.x;
    const end = beside ? { x: c.x - 14, y: k.cy - k.h * 0.18 } : { x: c.cx, y: c.y - 13 };
    const apexY = beside ? h.y - h.h * 0.05 : h.y + h.h + (Math.min(a.y, c.y) - h.y - h.h) * 0.45;
    const aim = { x: (a.cx + end.x) / 2 - a.cx, y: apexY - a.cy };
    const reach = (a.w / 2 + 10) / (Math.hypot(aim.x, aim.y) || 1);
    const start = { x: a.cx + aim.x * reach, y: a.cy + aim.y * reach };
    const apex = { x: (start.x + end.x) / 2, y: apexY };
    const control = { x: apex.x, y: 2 * apexY - (start.y + end.y) / 2 };
    const d = `M${start.x.toFixed(1)} ${start.y.toFixed(1)} Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    svg.setAttribute("viewBox", `0 0 ${root.offsetWidth} ${root.offsetHeight}`);
    arc.setAttribute("d", d);
    trace.setAttribute("d", d);
    label.style.left = `${apex.x}px`;
    label.style.top = `${apex.y}px`;
    geometry = { a, k, start, control, end };
    root.dataset.geometry = "";
  }

  // The flight: lift off the coin, ride the arc, drop into the card's ring.
  function flightFrames() {
    const { a, k, start, control, end } = geometry;
    const points = [{ x: a.cx, y: a.cy }];
    for (let i = 0; i <= 48; i++) points.push(quad(start, control, end, i / 48));
    points.push({ x: k.cx, y: k.cy });
    const lengths = [0];
    for (let i = 1; i < points.length; i++)
      lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const last = lengths.length - 1;
    const total = lengths[last];
    const arcFrom = lengths[1], arcTo = lengths[last - 1];
    const at = (distance) => {
      let i = 1;
      while (i < last && lengths[i] < distance) i++;
      const t = (distance - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
      return { x: lerp(points[i - 1].x, points[i].x, t), y: lerp(points[i - 1].y, points[i].y, t) };
    };
    const ghostFrames = [], traceFrames = [];
    const arcLength = trace.getTotalLength();
    let apexAt = 0.5;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const distance = eased * total;
      const p = at(distance);
      // It shrinks as it lifts off, then to the size of the card's ring; it tips, then rights.
      const scale = distance < arcFrom
        ? lerp(1, 0.82, distance / arcFrom)
        : lerp(0.82, k.w / a.w, Math.min(1, (distance - arcFrom) / (total - arcFrom)));
      ghostFrames.push({
        offset: t,
        opacity: t < 0.06 ? t / 0.06 : t > 0.9 ? (1 - t) / 0.1 : 1,
        transform: `translate(${(p.x - a.w / 2).toFixed(1)}px, ${(p.y - a.w / 2).toFixed(1)}px) rotate(${(-14 * Math.sin(Math.PI * eased)).toFixed(1)}deg) scale(${scale.toFixed(3)})`,
      });
      const drawn = Math.min(1, Math.max(0, (distance - arcFrom) / (arcTo - arcFrom)));
      traceFrames.push({ offset: t, strokeDasharray: `${arcLength} ${arcLength}`, strokeDashoffset: arcLength * (1 - drawn) });
      if (drawn < 0.5) apexAt = t;
    }
    return { ghostFrames, traceFrames, apexAt };
  }

  function play() {
    played = true;
    visibility.disconnect();
    measure();
    root.classList.remove("is-armed");
    // Pepe pops with the stage, even when his centre is still under the reveal line.
    host.classList.add("revealed");
    if (!geometry || motion.matches || !root.animate) return;
    const { ghostFrames, traceFrames, apexAt } = flightFrames();
    const apexTime = FLIGHT.delay + FLIGHT.duration * apexAt;
    ghost.style.setProperty("--coin", `${geometry.a.w}px`);
    const hidden = { opacity: 0 };
    animations = [
      // A flick: the coin dips, then lets go of its copy.
      coin.animate([{ transform: "none" }, { transform: "scale(0.9)", offset: 0.5 }, { transform: "scale(1.04)", offset: 0.8 }, { transform: "none" }], { duration: 440, easing: "ease-in-out" }),
      ghost.animate(ghostFrames, { ...FLIGHT, fill: "backwards" }),
      trace.animate(traceFrames, { ...FLIGHT, fill: "backwards" }),
      label.animate([{ ...hidden, scale: 0.6 }, { opacity: 1, scale: 1 }], { delay: apexTime - 120, duration: 420, easing: SPRING, fill: "backwards" }),
      host.animate([{ transform: "none" }, { transform: "translateY(-9px) rotate(-1.5deg)" }, { transform: "none" }], { delay: apexTime - 160, duration: 520, easing: "ease-in-out" }),
      card.animate(
        [
          { ...hidden, transform: "perspective(900px) rotateY(-80deg) scale(0.86)" },
          { opacity: 1, offset: 0.3 },
          { opacity: 1, transform: "perspective(900px) rotateY(0deg) scale(1)" },
        ],
        { delay: LANDED - 80, duration: 780, easing: "cubic-bezier(0.2, 1.25, 0.4, 1)", fill: "backwards" },
      ),
      foil.animate(
        [
          { opacity: 0, backgroundPosition: "130% 0" },
          { opacity: 1, offset: 0.25 },
          { opacity: 0, backgroundPosition: "-30% 0" },
        ],
        { delay: LANDED + 250, duration: 1200, easing: "ease-out" },
      ),
      // The payoff: "up to", then the multiple counts up to its value, pops and shines.
      upto.animate([{ ...hidden, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
        delay: LANDED + 300, duration: 380, easing: "ease-out", fill: "backwards",
      }),
      multiple.animate([{ ...hidden, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], {
        delay: COUNT.delay, duration: 420, easing: SPRING, fill: "backwards",
      }),
      multiple.animate([{ transform: "none" }, { transform: "scale(1.12)", offset: 0.4 }, { transform: "none" }], {
        delay: COUNT.delay + COUNT.duration - 40, duration: 420, easing: "ease-out",
      }),
      multiple.animate([{ backgroundPosition: "100% 0" }, { backgroundPosition: "0% 0" }], {
        delay: COUNT.delay + COUNT.duration, duration: 1000, easing: "ease-in-out",
      }),
      when.animate([{ ...hidden, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
        delay: COUNT.delay + COUNT.duration - 250, duration: 420, easing: "ease-out", fill: "backwards",
      }),
      range.animate([{ ...hidden, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
        delay: COUNT.delay + COUNT.duration - 100, duration: 420, easing: "ease-out", fill: "backwards",
      }),
    ];
    countUp(count.animate([{ opacity: 1 }, { opacity: 1 }], { ...COUNT, easing: "cubic-bezier(0.2, 0.7, 0.25, 1)", fill: "both" }));
  }

  // The count follows its own (seekable) animation, so it stays in step with the rest.
  function countUp(timer) {
    animations.push(timer);
    multiple.style.minWidth = `${multiple.offsetWidth}px`;
    const tick = () => {
      const progress = timer.effect.getComputedTiming().progress ?? 0;
      const done = timer.playState === "finished" || timer.playState === "idle";
      count.textContent = String(done ? target : Math.max(1, Math.round(target * progress)));
      counting = done ? 0 : requestAnimationFrame(tick);
    };
    tick();
  }

  function stop() {
    animations.forEach((animation) => animation.cancel());
    animations = [];
    cancelAnimationFrame(counting);
    counting = 0;
    count.textContent = String(target);
    root.classList.remove("is-armed");
  }

  const visibility = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible && entered && !played) play();
    },
    { threshold: 0.4 },
  );
  const resize = new ResizeObserver(() => measure());
  const onMotion = () => motion.matches && stop();
  let alive = true;
  if (!motion.matches) root.classList.add("is-armed");
  visibility.observe(root);
  // The stage, and its columns: a late font can move the coin without resizing the stage.
  [root, coin.parentElement, card.parentElement, host].forEach((el) => resize.observe(el));
  document.fonts?.ready.then(() => alive && measure());
  motion.addEventListener("change", onMotion);
  if (ready)
    Promise.resolve(ready)
      .catch(() => {})
      .then(() => {
        entered = true;
        if (alive && visible && !played) play();
      });

  return () => {
    alive = false;
    visibility.disconnect();
    resize.disconnect();
    motion.removeEventListener("change", onMotion);
    stop();
  };
}
