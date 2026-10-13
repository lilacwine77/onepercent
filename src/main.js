import "./styles.css";
import Lenis from "lenis";
import { startEntrance, waveTransition } from "./entrance.js";
import { initPackDisplay } from "./pack-display.js";
import { initConceptVideo, bindTelevisionPoster } from "./concept-video.js";
import { preloadCRTResources } from "./crt-resources.js";
import "./crt-hero.css";
import { initDustPays } from "./dust-pays.js";
import { initLaunchCountdown } from "./launch-countdown.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const destroyLaunchCountdown = initLaunchCountdown($("[data-countdown]"));
const lenis = new Lenis({
  autoRaf: true,
  anchors: { offset: -64 },
  smoothWheel: !motion.matches,
  duration: 1.15,
});
// Edition prices in SOL, as the machine's config prices them (PACK_EDITIONS).
const packs = [
  {
    id: "original",
    name: "The Original",
    price: "0.10 SOL",
    finish: "Polished silver × gold",
    image: "pack-silver.webp",
    description:
      "The 0.10 SOL entry, in polished silver. Four Dust Cards fed to the machine and one hit it bought. Every draw can be verified.",
  },
  {
    id: "blue",
    name: "Blue Shift",
    price: "0.25 SOL",
    finish: "Electric blue × gold",
    image: "pack-first-light.webp",
    description:
      "Step up to 0.25 SOL, in electric blue. Four Dust Cards fed to the machine and one hit it bought. Every draw can be verified.",
  },
  {
    id: "signature",
    name: "Signature",
    price: "0.50 SOL",
    finish: "Holographic foil × gold",
    image: "pack-closed.webp",
    description:
      "The 0.50 SOL pack, in our signature holographic foil. Four Dust Cards fed to the machine and one hit it bought. Every draw can be verified.",
  },
  {
    id: "after-hours",
    name: "After Hours",
    price: "1.00 SOL",
    finish: "Black anthracite × gold",
    image: "pack-anthracite.webp",
    description:
      "The 1.00 SOL pack, in black anthracite. Four Dust Cards fed to the machine and one hit it bought. Every draw can be verified.",
  },
];
const cardsRule = {
  title: "Your cards, your call.",
  copy: "Redeem: the tokens go to your wallet. Sell: the machine buys a hit now, in SOL. Feed back: a Dust Card goes back in and pays you when it’s pulled. Cards stay in My cards until you choose.",
};
// The reference reveals characters with a spring, and body copy from a mask.
$$("[data-title]").forEach((el) => {
  const html = el.innerHTML;
  let i = 0;
  el.setAttribute("aria-label", el.innerHTML.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim());
  el.innerHTML = html
    .split(/(<br\s*\/?>)/i)
    .map((part) =>
      /^<br/i.test(part)
        ? `${part} `
        : part
            .split(/(\s+)/)
            .map((word) =>
              /^\s+$/.test(word)
                ? word
                : `<span class="word" aria-hidden="true">${Array.from(word)
                    .map(
                      (c) =>
                        `<span class="char" style="--i:${i++}">${c}</span>`,
                    )
                    .join("")}</span>`,
            )
            .join(""),
    )
    .join("");
});
$$("[data-copy]").forEach((el) => {
  const span = document.createElement("span");
  span.className = "copy-inner";
  while (el.firstChild) span.append(el.firstChild);
  el.append(span);
});
let revealObserver;
function armReveals() {
  document.body.classList.add("hero-ready");
  if (revealObserver) return;
  revealObserver = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          revealObserver.unobserve(entry.target);
        }
      }),
    { rootMargin: "0px 0px -12% 0px", threshold: 0 },
  );
  $$("[data-title],[data-copy],[data-pop]").forEach((el) =>
    revealObserver.observe(el),
  );
}
const entranceReady = startEntrance({ onReveal: armReveals, onComplete: armReveals });

let television;
let artRaf;
let artResources;
let disposed = false;
const frame = $(".hero-frame"),
  header = $(".site-header"),
  televisionStage = $("#crt-stage"),
  televisionArt = televisionStage.parentElement,
  filmTrigger = $("[data-watch-film]");
const conceptVideo = initConceptVideo({
  dialog: $("#concept-video-dialog"),
  trigger: filmTrigger,
  stage: televisionStage,
  getTelevision: () => television,
  onOpen() {
    lenis.stop();
  },
  onClose() {
    if (disposed) return;
    lenis.start();
    television?.setPaused(false);
    scheduleArt();
  },
});
function watchFilm() { conceptVideo.open(filmTrigger); }
televisionStage.addEventListener("crt:activate", watchFilm);
const destroyPosterActivation = bindTelevisionPoster({
  container: televisionStage.parentElement,
  image: $(".crt-poster"),
  isActive: () => televisionStage.dataset.ready !== "true" && !conceptVideo.isOpen,
  onActivate: watchFilm,
});
function updateTelevisionPresentation() {
  if (disposed) return;
  const ready = televisionStage.dataset.ready === "true" && !televisionStage.hidden;
  televisionArt.classList.toggle("is-crt-ready", ready);
}
televisionStage.addEventListener("crt:ready", updateTelevisionPresentation);
televisionStage.addEventListener("crt:error", updateTelevisionPresentation);
async function initArt() {
  try {
    if (conceptVideo.isOpen || !artVisible) { artStarted = false; return; }
    const { CRTTelevision } = await import("./crt-tv.js");
    if (disposed) return;
    if (conceptVideo.isOpen || !artVisible) { artStarted = false; return; }
    television = new CRTTelevision({
      container: televisionStage,
      reducedMotion: motion.matches,
      resources: artResources,
    });
    television.setPaused(conceptVideo.isOpen);
    artObserver.disconnect();
    window.crtTelevision = television;
    await television.ready;
    if (disposed) return;
    updateTelevisionPresentation();
  } catch (error) {
    television?.destroy();
    televisionStage.hidden = true;
    updateTelevisionPresentation();
    console.error("Could not load the television; showing its poster:", error);
  }
}
// Keep GPU setup out of the entrance, and skip the hero scene when the page
// opens directly at #packs. Its matching poster remains immediately available.
let artEntranceComplete = false;
let artVisible = false;
let artStarted = false;
function scheduleArt() {
  // Download bytes while the entrance runs; decoding and GPU setup stay deferred.
  // Direct section links do not fetch the offscreen hero until it is visited.
  if (!disposed && artVisible && !artResources &&
      (artEntranceComplete || !location.hash || location.hash === '#home')) {
    artResources = preloadCRTResources();
  }
  if (disposed || artStarted || !artEntranceComplete || !artVisible || conceptVideo.isOpen) return;
  artStarted = true;
  artRaf = requestAnimationFrame(initArt);
}
const artObserver = new IntersectionObserver(([entry]) => {
  artVisible = entry.isIntersecting;
  scheduleArt();
});
artObserver.observe(televisionStage);
entranceReady.then(async () => {
  // Returning visits skip the loader, but still reveal the hero. Keep GPU work
  // after the poster settles so startup cannot interrupt or mismeasure it.
  await Promise.allSettled(televisionArt.getAnimations().map(animation => animation.finished));
  if (disposed) return;
  artEntranceComplete = true;
  scheduleArt();
});
let scrollRaf;
function updateScroll() {
  scrollRaf = 0;
  header.classList.toggle("is-fixed", frame.getBoundingClientRect().top < -1);
  $$('.section-intro h2').forEach(el=>{
    const top=el.getBoundingClientRect().top;
    const wipe=motion.matches?1:clamp((innerHeight*.7-top)/(innerHeight*.7));
    el.style.setProperty('--wipe-y',`${wipe*200}%`);
    el.style.setProperty('--wipe-angle',`${wipe*-10}deg`);
  });
}
function scheduleScroll() {
  if (!scrollRaf) scrollRaf = requestAnimationFrame(updateScroll);
}
lenis.on("scroll", scheduleScroll);
addEventListener("scroll", scheduleScroll, { passive: true });
addEventListener("resize", scheduleScroll);
function onMotionChange() {
  lenis.options.smoothWheel = !motion.matches;
  television?.setReducedMotion(motion.matches);
  updateTelevisionPresentation();
  scheduleScroll();
}
motion.addEventListener("change", onMotionChange);
updateScroll();
function replay() {
  lenis.scrollTo(0, { immediate: true });
  television?.replay();
}
$$(".replay").forEach((el) => el.addEventListener("click", replay));
$("#replay-intro").addEventListener("click", () => {
  try {
    sessionStorage.removeItem("onepercent-v2-seen");
  } catch {}
  location.href = location.pathname;
});

const toggle = $(".menu-toggle"),
  menu = $("#mobile-menu");
function closeMenu() {
  menu.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Open menu");
}
toggle.addEventListener("click", () => {
  const open = menu.hidden;
  menu.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
});
$$("#mobile-menu a").forEach((a) => a.addEventListener("click", closeMenu));
addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

const dialog = $("#pack-detail");
let detailOpener;
let detailOpen = false;
let detailClosing = false;
let detailActionTarget;
async function showDetail(data, opener) {
  if (detailOpen || detailClosing) return;
  detailOpen = true;
  detailOpener = opener;
  lenis.stop();
  try {
    await waveTransition(() => {
    $("#detail-title").textContent = data.name;
    $("#detail-price").textContent = data.price || data.subtitle;
    $("#detail-description").textContent = data.description;
    $("#detail-rule-title").textContent = data.ruleTitle || cardsRule.title;
    $("#detail-rule-copy").textContent = data.ruleCopy || cardsRule.copy;
    const actionLabel = data.actionLabel || "Back to the TV";
    $(".detail-preview > span").innerHTML = `${actionLabel} <b>→</b>`;
    detailActionTarget = data.actionTarget || null;
    $("#detail-image").src = `/assets/${data.image}`;
    $("#detail-image").alt = data.name;
    dialog.showModal();
    dialog.scrollTop = 0;
    $(".detail-close").focus({ preventScroll: true });
    });
  } catch (error) {
    if (dialog.open) dialog.close();
    detailOpen = false;
    lenis.start();
    console.error("Could not open pack details:", error);
  }
}
async function closeDetail(preview = false) {
  if (!detailOpen || detailClosing) return;
  detailClosing = true;
  try {
    await waveTransition(() => {
      dialog.close();
      detailOpen = false;
      lenis.start();
      if (preview && detailActionTarget) lenis.scrollTo(detailActionTarget, { offset: -64 });
      else if (preview) replay();
      else detailOpener?.focus({ preventScroll: true });
    });
  } catch (error) {
    if (dialog.open) dialog.close();
    console.error("Could not close pack details:", error);
  } finally {
    detailClosing = false;
    if (!dialog.open) {
      detailOpen = false;
      lenis.start();
    }
  }
}
$(".detail-close").addEventListener("click", () => closeDetail());
$(".detail-preview").addEventListener("click", () => closeDetail(true));
dialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDetail();
});
function openPack(pack, opener) {
  return showDetail(pack, opener);
}
const destroyPackDisplay = initPackDisplay({
  ready: entranceReady,
  container: $("#product-grid"),
  packs,
  onSelect: openPack,
});
const destroyDustPays = initDustPays({ ready: entranceReady });

const info = {
  packs: {
    name: "Rip a pack.",
    subtitle: "Every pack: 4 Dust Cards + 1 hit.",
    image: "pack-closed.webp",
    description:
      "Pick a pack for your budget: 0.10, 0.25, 0.50 or 1.00 SOL. Four Dust Cards fed to the machine and one hit it bought. Every card lands in My cards. Pick what it becomes.",
    ruleTitle: "Go for the 1%.",
    ruleCopy:
      "Jackpot: 5% of every pack fills the pot, held in $1PCT. The Jackpot hit takes the whole pot. The 1%: four cards of 10,000,000 $1PCT, 1% of the supply each, released through the season. 1% is the size of the prize, not its odds.",
    actionLabel: "Explore the packs",
    actionTarget: "#packs",
  },
  supply: {
    name: "Feed the machine.",
    subtitle: "Your dust becomes Dust Cards.",
    image: "pepe-mascot-white.webp",
    description:
      "Each bag you feed becomes a Dust Card. When a pack pulls it, you get 2% of that pack’s price in SOL. Take any card back until it’s pulled.",
    ruleTitle: "Which bags?",
    ruleCopy:
      "Tokens born on pump.fun, bought with a swap (airdrops don’t count) and held at the season’s snapshot. Once a pack pulls your card, its tokens go to that pack’s opener. You sign everything.",
    actionLabel: "Explore the packs",
    actionTarget: "#packs",
  },
};
$$("[data-info]").forEach((el) =>
  el.addEventListener("click", () => {
    closeMenu();
    showDetail(info[el.dataset.info], el);
  }),
);

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposed = true;
    conceptVideo.destroy();
    destroyPosterActivation();
    television?.destroy();
    delete window.crtTelevision;
    destroyPackDisplay?.();
    destroyDustPays();
    destroyLaunchCountdown();
    lenis.destroy();
    revealObserver?.disconnect();
    artObserver.disconnect();
    removeEventListener("scroll", scheduleScroll);
    removeEventListener("resize", scheduleScroll);
    motion.removeEventListener("change", onMotionChange);
    televisionStage.removeEventListener("crt:ready", updateTelevisionPresentation);
    televisionStage.removeEventListener("crt:error", updateTelevisionPresentation);
    televisionStage.removeEventListener("crt:activate", watchFilm);
    cancelAnimationFrame(artRaf);
    cancelAnimationFrame(scrollRaf);
  });
