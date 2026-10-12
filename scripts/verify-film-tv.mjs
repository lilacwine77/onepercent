import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  filmFacts as film,
  filmSelectors as s,
  inspectFilm,
  televisionPoints,
  posterPoints,
  verticalSwipe,
  installFilmProbes,
  videoFrameSample,
  frameDistance,
  mp4Facts,
} from "./film-qa-helpers.mjs";

const url = process.env.QA_URL || "http://127.0.0.1:4173";
const out = process.env.QA_OUT || "artifacts/film-tv-v10";
const mediaVersion = process.env.QA_MEDIA_VERSION || "10";
const beat = Object.fromEntries(film.beats);
const requested = process.env.QA_SCENARIOS?.split(",");
const software = process.env.QA_GPU_MODE === "swiftshader";
const skipDecode = process.env.QA_SKIP_DECODE === "1";
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
const report = {
  url,
  at: new Date().toISOString(),
  scope: `Chrome ${software ? "SwiftShader" : "default GPU"}, desktop and touch emulation. Physical phone GPU, assistive-technology announcements and audible mix quality are not measured.`,
  failures: [],
  errors: [],
  expectedBlockedErrors: [],
  runs: [],
};
const check = (condition, message) => {
  if (!condition) report.failures.push(message);
};
const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: software
    ? ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"]
    : [],
});

async function state(page) {
  return inspectFilm(page);
}
async function waitReady(page) {
  await page.waitForFunction(
    () =>
      window.crtTelevision?.renderReady &&
      document.querySelector("#crt-stage").dataset.ready === "true",
    null,
    { timeout: 45000 },
  );
}
async function waitPlaying(page, name, expectedMode) {
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector("#concept-video-dialog"),
        v = document.querySelector("#concept-film");
      return (
        dialog.open &&
        dialog.dataset.state === "playing" &&
        v.readyState >= 2 &&
        v.currentTime > 0.1 &&
        !v.paused
      );
    },
    null,
    { timeout: 30000 },
  );
  const a = await state(page);
  check(
    a.modal && !!a.title && a.focus.inside,
    `${name}: named modal or focus is missing`,
  );
  check(
    a.panelDataset.mode === expectedMode,
    `${name}: expected ${expectedMode}, got ${a.panelDataset.mode}`,
  );
  check(
    a.media.inline && !a.media.autoplay && !a.media.error,
    `${name}: inline playback is unavailable`,
  );
  check(
    Math.abs(a.media.duration - film.seconds) <= 0.05,
    `${name}: unexpected film duration ${a.media.duration}`,
  );
  check(
    a.media.width === film.width && a.media.height === film.height,
    `${name}: unexpected film size ${a.media.width}x${a.media.height}`,
  );
  const urls = [
    a.media.source,
    a.media.poster,
    ...a.media.tracks.map((t) => t.source),
  ];
  check(
    urls.length === 3 &&
      urls.every((url) => url?.includes(`?v=${mediaVersion}`)),
    `${name}: film, poster or captions URL does not invalidate the previous cut`,
  );
  check(a.overflow <= 1, `${name}: horizontal overflow`);
  if (expectedMode === "live") {
    check(
      a.stageInPanel && a.television.isFilmActive,
      `${name}: live TV is not in the film dialog`,
    );
    check(
      a.television.videoTextures.some((t) => t.videoMatches),
      `${name}: screen does not sample the playing video`,
    );
    check(
      a.television.uniforms.amount > 0,
      `${name}: CRT treatment is missing during film`,
    );
    check(
      a.television.uniforms.video >= 0.999,
      `${name}: film shader is not active`,
    );
    const content = a.television.filmScreenBounds?.content;
    check(
      content && Math.abs(content.width / content.height - 16 / 9) < 0.1,
      `${name}: 16:9 film is stretched on the CRT screen`,
    );
    check(
      a.television.screenBounds?.width > 200,
      `${name}: zoomed screen is too small`,
    );
    const b = a.television.screenBounds,
      vp = page.viewportSize();
    check(
      b &&
        b.left >= -2 &&
        b.right <= vp.width + 2 &&
        b.top >= -2 &&
        b.bottom <= vp.height + 2,
      `${name}: zoomed screen is clipped by the viewport`,
    );
    await page.waitForTimeout(180);
    const later = await state(page);
    check(
      later.television.renders > a.television.renders,
      `${name}: TV does not upload/render advancing video frames`,
    );
    if (a.television.reduced)
      check(
        Math.abs(later.television.time - a.television.time) < 0.001,
        `${name}: CRT distortion animates despite reduced motion`,
      );
  }
  for (const key of ["play", "replay", "seek", "mute", "captions", "close"]) {
    const control = a.controls[key],
      r = control?.rect,
      vp = page.viewportSize();
    check(
      r?.width > 0 &&
        r?.height > 0 &&
        r.x >= -1 &&
        r.x + r.width <= vp.width + 1 &&
        r.y >= -1 &&
        r.y + r.height <= vp.height + 1,
      `${name}: ${key} control is outside the viewport`,
    );
  }
  return a;
}

async function closeFilm(page, name, method = "button", baseline) {
  if (method === "escape") await page.keyboard.press("Escape");
  else if (method === "backdrop") await page.mouse.click(3, 3);
  else await page.locator(s.close).click();
  await page.waitForFunction(
    () => !document.querySelector("#concept-video-dialog").open,
    null,
    { timeout: 15000 },
  );
  await page.mouse.move(2, 2);
  const a = await state(page);
  check(
    a.media.paused && a.media.time < 0.05,
    `${name}: close does not stop/reset audio and video`,
  );
  check(a.focus.watch, `${name}: focus did not return to Watch the film`);
  check(
    !a.stageInPanel && !a.television.isFilmActive,
    `${name}: TV remains in the film scene after close`,
  );
  if (a.television.created) {
    check(
      a.television.uniforms.video === 0 && a.television.heroMapRestored,
      `${name}: video texture remains on the idle screen`,
    );
    if (baseline?.television?.renderReady && !baseline.television.contextLost) {
      check(
        diff(a.television.cameraPosition, baseline.television.cameraPosition) <
          0.005,
        `${name}: camera position is not restored`,
      );
      check(
        Math.abs(a.television.cameraZoom - baseline.television.cameraZoom) <
          0.005,
        `${name}: camera zoom is not restored`,
      );
    }
  }
  check(
    Math.abs(a.scrollY - (baseline?.scrollY ?? a.scrollY)) < 2,
    `${name}: film changed page scroll position`,
  );
  return a;
}

async function seekTo(page, seconds) {
  await page.evaluate((time) => {
    document.querySelector("#concept-film").currentTime = time;
  }, seconds);
  await page.waitForFunction((time) => {
    const v = document.querySelector("#concept-film");
    return (
      !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - time) < 0.05
    );
  }, seconds);
}
const sampleSummary = (sample) =>
  sample && {
    time: sample.time,
    mean: sample.mean,
    dark: sample.dark,
    bright: sample.bright,
  };

async function captureAt(page, seconds, filename) {
  await page.evaluate((time) => {
    const video = document.querySelector("#concept-film");
    video.pause();
    video.currentTime = time;
  }, seconds);
  await page.waitForFunction((time) => {
    const v = document.querySelector("#concept-film");
    return !v.seeking && Math.abs(v.currentTime - time) < 0.05;
  }, seconds);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/${filename}.png` });
}

async function controls(page, name) {
  // Real key presses validate custom controls; direct seeks are only for visual snapshots.
  const results = {};
  if (!(await state(page)).media.paused) await page.locator(s.play).click();
  const paused = await state(page);
  await page.waitForTimeout(160);
  results.paused = await state(page);
  check(
    results.paused.media.paused &&
      Math.abs(results.paused.media.time - paused.media.time) < 0.05,
    `${name}: Pause does not stop media`,
  );
  await page.locator(s.seek).focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  results.seek = await state(page);
  check(
    results.seek.media.time > 0.05 && results.seek.media.time < 1,
    `${name}: keyboard range control does not seek`,
  );
  await page.locator(s.mute).click();
  results.muted = await state(page);
  check(
    results.muted.media.muted && results.muted.controls.mute.pressed === "true",
    `${name}: mute button/state do not agree`,
  );
  await page.locator(s.mute).click();
  check(
    !(await state(page)).media.muted,
    `${name}: unmute does not restore sound`,
  );
  await page.locator(s.captions).click();
  await page.waitForFunction(
    () =>
      [...document.querySelector("#concept-film").textTracks].some(
        (t) => t.cues?.length,
      ),
    null,
    { timeout: 10000 },
  );
  // Show the first cue, wherever the captions file places it.
  await page.evaluate(() => {
    const video = document.querySelector("#concept-film");
    const cue = [...video.textTracks].find((t) => t.cues?.length).cues[0];
    video.currentTime = (cue.startTime + cue.endTime) / 2;
  });
  await page.waitForFunction(() => {
    const caption = document.querySelector("[data-film-caption]");
    return !caption.hidden && !!caption.textContent.trim();
  });
  results.captions = await state(page);
  check(
    results.captions.media.tracks.some(
      (t) =>
        t.language === "en" &&
        t.cues.length > 0 &&
        t.cues.every(
          (cue) => cue.end > cue.start && !cue.text.includes("\u2014"),
        ) &&
        t.cues.at(-1).end <= results.captions.media.duration + 0.01,
    ),
    `${name}: English captions are not parsed, overrun the film or carry an em dash`,
  );
  check(
    results.captions.controls.captions.pressed === "true",
    `${name}: caption control state is wrong`,
  );
  await page.locator(s.captions).click();
  check(
    (await state(page)).caption.hidden,
    `${name}: captions remain visible after disabling`,
  );
  // The film opens on a black frame: the CRT power-on starts from it.
  await seekTo(page, 0);
  const first = await videoFrameSample(page);
  results.firstFrame = sampleSummary(first);
  check(
    first?.dark >= 0.9,
    `${name}: the first frame is not black (${first?.dark} of it is dark)`,
  );
  await page.locator(s.play).focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () => !document.querySelector("#concept-film").paused,
  );
  results.resumed = await state(page);
  await page.locator(s.replay).click();
  results.replay = await state(page);
  check(
    results.replay.media.time < 1 && !results.replay.media.paused,
    `${name}: Replay does not restart film`,
  );
  // The end card holds from 20 s to the last frame, which stays on the glass
  // with Replay until Close.
  await page.locator(s.play).click();
  const end = results.replay.media.duration;
  await seekTo(page, end - 0.5);
  const card = await videoFrameSample(page);
  await seekTo(page, end - 0.15);
  await page.locator(s.play).click();
  await page.waitForFunction(
    () => document.querySelector("#concept-film").ended,
    null,
    { timeout: 10000 },
  );
  results.ended = await state(page);
  const last = await videoFrameSample(page);
  results.endCard = {
    before: sampleSummary(card),
    last: sampleSummary(last),
    distance: frameDistance(card, last),
  };
  check(
    results.ended.open &&
      results.ended.media.paused &&
      results.ended.controls.play.text === "Replay",
    `${name}: ended film does not leave a controllable final frame`,
  );
  check(
    last?.bright >= 0.03 && results.endCard.distance < 8,
    `${name}: the last frame is not the held end card`,
  );
  if (results.ended.television.film)
    check(
      results.ended.television.film.phase === "playing" &&
        results.ended.television.uniforms.video >= 0.999,
      `${name}: the TV leaves the last frame before Close`,
    );
  await page.locator(s.replay).click();
  await page.waitForFunction(() => {
    const v = document.querySelector("#concept-film");
    return !v.paused && !v.ended && v.currentTime < 1;
  });
  return results;
}

async function focusChecks(page, name) {
  const observations = [];
  await page.locator(s.close).focus();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(i === 0 ? "Shift+Tab" : "Tab");
    observations.push((await state(page)).focus);
  }
  check(
    observations.every(
      (a) => a.inside || (a.tag === "BODY" && !a.hasDocumentFocus),
    ) && observations.at(-1).inside,
    `${name}: keyboard focus enters background or fails to cycle`,
  );
  await page.locator(".site-header a").first().focus();
  check(
    (await state(page)).focus.inside,
    `${name}: background page is not inert`,
  );
  return observations;
}

async function inspectVisibility(page, name, manuallyPaused = false) {
  if (manuallyPaused && !(await state(page)).media.paused)
    await page.locator(s.play).click();
  const other = await page.context().newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await page.waitForTimeout(120);
  const nativeHidden = await page.evaluate(() => document.hidden);
  if (!nativeHidden)
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  await page.waitForTimeout(150);
  const hidden = await state(page);
  check(hidden.media.paused, `${name}: hidden tab leaves film audio playing`);
  await page.waitForTimeout(120);
  const later = await state(page);
  check(
    later.television.renders - hidden.television.renders <= 1,
    `${name}: hidden tab continues GPU film rendering`,
  );
  await page.bringToFront();
  if (!nativeHidden)
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
  await other.close();
  await page.waitForTimeout(100);
  const returned = await state(page);
  check(
    returned.media.paused === manuallyPaused,
    `${name}: visibility return ignores previous playback intent`,
  );
  return {
    mechanism: nativeHidden
      ? "native tab visibility"
      : "synthetic visibilitychange; headless Chrome keeps both tabs visible",
    hidden,
    later,
    returned,
  };
}

try {
  for (const scenario of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "compact", width: 910, height: 773 },
    { name: "mobile", width: 390, height: 844, touch: true },
    { name: "reduced", width: 910, height: 773, reduced: true },
    { name: "fallback", width: 910, height: 773, fallback: true },
    { name: "loading", width: 910, height: 773, loading: true },
  ].filter((a) => !requested || requested.includes(a.name))) {
    const context = await browser.newContext({
      viewport: { width: scenario.width, height: scenario.height },
      deviceScaleFactor: 1,
      hasTouch: !!scenario.touch,
      isMobile: !!scenario.touch,
      reducedMotion: scenario.reduced ? "reduce" : "no-preference",
    });
    const run = { ...scenario, actions: [] };
    report.runs.push(run);
    let releaseModel;
    try {
      await context.addInitScript(() =>
        sessionStorage.setItem("onepercent-v2-seen", "1"),
      );
      const page = await context.newPage();
      await installFilmProbes(page);
      const mediaRequests = [];
      page.on("request", (r) => {
        if (/\/media\//.test(r.url()))
          mediaRequests.push({ url: r.url(), at: Date.now() });
      });
      page.on("pageerror", (e) =>
        report.errors.push(`${scenario.name}: ${e.message}`),
      );
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const message = `${scenario.name}: ${m.text()}`;
        if (
          scenario.fallback &&
          /ERR_FAILED|Could not load the television/.test(message)
        )
          report.expectedBlockedErrors.push(message);
        else report.errors.push(message);
      });
      if (scenario.fallback)
        await page.route("**/models/onepercent-crt.glb*", (r) => r.abort());
      if (scenario.loading) {
        const held = new Promise((resolve) => {
          releaseModel = resolve;
        });
        await page.route("**/models/onepercent-crt.glb*", async (r) => {
          await held;
          await r.continue();
        });
      }
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.locator(s.watch).waitFor({ state: "visible" });
      if (!scenario.fallback && !scenario.loading) await waitReady(page);
      else
        await page.waitForFunction(
          () => document.querySelector(".crt-poster").naturalWidth > 0,
        );
      await page.mouse.move(2, 2);
      run.initial = await state(page);
      check(
        !run.initial.open &&
          run.initial.media.paused &&
          !run.initial.media.source,
        `${scenario.name}: film is initialized before activation`,
      );
      check(
        run.initial.media.preload === "none" && mediaRequests.length === 0,
        `${scenario.name}: film resources fetched before activation`,
      );
      run.requestsBeforeActivation = mediaRequests.length;
      await page.screenshot({ path: `${out}/${scenario.name}-idle.png` });
      const points =
        scenario.loading || scenario.fallback
          ? await posterPoints(page)
          : await televisionPoints(page);
      run.points = points;
      if (points.empty) {
        await page.mouse.click(points.empty.x, points.empty.y);
        check(
          !(await state(page)).open,
          `${scenario.name}: transparent area opens film`,
        );
      }
      if (scenario.touch) {
        run.swipe = await verticalSwipe(page, points.screen);
        check(
          !(await state(page)).open &&
            run.swipe.scrollY > run.swipe.initial + 40,
          "mobile: vertical touch gesture opens film or prevents page scroll",
        );
        check(mediaRequests.length === 0, "mobile: scrolling loads the film");
        await page.evaluate(() =>
          window.scrollTo({ top: 0, behavior: "instant" }),
        );
        await page.waitForTimeout(200);
      }
      const activationPoint = scenario.touch
        ? (await televisionPoints(page)).screen
        : points.physical || points.screen;
      run.beforeOpen = await state(page);
      if (scenario.touch)
        await page.touchscreen.tap(activationPoint.x, activationPoint.y);
      else await page.mouse.click(activationPoint.x, activationPoint.y);
      await page.waitForTimeout(100);
      run.opening = await state(page);
      check(
        run.opening.open,
        `${scenario.name}: physical television/poster activation failed`,
      );
      if (!scenario.reduced)
        check(
          run.opening.media.paused && run.opening.media.time < 0.001,
          `${scenario.name}: video/audio progresses before zoom completes`,
        );
      await page.screenshot({ path: `${out}/${scenario.name}-opening.png` });
      const mode = scenario.fallback || scenario.loading ? "fallback" : "live";
      run.playing = await waitPlaying(page, scenario.name, mode);
      if (mode === "live" && !scenario.reduced)
        check(
          run.playing.television.screenBounds.width >
            run.beforeOpen.television.screenBounds.width * 1.12,
          `${scenario.name}: click does not visibly enlarge the screen`,
        );
      if (scenario.loading) {
        releaseModel();
        releaseModel = null;
        await page.waitForTimeout(400);
        run.modelReleased = await state(page);
        check(
          run.modelReleased.panelDataset.mode === "fallback",
          "loading: async model arrival switches reader mid-film",
        );
      }
      await captureAt(page, beat["rip-hit"], `${scenario.name}-rip-hit`);
      if (scenario.fallback) {
        for (const [label, time] of film.beats) {
          await captureAt(page, time, `fallback-${label}`);
        }
      }
      if (["desktop", "mobile", "reduced"].includes(scenario.name)) {
        run.controls = await controls(page, scenario.name);
        run.focus = await focusChecks(page, scenario.name);
      }
      run.closed = await closeFilm(
        page,
        scenario.name,
        scenario.name === "compact" ? "backdrop" : "escape",
        run.initial,
      );
      if (scenario.loading) await waitReady(page);
      await page.locator(s.watch).focus();
      await page.keyboard.press("Enter");
      run.keyboardOpen = await waitPlaying(
        page,
        scenario.name,
        scenario.fallback ? "fallback" : "live",
      );
      check(
        (await page.locator(s.video).count()) === 1 &&
          (await page.locator(s.dialog).count()) === 1,
        `${scenario.name}: repeated opening duplicates media or panel`,
      );
      if (scenario.name === "desktop") {
        run.visibility = await inspectVisibility(page, scenario.name);
        run.pausedVisibility = await inspectVisibility(
          page,
          scenario.name,
          true,
        );
        if ((await state(page)).media.paused)
          await page.locator(s.play).click();
        await page.evaluate(() => {
          window.__filmQALoseContext = window.crtTelevision.renderer
            .getContext()
            .getExtension("WEBGL_lose_context");
          window.__filmQALoseContext.loseContext();
        });
        await page.waitForFunction(
          () =>
            document.querySelector("#concept-video-dialog").dataset.mode ===
            "fallback",
        );
        run.contextLost = await state(page);
        check(
          run.contextLost.open && run.contextLost.media.readyState >= 2,
          "desktop: context loss leaves no usable fallback reader",
        );
        await page.screenshot({ path: `${out}/desktop-context-fallback.png` });
        await page.evaluate(() => window.__filmQALoseContext.restoreContext());
        await page.waitForTimeout(400);
        run.contextRestoring = await state(page);
      }
      if (scenario.name === "mobile") {
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(250);
        run.landscape = await waitPlaying(page, "mobile landscape", "live");
        await captureAt(page, beat["rip-hit"], "mobile-landscape-rip-hit");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
      }
      run.keyboardClosed = await closeFilm(
        page,
        scenario.name,
        "button",
        run.initial,
      );
      if (scenario.reduced) {
        await page.waitForTimeout(200);
        const a = await state(page);
        await page.waitForTimeout(200);
        const b = await state(page);
        run.reducedIdle = { a, b };
        check(
          a.television.renders === b.television.renders &&
            b.television.frame === 0,
          "reduced: returning from film starts continuous idle animation",
        );
      }
      if (scenario.name === "desktop") {
        await waitReady(page);
        await page.locator(s.watch).click();
        await page.waitForTimeout(100);
        run.closeDuringOpening = await closeFilm(
          page,
          scenario.name,
          "escape",
          run.initial,
        );
        await page.waitForTimeout(1100);
        check(
          !(await state(page)).open && (await state(page)).media.paused,
          "desktop: stale opening promise reactivates a closed film",
        );
      }
      run.events = await page.evaluate(() => window.__filmQAEvents);
      run.mediaRequests = mediaRequests;
      await page.screenshot({ path: `${out}/${scenario.name}-returned.png` });
    } catch (error) {
      const activePage = context.pages()[0];
      if (activePage) {
        run.failureState = await inspectFilm(activePage).catch(() => null);
        run.failureEvents = await activePage
          .evaluate(() => window.__filmQAEvents)
          .catch(() => null);
      }
      report.failures.push(`${scenario.name}: ${error.stack || error}`);
    } finally {
      releaseModel?.();
      await context.close();
    }
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  }
  // Facts from the file itself; a full decode also needs an FFmpeg binary
  // (FFMPEG_BIN or ffmpeg on PATH), which the repository does not ship.
  const source = report.runs.find((r) => r.playing?.media.source)?.playing.media
    .source;
  if (!source)
    throw new Error("No played film source available for media validation");
  const filename =
    process.env.CONCEPT_VIDEO_PATH ||
    path.resolve(
      "public",
      decodeURIComponent(new URL(source).pathname).replace(/^\//, ""),
    );
  const media = await readFile(filename);
  const facts = mp4Facts(media);
  const picture = facts.tracks?.find((t) => t.handler === "vide");
  const sound = facts.tracks?.find((t) => t.handler === "soun");
  report.media = {
    path: filename,
    bytes: media.length,
    sha256: createHash("sha256").update(media).digest("hex"),
    facts,
  };
  // The picture lasts exactly the film's length; AAC framing may add a few ms.
  check(
    picture?.seconds === film.seconds &&
      Math.abs(facts.seconds - film.seconds) <= 0.05,
    `MP4: ${facts.seconds} s long (picture ${picture?.seconds} s), expected ${film.seconds} s`,
  );
  check(
    picture?.codec === "avc1" && picture.profile === "High",
    "MP4: H.264 High video missing",
  );
  check(
    picture?.width === film.width && picture?.height === film.height,
    `MP4: picture is ${picture?.width}x${picture?.height}`,
  );
  check(
    picture?.fps === film.fps && picture?.samples === film.frames,
    `MP4: ${picture?.samples} frames at ${picture?.fps} fps, expected ${film.frames} at ${film.fps}`,
  );
  check(sound?.codec === "mp4a", "MP4: AAC sound track missing");
  check(facts.faststart, "MP4: moov after mdat, so no fast start");
  if (!skipDecode) {
    const decode = spawnSync(
      ffmpeg,
      ["-hide_banner", "-i", filename, "-map", "0", "-f", "null", "-"],
      { encoding: "utf8", timeout: 60000 },
    );
    if (decode.error?.code === "ENOENT" && !process.env.FFMPEG_BIN)
      report.media.decode = "skipped: no ffmpeg on PATH (set FFMPEG_BIN)";
    else {
      if (decode.error) throw decode.error;
      report.media.decodeExitCode = decode.status;
      report.media.metadata = decode.stderr
        .split(/\r?\n/)
        .filter((line) =>
          /Duration:|Stream #.*(?:Video:|Audio:)|Error|Invalid|corrupt/i.test(
            line,
          ),
        );
      check(decode.status === 0, "FFmpeg: film does not decode fully");
      check(
        /Video:\s*h264.*yuv420p/.test(decode.stderr),
        "FFmpeg: H.264/yuv420p compatibility missing",
      );
      check(
        /Audio:\s*aac/.test(decode.stderr),
        "FFmpeg: embedded AAC sound track missing",
      );
    }
  }
} catch (error) {
  report.failures.push(error.stack || String(error));
} finally {
  await browser.close();
  report.passed = report.failures.length === 0 && report.errors.length === 0;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        failures: report.failures,
        errors: report.errors,
        scenarios: report.runs.map((r) => r.name),
        out,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}
