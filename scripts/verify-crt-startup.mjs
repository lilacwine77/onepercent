import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const url = process.env.QA_URL || "http://127.0.0.1:4173";
const phase = process.env.QA_PHASE || "baseline";
const out = `artifacts/crt-startup-v1/${phase}`;
const modes = (process.env.QA_GPU_MODES || "default,swiftshader").split(",");
const report = {
  url,
  phase,
  at: new Date().toISOString(),
  scope:
    "Fresh Chrome processes and browser contexts, HTTP cache disabled and empty sessionStorage, 910×773 DPR1.75. Timings include temporary instrumentation. GPU identity is measured, never inferred from launch flags.",
  runs: [],
  errors: [],
};
await mkdir(out, { recursive: true });

function instrument() {
  const q = (window.__startup = {
    events: [],
    tasks: [],
    frames: [],
    heartbeat: [],
    input: [],
    gl: [],
    renderers: [],
    resources: [],
    renders: [],
    finished: false,
  });
  window.__startupMark = (name, data = {}) =>
    q.events.push({ name, t: performance.now(), ...data });
  const mark = window.__startupMark;
  for (const name of [
    "DOMContentLoaded",
    "onepercent:entrance-reveal",
    "onepercent:entrance-complete",
    "crt:ready",
  ])
    document.addEventListener(name, () => mark(name), true);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      q.tasks.push({
        t: e.startTime,
        duration: e.duration,
        attribution: e.attribution?.map((a) => ({
          name: a.name,
          container: a.containerName,
        })),
      });
  }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => {
    for (const r of list.getEntries())
      q.resources.push({
        name: r.name,
        start: r.startTime,
        end: r.responseEnd,
        duration: r.duration,
        transfer: r.transferSize,
        decoded: r.decodedBodySize,
      });
  }).observe({ type: "resource", buffered: true });
  let lastFrame,
    lastStyle = 0,
    lastPresentation = "";
  const frame = (timestamp) => {
    const now = performance.now();
    if (lastFrame !== undefined)
      q.frames.push({ t: now, dt: now - lastFrame, timestamp });
    lastFrame = now;
    if (now - lastStyle > 80) {
      lastStyle = now;
      const poster = document.querySelector(".crt-poster"),
        stage = document.querySelector("#crt-stage");
      if (poster && stage) {
        const state = {
          poster: +getComputedStyle(poster).opacity,
          canvas: +getComputedStyle(stage).opacity,
          ready: stage.dataset.ready || null,
        };
        const text = JSON.stringify(state);
        if (text !== lastPresentation) {
          lastPresentation = text;
          mark("presentation", state);
        }
      }
    }
    if (!q.finished) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  let beat = performance.now();
  const heartbeat = setInterval(() => {
    const t = performance.now();
    q.heartbeat.push({ t, dt: t - beat });
    beat = t;
    if (q.finished) clearInterval(heartbeat);
  }, 16);
  document.addEventListener(
    "pointermove",
    (event) => {
      q.input.push({
        t: performance.now(),
        eventTime: event.timeStamp,
        delay: Math.max(0, performance.now() - event.timeStamp),
        x: event.clientX,
        y: event.clientY,
        ready: document.querySelector("#crt-stage")?.dataset.ready || null,
      });
    },
    { capture: true, passive: true },
  );
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    const t = performance.now(),
      result = getContext.call(this, type, ...args);
    if (type.startsWith("webgl") && result) {
      const ext = result.getExtension("WEBGL_debug_renderer_info");
      mark("webgl-context", {
        duration: performance.now() - t,
        renderer: ext
          ? result.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : result.getParameter(result.RENDERER),
        vendor: ext
          ? result.getParameter(ext.UNMASKED_VENDOR_WEBGL)
          : result.getParameter(result.VENDOR),
        parallelCompile: !!result.getExtension("KHR_parallel_shader_compile"),
      });
    }
    return result;
  };
  for (const Type of [
    window.WebGLRenderingContext,
    window.WebGL2RenderingContext,
  ].filter(Boolean)) {
    for (const name of [
      "texImage2D",
      "texSubImage2D",
      "bufferData",
      "compileShader",
      "linkProgram",
      "getProgramParameter",
      "getParameter",
      "getExtension",
    ]) {
      if (!Object.prototype.hasOwnProperty.call(Type.prototype, name)) continue;
      const original = Type.prototype[name];
      Type.prototype[name] = function (...args) {
        const t = performance.now();
        const value = original.apply(this, args);
        const duration = performance.now() - t;
        if (duration > 2)
          q.gl.push({
            name,
            t,
            duration,
            query:
              name === "getParameter" || name === "getExtension"
                ? args[0]
                : undefined,
          });
        return value;
      };
    }
  }
  window.__THREE_DEVTOOLS__ = new EventTarget();
  window.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
    const renderer = event.detail;
    if (!renderer.isWebGLRenderer) return;
    const id = q.renderers.length;
    q.renderers.push(renderer);
    mark("renderer-ready", { id });
    const render = renderer.render.bind(renderer);
    renderer.render = (...args) => {
      const t = performance.now();
      const result = render(...args);
      q.renders.push({
        t,
        duration: performance.now() - t,
        class: renderer.domElement.className,
        id,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      });
      return result;
    };
    const compile = renderer.compileAsync.bind(renderer);
    const initTexture = renderer.initTexture.bind(renderer);
    renderer.initTexture = (texture) => {
      const t = performance.now();
      const value = initTexture(texture);
      mark("texture-upload", {
        duration: performance.now() - t,
        width: texture.image?.width,
        height: texture.image?.height,
      });
      return value;
    };
    renderer.compileAsync = (...args) => {
      const t = performance.now();
      mark("compile-start");
      const promise = compile(...args);
      mark("compile-sync-return", { duration: performance.now() - t });
      return promise.then((result) => {
        mark("compile-end", { duration: performance.now() - t });
        return result;
      });
    };
  });
}

function instrumentModule(source) {
  const match = source.match(/export\{([\w$]+) as CRTTelevision\}/);
  if (!match)
    throw new Error(
      "CRT export not found; phase instrumentation was not applied",
    );
  const className = match[1];
  // These additions exist only in the browser response; repository/dist bytes
  // stay untouched. Public method wrappers add timing, not behavior changes.
  source = source.replace(
    /this\.model=([\w$]+\.scene)/,
    '(window.__startupMark("model-parsed"),this.model=$1)',
  );
  source = source.replace(
    /this\.environment=([\w$]+)/,
    '(window.__startupMark("studio-ready"),this.environment=$1)',
  );
  const patch = `
window.__startupMark('crt-module-evaluated');
for(const method of ['makeStudio','resize','prepareRenderer','draw']){
  const original=${className}.prototype[method];
  if(typeof original!=='function')continue;
  ${className}.prototype[method]=function(...args){
    const t=performance.now(), first=method==='draw'&&this.renderCount===0;
    if(method!=='draw'||first)window.__startupMark(method+'-start',{first});
    const value=original.apply(this,args);
    const duration=performance.now()-t;
    if(value&&typeof value.then==='function'){
      window.__startupMark(method+'-sync-return',{duration});
      return value.then(result=>{window.__startupMark(method+'-end',{duration:performance.now()-t,async:true});return result;});
    }
    if(method!=='draw'||first||duration>50)window.__startupMark(method+'-end',{duration,first,renders:this.renderCount});
    return value;
  };
}
class QAStartupCRT extends ${className}{constructor(...args){const t=performance.now();window.__startupMark('constructor-start');super(...args);window.__startupMark('constructor-end',{duration:performance.now()-t});this.ready.then(()=>window.__startupMark('crt-ready-promise'));}}
export{QAStartupCRT as CRTTelevision};`;
  return source.replace(match[0] + ";", patch);
}

function summarize(data) {
  const entry = (name) => data.events.find((e) => e.name === name);
  const intro = entry("onepercent:entrance-complete")?.t || 0,
    ready = entry("crt:ready")?.t || Infinity;
  const quantiles = (items) => {
    const a = items.slice().sort((a, b) => a - b);
    return {
      count: a.length,
      max: a.at(-1) || 0,
      p95: a[Math.floor(a.length * 0.95)] || 0,
    };
  };
  return {
    introComplete: intro,
    tvReady: Number.isFinite(ready) ? ready : null,
    afterIntroUntilTVReady: ready - intro,
    timings: data.events.filter((e) =>
      [
        "constructor-end",
        "makeStudio-end",
        "compile-sync-return",
        "compile-end",
        "draw-end",
        "resize-end",
      ].includes(e.name),
    ),
    longTasksAfterIntro: data.tasks.filter((e) => e.t + e.duration > intro),
    rafAfterIntro: quantiles(
      data.frames.filter((e) => e.t > intro).map((e) => e.dt),
    ),
    heartbeatAfterIntro: quantiles(
      data.heartbeat.filter((e) => e.t > intro).map((e) => e.dt),
    ),
    inputsAfterIntro: quantiles(
      data.input.filter((e) => e.t > intro).map((e) => e.delay),
    ),
    biggestGLCalls: data.gl
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 15),
    slowRenders: data.renders.filter((r) => r.duration > 50),
    presentation: data.events.filter((e) => e.name === "presentation"),
  };
}

for (const mode of modes) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args:
      mode === "swiftshader"
        ? ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"]
        : [],
  });
  const context = await browser.newContext({
    viewport: { width: 910, height: 773 },
    deviceScaleFactor: 1.75,
  });
  await context.addInitScript(instrument);
  const page = await context.newPage(),
    cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  let moduleURL;
  await page.route(/\/assets\/crt-tv-[^/]+\.js$/, async (route) => {
    const response = await route.fetch();
    moduleURL = route.request().url();
    await route.fulfill({
      response,
      body: instrumentModule(await response.text()),
    });
  });
  const sentInputs = [];
  let pointerTimer;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    let count = 0;
    pointerTimer = setInterval(() => {
      const at = Date.now(),
        x = 570 + Math.sin(count * 0.4) * 60,
        y = 325 + Math.cos(count * 0.31) * 50;
      count++;
      cdp
        .send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          timestamp: at / 1000,
        })
        .then(() => sentInputs.push({ at, ackDelay: Date.now() - at }))
        .catch(() => {});
    }, 120);
    await page
      .locator('#crt-stage[data-ready="true"]')
      .waitFor({ timeout: 90000 });
    await page.waitForTimeout(3500);
    clearInterval(pointerTimer);
    await page.mouse.move(3, 3);
    await page.evaluate(() => {
      window.__startup.finished = true;
    });
    const data = await page.evaluate(() => {
      const { renderers, ...data } = window.__startup;
      return {
        ...data,
        renderers: renderers.map((r) => ({
          width: r.domElement.width,
          height: r.domElement.height,
          dpr: r.getPixelRatio(),
          class: r.domElement.className,
        })),
        model: window.crtTelevision && {
          renders: window.crtTelevision.renderCount,
          time: window.crtTelevision.time,
        },
        sessionStorage: Object.keys(sessionStorage),
      };
    });
    const run = {
      mode,
      moduleURL,
      errors,
      data,
      sentInputs,
      summary: summarize(data),
    };
    report.runs.push(run);
    await page.screenshot({ path: `${out}/${mode}-ready.png` });
    await writeFile(`${out}/${mode}.json`, JSON.stringify(run, null, 2));
    console.log(
      JSON.stringify(
        {
          mode,
          renderer: data.events.find((e) => e.name === "webgl-context"),
          summary: run.summary,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    report.errors.push({ mode, error: error.stack || String(error) });
  } finally {
    clearInterval(pointerTimer);
    await browser.close();
  }
}
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 1;
