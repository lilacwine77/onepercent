import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const out = 'artifacts/crt-v3';
const url = process.env.CRT_PREVIEW_URL || 'http://127.0.0.1:5173';
const targeted = process.env.CRT_TARGETED === '1';
await mkdir(out, { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex');
const report = { url, targeted, modelSHA256: hash(await readFile('public/models/onepercent-crt.glb')),
  scope: 'Perceptual regression at 910×773, 1440×900, and 390×844 DPR1 in Chrome ANGLE SwiftShader. Physical mobile GPU precision, frame rate, and touch latency are not measured.',
  failures: [], errors: [], samples: [] };
const check = (condition, message) => { if (!condition) report.failures.push(message); };
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });

const state = page => page.evaluate(() => {
  const t = window.crtTelevision;
  return { rotation: t.pivot.rotation.toArray().slice(0, 3), position: t.pivot.position.toArray(),
    base: t.baseRotation.toArray().slice(0, 3), target: t.target.toArray(), current: t.current.toArray(),
    velocity: t.velocity.toArray(), hoverWeight: t.hoverWeight, renders: t.renderCount, frame: t.frame,
    active: t.container.dataset.screenActive, intensity: t.screenIntensity, reducedMotion: t.reducedMotion,
    amount: t.uniforms.amount.value, pointerInside: t.pointerInside, scrollPaused: t.scrollPaused,
    lastPointerPosition: t.lastPointerPosition, time: t.time, rows: t.uniforms.rows.value, pixel: t.uniforms.pixel.value };
});

async function screenGeometry(page) {
  return page.evaluate(() => {
    const t = window.crtTelevision, screen = t.screenMesh;
    const r = t.renderer.domElement.getBoundingClientRect();
    const pos = screen.geometry.attributes.position, uv = screen.geometry.attributes.uv;
    t.scene.updateMatrixWorld(true); t.camera.updateMatrixWorld(true);
    const project = (u, v) => {
      let best = 0, minimum = Infinity;
      for (let i = 0; i < uv.count; i++) {
        const d = (uv.getX(i) - u) ** 2 + (uv.getY(i) - v) ** 2;
        if (d < minimum) { best = i; minimum = d; }
      }
      const p = screen.localToWorld(screen.position.clone().fromBufferAttribute(pos, best)).project(t.camera);
      return { x: r.x + (p.x + 1) * r.width / 2, y: r.y + (1 - p.y) * r.height / 2, u: uv.getX(best), v: uv.getY(best) };
    };
    const corners = [[.03, .03], [.97, .03], [.03, .97], [.97, .97]].map(([u, v]) => project(u, v));
    const minX = Math.min(...corners.map(p => p.x)), minY = Math.min(...corners.map(p => p.y));
    const maxX = Math.max(...corners.map(p => p.x)), maxY = Math.max(...corners.map(p => p.y));
    const a = project(.4, .5), b = project(.6, .5), c = project(.5, .4), d = project(.5, .6);
    const ax = (b.x - a.x) / (b.u - a.u), ay = (b.y - a.y) / (b.u - a.u), bx = (d.x - c.x) / (d.v - c.v), by = (d.y - c.y) / (d.v - c.v);
    const determinant = ax * by - ay * bx;
    const derivative = (Math.abs(-ay / determinant) + Math.abs(ax / determinant)) / t.renderer.getPixelRatio();
    const input = derivative * t.uniforms.rows.value;
    const k = Math.max(0, Math.min(1, (input - .4) / (.85 - .4)));
    return { center: project(.5, .5), left: project(.12, .5), right: project(.88, .5),
      clip: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      derivative, scanAAInput: input, estimatedScanVisibility: 1 - k * k * (3 - 2 * k),
      stage: { x: r.x, y: r.y, width: r.width, height: r.height }, pageWidth: document.documentElement.scrollWidth };
  });
}

async function settle(page) {
  await page.waitForFunction(() => {
    const t = window.crtTelevision;
    return t && t.hoverWeight === 0 && t.current.lengthSq() === 0 && t.velocity.lengthSq() === 0;
  }, null, { timeout: 20000 });
}

async function difference(a, b) {
  const x = await sharp(`${out}/${a}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const y = await sharp(`${out}/${b}.png`).ensureAlpha().raw().toBuffer();
  if (x.data.length !== y.length) throw new Error(`Mismatched A/B dimensions: ${a}, ${b}`);
  let sum = 0, maximum = 0, changed = 0;
  const pixels = x.info.width * x.info.height;
  for (let i = 0; i < x.data.length; i += 4) {
    let peak = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(x.data[i + channel] - y[i + channel]);
      sum += delta; maximum = Math.max(maximum, delta); peak = Math.max(peak, delta);
    }
    if (peak > 2) changed++;
  }
  return { meanRGBDelta: sum / (pixels * 3), maxChannelDelta: maximum, percentPixelsOver2: changed / pixels * 100 };
}

async function renderEvidence(page, name) {
  await page.mouse.move(5, 5);
  await settle(page);
  const geometry = await screenGeometry(page);
  // Freeze pose/time to prove that scanlines/noise/reflections change real
  // pixels; changing a JS uniform alone is not sufficient evidence.
  await page.evaluate(() => {
    const t = window.crtTelevision;
    t.stop(); t.uniforms.time.value = 2; t.uniforms.amount.value = 0;
    t.scene.environmentRotation.y = 0; t.renderer.render(t.scene, t.camera);
  });
  await page.screenshot({ path: `${out}/${name}-shader-off.png`, clip: geometry.clip });
  await page.evaluate(() => { const t = window.crtTelevision; t.uniforms.amount.value = 1; t.renderer.render(t.scene, t.camera); });
  await page.screenshot({ path: `${out}/${name}-shader-on.png`, clip: geometry.clip });
  await page.evaluate(() => { const t = window.crtTelevision; t.renderer.render(t.scene, t.camera); });
  await page.screenshot({ path: `${out}/${name}-shader-repeat.png`, clip: geometry.clip });
  await page.evaluate(() => { const t = window.crtTelevision; t.uniforms.time.value = 3.25; t.renderer.render(t.scene, t.camera); });
  await page.screenshot({ path: `${out}/${name}-shader-later.png`, clip: geometry.clip });
  await page.evaluate(() => {
    const t = window.crtTelevision;
    t.uniforms.amount.value = 0; t.scene.environmentRotation.y = -.08; t.renderer.render(t.scene, t.camera);
  });
  await page.screenshot({ path: `${out}/${name}-reflection-a.png`, clip: geometry.clip });
  await page.evaluate(() => { const t = window.crtTelevision; t.scene.environmentRotation.y = .08; t.renderer.render(t.scene, t.camera); });
  await page.screenshot({ path: `${out}/${name}-reflection-b.png`, clip: geometry.clip });
  const evidence = {
    geometry,
    shader: await difference(`${name}-shader-off`, `${name}-shader-on`),
    deterministic: await difference(`${name}-shader-on`, `${name}-shader-repeat`),
    temporal: await difference(`${name}-shader-on`, `${name}-shader-later`),
    reflection: await difference(`${name}-reflection-a`, `${name}-reflection-b`),
    precision: await page.evaluate(() => {
      const t = window.crtTelevision, gl = t.renderer.getContext();
      const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const program = t.renderer.info.programs.find(p => gl.getShaderSource(p.fragmentShader)?.includes('crtHash'));
      return { bits: precision.precision, highp: !!program && gl.getShaderSource(program.fragmentShader).includes('precision highp float') };
    }),
  };
  check(evidence.geometry.estimatedScanVisibility > .05, `${name}: AA filter suppresses scanlines at screen center`);
  check(evidence.shader.meanRGBDelta > 1 && evidence.shader.percentPixelsOver2 > 10, `${name}: CRT shader barely changes screen pixels`);
  check(evidence.temporal.meanRGBDelta > .3 && evidence.temporal.percentPixelsOver2 > 5, `${name}: fixed-pose CRT broadcast does not visibly animate`);
  check(evidence.deterministic.maxChannelDelta === 0, `${name}: frozen shader changes between identical renders`);
  check(evidence.reflection.maxChannelDelta > 10 && evidence.reflection.percentPixelsOver2 > 1, `${name}: environment reflections barely affect actual screen pixels`);
  check(evidence.precision.highp && evidence.precision.bits >= 23, `${name}: test GPU did not compile highp CRT shader`);
  await page.evaluate(() => { const t = window.crtTelevision; t.scene.environmentRotation.y = 0; t.uniforms.amount.value = 1; t.invalidate(); });
  return evidence;
}

async function run(width, height, mobile = false) {
  const name = `final-${width}`;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen', '1'));
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`${name}: ${m.text()}`); });
  try {
    const responsePromise = page.waitForResponse(r => r.url().includes('/models/onepercent-crt.glb'), { timeout: 45000 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('#crt-stage[data-ready="true"]').waitFor({ timeout: 45000 });
    const response = await responsePromise;
    const servedHash = hash(await response.body());
    check(servedHash === report.modelSHA256, `${name}: server model differs from canonical public GLB`);
    await page.waitForTimeout(1100);
    const geometry = await screenGeometry(page), initial = await state(page);
    await page.waitForFunction(s => window.crtTelevision.renderCount > s.renders && window.crtTelevision.time > s.time, initial, { timeout: 10000 });
    const initialAdvanced = await state(page);
    check(initial.intensity === 1 && initial.amount === 1, `${name}: CRT is absent before the first pointer interaction`);
    check(initialAdvanced.renders > initial.renders && initialAdvanced.time > initial.time, `${name}: CRT does not animate without hovering`);
    check(initialAdvanced.rotation.every((v, i) => Math.abs(v - initialAdvanced.base[i]) < .0001), `${name}: television rotates without pointer interaction`);
    check(geometry.pageWidth <= width + 2, `${name}: horizontal overflow`);
    await page.screenshot({ path: `${out}/${name}-idle.png` });
    let motion;
    if (!mobile) {
      const casingPoint = await page.evaluate(() => {
        const t = window.crtTelevision, mesh = t.model.getObjectByName('CRT_PowerButton');
        mesh.geometry.computeBoundingBox();
        t.scene.updateMatrixWorld(true); t.camera.updateMatrixWorld(true);
        const p = mesh.localToWorld(mesh.geometry.boundingBox.getCenter(mesh.position.clone())).project(t.camera);
        const r = t.renderer.domElement.getBoundingClientRect();
        t.raycaster.setFromCamera(t.pointer.clone().set(p.x, p.y), t.camera);
        return { x: r.x + (p.x + 1) * r.width / 2, y: r.y + (1 - p.y) * r.height / 2,
          hit: t.raycaster.intersectObject(t.model, true)[0]?.object.name };
      });
      check(!!casingPoint.hit && casingPoint.hit !== 'CRT_Screen', `${name}: casing test point misses the actual case`);
      await page.mouse.move(casingPoint.x, casingPoint.y); await page.waitForTimeout(800);
      const casing = await state(page);
      check(casing.intensity === 1 && casing.amount === 1, `${name}: casing hover changes permanent CRT intensity`);
      await page.mouse.move(geometry.left.x, geometry.left.y); await page.waitForTimeout(900);
      const left = await state(page);
      await page.screenshot({ path: `${out}/${name}-left.png` });
      await page.mouse.move(geometry.right.x, geometry.right.y); await page.waitForTimeout(900);
      const right = await state(page);
      await page.screenshot({ path: `${out}/${name}-right.png` });
      const yawSpan = Math.abs(right.rotation[1] - left.rotation[1]);
      check(yawSpan > .05, `${name}: pointer span gives imperceptible yaw (${yawSpan} rad)`);
      await page.mouse.move(5, 5); await settle(page);
      const center = geometry.center;
      await page.mouse.move(center.x, center.y);
      await page.waitForFunction(() => window.crtTelevision.screenIntensity > .9, null, { timeout: 10000 });
      await page.waitForTimeout(1000);
      const hold = [];
      for (let i = 0; i < 6; i++) { hold.push(await state(page)); if (i < 5) await page.waitForTimeout(400); }
      const drift = Math.max(...[0, 1, 2].map(axis => Math.max(...hold.map(s => s.rotation[axis])) - Math.min(...hold.map(s => s.rotation[axis]))));
      const floating = Math.max(...hold.map(s => s.position[1])) - Math.min(...hold.map(s => s.position[1]));
      check(drift > .003, `${name}: held hover stops moving (${drift} rad drift)`);
      check(floating > .005, `${name}: held hover has no visible float`);
      check(hold.at(-1).renders > hold[0].renders + 2, `${name}: stationary screen hover stops its animation loop`);
      check(hold.every(s => s.active === 'true'), `${name}: screen raycast flickers off during held hover`);
      check(hold.every(s => Math.abs(s.target[0]) < .08 && Math.abs(s.rotation[1] - s.base[1]) < .035), `${name}: center hover introduces a left/right yaw bias`);
      await page.screenshot({ path: `${out}/${name}-screen-hover.png` });
      await page.mouse.move(5, 5); await settle(page);
      const resting = await state(page);
      await page.waitForFunction(s => window.crtTelevision.renderCount > s.renders && window.crtTelevision.time > s.time, resting, { timeout: 10000 });
      const restingAdvanced = await state(page);
      check(restingAdvanced.amount === 1 && restingAdvanced.intensity === 1, `${name}: pointer exit removes permanent CRT`);
      check(resting.rotation.every((v, i) => Math.abs(v - resting.base[i]) < .0001) && resting.position.every(v => Math.abs(v) < .0001), `${name}: spring does not return to neutral pose`);
      await page.mouse.move(center.x, center.y);
      await page.waitForFunction(() => window.crtTelevision.screenIntensity > .5, null, { timeout: 10000 });
      const resumed = await state(page);
      check(resumed.renders > resting.renders, `${name}: permanent CRT stops after pointer re-entry`);

      // The pointer remains at the same client coordinates as scrolling moves
      // the canvas underneath it. This must not tilt the TV left again.
      const fixedPointer = geometry.left;
      await page.mouse.move(fixedPointer.x, fixedPointer.y); await page.waitForTimeout(700);
      const beforeScroll = await state(page);
      await page.mouse.wheel(0, 120);
      await page.waitForFunction(() => window.crtTelevision.scrollPaused && !window.crtTelevision.pointerInside, null, { timeout: 10000 });
      await settle(page);
      const afterScroll = await state(page);
      check(afterScroll.target.every(v => v === 0) && afterScroll.rotation.every((v, i) => Math.abs(v - afterScroll.base[i]) < .0001), `${name}: scroll leaves television tilted`);
      check(afterScroll.amount === 1 && afterScroll.time > beforeScroll.time, `${name}: scroll stops visible CRT effect`);
      await page.mouse.move(fixedPointer.x, fixedPointer.y); await page.waitForTimeout(300);
      const samePosition = await state(page);
      check(samePosition.scrollPaused && !samePosition.pointerInside && samePosition.target.every(v => v === 0), `${name}: unchanged client coordinates reactivate hover after scroll`);
      await page.mouse.move(fixedPointer.x + 12, fixedPointer.y);
      await page.waitForFunction(() => !window.crtTelevision.scrollPaused && window.crtTelevision.pointerInside, null, { timeout: 10000 });
      const realMovement = await state(page);
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForFunction(() => scrollY < 1, null, { timeout: 10000 });
      await settle(page);
      await page.screenshot({ path: `${out}/${name}-after-scroll.png` });

      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await page.waitForFunction(() => !window.crtTelevision.visible && window.crtTelevision.frame === 0, null, { timeout: 10000 });
      const offscreenA = await state(page); await page.waitForTimeout(400); const offscreenB = await state(page);
      check(offscreenB.renders === offscreenA.renders && offscreenB.time === offscreenA.time, `${name}: offscreen permanent CRT continues animating`);
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForFunction(s => window.crtTelevision.visible && window.crtTelevision.renderCount > s.renders, offscreenB, { timeout: 10000 });
      await settle(page);
      const backOnscreen = await state(page);
      check(backOnscreen.intensity === 1 && backOnscreen.amount === 1, `${name}: onscreen re-entry loses CRT effect`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => window.crtTelevision.reducedMotion === true && window.crtTelevision.frame === 0, null, { timeout: 10000 });
      const reducedA = await state(page); await page.waitForTimeout(500); const reducedB = await state(page);
      check(reducedB.reducedMotion && reducedB.renders === reducedA.renders, `${name}: reduced motion continues animation`);
      check(reducedB.intensity === 1 && reducedB.amount === 1 && reducedB.time === 0 && reducedB.position.every(v => Math.abs(v) < .0001), `${name}: reduced motion fails to preserve static CRT with neutral pose`);
      await page.screenshot({ path: `${out}/${name}-reduced-static-crt.png` });
      await page.mouse.move(5, 5); await page.emulateMedia({ reducedMotion: 'no-preference' }); await settle(page);
      motion = { casingPoint, casing, left, right, yawSpan, yawDegrees: yawSpan * 180 / Math.PI, hold, drift, floating, resting, restingAdvanced, resumed,
        beforeScroll, afterScroll, samePosition, realMovement, offscreenA, offscreenB, backOnscreen, reducedA, reducedB };
    } else {
      await page.touchscreen.tap(geometry.center.x, geometry.center.y);
      await page.waitForFunction(() => window.crtTelevision.screenIntensity > .1, null, { timeout: 10000 });
      const tapped = await state(page);
      await page.screenshot({ path: `${out}/${name}-tap.png` });
      await settle(page);
      motion = { tapped, rested: await state(page) };
    }
    let contextRecovery;
    if (width === 910 && !targeted) {
      await page.evaluate(() => window.crtTelevision.renderer.forceContextLoss());
      await page.waitForFunction(() => document.querySelector('#crt-stage').dataset.ready !== 'true', null, { timeout: 5000 });
      const loss = await state(page); await page.waitForTimeout(400);
      check((await state(page)).renders === loss.renders, `${name}: context loss keeps rendering`);
      check(await page.locator('.crt-poster').evaluate(el => Number(getComputedStyle(el).opacity) > .99), `${name}: context loss does not reveal fallback poster`);
      await page.evaluate(() => window.crtTelevision.renderer.forceContextRestore());
      await page.locator('#crt-stage[data-ready="true"]').waitFor({ timeout: 10000 });
      await settle(page);
      const restored = await state(page);
      check(restored.renders > loss.renders, `${name}: restored context does not redraw`);
      check(await page.locator('.crt-poster').evaluate(el => Number(getComputedStyle(el).opacity) < .01), `${name}: restored context keeps fallback poster`);
      await page.screenshot({ path: `${out}/${name}-context-restored.png` });
      contextRecovery = { loss, restored };
    }
    const evidence = targeted ? null : await renderEvidence(page, name);
    await settle(page);
    const beforeDestroy = await page.evaluate(() => { const t = window.crtTelevision, renders = t.renderCount; t.destroy(); t.destroy(); return renders; });
    await page.waitForTimeout(400);
    const destroyed = await state(page);
    check(destroyed.renders === beforeDestroy && destroyed.frame === 0, `${name}: destroy does not stop rendering`);
    check(await page.locator('#crt-stage canvas').count() === 0, `${name}: destroy leaves canvas attached`);
    report.samples.push({ name, servedHash, geometry, initial, initialAdvanced, motion, contextRecovery, evidence, destroyed });
  } finally { await context.close(); }
}

try {
  for (const [width, height, mobile] of [[910, 773, false], [1440, 900, false], [390, 844, true]]) {
    try { await run(width, height, mobile); } catch (error) { report.failures.push(`${width}: ${error.stack || error}`); }
    console.log(`${width}: checked`);
  }
} finally { await browser.close(); }
report.passed = report.failures.length === 0 && report.errors.length === 0;
await writeFile(`${out}/browser-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failures: report.failures, errors: report.errors, report: `${out}/browser-report.json` }, null, 2));
if (!report.passed) process.exitCode = 1;
