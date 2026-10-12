import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.env.QA_URL || "http://127.0.0.1:4173";
const out = process.env.QA_OUT || "artifacts/quality-v5/final";
await mkdir(out, { recursive: true });
const report = {
  url,
  at: new Date().toISOString(),
  scope:
    "Actual carousel transforms at 64 phases per full turn; projected triangle-vertex envelopes, all four editions, rest and four hover extremes. Checks visible front-arc rise, depth, scale, spacing and clipping. Geometry sweep skips GPU draws; selected real GPU captures retained. Chrome SwiftShader, not hardware performance.",
  failures: [],
  errors: [],
  runs: [],
};
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
});
const check = (condition, message) => {
  if (!condition) report.failures.push(message);
};
for (const [width, height] of [
  [1190, 820],
  [1440, 900],
  [910, 773],
  [390, 844],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: width === 390,
    hasTouch: width === 390,
  });
  await context.addInitScript(() =>
    sessionStorage.setItem("onepercent-v2-seen", "1"),
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(`${width}: ${e.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .locator('#crt-stage[data-ready="true"]')
    .waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${out}/hero-${width}.png` });
  await page.locator(".pack-orbit").scrollIntoViewIfNeeded();
  await page
    .locator('.pack-orbit[data-volume="ready"]')
    .waitFor({ timeout: 60000 });
  await page.mouse.move(1, 1);
  const moduleURL = await page.evaluate(
    () =>
      performance
        .getEntriesByType("resource")
        .find((r) => /pack-carousel-scene[^/]*\.js/.test(r.name))?.name,
  );
  if (!moduleURL) throw new Error("Loaded carousel module URL missing");
  await page.evaluate(async (url) => {
    const mod = await import(url);
    const type = Object.values(mod).find(
      (v) =>
        typeof v === "function" &&
        v.prototype?.render &&
        v.prototype?.setEdition,
    );
    const render = type.prototype.render;
    type.prototype.render = function (state) {
      window.__qaCarousel = this;
      type.prototype.render = render;
      return render.call(this, state);
    };
  }, moduleURL);
  await page.waitForFunction(() => window.__qaCarousel, { timeout: 10000 });
  await page.evaluate(() => {
    const v = window.__qaCarousel;
    v.qaOriginalRender = v.render.bind(v);
    v.render = () => {};
    v.qaDraw = v.renderer.render.bind(v.renderer);
  });
  const run = {
    width,
    height,
    editions: [],
    overflow: await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  };
  report.runs.push(run);
  check(run.overflow <= 1, `${width}: horizontal overflow ${run.overflow}`);
  for (const edition of ["signature", "original", "blue", "after-hours"]) {
    await page.locator(`#edition-${edition}`).click();
    await page.waitForFunction(
      (id) => {
        const v = window.__qaCarousel;
        return (
          v.pendingEdition?.id === id &&
          v.currentMaterials?.front?.["Printed front"]?.map?.image?.complete
        );
      },
      edition,
      { timeout: 30000 },
    );
    // Wait for the edition's material identity to be installed, not just requested.
    await page.waitForFunction(
      (id) => {
        const v = window.__qaCarousel;
        const expected = document.querySelector(`#edition-${id} img`).src;
        return (
          v.items[0].model.getObjectByName("Printed front").material.map?.image
            ?.src === expected
        );
      },
      edition,
      { timeout: 10000 },
    );
    await page.waitForFunction(() => !window.__qaCarousel.compiling, {
      timeout: 30000,
    });
    await page.evaluate(() =>
      window.scrollTo({
        top:
          document.querySelector(".pack-display").getBoundingClientRect().top +
          scrollY -
          85,
        behavior: "instant",
      }),
    );
    const data = await page.evaluate(() => {
      const v = window.__qaCarousel,
        r = v.renderer,
        scene = v.scene,
        camera = v.camera;
      const rect = r.domElement.getBoundingClientRect();
      r.render = () => {};
      const project = (g) => {
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        g.traverse((o) => {
          if (!o.isMesh) return;
          const p = o.geometry.attributes.position,
            m = camera.projectionMatrix
              .clone()
              .multiply(camera.matrixWorldInverse)
              .multiply(o.matrixWorld).elements;
          for (let i = 0; i < p.count; i++) {
            const px = p.getX(i),
              py = p.getY(i),
              pz = p.getZ(i),
              w = 1 / (m[3] * px + m[7] * py + m[11] * pz + m[15]);
            const ax = (m[0] * px + m[4] * py + m[8] * pz + m[12]) * w,
              ay = (m[1] * px + m[5] * py + m[9] * pz + m[13]) * w;
            const x = rect.x + ((ax + 1) * rect.width) / 2,
              y = rect.y + ((1 - ay) * rect.height) / 2;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        });
        const anchor = g.position.clone().project(camera);
        return {
          index: g.userData.index,
          minX,
          maxX,
          minY,
          maxY,
          z: g.position.z,
          y: g.position.y,
          scale: g.scale.x,
          anchorX: rect.x + ((anchor.x + 1) * rect.width) / 2,
          anchorY: rect.y + ((1 - anchor.y) * rect.height) / 2,
          visible: g.visible,
        };
      };
      const samples = [];
      let worstGap = Infinity,
        worstOverlap = 0,
        frontClips = 0,
        visibleClips = 0;
      for (let phase = 0; phase < 64; phase++) {
        const angle = (phase * Math.PI) / 32;
        for (const hover of [null, 0]) {
          // Explicit extremes are settled targets, so this tests the full envelope.
          for (const cursor of hover === null
            ? [{ x: 0, y: 0 }]
            : [
                { x: -1, y: -1 },
                { x: -1, y: 1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
              ]) {
            v.rotationX.fill(hover === null ? 0.035 : -cursor.y * 0.19);
            v.rotationY.fill(hover === null ? 0 : cursor.x * 0.28);
            v.qaOriginalRender({
              angle,
              lifts: Array.from({ length: 8 }, (_, i) =>
                hover === i ? 30 : 0,
              ),
              hovered: hover,
              cursor,
              time: 0,
              reducedMotion: false,
              dragging: false,
            });
            scene.updateMatrixWorld(true);
            camera.updateMatrixWorld(true);
            const items = v.items.map((i) => project(i.group));
            const visible = items
              .filter(
                (i) => i.visible && i.maxX > rect.left && i.minX < rect.right,
              )
              .sort((a, b) => a.minX - b.minX);
            const gaps = [];
            for (let i = 1; i < visible.length; i++) {
              const gap = visible[i].minX - visible[i - 1].maxX;
              gaps.push(gap);
              worstGap = Math.min(worstGap, gap);
              worstOverlap = Math.max(worstOverlap, -gap);
            }
            const center = visible
              .slice()
              .sort(
                (a, b) =>
                  Math.abs(
                    (a.minX + a.maxX) / 2 - (rect.left + rect.width / 2),
                  ) -
                  Math.abs(
                    (b.minX + b.maxX) / 2 - (rect.left + rect.width / 2),
                  ),
              )[0];
            if (
              center &&
              (center.minY < rect.top - 1 || center.maxY > rect.bottom + 1)
            )
              frontClips++;
            visibleClips += visible.filter(
              (item) =>
                item.minX >= rect.left &&
                item.maxX <= rect.right &&
                (item.minY < rect.top - 1 || item.maxY > rect.bottom + 1),
            ).length;
            samples.push({ phase, angle, hover, cursor, gaps, items });
          }
        }
      }
      const neutral = samples.find((s) => s.phase === 0 && s.hover === null);
      const front = neutral.items.find((i) => i.index === 0);
      const neighbors = [1, 7].map((index) => {
        const item = neutral.items.find((i) => i.index === index);
        return {
          index,
          risePixels: front.anchorY - item.anchorY,
          riseRelativeToFront:
            (front.anchorY - item.anchorY) / (front.maxY - front.minY),
          depthBehind: front.z - item.z,
          frontScaleRatio: front.scale / item.scale,
        };
      });
      const mesh = v.items[0].model.getObjectByName("Printed front"),
        image = mesh.material.map.image;
      const expected = document.querySelector(
        `#edition-${v.pendingEdition.id} img`,
      ).src;
      const pos = mesh.geometry.attributes.position,
        uv = mesh.geometry.attributes.uv;
      let uvAffineResidual = 0;
      for (let i = 0; i < pos.count; i++)
        uvAffineResidual = Math.max(
          uvAffineResidual,
          Math.abs(pos.getX(i) - (4 * uv.getX(i) - 2)),
          Math.abs(pos.getY(i) - (4 * uv.getY(i) - 2)),
        );
      r.render = v.qaDraw;
      v.rotationX.fill(0.035);
      v.rotationY.fill(0);
      v.qaOriginalRender({
        angle: 0,
        lifts: Array(8).fill(0),
        hovered: null,
        cursor: { x: 0, y: 0 },
        time: 0,
        reducedMotion: false,
        dragging: false,
      });
      return {
        edition: v.pendingEdition.id,
        expected,
        map: image.src,
        flipY: mesh.material.map.flipY,
        colorSpace: mesh.material.map.colorSpace,
        toneMapped: mesh.material.toneMapped,
        uvAffineResidual,
        worstGap,
        worstOverlap,
        frontClips,
        visibleClips,
        curvature: { neighbors, frontHeight: front.maxY - front.minY },
        canvas: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        samples,
      };
    });
    run.editions.push(data);
    check(
      Math.abs(
        data.samples[0].items[0].minX -
          data.samples.find((s) => s.phase === 8 && s.hover === null).items[0]
            .minX,
      ) > 5,
      `${width}/${edition}: sweep did not actually change the pack pose`,
    );
    check(
      data.worstOverlap <= 1,
      `${width}/${edition}: projected silhouettes overlap ${data.worstOverlap.toFixed(2)}px`,
    );
    check(
      data.frontClips === 0,
      `${width}/${edition}: center pack clips at ${data.frontClips} phases`,
    );
    check(
      data.visibleClips === 0,
      `${width}/${edition}: fully visible lateral pack clips vertically at ${data.visibleClips} phases`,
    );
    check(
      data.curvature.neighbors.every(
        (n) =>
          n.riseRelativeToFront >= 0.06 &&
          n.depthBehind > 0.1 &&
          n.frontScaleRatio >= 1.05,
      ),
      `${width}/${edition}: front arc lacks a visible rise, recession, or scale difference`,
    );
    check(
      data.uvAffineResidual < 1e-5,
      `${width}/${edition}: printed image stretched away from native UV proportions (${data.uvAffineResidual})`,
    );
    check(
      data.toneMapped === false,
      `${width}/${edition}: print still passes through cinematic tonemapping`,
    );
    check(
      data.map === data.expected,
      `${width}/${edition}: rendered front differs from selected thumbnail source`,
    );
    check(
      data.flipY === true && data.colorSpace === "srgb",
      `${width}/${edition}: unexpected front texture color or orientation`,
    );
    await page.screenshot({ path: `${out}/carousel-${width}-${edition}.png` });
    if (edition === "signature") {
      await page.evaluate(() => {
        const v = window.__qaCarousel;
        v.qaOriginalRender({
          angle: Math.PI / 8,
          lifts: Array(8).fill(0),
          hovered: null,
          cursor: { x: 0, y: 0 },
          time: 0,
          reducedMotion: false,
          dragging: false,
        });
      });
      await page.screenshot({ path: `${out}/carousel-${width}-halfway.png` });
    }
  }
  await context.close();
  await writeFile(
    `${out}/carousel-report.json`,
    JSON.stringify(report, null, 2),
  );
}
await browser.close();
report.passed = !report.failures.length && !report.errors.length;
await writeFile(`${out}/carousel-report.json`, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      failures: report.failures,
      errors: report.errors,
      runs: report.runs.map((r) => ({
        width: r.width,
        editions: r.editions.map((e) => ({
          edition: e.edition,
          worstGap: e.worstGap,
          worstOverlap: e.worstOverlap,
          frontClips: e.frontClips,
          visibleClips: e.visibleClips,
          curvature: e.curvature,
        })),
      })),
    },
    null,
    2,
  ),
);

if (!report.passed) process.exitCode = 1;
