import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Run against this checkout's Vite server, after the CRT assets are built.
const url = process.env.CRT_PREVIEW_URL || 'http://127.0.0.1:5173';
const out = 'artifacts/crt-v3/compatibility';
await mkdir(out, { recursive: true });
const report = {
  url,
  browser: 'Chrome, headless, ANGLE SwiftShader',
  scope: 'Browser emulation at desktop DPR 1/2 and mobile 390×844. Real mobile hardware, GPU performance, and touch latency are not measured.',
  samples: [],
  failures: [],
  errors: [],
  expectedFailureDiagnostics: [],
};
const check = (condition, message) => { if (!condition) report.failures.push(message); };
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});

async function open(name, { width = 1440, height = 900, dpr = 1, mobile = false, reducedMotion = 'no-preference', failure } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
    isMobile: mobile, hasTouch: mobile, reducedMotion });
  await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen', '1'));
  if (failure === 'webgl') await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return getContext.call(this, type, ...args);
    };
  });
  let blockedModels = 0;
  if (failure === 'model') await context.route(/\.glb(?:\?.*)?$/, async (route) => {
    blockedModels++;
    await route.abort('failed');
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(`${name}: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const target = failure ? report.expectedFailureDiagnostics : report.errors;
    target.push(`${name}: ${message.text()}`);
  });
  const modelRequests = [];
  page.on('request', request => { if (/\.glb(?:\?|$)/.test(request.url())) modelRequests.push(request.url()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#crt-stage').waitFor({ state: 'attached', timeout: 15000 });
  if (!failure) await page.locator('#crt-stage[data-ready="true"]').waitFor({ timeout: 45000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(failure ? 1600 : 2400);
  return { context, page, modelRequests, get blockedModels() { return blockedModels; }, name, width, height, dpr };
}

async function snapshot(page) {
  return page.evaluate(() => {
    const tv = window.crtTelevision;
    const stage = document.querySelector('#crt-stage');
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const poster = document.querySelector('.crt-poster');
    const posterStyle = poster && getComputedStyle(poster);
    const canvas = stage?.querySelector('canvas');
    return {
      ready: stage?.dataset.ready,
      active: stage?.dataset.screenActive,
      intensity: tv?.screenIntensity,
      amount: tv?.uniforms?.amount?.value,
      time: tv?.time,
      renderCount: tv?.renderCount,
      frame: tv?.frame ?? null,
      reducedMotion: tv?.reducedMotion,
      rotation: tv?.pivot?.rotation?.toArray().slice(0, 3),
      base: tv?.baseRotation?.toArray().slice(0, 3),
      position: tv?.pivot?.position?.toArray(),
      stage: rect(stage),
      title: rect(document.querySelector('.hero-copy h1')),
      copy: rect(document.querySelector('.hero-copy')),
      scrollY,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      canvas: canvas ? { width: canvas.width, height: canvas.height, rect: rect(canvas) } : null,
      pixelRatio: tv?.renderer?.getPixelRatio(),
      poster: poster ? { visible: !poster.hidden && posterStyle.display !== 'none' && posterStyle.visibility !== 'hidden' && Number(posterStyle.opacity) > 0,
        src: poster.currentSrc, loaded: poster.complete && poster.naturalWidth > 0, rect: rect(poster) } : null,
    };
  });
}

async function idleSample(page, duration = 600, live = false) {
  const start = await snapshot(page);
  if (live) await page.waitForFunction(s => window.crtTelevision.renderCount > s.renderCount && window.crtTelevision.time > s.time, start, { timeout: 10000 });
  else await page.waitForTimeout(duration);
  const end = await snapshot(page);
  return { start, end, renders: end.renderCount - start.renderCount };
}

async function waitForRest(page) {
  // Software rasterization can deliver very few frames per second. Verify the
  // actual settled state instead of claiming a device frame-rate measurement.
  const start = Date.now();
  await page.waitForFunction(() => {
    const tv = window.crtTelevision;
    return tv && tv.hoverWeight === 0 && tv.current.lengthSq() === 0 && tv.velocity.lengthSq() === 0;
  }, null, { timeout: 45000 });
  return Date.now() - start;
}

async function pointerTargets(page) {
  return page.evaluate(() => {
    const tv = window.crtTelevision;
    const screen = tv.screenMesh;
    screen.geometry.computeBoundingBox();
    tv.model.updateMatrixWorld(true);
    tv.camera.updateMatrixWorld(true);
    const box = screen.geometry.boundingBox;
    const center = box.getCenter(screen.position.clone());
    const canvas = tv.renderer.domElement.getBoundingClientRect();
    const project = point => {
      const p = screen.localToWorld(point).project(tv.camera);
      return { x: canvas.left + (p.x + 1) * canvas.width / 2, y: canvas.top + (1 - p.y) * canvas.height / 2 };
    };
    const face = center.clone();
    face.z = box.max.z;
    const casing = face.clone();
    casing.x = box.max.x + (box.max.x - box.min.x) * 0.06;
    return { screen: project(face), casing: project(casing), mesh: screen.name };
  });
}

const rotationDistance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

async function desktop(dpr) {
  const session = await open(`desktop-dpr${dpr}`, { dpr });
  const { page, context, name } = session;
  try {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(900);
    const idle = await idleSample(page, 600, true);
    check(idle.end.ready === 'true', `${name}: model never becomes ready`);
    check(idle.end.canvas?.width > 0, `${name}: canvas has no drawing buffer`);
    check(idle.end.intensity === 1 && idle.end.amount === 1, `${name}: permanent CRT missing before hover`);
    check(idle.renders > 0 && idle.end.time > idle.start.time, `${name}: visible CRT does not animate without hover`);
    check(idle.end.pageWidth <= 1442, `${name}: horizontal overflow`);
    check(!idle.end.poster?.visible, `${name}: fallback poster overlays loaded television`);
    check(await page.locator('#pack-stage').count() === 0, `${name}: old pack-rip stage remains in hero`);
    check(await page.evaluate(() => !window.packReveal), `${name}: previous pack reveal still initializes`);
    await page.screenshot({ path: `${out}/${name}-hero.png` });

    const targets = await pointerTargets(page);
    await page.mouse.move(targets.casing.x, targets.casing.y);
    await page.waitForTimeout(650);
    const casing = await snapshot(page);
    check(casing.intensity === 1 && casing.amount === 1, `${name}: casing hover changes permanent CRT intensity`);
    check(rotationDistance(casing.rotation, idle.end.rotation) > 0.001, `${name}: casing hover does not tilt television`);
    const adjusted = await pointerTargets(page);
    await page.mouse.move(adjusted.screen.x, adjusted.screen.y);
    await page.waitForFunction(() => document.querySelector('#crt-stage')?.dataset.screenActive === 'true', null, { timeout: 3000 });
    await page.waitForTimeout(300);
    const screen = await snapshot(page);
    check(screen.intensity === 1, `${name}: screen hover changes permanent CRT effect intensity`);
    await page.screenshot({ path: `${out}/${name}-screen-hover.png` });
    await page.mouse.move(5, 5);
    const exitSettleMs = await waitForRest(page);
    const exited = await idleSample(page, 600, true);
    check(exited.end.intensity === 1 && exited.end.amount === 1, `${name}: permanent CRT disappears after pointer exit`);
    check(exited.renders > 0, `${name}: permanent CRT stops after pointer exit`);
    check(rotationDistance(exited.end.rotation, exited.end.base) < .0001 && exited.end.position.every(v => Math.abs(v) < .0001), `${name}: pointer exit does not restore neutral pose`);

    const replay = page.locator('.crt-replay[data-crt-replay]');
    await replay.evaluate(el => el.addEventListener('click', () => { window.__crtReplaySnapshot = { time: window.crtTelevision.time, amount: window.crtTelevision.uniforms.amount.value }; }, { once: true }));
    await replay.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.crtTelevision?.screenIntensity > 0.05 && document.querySelector('#crt-stage')?.dataset.screenActive === 'true', null, { timeout: 5000 });
    const keyboard = await snapshot(page);
    const replayReset = await page.evaluate(() => window.__crtReplaySnapshot);
    check(replayReset?.time === 0 && replayReset.amount === 1, `${name}: keyboard replay does not reset permanent CRT phase`);
    const replaySettleMs = await waitForRest(page);
    const replaySettled = await idleSample(page, 600, true);
    check(replaySettled.end.intensity === 1, `${name}: replay disables permanent CRT`);
    check(replaySettled.renders > 0, `${name}: replay leaves permanent CRT stopped`);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.crtTelevision?.reducedMotion === true && window.crtTelevision.frame === 0, null, { timeout: 10000 });
    const reducedBefore = await snapshot(page);
    const reducedTargets = await pointerTargets(page);
    await page.mouse.move(reducedTargets.screen.x, reducedTargets.screen.y);
    await page.waitForTimeout(1000);
    const reduced = await idleSample(page);
    check(rotationDistance(reducedBefore.rotation, reduced.end.rotation) < 0.0001, `${name}: reduced motion still tilts with pointer`);
    check(reduced.renders <= 1, `${name}: reduced motion still renders continuously`);
    check(reduced.end.intensity === 1 && reduced.end.amount === 1 && reduced.end.time === 0, `${name}: reduced motion does not preserve static CRT at time zero`);
    check(!await replay.isVisible(), `${name}: motion replay remains visible with reduced motion`);
    await page.evaluate(() => window.crtTelevision.replay());
    await page.waitForTimeout(600);
    const reducedReplay = await idleSample(page);
    check(reducedReplay.renders <= 1, `${name}: reduced motion replay starts continuous animation`);

    await page.mouse.move(5, 5);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(1200);
    const offscreen = await idleSample(page, 800);
    check(offscreen.end.stage.bottom < 0, `${name}: suspension test did not put television offscreen`);
    check(offscreen.renders <= 1, `${name}: offscreen television continues rendering`);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(1000);
    const reentry = await snapshot(page);
    check(reentry.renderCount > offscreen.end.renderCount, `${name}: television does not redraw on re-entry`);
    const liveTargets = await pointerTargets(page);
    await page.mouse.move(liveTargets.screen.x, liveTargets.screen.y);
    await page.waitForFunction(() => document.querySelector('#crt-stage')?.dataset.screenActive === 'true', null, { timeout: 3000 });
    let contextRecovery;
    if (dpr === 1) {
      await page.mouse.move(5, 5);
      await page.evaluate(() => window.crtTelevision.renderer.forceContextLoss());
      await page.waitForFunction(() => document.querySelector('#crt-stage')?.dataset.ready !== 'true', null, { timeout: 3000 });
      await page.waitForTimeout(300);
      const lost = await idleSample(page);
      check(lost.end.poster?.visible && lost.end.poster?.loaded, `${name}: context loss does not restore poster`);
      check(lost.renders === 0, `${name}: context loss does not suspend rendering`);
      await page.screenshot({ path: `${out}/context-loss-fallback.png` });
      await page.evaluate(() => window.crtTelevision.renderer.forceContextRestore());
      await page.locator('#crt-stage[data-ready="true"]').waitFor({ timeout: 10000 });
      await page.waitForTimeout(1000);
      const restored = await snapshot(page);
      check(!restored.poster?.visible, `${name}: restored renderer keeps poster visible`);
      check(restored.renderCount > lost.end.renderCount, `${name}: restored renderer never redraws`);
      await page.screenshot({ path: `${out}/context-restored.png` });
      contextRecovery = { lost, restored };
    }
    await page.evaluate(() => window.crtTelevision.destroy());
    const destroyed = await idleSample(page);
    check(!destroyed.end.canvas, `${name}: destroy leaves WebGL canvas attached`);
    check(destroyed.renders === 0, `${name}: destroy does not stop rendering`);
    report.samples.push({ name, modelRequests: session.modelRequests, targets, idle, casing, screen, exited, exitSettleMs, keyboard, replayReset, replaySettled, replaySettleMs, reduced, reducedReplay, offscreen, reentry, contextRecovery, destroyed });
  } finally { await context.close(); }
}

async function mobile() {
  const session = await open('mobile-390x844', { width: 390, height: 844, dpr: 2, mobile: true });
  const { page, context, name } = session;
  try {
    const start = await snapshot(page);
    check(start.intensity === 1 && start.amount === 1, `${name}: CRT missing before first touch`);
    check(start.pageWidth <= 392, `${name}: horizontal overflow`);
    check(start.stage.width > 150 && start.stage.height > 150, `${name}: television is too small to inspect`);
    check(start.stage.bottom <= 844 && start.stage.top >= 0, `${name}: television stage is clipped on initial viewport`);
    await page.screenshot({ path: `${out}/${name}-hero.png` });
    const cdp = await context.newCDPSession(page);
    const x = Math.min(370, Math.max(20, start.stage.x + start.stage.width / 2));
    const y = Math.min(760, Math.max(380, start.stage.y + start.stage.height * 0.8));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 28 }] });
      await page.waitForTimeout(35);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1000);
    const swiped = await snapshot(page);
    check(swiped.scrollY > start.scrollY + 100, `${name}: vertical swipe over TV prevents page scrolling`);
    check(swiped.pageWidth <= 392, `${name}: horizontal overflow after swipe`);
    await page.screenshot({ path: `${out}/${name}-after-swipe.png` });
    report.samples.push({ name, start, swiped });
  } finally { await context.close(); }
}

async function fallback(failure) {
  const session = await open(`failure-${failure}`, { failure });
  const { page, context, name } = session;
  try {
    const state = await snapshot(page);
    check(state.ready !== 'true', `${name}: failed renderer/model marked ready`);
    check(state.poster?.visible && state.poster?.loaded, `${name}: failure leaves no loaded, visible fallback poster`);
    if (failure === 'model') check(session.blockedModels > 0, `${name}: no model request was blocked`);
    await page.screenshot({ path: `${out}/${name}.png` });
    report.samples.push({ name, blockedModels: session.blockedModels, state });
  } finally { await context.close(); }
}

for (const [name, test] of [
  ['desktop-dpr1', () => desktop(1)],
  ['desktop-dpr2', () => desktop(2)],
  ['mobile', mobile],
  ['webgl-fallback', () => fallback('webgl')],
  ['model-fallback', () => fallback('model')],
]) {
  try { await test(); } catch (error) { report.failures.push(`${name}: ${error.stack || error}`); }
  console.log(`${name}: complete`);
}
await browser.close();
report.passed = report.failures.length === 0 && report.errors.length === 0;
await writeFile(`${out}/browser-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failures: report.failures, errors: report.errors,
  report: `${out}/browser-report.json`, scope: report.scope }, null, 2));
if (!report.passed) process.exitCode = 1;
