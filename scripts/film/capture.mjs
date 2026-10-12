#!/usr/bin/env node
/**
 * Captures the real app flows frame by frame under virtual time.
 *
 *   git apply scripts/film/capture-hooks.patch   # demo hooks (never committed)
 *   cd app/apps/web && VITE_PREVIEW=1 VITE_API_URL=https://<preview-host> pnpm dev
 *   node scripts/film/capture.mjs --profile desktop      --out <cap>/desktop --only rows,dustcards,hitcard,hits
 *   node scripts/film/capture.mjs --profile desktop-tall --out <cap>/desktop-tall --only rip-tap
 *   node scripts/film/capture.mjs --profile mobile       --out <cap>/mobile
 *   git apply -R scripts/film/capture-hooks.patch
 *
 * Every clip is a numbered WebP sequence plus clip.json (pointer presses, and the
 * Rip module's beats and sound cues with their frame numbers), at 60 frames per
 * virtual second. Stills (bag rows and coins, Dust Card and hit card faces) are
 * PNG with transparency. The X-ray is the preview API's live scan of the wallet.
 */
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CLEAN_CSS, Recorder, launch, pressFrames, tapFrames, sleep, PROFILES } from "./lib/kit.mjs";

const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "desktop" },
    out: { type: "string" },
    only: { type: "string" },
    base: { type: "string", default: "http://localhost:5173" },
    wallet: { type: "string", default: "J4aGiHemVzcxxjcwMKm77A9uUpB4Yf32KbEBrwtKG31a" },
    // The bags the film shows: real pump.fun dust from a live X-ray (see the fixture).
    fixture: { type: "string", default: new URL("./fixtures/dust-bags.json", import.meta.url).pathname },
    // Optional folder of logo files named by mint, served for /api/logo/:mint.
    logos: { type: "string" },
  },
});
const FIXTURE = JSON.parse(await readFile(values.fixture, "utf8"));
if (!values.out) throw new Error("--out <dir> is required");
const profile = values.profile;
const mobile = profile === "mobile";
const only = values.only ? new Set(values.only.split(",")) : null;
const want = (name) => !only || only.has(name);
const url = (path) => `${values.base}${path}`;
const VIEW = PROFILES[profile].viewport;
// Tall pages (Feed, My cards) are captured whole; the compositor frames them.
const TALL = mobile ? { width: VIEW.width, height: 1460 } : { width: VIEW.width, height: 1500 };

const { browser, page, cdp } = await launch(profile, {
  init: [
    () => {
      try {
        localStorage.setItem("onepercent.rip.reveal", "auto");
        localStorage.setItem("onepercent.rip.turbo", "off");
      } catch {
        /* ignore */
      }
    },
  ],
});

if (values.logos)
  await page.route("**/api/logo/*", async (route) => {
    const mint = new URL(route.request().url()).pathname.split("/").pop();
    const file = join(values.logos, mint);
    if (!existsSync(file)) return route.continue();
    const body = await readFile(file);
    const type = body[0] === 0x89 ? "image/png" : body[0] === 0x52 ? "image/webp" : "image/jpeg";
    await route.fulfill({ status: 200, body, headers: { "Content-Type": type, "Cache-Control": "max-age=3600" } });
  });

const HIDE = `${CLEAN_CSS} .demo-badge, .demo-panel { display: none !important; }`;
// App chrome the film does not need (status pills, tips, pips, Skip, Verify,
// Share, docks, nav), hidden only while a clip records.
const HIDDEN = (list) => `${list.join(", ")} { visibility: hidden !important; }`;
const RIP_CHROME = [".rip-caption", ".rip-pips", ".rip-btn.rip-reveal-all", ".rip-btn.rip-skip", ".rip-tip", ".rip-notice", ".rip-verify", ".rip-btn.is-share"];
const CHROME = {
  rip: HIDDEN([...RIP_CHROME, ".app-header", ".rip-dock.is-compact"]),
  hits: HIDDEN([...RIP_CHROME, ".app-header"]) + " .rip-dock { opacity: 0 !important; }",
  jackpot: HIDDEN([...RIP_CHROME, ".app-header", ".rip-counter"]) + " .rip-dock { opacity: 0 !important; }",
};
async function chrome(cssText) {
  await page.evaluate((text) => {
    let tag = document.getElementById("film-chrome");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "film-chrome";
      document.head.append(tag);
    }
    tag.textContent = text;
  }, cssText ?? "");
}
async function open(path, settle = 6000) {
  await page.goto(url(path), { waitUntil: "load", timeout: 120000 });
  await page.addStyleTag({ content: HIDE });
  await sleep(settle);
}

// The demo machine's state, as demo/store.ts persists it (bigints as "123n").
const big = (value) => `${value}n`;
const lamports = (sol) => {
  const [whole = "0", fraction = ""] = String(sol).split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0").slice(0, 9));
};
/** The film's bags (fixture: a live X-ray's pump.fun dust with executable quotes), in order. */
async function quotedBags() {
  return FIXTURE.bags.map((bag) => ({
    mint: bag.mint,
    symbol: bag.symbol.replace(/^\$+/, ""),
    name: bag.name,
    logo: `/api/logo/${bag.mint}`,
    amountUi: bag.amountUi,
    decimals: bag.decimals ?? 0,
    valueLamports: big(lamports(bag.valueSol)),
    drawdownPct: null,
    kind: bag.reasonCode === "snapshot_at_feed" ? "checkAtFeed" : "feedable",
  }));
}
async function setDemo(patch) {
  await page.goto(url("/"), { waitUntil: "load" });
  const state = {
    address: values.wallet,
    source: "xray",
    lamports: big(3_200_000_000n),
    bags: [],
    empties: [],
    deck: [],
    cards: [],
    history: [],
    seq: 48231,
    pulls: 0,
    fed: 0,
    ...patch,
  };
  await page.evaluate((json) => {
    localStorage.setItem("onepercent.demo.v2", json);
    localStorage.setItem("onepercent.demo.seen", "1");
    // The demo wallet connects itself on a first visit only: connect it here.
    localStorage.setItem("onepercent.wallet", "Demo Wallet");
  }, JSON.stringify(state));
}

async function ripReady() {
  await page.waitForFunction(() => !!window.__rip, null, { timeout: 60000 });
  await sleep(4500);
  await page.evaluate(() => {
    window.__events = [];
    const push = (kind, value, index) =>
      window.__events.push({ t: performance.now(), kind, value, index: index ?? null });
    window.__rip.on("beat", (beat) => push("beat", beat));
    window.__rip.on("sound", ({ cue, index }) => push("cue", cue, index));
  });
}

/** Rip events since the recorder started, as frame numbers. */
async function ripEvents(rec) {
  const events = await page.evaluate(() => window.__events.splice(0));
  for (const e of events)
    rec.events.push({
      frame: Math.round(((e.t - rec.t0) * rec.fps) / 1000),
      ms: Math.round((e.t - rec.t0) * 10) / 10,
      label: `${e.kind}:${e.value}`,
      index: e.index,
    });
}

const press = (rec, locator, opts) =>
  mobile ? tapFrames(rec, locator, { hold: 3 }) : pressFrames(rec, locator, opts);

async function setTier(tier, hit = "WIF") {
  // The pack's four Dust Cards are the film's bags (fed by the demo wallet).
  const dust = (await quotedBags()).map((bag) => ({
    mint: bag.mint,
    symbol: bag.symbol,
    name: bag.name,
    logo: bag.logo,
    amountUi: bag.amountUi,
    valueLamports: bag.valueLamports,
    fedBy: values.wallet,
  }));
  await page.evaluate(
    ([t, h, d]) => {
      globalThis.__filmTier = t;
      globalThis.__filmHit = h;
      globalThis.__filmDust = d.map((c) => ({ ...c, valueLamports: BigInt(c.valueLamports.slice(0, -1)) }));
    },
    [tier, hit, dust],
  );
}

async function ensureRip() {
  const ready = await page.evaluate(() => !!window.__rip && location.pathname === "/rip").catch(() => false);
  if (ready) return;
  await setDemo({});
  await open("/rip", 3000);
  await ripReady();
}

/** Element stills with transparency (page background removed), padded for shadows. */
async function elementStills(dir, selector, pad = 36) {
  await mkdir(dir, { recursive: true });
  await page.addStyleTag({
    content:
      "html, body, #root, main, .app-shell, .app-main, .feed-page, .mc-main, .mc-board { background: transparent !important; } .app-header { visibility: hidden !important; }",
  });
  await page.evaluate(() => document.body.classList.add("film-still"));
  await sleep(600);
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, text: el.textContent.trim().slice(0, 60) };
    }),
  );
  const out = [];
  for (const [i, box] of boxes.entries()) {
    const clip = { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
    const file = join(dir, `${String(i).padStart(2, "0")}.png`);
    await page.screenshot({ path: file, clip, omitBackground: true, scale: "device", fullPage: true });
    out.push({ file, pad, ...box });
  }
  await writeFile(join(dir, "stills.json"), JSON.stringify(out, null, 2));
  return out;
}

const clips = {
  /** The X-rayed bags with a quote, as the Feed lists them (stills, transparent). */
  async rows(dir) {
    const bags = await quotedBags();
    await setDemo({ bags });
    await page.setViewportSize(TALL);
    await open("/feed", 7000);
    await page.screenshot({ path: join(dir, "page.png"), scale: "device" });
    await elementStills(join(dir, "rows"), ".feed-group .feed-row", 18);
    await elementStills(join(dir, "coins"), ".feed-group .feed-row .feed-coin", 10);
    await page.setViewportSize(VIEW);
  },

  /** The same bags as Dust Cards, as My cards draws them (stills, transparent). */
  async dustcards(dir) {
    const bags = await quotedBags();
    const cards = bags.map((bag, i) => ({
      mint: bag.mint,
      symbol: bag.symbol,
      name: bag.name,
      logo: bag.logo,
      cardId: `48231:dust:${bag.mint}:${bag.amountUi}:${i + 1}`,
      kind: "dust",
      edition: "original",
      seq: "48231",
      amountUi: bag.amountUi,
      valueLamports: bag.valueLamports,
      stockedLamports: null,
      sellBackLamports: null,
      fedBy: values.wallet,
    }));
    await setDemo({ bags: [], cards });
    await page.setViewportSize(TALL);
    await open("/cards", 8000);
    await elementStills(join(dir, "cards"), ".mc-grid .mc-card", 40);
    await page.setViewportSize(VIEW);
  },

  /** The Holo Foil 4× $WIF hit as My cards draws it (still, transparent). */
  async hitcard(dir) {
    const WIF = { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat" };
    // Holo Foil = 4× the 0.10 SOL Original price; Sell back pays 87% of it.
    const value = 400_000_000n;
    const card = {
      ...WIF,
      logo: `/api/logo/${WIF.mint}`,
      cardId: `48231:holo:${WIF.mint}:${value}:0`,
      kind: "holo",
      edition: "original",
      seq: "48231",
      amountUi: "206",
      valueLamports: big(value),
      stockedLamports: big(value),
      sellBackLamports: big((value * 8700n) / 10000n),
    };
    await setDemo({ bags: [], cards: [card] });
    await page.setViewportSize(TALL);
    await open("/cards", 8000);
    await elementStills(join(dir, "card"), ".mc-grid .mc-card", 40);
    await page.setViewportSize(VIEW);
  },

  /** The 1% card as My cards draws it (still, transparent). */
  async onepctcard(dir) {
    const card = {
      mint: "4PmtUq695XbiJoCoVtiPTgpJV4Krq99jStZjHBvQdjTF",
      symbol: "1PCT",
      name: "Onepercent",
      logo: null,
      cardId: "48231:one_pct:4PmtUq695XbiJoCoVtiPTgpJV4Krq99jStZjHBvQdjTF:one_pct:0",
      kind: "one_pct",
      edition: "original",
      seq: "48231",
      amountUi: "10000000",
      valueLamports: big(1n),
      stockedLamports: null,
      sellBackLamports: null,
    };
    await setDemo({ bags: [], cards: [card] });
    await page.setViewportSize(TALL);
    await open("/cards", 8000);
    await elementStills(join(dir, "card"), ".mc-grid .mc-card", 40);
    await page.setViewportSize(VIEW);
  },

  /**
   * The Rip in tap mode: the four Dust Cards turn on the score's beats and the
   * hit is tapped so it explodes on the accent (taps scheduled from the tear).
   */
  async "rip-tap"(dir) {
    await setDemo({});
    await open("/rip", 3000);
    await ripReady();
    await page.getByRole("radio", { name: /Tap to reveal/ }).first().click();
    await sleep(600);
    await setTier("holo", "WIF");
    await chrome(CHROME.rip);
    await sleep(300);
    const rec = await new Recorder(page, cdp, dir).start();
    await rec.frames(30);
    rec.mark("press");
    await press(rec, page.getByRole("button", { name: /Rip 1/ }), { approach: 16, hold: 6 });
    rec.mark("released");
    let tear = null;
    while (tear === null) {
      await rec.frame();
      tear = await page.evaluate(() => window.__events.find((e) => e.value === "tear")?.t ?? null);
      if (rec.index > 1200) throw new Error("no tear");
    }
    // Dust taps (each flip snaps on a beat), offsets from the tear in s; the hit is
    // tapped as soon as it can be picked (the fifth "pick" beat).
    const plan = (process.env.FILM_TAPS ?? "1.033,1.517,2.0,2.483").split(",").map((v) => tear + Number(v) * 1000);
    const cardsOnScreen = () =>
      page.evaluate(() => {
        const rip = window.__rip;
        const r = rip.root.getBoundingClientRect();
        return rip.cards.map((c) => {
          const v = c.mesh.getWorldPosition(c.root.position.clone()).project(rip.camera);
          return { index: c.index, x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
        });
      });
    const picks = () => page.evaluate(() => window.__events.filter((e) => e.value === "pick").length);
    let order = null;
    let k = 0;
    let hitAt = null;
    while (hitAt === null || rec.now < hitAt + 4200) {
      const due = k < plan.length ? rec.now >= plan[k] && (await picks()) >= 1 : k === plan.length && (await picks()) >= 5;
      if (due) {
        if (!order) {
          const spots = (await cardsOnScreen()).sort((a, b) => a.x - b.x || a.y - b.y);
          const mid = spots.splice(Math.floor(spots.length / 2), 1)[0];
          order = [...spots, mid];
          rec.mark("spots", { spots: order });
        }
        const spot = order[k];
        rec.mark(k < 4 ? "tap:dust" : "tap:hit", { x: spot.x, y: spot.y });
        if (mobile) await page.touchscreen.tap(spot.x, spot.y);
        else {
          await page.mouse.move(spot.x, spot.y);
          await page.mouse.down();
          await page.mouse.up();
        }
        if (k === 4) hitAt = rec.now;
        k += 1;
      }
      await rec.frame();
      if (rec.index > 1500) throw new Error("rip-tap ran too long");
    }
    await ripEvents(rec);
    await rec.save({ tear });
    await page.evaluate(() => window.__vt.thaw());
    await chrome("");
    await page.evaluate(() => {
      window.__rip.setRevealMode("auto");
      localStorage.setItem("onepercent.rip.reveal", "auto");
    });
  },

  /** The 1% and the Jackpot pulls, from the press to the end state. */
  async hits(dir) {
    await ensureRip();
    for (const tier of ["one_pct", "jackpot"]) {
      await setTier(tier, "WIF");
      await page.evaluate(() => window.__rip.reset());
      await sleep(2500);
      await chrome(tier === "jackpot" ? CHROME.jackpot : CHROME.hits);
      await sleep(300);
      const rec = await new Recorder(page, cdp, join(dir, tier)).start();
      await rec.frames(6);
      rec.mark("press");
      await press(rec, page.getByRole("button", { name: /Rip again|Rip 1/ }), { approach: 8, hold: 5 });
      rec.mark("released");
      await rec.frames(60 * 11.5);
      await ripEvents(rec);
      await rec.save({ tier });
      await page.evaluate(() => window.__vt.thaw());
      await chrome("");
      await sleep(1500);
    }
  },
};

try {
  for (const [name, run] of Object.entries(clips)) {
    if (!want(name)) continue;
    const started = Date.now();
    console.log(`clip ${name}…`);
    await mkdir(join(values.out, name), { recursive: true });
    await run(join(values.out, name));
    console.log(`clip ${name} done in ${Math.round((Date.now() - started) / 1000)} s`);
  }
} finally {
  await browser.close();
}
