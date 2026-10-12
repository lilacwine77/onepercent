#!/usr/bin/env node
/**
 * Plays the film in both 3D TV players (the landing and the app's home) and
 * records what a viewer sees: screenshots during natural playback, the media
 * requests, the end, the captions and the return to the idle TV.
 *
 *   npm run build && npm run preview            # landing on 127.0.0.1:4173
 *   (the app's dev server on localhost:5173)
 *   node scripts/verify-film-players.mjs --out artifacts/film-tv-v10/players
 *        [--only landing,app] [--views desktop,touch] [--version 10]
 *
 * One headless Chrome (Chrome for Testing, GPU, muted), one context at a time.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    landing: { type: "string", default: "http://127.0.0.1:4173" },
    app: { type: "string", default: "http://localhost:5173" },
    only: { type: "string", default: "landing,app" },
    views: { type: "string", default: "desktop,touch" },
    version: { type: "string", default: "10" },
    seconds: { type: "string", default: "25" },
  },
});
if (!values.out) throw new Error("--out <dir> is required");
const out = resolve(values.out);
const FILM_SECONDS = Number(values.seconds);
// Natural-playback screenshots: X-ray, Feed, the ROI card, the Rip close-up,
// the Dust Cards, the hit, the Sell, The 1%, then the end card (held to the end).
const MARKS = [0.5, 2.5, 5.2, 7.4, 8.2, 12.2, 14.6, 18.6, 21, 24.5];
// A time inside a caption cue ("4 Dust Cards + 1 hit", 11 to 14 s).
const CAPTION_AT = 12;
const EM_DASH = String.fromCharCode(0x2014);

function load(name) {
  const bases = [
    join(repo, "package.json"),
    join(repo, "app/apps/web/package.json"),
    join(repo, `app/node_modules/.pnpm/${name}@1.63.0/node_modules/${name}/package.json`),
  ];
  for (const base of bases) {
    try {
      return createRequire(base)(name);
    } catch {
      /* next */
    }
  }
  return null;
}
const { chromium } = load("playwright-core");
const sharp = load("sharp");

const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  touch: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const PLAYERS = {
  landing: {
    url: values.landing,
    // Where each file must come from.
    media: { mp4: "/media/", webp: "/media/", vtt: "/media/" },
    init: () => {
      try {
        sessionStorage.setItem("onepercent-v2-seen", "1");
      } catch {
        /* private mode */
      }
    },
    ready: () =>
      !!window.crtTelevision?.renderReady && document.querySelector("#crt-stage")?.dataset.ready === "true",
    tv: "#crt-stage",
    s: {
      watch: "[data-watch-film]",
      dialog: "#concept-video-dialog",
      video: "#concept-film",
      play: "[data-film-play]",
      replay: "[data-film-replay]",
      close: "[data-concept-close]",
      captions: "[data-film-captions]",
      caption: "[data-film-caption]",
      stage: "#crt-stage",
    },
  },
  app: {
    url: values.app,
    media: { mp4: "/landing/", webp: "/landing/", vtt: "/experience/home/" },
    init: () => {
      try {
        sessionStorage.setItem("onepercent.intro", "1");
      } catch {
        /* private mode */
      }
    },
    ready: () =>
      !!document.querySelector(".hero-tv.is-live") && !!document.querySelector("button.hero-film"),
    tv: ".hero-tv",
    s: {
      watch: "button.hero-film",
      dialog: "dialog.film",
      video: "dialog.film video",
      play: "dialog.film .film__buttons > button:nth-of-type(1)",
      replay: "dialog.film .film__buttons > button:nth-of-type(2)",
      close: "dialog.film .film__close",
      captions: "dialog.film .film__buttons > button:nth-of-type(4)",
      caption: "dialog.film .film__caption",
      stage: ".crt-stage",
    },
  },
};

/** Media events on any <video>, the click, dialog states and long tasks, with page timestamps. */
function probe() {
  const film = (window.__film = { events: [], longTasks: [] });
  const push = (name, extra = {}) => film.events.push({ name, at: Math.round(performance.now()), ...extra });
  const names = ["loadedmetadata", "loadeddata", "play", "playing", "pause", "seeked", "waiting", "stalled", "ended", "error"];
  for (const name of names)
    document.addEventListener(
      name,
      (event) => {
        const video = event.target;
        if (video instanceof HTMLVideoElement) push(name, { time: video.currentTime, ready: video.readyState });
      },
      true,
    );
  document.addEventListener("click", () => push("click"), true);
  new MutationObserver((records) => {
    for (const record of records)
      if (record.target instanceof HTMLDialogElement)
        push(`dialog:${record.target.open ? (record.target.dataset.state ?? "open") : "closed"}`);
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["open", "data-state"] });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        film.longTasks.push({ at: Math.round(entry.startTime), ms: Math.round(entry.duration) });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    /* no long task timing */
  }
}

/** The player's state, as the page sees it (window.crtTelevision is the landing's TV). */
function snapshot(s) {
  const dialog = document.querySelector(s.dialog);
  const video = document.querySelector(s.video);
  const stage = document.querySelector(s.stage);
  const track = video?.querySelector("track");
  const tv = window.crtTelevision;
  return {
    now: Math.round(performance.now()),
    dialog: dialog && { open: dialog.open, state: dialog.dataset.state ?? null, mode: dialog.dataset.mode ?? null },
    video: video && {
      src: video.currentSrc,
      poster: video.getAttribute("poster"),
      time: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      ended: video.ended,
      seeking: video.seeking,
      ready: video.readyState,
      width: video.videoWidth,
      height: video.videoHeight,
      error: video.error?.message ?? null,
    },
    track: track && {
      src: track.getAttribute("src"),
      ready: track.readyState,
      cues: [...(track.track.cues ?? [])].map((cue) => ({ start: cue.startTime, end: cue.endTime, text: cue.text })),
    },
    controls: {
      play: document.querySelector(s.play)?.textContent.trim() ?? null,
      replayDisabled: document.querySelector(s.replay)?.disabled ?? null,
    },
    stageInDialog: !!(dialog && stage && dialog.contains(stage)),
    stageReady: stage?.dataset.ready ?? null,
    filmOpenClass: !!document.querySelector(".is-film-open"),
    rootOverflow: document.documentElement.style.overflow,
    tv: tv
      ? {
          filmActive: tv.isFilmActive,
          phase: tv.film?.phase ?? null,
          reveal: tv.film?.revealPhase ?? null,
          mix: tv.uniforms?.video?.value ?? null,
          heroMap: !tv.screenMesh?.material?.map?.isVideoTexture,
          camera: tv.camera?.position?.toArray() ?? null,
          zoom: tv.camera?.zoom ?? null,
        }
      : null,
  };
}

/** The video's current frame as a 32 × 18 luma grid; `dark` is the share below 16, `bright` above 60. */
function sampleFrame(selector) {
  const video = document.querySelector(selector);
  if (!video || video.readyState < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 18;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, 0, 0, 32, 18);
  const { data } = context.getImageData(0, 0, 32, 18);
  const luma = [];
  for (let i = 0; i < data.length; i += 4)
    luma.push(Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]));
  return {
    time: video.currentTime,
    mean: luma.reduce((a, b) => a + b, 0) / luma.length,
    dark: luma.filter((value) => value < 16).length / luma.length,
    bright: luma.filter((value) => value > 60).length / luma.length,
    luma,
  };
}
const distance = (a, b) =>
  a && b ? a.luma.reduce((sum, value, i) => sum + Math.abs(value - b.luma[i]), 0) / a.luma.length : null;
const summary = (frame) =>
  frame && { time: round(frame.time), mean: round(frame.mean), dark: round(frame.dark), bright: round(frame.bright) };
const round = (value, digits = 3) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value);

/** Mean absolute difference of two screenshots inside one box (CSS px). */
async function regionDifference(a, b, box, scale) {
  if (!sharp || !box) return null;
  const { width, height } = await sharp(a).metadata();
  const left = Math.max(0, Math.round(box.x * scale));
  const top = Math.max(0, Math.round(box.y * scale));
  const region = {
    left,
    top,
    width: Math.min(width, Math.round((box.x + box.width) * scale)) - left,
    height: Math.min(height, Math.round((box.y + box.height) * scale)) - top,
  };
  if (region.width < 8 || region.height < 8) return null;
  const read = (file) => sharp(file).extract(region).removeAlpha().raw().toBuffer();
  const [x, y] = await Promise.all([read(a), read(b)]);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

async function media(file) {
  try {
    const bytes = await readFile(file);
    return { file: file.replace(repo + "/", ""), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    return { file: file.replace(repo + "/", ""), error: error.code };
  }
}

async function play(browser, name, viewName) {
  const player = PLAYERS[name];
  const view = VIEWS[viewName];
  const { s } = player;
  const result = {
    player: name,
    view: viewName,
    url: player.url,
    checks: {},
    shots: [],
    errors: [],
    ignoredErrors: [],
    httpErrors: [],
    requests: [],
  };
  const context = await browser.newContext({ ...view });
  await context.addInitScript(player.init);
  await context.addInitScript(probe);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const source = message.location()?.url ?? "";
    const text = `${message.text().slice(0, 300)}${source ? ` (${source.replace(player.url, "")})` : ""}`;
    // The browser's own favicon probe is not the page's doing (the app ships none).
    if (/\/favicon\.ico$/.test(source)) result.ignoredErrors.push(text);
    else result.errors.push(text);
  });
  page.on("pageerror", (error) => result.errors.push(`pageerror: ${error.message.slice(0, 300)}`));
  const strip = (url) => url.replace(player.url, "");
  page.on("response", (response) => {
    if (/onepercent-explained\./.test(response.url()))
      result.requests.push({ url: strip(response.url()), status: response.status() });
    if (response.status() >= 400) result.httpErrors.push({ url: strip(response.url()), status: response.status() });
  });
  page.on("requestfailed", (request) => {
    if (/onepercent-explained\./.test(request.url()))
      result.requests.push({ url: strip(request.url()), failed: request.failure()?.errorText ?? "failed" });
  });
  const now = () => page.evaluate(() => performance.now());
  const state = () => page.evaluate(snapshot, s);
  const frame = () => page.evaluate(sampleFrame, s.video);
  async function shot(label, extra = {}) {
    const file = `${name}-${viewName}-${label}.jpg`;
    const before = await page.evaluate((selector) => document.querySelector(selector)?.currentTime ?? null, s.video);
    await page.screenshot({ path: join(out, file), type: "jpeg", quality: 85 });
    const after = await page.evaluate((selector) => document.querySelector(selector)?.currentTime ?? null, s.video);
    result.shots.push({ label, file, filmTime: before === null ? null : [round(before), round(after)], ...extra });
    return join(out, file);
  }
  try {
    await page.goto(player.url, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction(player.ready, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const tvBox = await page.locator(player.tv).boundingBox();
    result.before = await state();
    const idle = await shot("idle");
    const requestsBeforeOpen = result.requests.length;

    const watch = page.locator(s.watch);
    await watch.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    // Raw input at the button's centre: no actionability wait between the
    // press and the timeline below (clicks are timed in the page).
    const box = await watch.boundingBox();
    const clickedAt = await now();
    if (view.hasTouch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const sinceClick = () =>
      page.evaluate(() => Math.round(performance.now() - window.__film.events.find((e) => e.name === "click").at));
    await page.waitForFunction(() => window.__film.events.some((e) => e.name === "click"), null, { timeout: 5000 });
    // Mid-zoom: the TV comes forward over 900 ms, still showing Pepe.
    await page.waitForFunction(
      () => performance.now() - window.__film.events.find((e) => e.name === "click").at >= 450,
      null,
      { timeout: 5000, polling: "raf" },
    );
    await shot("zoom", { msAfterClick: await sinceClick() });
    // The 400 ms fade from Pepe to the first frame (the landing's TV reports it).
    await page.waitForFunction(
      ({ dialog, video }) => {
        const d = document.querySelector(dialog);
        const v = document.querySelector(video);
        const tv = window.crtTelevision;
        if (d?.dataset.state === "playing") return true;
        if (tv) return tv.film?.revealPhase === "fading";
        return d?.dataset.state === "preparing" && v?.readyState >= 2 && !v.seeking;
      },
      s,
      { timeout: 30000, polling: "raf" },
    );
    await page.waitForTimeout(150);
    await shot("fade", { msAfterClick: await sinceClick() });
    await page.waitForFunction(
      ({ dialog, video }) => {
        const d = document.querySelector(dialog);
        const v = document.querySelector(video);
        return d?.open && d.dataset.state === "playing" && !v.paused && v.currentTime > 0.03;
      },
      s,
      { timeout: 30000, polling: "raf" },
    );
    result.playing = await state();
    await shot("power-on");
    let card = null;
    for (const mark of MARKS) {
      await page.waitForFunction(
        ({ video, mark }) => {
          const v = document.querySelector(video);
          return v.currentTime >= mark || v.ended;
        },
        { video: s.video, mark },
        { timeout: 45000, polling: "raf" },
      );
      await shot(`t${String(mark).replace(".", "_")}s`, { mark });
      if (mark === MARKS.at(-1)) card = await frame();
    }
    await page.waitForFunction((selector) => document.querySelector(selector).ended, s.video, { timeout: 30000 });
    await page.waitForTimeout(1500);
    result.ended = await state();
    const last = await frame();
    await shot("ended");
    result.endCard = { lastMark: summary(card), last: summary(last), distance: round(distance(card, last)) };

    // Captions on, parked inside a cue (the Dust Cards of the Rip), as a viewer would see them.
    await page.locator(s.captions)[view.hasTouch ? "tap" : "click"]();
    await page.evaluate(
      ({ selector, time }) => {
        document.querySelector(selector).currentTime = time;
      },
      { selector: s.video, time: CAPTION_AT },
    );
    await page.waitForFunction(
      (selector) => {
        const caption = document.querySelector(selector);
        return !!caption && !caption.hidden && !!caption.textContent.trim();
      },
      s.caption,
      { timeout: 10000 },
    );
    result.captionShown = await page.evaluate((selector) => document.querySelector(selector).textContent, s.caption);
    await shot("captions");

    await page.locator(s.close)[view.hasTouch ? "tap" : "click"]();
    await page.waitForFunction((selector) => !document.querySelector(selector)?.open, s.dialog, { timeout: 15000 });
    await page.waitForTimeout(1200);
    result.closed = await state();
    const closed = await shot("closed");
    // Closing parks the video on its first frame: it must be black.
    await page.waitForFunction(
      (selector) => {
        const v = document.querySelector(selector);
        return v.readyState >= 2 && !v.seeking && v.currentTime === 0;
      },
      s.video,
      { timeout: 10000 },
    );
    result.firstFrame = summary(await frame());
    result.tvRestoredDifference = round(await regionDifference(idle, closed, tvBox, view.deviceScaleFactor), 2);
    const probed = await page.evaluate(() => window.__film);
    const click = probed.events.find((e) => e.name === "click")?.at ?? Math.round(clickedAt);
    result.events = probed.events.map((e) => ({ ...e, at: e.at - click }));
    // Main-thread blocks of 50 ms or more from the click to the start of playback.
    result.longTasksDuringOpening = probed.longTasks
      .map((t) => ({ at: t.at - click, ms: t.ms }))
      .filter((t) => t.at >= -50 && t.at <= 2500);
    const firstPlaying = result.events.find((e) => e.name === "playing" && e.at >= 0);
    result.msToFirstPlaying = firstPlaying?.at ?? null;

    // Checks ------------------------------------------------------------
    const c = result.checks;
    const version = `?v=${values.version}`;
    const kind = (url) => url.match(/onepercent-explained\.(\w+)/)?.[1];
    const kinds = new Set(result.requests.map((r) => kind(r.url)));
    c.noMediaBeforeOpen = requestsBeforeOpen === 0;
    c.mediaVersioned =
      result.requests.length > 0 &&
      result.requests.every(
        (r) => r.url.includes(version) && r.url.startsWith(player.media[kind(r.url)]) && !r.failed && r.status < 400,
      ) &&
      ["mp4", "webp", "vtt"].every((name) => kinds.has(name));
    c.liveTv = result.playing.dialog?.mode === "live" && result.playing.stageInDialog;
    c.startsAfterZoomAndFade = result.msToFirstPlaying !== null && result.msToFirstPlaying >= 1300;
    c.duration = Math.abs(result.playing.video.duration - FILM_SECONDS) <= 0.05;
    c.size = result.playing.video.width === 1280 && result.playing.video.height === 720;
    c.playedToEnd = result.events.some((e) => e.name === "ended");
    c.lastFrameHeldWithReplay =
      result.ended.dialog?.open === true &&
      result.ended.video.ended &&
      result.ended.video.paused &&
      result.ended.controls.play === "Replay" &&
      result.ended.controls.replayDisabled === false &&
      (!result.ended.tv || (result.ended.tv.phase === "playing" && result.ended.tv.mix >= 0.999));
    c.lastFrameIsEndCard = !!last && last.bright >= 0.03 && distance(card, last) < 8;
    c.firstFrameBlack = !!result.firstFrame && result.firstFrame.dark >= 0.9;
    const cues = result.ended.track?.cues ?? [];
    c.captionsLoaded =
      result.ended.track?.ready === 2 &&
      !!result.ended.track.src?.includes(version) &&
      cues.length > 0 &&
      cues.at(-1).end <= result.ended.video.duration + 0.01 &&
      cues.every((cue) => !cue.text.includes(EM_DASH));
    c.captionsShown = !!result.captionShown?.trim();
    c.noConsoleErrors = result.errors.length === 0;
    c.closedToIdle =
      result.closed.dialog?.open === false &&
      result.closed.video.paused &&
      result.closed.video.time === 0 &&
      !result.closed.stageInDialog &&
      !result.closed.filmOpenClass &&
      result.closed.rootOverflow === result.before.rootOverflow &&
      (!result.closed.tv ||
        (!result.closed.tv.filmActive &&
          result.closed.tv.mix === 0 &&
          result.closed.tv.heroMap &&
          Math.max(...result.closed.tv.camera.map((v, i) => Math.abs(v - result.before.tv.camera[i]))) < 0.005));
    result.captions = { src: result.ended.track?.src, ready: result.ended.track?.ready, cues };
  } catch (error) {
    result.failure = String(error.stack || error).slice(0, 1200);
    try {
      result.failureState = await state();
      await shot("failure");
    } catch {
      /* page gone */
    }
  } finally {
    await context.close();
  }
  result.passed = !result.failure && Object.values(result.checks).every(Boolean);
  // Keep the report short: the full snapshots stay out, the verdicts stay in.
  for (const key of ["before", "playing", "ended", "closed"])
    if (result[key]) result[key] = { dialog: result[key].dialog, video: result[key].video && { ...result[key].video, src: undefined }, controls: result[key].controls, tv: result[key].tv };
  return result;
}

await mkdir(out, { recursive: true });
const report = {
  at: new Date().toISOString(),
  version: values.version,
  media: {
    landing: await media(join(repo, "public/media/onepercent-explained.mp4")),
    poster: await media(join(repo, "public/media/onepercent-explained.webp")),
    captions: await media(join(repo, "public/media/onepercent-explained.vtt")),
    appFilm: await media(join(repo, "app/apps/web/public/landing/onepercent-explained.mp4")),
    appPoster: await media(join(repo, "app/apps/web/public/landing/onepercent-explained.webp")),
    appCaptions: await media(join(repo, "app/apps/web/public/experience/home/onepercent-explained.vtt")),
  },
  runs: [],
};
report.media.appCopiesMatch =
  report.media.landing.sha256 === report.media.appFilm.sha256 && report.media.poster.sha256 === report.media.appPoster.sha256;
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--mute-audio", "--force-color-profile=srgb"],
});
try {
  for (const name of values.only.split(","))
    for (const view of values.views.split(",")) {
      const started = Date.now();
      const result = await play(browser, name, view);
      result.seconds = Math.round((Date.now() - started) / 1000);
      report.runs.push(result);
      console.log(`${name} ${view}: ${result.passed ? "pass" : "FAIL"} ${JSON.stringify(result.checks)}${result.failure ? " " + result.failure.split("\n")[0] : ""}`);
      await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
    }
} finally {
  await browser.close();
}
report.passed = report.runs.every((run) => run.passed);
await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`report: ${join(out, "report.json")} passed=${report.passed}`);
