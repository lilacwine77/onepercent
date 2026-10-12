/** Browser observations and media facts shared by the in-TV film checks. No product state is mutated. */

/** The film the checks expect (docs/concept-video.md). */
export const filmFacts = {
  seconds: 25,
  frames: 1500,
  fps: 60,
  width: 1280,
  height: 720,
  // Natural frames worth a look: the CRT power-on, then the beats (Feed and
  // its ROI card, the Rip close-up, the Dust Cards, the hit, the Sell, The 1%);
  // the end card holds from 22 s to the last frame.
  beats: [
    ["power-on", 0.15],
    ["xray", 2.5],
    ["feed", 5.2],
    ["roi", 7.4],
    ["rip", 8.2],
    ["dust-cards", 12.2],
    ["rip-hit", 14.6],
    ["sell", 18.6],
    ["one-percent", 21],
    ["end-card", 24.5],
  ],
};

export const filmSelectors = {
  dialog: "#concept-video-dialog",
  video: "#concept-film",
  watch: "[data-watch-film]",
  close: "[data-concept-close]",
  stage: "#crt-stage",
  poster: ".crt-poster",
  play: "[data-film-play]",
  replay: "[data-film-replay]",
  seek: "[data-film-seek]",
  mute: "[data-film-mute]",
  captions: "[data-film-captions]",
  caption: "[data-film-caption]",
};

export async function inspectFilm(page, selectors = filmSelectors) {
  return page.evaluate((s) => {
    const video = document.querySelector(s.video);
    const panel = document.querySelector(s.dialog);
    const tv = window.crtTelevision;
    const elementRect = (element) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        display: style.display,
        visibility: style.visibility,
        opacity: +style.opacity,
      };
    };
    function projectedBounds(meshes) {
      if (!tv?.camera || !tv?.renderer) return null;
      const rect = tv.renderer.domElement.getBoundingClientRect();
      const point = tv.camera.position.clone();
      const bounds = {
        left: Infinity,
        top: Infinity,
        right: -Infinity,
        bottom: -Infinity,
      };
      let vertices = 0;
      for (const mesh of meshes) {
        const positions = mesh.geometry?.attributes?.position;
        if (!positions || !mesh.visible) continue;
        for (let i = 0; i < positions.count; i++) {
          point
            .fromBufferAttribute(positions, i)
            .applyMatrix4(mesh.matrixWorld)
            .project(tv.camera);
          const x = rect.x + ((point.x + 1) * rect.width) / 2;
          const y = rect.y + ((1 - point.y) * rect.height) / 2;
          bounds.left = Math.min(bounds.left, x);
          bounds.right = Math.max(bounds.right, x);
          bounds.top = Math.min(bounds.top, y);
          bounds.bottom = Math.max(bounds.bottom, y);
          vertices++;
        }
      }
      return vertices
        ? {
            ...bounds,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top,
            vertices,
          }
        : null;
    }
    tv?.scene?.updateMatrixWorld(true);
    tv?.camera?.updateMatrixWorld(true);
    const meshes = [];
    tv?.model?.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
    const screen = tv?.screenMesh;
    const materials = screen ? [screen.material].flat() : [];
    const videoTextures = [];
    for (const [name, uniform] of Object.entries(tv?.uniforms || {})) {
      const value = uniform?.value;
      if (value?.isVideoTexture)
        videoTextures.push({
          name: `tv.uniforms.${name}`,
          videoMatches: value.image === video,
          colorSpace: value.colorSpace,
          flipY: value.flipY,
          version: value.version,
        });
    }
    for (const material of materials) {
      for (const [name, value] of Object.entries(material)) {
        if (value?.isVideoTexture)
          videoTextures.push({
            name,
            videoMatches: value.image === video,
            colorSpace: value.colorSpace,
            flipY: value.flipY,
            version: value.version,
          });
      }
      for (const [name, uniform] of Object.entries(material.uniforms || {})) {
        const value = uniform?.value;
        if (value?.isVideoTexture)
          videoTextures.push({
            name,
            videoMatches: value.image === video,
            colorSpace: value.colorSpace,
            flipY: value.flipY,
            version: value.version,
          });
      }
    }
    return {
      now: performance.now(),
      hidden: document.hidden,
      open:
        panel instanceof HTMLDialogElement
          ? panel.open
          : panel?.getAttribute("aria-hidden") === "false",
      modal: panel?.matches(":modal") || false,
      panelRole: panel?.getAttribute("role"),
      panelDataset: { ...panel?.dataset },
      title:
        document
          .getElementById(panel?.getAttribute("aria-labelledby"))
          ?.textContent?.trim() || panel?.getAttribute("aria-label"),
      panelRect: elementRect(panel),
      stageRect: elementRect(document.querySelector(s.stage)),
      stageInPanel: !!panel?.contains(document.querySelector(s.stage)),
      controls: Object.fromEntries(
        ["play", "replay", "seek", "mute", "captions", "close"].map((key) => {
          const element = document.querySelector(s[key]);
          return [
            key,
            {
              rect: elementRect(element),
              text: element?.textContent?.trim(),
              label: element?.getAttribute("aria-label"),
              pressed: element?.getAttribute("aria-pressed"),
              min: element?.min,
              max: element?.max,
              value: element?.value,
            },
          ];
        }),
      ),
      caption: {
        text: document.querySelector(s.caption)?.textContent,
        hidden: document.querySelector(s.caption)?.hidden,
        rect: elementRect(document.querySelector(s.caption)),
      },
      videoRect: elementRect(video),
      posterRect: elementRect(document.querySelector(s.poster)),
      focus: {
        inside: !!panel?.contains(document.activeElement),
        watch: !!document.activeElement?.matches(s.watch),
        tag: document.activeElement?.tagName,
        hasDocumentFocus: document.hasFocus(),
      },
      scrollY,
      overflow: document.documentElement.scrollWidth - innerWidth,
      media: video
        ? {
            source: video.currentSrc || video.getAttribute("src"),
            poster: video.getAttribute("poster"),
            preload: video.preload,
            autoplay: video.autoplay,
            inline: video.playsInline,
            controls: video.controls,
            paused: video.paused,
            ended: video.ended,
            time: video.currentTime,
            duration: Number.isFinite(video.duration) ? video.duration : null,
            width: video.videoWidth,
            height: video.videoHeight,
            readyState: video.readyState,
            muted: video.muted,
            volume: video.volume,
            rate: video.playbackRate,
            error: video.error?.message || null,
            tracks: [...video.querySelectorAll("track")].map((track) => ({
              kind: track.kind,
              language: track.srclang,
              source: track.getAttribute("src"),
              ready: track.readyState,
              mode: track.track.mode,
              cues: [...(track.track.cues || [])].map((cue) => ({
                start: cue.startTime,
                end: cue.endTime,
                text: cue.text,
              })),
            })),
          }
        : null,
      television: tv
        ? {
            created: true,
            renderReady: tv.renderReady,
            paused: tv.paused,
            contextLost: tv.contextLost,
            reduced: tv.reducedMotion,
            visible: tv.visible,
            renders: tv.renderCount,
            frame: tv.frame,
            time: tv.time,
            current: tv.current?.toArray(),
            cameraPosition: tv.camera?.position.toArray(),
            isFilmActive: tv.isFilmActive,
            film: tv.film
              ? {
                  phase: tv.film.phase,
                  progress: tv.film.progress,
                  videoMatches: tv.film.video === video,
                  videoTexture: !!tv.film.texture?.isVideoTexture,
                  hasVideoFrame: tv.film.hasVideoFrame,
                  revealPhase: tv.film.revealPhase,
                  revealProgress: tv.film.revealProgress,
                }
              : null,
            filmScreenBounds: tv.getFilmScreenBounds?.(),
            frameScale: tv.uniforms?.frameScale?.value?.toArray(),
            heroMapRestored: !screen?.material.map?.isVideoTexture,
            cameraQuaternion: tv.camera?.quaternion.toArray(),
            cameraZoom: tv.camera?.zoom,
            pivotPosition: tv.pivot?.position.toArray(),
            pivotQuaternion: tv.pivot?.quaternion.toArray(),
            stageDataset: { ...tv.container?.dataset },
            screenBounds: projectedBounds(screen ? [screen] : []),
            modelBounds: projectedBounds(meshes),
            uniforms: Object.fromEntries(
              Object.entries(tv.uniforms || {})
                .filter(([, u]) => typeof u?.value === "number")
                .map(([name, u]) => [name, u.value]),
            ),
            videoTextures,
          }
        : { created: false },
    };
  }, selectors);
}

export async function televisionPoints(page) {
  return page.evaluate(() => {
    const tv = window.crtTelevision;
    if (!tv?.model || !tv?.screenMesh) return null;
    const rect = tv.renderer.domElement.getBoundingClientRect();
    tv.scene.updateMatrixWorld(true);
    tv.camera.updateMatrixWorld(true);
    const ray = new tv.raycaster.constructor();
    const pointer = tv.pointer.clone();
    const box = tv.screenMesh.geometry.boundingBox;
    const center = box.getCenter(tv.screenMesh.position.clone());
    center.z = box.max.z;
    tv.screenMesh.localToWorld(center).project(tv.camera);
    const screen = {
      x: rect.x + ((center.x + 1) * rect.width) / 2,
      y: rect.y + ((1 - center.y) * rect.height) / 2,
    };
    const points = [];
    let empty;
    for (let y = 0.06; y <= 0.94; y += 0.04) {
      for (let x = 0.06; x <= 0.94; x += 0.04) {
        pointer.set(x * 2 - 1, 1 - y * 2);
        ray.setFromCamera(pointer, tv.camera);
        const mesh = ray.intersectObject(tv.model, true)[0]?.object;
        const point = {
          x: rect.x + x * rect.width,
          y: rect.y + y * rect.height,
          mesh: mesh?.name,
          body:
            !!mesh &&
            mesh !== tv.screenMesh &&
            /Body|Case|Bezel|Housing/i.test(mesh.name),
        };
        points.push(point);
        if (!mesh && !empty) empty = point;
      }
    }
    const outside = points.filter((p) => !p.body);
    const body = points
      .filter((p) => p.body)
      .map((p) => ({
        ...p,
        margin: Math.sqrt(
          Math.min(...outside.map((q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2)),
        ),
      }))
      .sort((a, b) => b.margin - a.margin)[0];
    return { screen, body, empty };
  });
}

export async function posterPoints(page, selector = filmSelectors.poster) {
  return page.evaluate((s) => {
    const image = document.querySelector(s),
      rect = image.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const scale = Math.min(
      rect.width / canvas.width,
      rect.height / canvas.height,
    );
    const offsetX = rect.x + (rect.width - canvas.width * scale) / 2;
    const offsetY = rect.y + (rect.height - canvas.height * scale) / 2;
    const candidates = [];
    for (let y = 0.1; y < 0.9; y += 0.05)
      for (let x = 0.1; x < 0.9; x += 0.05) {
        const px = Math.round(x * canvas.width),
          py = Math.round(y * canvas.height);
        candidates.push({
          x: offsetX + px * scale,
          y: offsetY + py * scale,
          alpha: pixels[(py * canvas.width + px) * 4 + 3],
          distance: (x - 0.5) ** 2 + (y - 0.5) ** 2,
        });
      }
    candidates.sort((a, b) => a.distance - b.distance);
    return {
      physical: candidates.find((p) => p.alpha === 255),
      empty: candidates.find((p) => p.alpha === 0),
    };
  }, selector);
}

export async function verticalSwipe(page, point) {
  const cdp = await page.context().newCDPSession(page);
  const initial = await page.evaluate(() => scrollY);
  const x = Math.round(point.x),
    y = Math.round(point.y);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - i * 17 }],
      });
      await page.waitForTimeout(20);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(200);
    return { initial, scrollY: await page.evaluate(() => scrollY) };
  } finally {
    await cdp.detach();
  }
}

/** Keep actual event times, especially first media progress relative to zoom readiness. */
export async function installFilmProbes(page, selectors = filmSelectors) {
  await page.addInitScript((s) => {
    window.__filmQAEvents = [];
    const record = (name, detail = {}) =>
      window.__filmQAEvents.push({ name, at: performance.now(), ...detail });
    for (const name of [
      "play",
      "playing",
      "pause",
      "waiting",
      "stalled",
      "ended",
      "error",
      "loadedmetadata",
      "seeking",
      "seeked",
    ]) {
      document.addEventListener(
        name,
        (event) => {
          if (!event.target.matches?.(s.video)) return;
          record(`media:${name}`, {
            time: event.target.currentTime,
            ready: event.target.readyState,
            paused: event.target.paused,
            error: event.target.error?.message,
          });
        },
        true,
      );
    }
    for (const name of ["crt:ready", "crt:error", "crt:activate"])
      document.addEventListener(name, () => record(name), true);
    document.addEventListener("visibilitychange", () =>
      record("visibilitychange", { hidden: document.hidden }),
    );
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        const panel = document.querySelector(s.dialog),
          stage = document.querySelector(s.stage);
        for (const [label, element] of [
          ["panel", panel],
          ["stage", stage],
        ]) {
          if (!element) continue;
          new MutationObserver((changes) => {
            for (const change of changes)
              record(`${label}:attribute`, {
                attribute: change.attributeName,
                value: element.getAttribute(change.attributeName),
              });
          }).observe(element, {
            attributes: true,
            attributeFilter: [
              "open",
              "hidden",
              "aria-hidden",
              "data-state",
              "data-mode",
              "data-film-state",
              "data-ready",
            ],
          });
        }
      },
      { once: true },
    );
  }, selectors);
}

/**
 * The video's current frame as a 32 × 18 luma grid (0–255), read through a
 * canvas (same-origin media). `dark` is the share of samples below 16 and
 * `bright` the share above 60 (type, logos: a card rather than a black frame).
 */
export async function videoFrameSample(page, selector = filmSelectors.video) {
  return page.evaluate((s) => {
    const video = document.querySelector(s);
    if (!video || video.readyState < 2) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 18;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const luma = [];
    for (let i = 0; i < data.length; i += 4)
      luma.push(
        Math.round(
          0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2],
        ),
      );
    return {
      time: video.currentTime,
      mean: luma.reduce((a, b) => a + b, 0) / luma.length,
      dark: luma.filter((value) => value < 16).length / luma.length,
      bright: luma.filter((value) => value > 60).length / luma.length,
      luma,
    };
  }, selector);
}

/** Mean absolute luma difference between two frame samples. */
export function frameDistance(a, b) {
  if (!a || !b) return Infinity;
  return (
    a.luma.reduce((sum, value, i) => sum + Math.abs(value - b.luma[i]), 0) /
    a.luma.length
  );
}

/**
 * Container facts of an MP4, read from its boxes (this Mac has no ffprobe):
 * duration, fast start, and per track the handler, codec, size, frame count
 * and rate, H.264 profile and AAC layout.
 */
export function mp4Facts(buffer) {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const boxes = (start, end) => {
    const list = [];
    for (let at = start; at + 8 <= end;) {
      let size = view.getUint32(at);
      let header = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header) break;
      list.push({
        type: buffer.toString("latin1", at + 4, at + 8),
        body: at + header,
        end: at + size,
      });
      at += size;
    }
    return list;
  };
  const find = (box, ...path) => {
    let current = box;
    for (const type of path) {
      current = boxes(current.body, current.end).find((b) => b.type === type);
      if (!current) return null;
    }
    return current;
  };
  // mvhd and mdhd share this layout after the version and flags.
  const clock = (box) =>
    view.getUint8(box.body) === 1
      ? {
          timescale: view.getUint32(box.body + 20),
          duration: Number(view.getBigUint64(box.body + 24)),
        }
      : {
          timescale: view.getUint32(box.body + 12),
          duration: view.getUint32(box.body + 16),
        };
  const file = { body: 0, end: buffer.length };
  const order = boxes(0, buffer.length).map((b) => b.type);
  const moov = find(file, "moov");
  if (!moov) return { order, error: "no moov box" };
  const movie = clock(find(moov, "mvhd"));
  const tracks = boxes(moov.body, moov.end)
    .filter((b) => b.type === "trak")
    .map((trak) => {
      const track = {};
      const hdlr = find(trak, "mdia", "hdlr");
      if (hdlr)
        track.handler = buffer.toString(
          "latin1",
          hdlr.body + 8,
          hdlr.body + 12,
        );
      const tkhd = find(trak, "tkhd");
      if (tkhd) {
        const at = tkhd.body + (view.getUint8(tkhd.body) === 1 ? 36 : 24) + 52;
        track.width = view.getUint32(at) / 65536;
        track.height = view.getUint32(at + 4) / 65536;
      }
      const mdhd = find(trak, "mdia", "mdhd");
      if (mdhd) {
        Object.assign(track, clock(mdhd));
        track.seconds = track.duration / track.timescale;
      }
      const stts = find(trak, "mdia", "minf", "stbl", "stts");
      if (stts) {
        const deltas = new Set();
        track.samples = 0;
        for (let i = 0, n = view.getUint32(stts.body + 4); i < n; i++) {
          track.samples += view.getUint32(stts.body + 8 + i * 8);
          deltas.add(view.getUint32(stts.body + 12 + i * 8));
        }
        if (track.handler === "vide" && deltas.size === 1)
          track.fps = track.timescale / [...deltas][0];
      }
      const stsd = find(trak, "mdia", "minf", "stbl", "stsd");
      if (stsd) {
        const entry = stsd.body + 8;
        const size = view.getUint32(entry);
        track.codec = buffer.toString("latin1", entry + 4, entry + 8);
        if (track.codec === "avc1" || track.codec === "avc3") {
          const avcC = boxes(entry + 8 + 78, entry + size).find(
            (b) => b.type === "avcC",
          );
          if (avcC) {
            const profiles = { 66: "Baseline", 77: "Main", 100: "High" };
            const profile = view.getUint8(avcC.body + 1);
            track.profile = profiles[profile] ?? profile;
            track.level = view.getUint8(avcC.body + 3) / 10;
          }
        }
        if (track.codec === "mp4a") {
          track.channels = view.getUint16(entry + 24);
          track.sampleRate = view.getUint32(entry + 32) >>> 16;
        }
      }
      return track;
    });
  return {
    bytes: buffer.length,
    order,
    faststart:
      order.includes("mdat") && order.indexOf("moov") < order.indexOf("mdat"),
    seconds: movie.duration / movie.timescale,
    tracks,
  };
}
