import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { televisionPoints } from "./film-qa-helpers.mjs";
import {
  rectifyScreen,
  pixelBlendEstimate,
  bezelPixels,
} from "./film-pixel-qa.mjs";

const url = process.env.QA_URL || "http://127.0.0.1:4173";
const out = process.env.QA_OUT || "artifacts/film-tv-v10/sequence";
await mkdir(out, { recursive: true });
const report = {
  url,
  at: new Date().toISOString(),
  runs: [],
  failures: [],
  errors: [],
  method:
    "Compositor PNG frames matched to actual WebGL draw timestamps. Screen crops are rectified from projected surface points; return blend is estimated from pixels relative to the held film and restored Pepe endpoints. No material or texture is changed by the probe.",
};
const check = (condition, message) => {
  if (!condition) report.failures.push(message);
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const name = viewport.width === 390 ? "mobile" : "desktop";
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      hasTouch: name === "mobile",
      isMobile: name === "mobile",
    });
    await context.addInitScript(() =>
      sessionStorage.setItem("onepercent-v2-seen", "1"),
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") report.errors.push(`${name}: ${m.text()}`);
    });
    await page.goto(url);
    await page.waitForFunction(() => window.crtTelevision?.renderReady);
    await page.evaluate(() => {
      const tv = window.crtTelevision,
        video = document.querySelector("#concept-film"),
        q = (window.__filmSequence = { draws: [], events: [] });
      const now = () => performance.timeOrigin + performance.now();
      const enter = tv.enterFilm.bind(tv),
        exit = tv.exitFilm.bind(tv);
      tv.enterFilm = (...args) => {
        q.opening = now();
        return enter(...args);
      };
      tv.exitFilm = (...args) => {
        if (tv.film?.phase !== "exiting" && args[0]?.duration > 0)
          q.closing = now();
        return exit(...args);
      };
      for (const event of [
        "play",
        "playing",
        "pause",
        "timeupdate",
        "loadeddata",
        "ended",
      ])
        video.addEventListener(event, () =>
          q.events.push({
            event,
            at: now(),
            time: video.currentTime,
            paused: video.paused,
            mix: tv.uniforms.video.value,
            progress: tv.film?.progress,
          }),
        );
      const mesh = tv.screenMesh,
        p = mesh.geometry.attributes.position,
        box = mesh.geometry.boundingBox;
      const targets = [
        [0.1, 0.75],
        [0.9, 0.75],
        [0.9, 0.25],
        [0.1, 0.25],
      ];
      const local = targets.map(([u, v]) => {
        const x = box.min.x + u * (box.max.x - box.min.x),
          y = box.min.y + v * (box.max.y - box.min.y);
        let best = 0,
          bestDistance = Infinity;
        for (let i = 0; i < p.count; i++) {
          const d = (p.getX(i) - x) ** 2 + (p.getY(i) - y) ** 2;
          if (d < bestDistance) {
            best = i;
            bestDistance = d;
          }
        }
        return tv.camera.position.clone().fromBufferAttribute(p, best);
      });
      const render = tv.renderer.render.bind(tv.renderer);
      tv.renderer.render = (...args) => {
        const value = render(...args),
          r = tv.renderer.domElement.getBoundingClientRect();
        const quad = local.map((point) => {
          const p = point
            .clone()
            .applyMatrix4(mesh.matrixWorld)
            .project(tv.camera);
          return [
            r.x + ((p.x + 1) * r.width) / 2,
            r.y + ((1 - p.y) * r.height) / 2,
          ];
        });
        q.draws.push({
          at: now(),
          quad,
          bounds: tv.getFilmScreenBounds(),
          phase: tv.film?.phase,
          progress: tv.film?.progress,
          reveal: tv.film?.revealPhase,
          mix: tv.uniforms.video.value,
          mediaTime: video.currentTime,
          paused: video.paused,
          ready: video.readyState,
          heroMap: !mesh.material.map?.isVideoTexture,
          state: document.querySelector("#concept-video-dialog").dataset.state,
        });
        return value;
      };
    });
    const cdp = await context.newCDPSession(page),
      frames = [];
    cdp.on("Page.screencastFrame", (frame) => {
      frames.push({ at: frame.metadata.timestamp * 1000, data: frame.data });
      cdp
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "png",
      everyNthFrame: 1,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
    });
    const point = (await televisionPoints(page)).screen;
    if (name === "mobile") await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    await page.waitForFunction(
      () => {
        const v = document.querySelector("#concept-film");
        return !v.paused && v.currentTime > 2.9;
      },
      null,
      { timeout: 30000 },
    );
    // Pause on the dark X-ray beat so the return's pixels isolate crossfade from film motion.
    await page.evaluate(() => {
      const v = document.querySelector("#concept-film");
      v.pause();
      v.currentTime = 2.5;
    });
    await page.waitForFunction(() => {
      const v = document.querySelector("#concept-film");
      return !v.seeking && Math.abs(v.currentTime - 2.5) < 0.01;
    });
    await page.waitForTimeout(160);
    await page.locator("[data-concept-close]").click();
    await page.waitForFunction(
      () => !document.querySelector("#concept-video-dialog").open,
    );
    await page.waitForTimeout(140);
    await cdp.send("Page.stopScreencast");
    const q = await page.evaluate(() => ({
      ...window.__filmSequence,
      bundle: [...document.scripts]
        .map((s) => s.src)
        .find((s) => /\/assets\/index-/.test(s)),
    }));
    const run = {
      name,
      viewport,
      bundle: q.bundle,
      opening: q.opening,
      closing: q.closing,
      mediaEvents: q.events,
      compositorFrames: frames.length,
      frames: [],
    };
    report.runs.push(run);
    const drawFor = (frame) =>
      q.draws.filter((d) => d.at <= frame.at + 8).at(-1) || q.draws[0];
    const nearest = (at) =>
      frames.reduce(
        (best, f) =>
          !best || Math.abs(f.at - at) < Math.abs(best.at - at) ? f : best,
        null,
      );
    const advancing = q.draws.filter(
      (d) =>
        d.at >= q.opening &&
        d.at < q.closing &&
        (!d.paused || d.mediaTime > 0.001),
    );
    run.firstAdvancing = advancing[0];
    check(advancing.length > 0, `${name}: film never starts`);
    check(
      advancing.every((d) => d.progress === 1 && d.mix >= 0.999),
      `${name}: media advances before zoom and screen fade finish`,
    );
    check(
      advancing[0]?.at - q.opening >= 1250,
      `${name}: film starts before zoom900+settle100+fade400`,
    );
    check(
      q.events
        .filter((e) => e.event === "playing")
        .every((e) => e.progress === 1 && e.mix >= 0.999),
      `${name}: audio playback begins during preparation`,
    );
    const requests = [];
    for (const t of [100, 300, 600])
      requests.push({ label: `zoom-${t}`, at: q.opening + t, kind: "zoom" });
    for (const t of [1000, 1150, 1300, 1450])
      requests.push({
        label: `reveal-${t}`,
        at: q.opening + t,
        kind: "reveal",
      });
    // Natural playback until the pause: the CRT power-on out of the black
    // first frame, then the X-ray beat ("Your bags are dust.").
    for (const [label, time] of [
      ["power-on", 0.1],
      ["xray", 1.2],
      ["dust", 2.5],
    ]) {
      const draw = q.draws.filter(
        (d) => d.at < q.closing && d.mediaTime >= time && !d.paused,
      )[0];
      check(!!draw, `${name}: missing natural ${label} frame`);
      if (draw) requests.push({ label, at: draw.at, kind: "scene" });
    }
    requests.push({ label: "return-film", at: q.closing - 55, kind: "return" });
    for (const t of [100, 200, 300, 450, 600])
      requests.push({
        label: `return-${t}`,
        at: q.closing + t,
        kind: "return",
      });
    requests.push({
      label: "return-pepe",
      at: q.closing + 760,
      kind: "return",
    });
    const images = [],
      rectified = new Map();
    for (const request of requests) {
      const frame = nearest(request.at),
        draw = drawFor(frame),
        image = Buffer.from(frame.data, "base64");
      const filename = `${name}-${request.label}.png`,
        screen = await rectifyScreen(image, draw.quad);
      await writeFile(`${out}/${filename}`, image);
      await writeFile(`${out}/${name}-${request.label}-screen.png`, screen.png);
      const pixelCounts = await bezelPixels(image, draw.bounds);
      const observation = {
        label: request.label,
        kind: request.kind,
        filename,
        at: frame.at,
        offsetMs:
          frame.at - (request.kind === "return" ? q.closing : q.opening),
        targetErrorMs: frame.at - request.at,
        drawAgeMs: frame.at - draw.at,
        phase: draw.phase,
        progress: draw.progress,
        mix: draw.mix,
        mediaTime: draw.mediaTime,
        paused: draw.paused,
        heroMap: draw.heroMap,
        quad: draw.quad,
        bezelPixels: pixelCounts.reduce((a, b) => a + b, 0),
      };
      run.frames.push(observation);
      images.push({ image, label: request.label });
      rectified.set(request.label, screen);
      check(
        observation.bezelPixels > 25,
        `${name} ${request.label}: TV disappears in compositor pixels`,
      );
      if (request.kind === "zoom")
        check(
          draw.paused &&
            draw.mediaTime < 0.001 &&
            draw.mix === 0 &&
            draw.heroMap,
          `${name} ${request.label}: Pepe is replaced or media advances while zooming`,
        );
    }
    const film = rectified.get("return-film").pixels,
      pepe = rectified.get("return-pepe").pixels;
    run.returnBlend = run.frames
      .filter((f) => f.kind === "return")
      .map((f) => ({
        label: f.label,
        offsetMs: f.offsetMs,
        shaderMix: f.mix,
        ...pixelBlendEstimate(rectified.get(f.label).pixels, film, pepe),
      }));
    const middle = run.returnBlend.filter((f) =>
      /^return-(100|200|300)$/.test(f.label),
    );
    check(
      middle.some(
        (f) => f.filmContribution > 0.12 && f.filmContribution < 0.88,
      ),
      `${name}: no mixed film/Pepe pixels during return`,
    );
    check(
      middle[0].filmContribution > middle.at(-1).filmContribution + 0.15,
      `${name}: return pixels do not progressively move from film to Pepe`,
    );
    check(
      Math.abs(
        run.returnBlend.find((f) => f.label === "return-450").filmContribution,
      ) < 0.28,
      `${name}: film still dominates after return fade400ms`,
    );
    const width = name === "mobile" ? 220 : 420,
      height = Math.round((viewport.height * width) / viewport.width);
    const tiles = await Promise.all(
      images.map(async (item, i) => ({
        input: await sharp(item.image).resize(width, height).toBuffer(),
        left: (i % 4) * width,
        top: Math.floor(i / 4) * height,
      })),
    );
    await sharp({
      create: {
        width: width * 4,
        height: height * Math.ceil(images.length / 4),
        channels: 4,
        background: "#170d20",
      },
    })
      .composite(tiles)
      .png()
      .toFile(`${out}/${name}-contact-sheet.png`);
    const cropTiles = await Promise.all(
      [...rectified]
        .filter(([label]) => label.startsWith("return"))
        .map(async ([label, value], i) => ({
          input: value.png,
          left: i * 128,
          top: 0,
        })),
    );
    await sharp({
      create: {
        width: cropTiles.length * 128,
        height: 96,
        channels: 4,
        background: "#170d20",
      },
    })
      .composite(cropTiles)
      .png()
      .toFile(`${out}/${name}-return-pixel-strip.png`);
    await writeFile(`${out}/${name}-timeline.json`, JSON.stringify(q, null, 2));
    await cdp.detach();
    await context.close();
  }
} catch (error) {
  report.failures.push(error.stack || String(error));
} finally {
  await browser.close();
  report.passed = !report.failures.length && !report.errors.length;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        failures: report.failures,
        errors: report.errors,
        runs: report.runs.map((r) => ({
          name: r.name,
          firstAdvancingMs: r.firstAdvancing?.at - r.opening,
          returnBlend: r.returnBlend,
        })),
        out,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}

