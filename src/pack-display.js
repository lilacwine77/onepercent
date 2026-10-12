import "./pack-display.css";
import { getPackCarouselLayout, getPackCarouselPose, PACK_CAROUSEL_FLOOR } from "./pack-carousel-layout.js";

/** A draggable pack ring. `ready` defers its GPU setup until page entrance settles. */
export function initPackDisplay({ container, packs, onSelect, ready }) {
  if (!container || !packs.length) return () => {};
  const controller = new AbortController();
  const { signal } = controller;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const count = 8;
  const step = Math.PI * 2 / count;
  // Bring the next pack to center in about 6.5 seconds (previously 16 seconds).
  const idleRadiansPerSecond = 0.12;
  let selected = Math.max(0, packs.findIndex((pack) => pack.id === "signature"));
  let angle = 0;
  let target = angle;
  let velocity = 0;
  let settle = false;
  let pointer = null;
  let suppressClickUntil = 0;
  let frame = 0;
  let lastTime = 0;
  let visible = false;
  let nearViewport = false;
  let entranceComplete = !ready;
  let loadTask = 0;
  let active = false;
  let width = 700;
  let height = 430;
  let hovered = null;
  let pinnedXray = null;
  let idleAfter = 0;
  let volume = null;
  let volumeLoading = false;
  let destroyed = false;
  let cursor = { x: 0, y: 0 };
  const lifts = Array(count).fill(0);
  const xray = Array(count).fill(0);
  const xrayStyles = Array(count).fill('');
  container.className = "pack-display";
  container.innerHTML = `
    <div class="pack-editions" role="tablist" aria-label="Pack editions">
      ${packs.map((pack, i) => `<button type="button" class="pack-edition" role="tab" id="edition-${pack.id}" aria-controls="pack-collection" aria-selected="${i === selected}" tabindex="${i === selected ? 0 : -1}" data-edition="${i}">
        <img src="/assets/${pack.image}" alt="" loading="lazy" draggable="false" width="1254" height="1254" />
        <span>${pack.name}<b>${pack.price}</b></span>
      </button>`).join("")}
    </div>
    <div class="pack-collection" id="pack-collection" role="tabpanel" aria-labelledby="edition-${packs[selected].id}">
      <div class="pack-theatre">
        <div class="pack-orbit" tabindex="0" role="group" aria-label="Look inside the packs. Hover, tap or focus to X-ray the $WIF, $FONE and $JIMOTHY coins inside. Drag sideways or use arrow keys to turn. Press Enter for details." aria-describedby="pack-xray-status">
          <div class="pack-ring">
            ${Array.from({ length: count }, (_, i) => `<button type="button" class="orbit-pack" tabindex="-1" data-orbit="${i}" style="top:50%"><span class="orbit-ground" aria-hidden="true"></span><span class="orbit-float" style="animation:none"><span class="orbit-surface"><img class="orbit-art" alt="" draggable="false" loading="lazy" decoding="async" /><span class="orbit-light" aria-hidden="true"></span><span class="orbit-xray" aria-hidden="true"><span class="orbit-xray-foil"></span><span class="orbit-xray-coins"></span><span class="orbit-xray-scan"></span></span></span><img class="orbit-reflection" alt="" aria-hidden="true" draggable="false" loading="lazy" decoding="async" /></span></button>`).join("")}
          </div>
        </div>
      </div>
      <span class="sr-only" id="pack-xray-status" role="status"></span>
      <div class="pack-selection" aria-live="polite" aria-atomic="true">
        <p class="pack-finish"></p>
        <h3 class="pack-selected-name"></h3>
        <p class="pack-selected-price"></p>
        <p class="pack-selection-copy">Every pack: 4 Dust Cards + 1 hit.<br />Real tokens.</p>
        <button type="button" class="oval pack-explore"><span>Explore this pack <b aria-hidden="true">↗</b></span></button>
      </div>
    </div>`;
  const $ = (selector) => container.querySelector(selector);
  const tabs = [...container.querySelectorAll(".pack-edition")];
  const orbit = $(".pack-orbit");
  orbit.dataset.active = "false";
  const cards = [...container.querySelectorAll(".orbit-pack")];
  const xrayStatus = $("#pack-xray-status");
  orbit.dataset.xrayIndex = "";
  const reflections = cards.map((card) => card.querySelector(".orbit-reflection"));
  const shadows = cards.map((card) => card.querySelector(".orbit-ground"));
  function scheduleVolume() {
    if (loadTask || volumeLoading || destroyed || !entranceComplete || !nearViewport || document.hidden) return;
    const start = () => { loadTask = 0; loadVolume(); };
    loadTask = window.requestIdleCallback
      ? window.requestIdleCallback(start, { timeout: 500 })
      : window.setTimeout(start, 32);
  }
  function cancelVolumeSchedule() {
    if (!loadTask) return;
    if (window.cancelIdleCallback) window.cancelIdleCallback(loadTask);
    else window.clearTimeout(loadTask);
    loadTask = 0;
  }
  async function loadVolume() {
    if (volumeLoading || destroyed || !entranceComplete || !nearViewport || document.hidden) return;
    volumeLoading = true;
    try {
      const { PackCarouselScene } = await import('./pack-carousel-scene.js');
      if (destroyed || !nearViewport || document.hidden) { volumeLoading = false; return; }
      volume = new PackCarouselScene(orbit, () => {
        cards.forEach((card) => card.setAttribute('aria-hidden', 'true'));
        wake();
      });
      volume.setEdition(packs[selected]);
      await volume.ready;
    } catch (error) {
      volume?.destroy();
      volume = null;
      console.warn('The 3D pack display could not load; showing the pack artwork.', error);
    }
  }
  const finishes = { original: "The silver edition", blue: "The electric blue edition", signature: "The holographic edition", "after-hours": "The black edition" };

  function choose(index) {
    selected = index;
    pinnedXray = null;
    hovered = null;
    xray.fill(0);
    const pack = packs[index];
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    $(".pack-collection").setAttribute("aria-labelledby", `edition-${pack.id}`);
    $(".pack-finish").textContent = finishes[pack.id] || pack.finish;
    $(".pack-selected-name").textContent = pack.name;
    $(".pack-selected-price").textContent = pack.price;
    cards.forEach((card) => {
      card.setAttribute("aria-label", `Explore ${pack.name}, ${pack.price}`);
      card.style.setProperty("--foil-mask", `url("/assets/${pack.image}")`);
      card.querySelectorAll(".orbit-art, .orbit-reflection").forEach((img) => { img.src = `/assets/${pack.image}`; });
    });
    container.dataset.edition = pack.id;
    volume?.setEdition(pack).catch((error) => console.warn('Could not load pack finish', error));
    wake();
  }
  function render() {
    if (!width || !height) return;
    const time = performance.now();
    cards.forEach((card, i) => {
      const value = xray[i].toFixed(3);
      if (value !== xrayStyles[i]) { card.style.setProperty('--xray', value); xrayStyles[i] = value; }
    });
    if (volume?.loaded) {
      if (active) volume.render({ angle, lifts, hovered, cursor, time, xray, reducedMotion: motion.matches, dragging: Boolean(pointer?.dragging) });
      return;
    }
    // Match the WebGL camera and arc before its model is ready. Native images
    // keep their proportions and no rear copy can overlap a front copy.
    const layout = getPackCarouselLayout(width, height);
    const { pixelsPerUnit, imagePixels, spacing } = layout;
    orbit.style.setProperty("--pack-size", `${imagePixels}px`);
    cards.forEach((card, i) => {
      const pose = getPackCarouselPose(angle, i, spacing);
      const { depth, side, scale } = pose;
      const bob = !active || motion.matches || pointer?.dragging ? 0 : Math.sin(time / 1100 + i * .7) * .045;
      const shown = Math.abs(pose.x) < layout.halfWidth + spacing;
      card.style.transform = `translate3d(${pose.x * pixelsPerUnit}px, ${-(pose.y + bob) * pixelsPerUnit}px, 0) rotateZ(${pose.roll}rad) scale(${scale})`;
      card.style.zIndex = String(Math.round((depth + 1) * 100));
      card.style.opacity = shown ? "1" : "0";
      card.style.pointerEvents = shown ? "auto" : "none";
      card.setAttribute("aria-hidden", String(!shown));
      card.style.setProperty("--pack-yaw", `${pose.yaw}rad`);
      card.style.setProperty("--pack-lift", `${lifts[i] * .016 * pixelsPerUnit / scale}px`);
      card.style.setProperty("--orbit-highlight", `${50 + side * 65}%`);
      card.style.setProperty("--orbit-shine", String(0.09 + Math.max(0, depth) * 0.15));
      card.style.setProperty("--pack-brightness", "1");
      card.style.setProperty("--reflection-opacity", String(Math.max(0, depth) * 0.18));
      card.style.setProperty("--shadow-opacity", String(0.2 + (depth + 1) * 0.24));
      const floorOffset = (pose.y + bob - PACK_CAROUSEL_FLOOR) * pixelsPerUnit / scale;
      reflections[i].style.top = `${floorOffset * 2}px`;
      shadows[i].style.bottom = "auto";
      shadows[i].style.top = `${imagePixels * .43 + floorOffset}px`;
    });
    if (active) volume?.render({ angle, lifts, hovered, cursor, time, xray, reducedMotion: motion.matches, dragging: Boolean(pointer?.dragging) });
  }
  function centralPack() {
    const { spacing } = getPackCarouselLayout(width, height);
    return cards.reduce((nearest, _, i) => Math.abs(getPackCarouselPose(angle, i, spacing).x) < Math.abs(getPackCarouselPose(angle, nearest, spacing).x) ? i : nearest, 0);
  }
  function hitPack(event) {
    if (volume?.hasFrame) return volume.hit(event.clientX, event.clientY);
    const card = event.target.closest?.('.orbit-pack');
    if (!card || !orbit.contains(card)) return null;
    const rect = card.getBoundingClientRect();
    return { index: Number(card.dataset.orbit), x: (event.clientX - rect.left) / rect.width * 2 - 1, y: (event.clientY - rect.top) / rect.height * 2 - 1 };
  }
  function tick(now) {
    frame = 0;
    if (!active || destroyed) { lastTime = 0; return; }
    const elapsed = Math.min((now - (lastTime || now)) / 16.667, 3);
    lastTime = now;
    if (!pointer) {
      target += velocity * elapsed;
      velocity *= Math.pow(0.92, elapsed);
      if (settle && Math.abs(velocity) < 0.004) {
        velocity = 0;
        target = Math.round(target / step) * step;
        settle = false;
      }
    }
    const keyboardFocus = orbit.classList.contains('is-keyboard') && document.activeElement === orbit;
    const idle = !motion.matches && !pointer && hovered === null && pinnedXray === null && !keyboardFocus && now > idleAfter;
    if (idle && !settle && Math.abs(velocity) < 0.004) target += idleRadiansPerSecond * elapsed / 60;
    let lifting = false;
    lifts.forEach((lift, i) => {
      const destination = !motion.matches && hovered === i && !pointer?.dragging ? 30 : 0;
      lifts[i] += (destination - lift) * (1 - Math.pow(0.8, elapsed || 1));
      lifting ||= Math.abs(destination - lifts[i]) > 0.05;
    });
    angle += (target - angle) * (motion.matches ? 1 : 1 - Math.pow(0.8, elapsed || 1));
    const inspected = pointer?.dragging ? null : keyboardFocus ? centralPack() : hovered ?? pinnedXray;
    if (orbit.dataset.xrayIndex !== String(inspected ?? '')) {
      orbit.dataset.xrayIndex = String(inspected ?? '');
      xrayStatus.textContent = inspected === null ? '' : 'X-ray: $WIF, $FONE and $JIMOTHY coins inside the pack.';
    }
    let scanning = false;
    xray.forEach((level, i) => {
      const destination = inspected === i ? 1 : 0;
      const change = Math.min(Math.abs(destination - level), (elapsed || 1) * 16.667 / 320);
      xray[i] = motion.matches ? destination : level + Math.sign(destination - level) * change;
      scanning ||= Math.abs(destination - xray[i]) > 0.001;
    });
    render();
    if (visible && !document.hidden && (!motion.matches || lifting || scanning || Math.abs(target - angle) > 0.0001 || Math.abs(velocity) > 0.0001)) frame = requestAnimationFrame(tick);
  }
  function wake() {
    if (frame || !active || destroyed) return;
    lastTime = 0;
    frame = requestAnimationFrame(tick);
  }
  function updateActivity() {
    const next = entranceComplete && visible && !document.hidden && !destroyed;
    if (next !== active) {
      active = next;
      orbit.dataset.active = String(active);
      if (active) volume?.resize();
      else {
        if (pointer) release({ type: "visibilitychange" });
        hovered = null;
        pinnedXray = null;
        xray.fill(0);
        orbit.dataset.xrayIndex = '';
        xrayStatus.textContent = '';
        lifts.fill(0);
        cancelAnimationFrame(frame);
        frame = 0;
        lastTime = 0;
      }
    }
    if (document.hidden || !nearViewport) cancelVolumeSchedule();
    else scheduleVolume();
    wake();
  }
  function spin(direction) {
    hovered = null;
    pinnedXray = null;
    idleAfter = performance.now() + 2500;
    velocity = 0;
    settle = false;
    target = (Math.round(target / step) + direction) * step;
    wake();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => choose(index), { signal });
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % packs.length;
      if (event.key === "ArrowLeft") next = (index - 1 + packs.length) % packs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = packs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); choose(next); tabs[next].focus();
    }, { signal });
  });
  orbit.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    orbit.classList.remove('is-keyboard');
    pointer = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, last: event.clientX, time: event.timeStamp, dragging: false };
    target = angle;
    velocity = 0;
    settle = false;
    suppressClickUntil = 0;
    idleAfter = performance.now() + 2500;
  }, { signal });
  orbit.addEventListener("pointermove", (event) => {
    if (!pointer?.dragging && event.pointerType !== 'touch') {
      orbit.classList.remove('is-keyboard');
      const hit = hitPack(event);
      pinnedXray = null;
      hovered = hit?.index ?? null;
      if (hit) cursor = { x: hit.x, y: hit.y };
      idleAfter = performance.now() + 1400;
      wake();
    }
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    if (!pointer.dragging) {
      if (Math.abs(event.clientY - pointer.y) > Math.abs(dx) && Math.abs(event.clientY - pointer.y) > 8) {
        pointer = null;
        pinnedXray = null;
        hovered = null;
        suppressClickUntil = performance.now() + 500;
        settle = true;
        wake();
        return;
      }
      if (Math.abs(dx) < 6) return;
      pointer.dragging = true;
      hovered = null;
      pinnedXray = null;
      suppressClickUntil = Infinity;
      orbit.focus({ preventScroll: true });
      orbit.setPointerCapture(event.pointerId);
      orbit.classList.add("is-dragging");
    }
    const delta = (event.clientX - pointer.last) / Math.min(width, 900) * 5;
    const dt = Math.max(8, event.timeStamp - pointer.time);
    velocity = Math.max(-0.13, Math.min(0.13, delta / dt * 16.667));
    target += delta;
    pointer.last = event.clientX;
    pointer.time = event.timeStamp;
    wake();
  }, { signal });
  orbit.addEventListener('pointerleave', () => { hovered = null; wake(); }, { signal });
  function release(event) {
    if (!pointer || (event.pointerId !== undefined && pointer.id !== event.pointerId)) return;
    if (orbit.hasPointerCapture(pointer.id)) orbit.releasePointerCapture(pointer.id);
    if (event.type !== "pointerup" || event.timeStamp - pointer.time > 100 || motion.matches) velocity = 0;
    if (event.type === 'pointerup' && pointer.type === 'touch' && !pointer.dragging) {
      const hit = hitPack(event);
      pinnedXray = hit && pinnedXray !== hit.index ? hit.index : null;
      hovered = null;
      cursor = { x: 0, y: 0 };
      suppressClickUntil = performance.now() + 500;
    }
    if (event.type !== 'pointerup') { hovered = null; pinnedXray = null; }
    if (pointer.dragging) suppressClickUntil = performance.now() + 250;
    pointer = null;
    idleAfter = performance.now() + 2500;
    settle = true;
    orbit.classList.remove("is-dragging");
    wake();
  }
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => window.addEventListener(type, release, { signal }));
  window.addEventListener("blur", release, { signal });
  window.addEventListener('blur', () => { hovered = null; pinnedXray = null; wake(); }, { signal });
  document.addEventListener('pointerdown', (event) => {
    if (!orbit.contains(event.target)) { pinnedXray = null; wake(); }
  }, { signal });
  orbit.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil || event.pointerType === 'touch') return;
    const hit = hitPack(event);
    if (hit) onSelect(packs[selected], $(".pack-explore"));
  }, { signal });
  orbit.addEventListener("keydown", (event) => {
    orbit.classList.add('is-keyboard');
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); spin(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === 'Escape') {
      hovered = null; pinnedXray = null; orbit.classList.remove('is-keyboard'); wake();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); onSelect(packs[selected], orbit);
    }
  }, { signal });
  orbit.addEventListener('focus', () => { if (orbit.matches(':focus-visible') && !pointer) orbit.classList.add('is-keyboard'); wake(); }, { signal });
  orbit.addEventListener('blur', () => { orbit.classList.remove('is-keyboard'); wake(); }, { signal });
  $(".pack-explore").addEventListener("click", (event) => onSelect(packs[selected], event.currentTarget), { signal });
  const resize = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width;
    height = entry.contentRect.height;
    if (active) volume?.resize();
    render();
  });
  resize.observe(orbit);
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; updateActivity(); });
  visibility.observe(orbit);
  const proximity = new IntersectionObserver(([entry]) => { nearViewport = entry.isIntersecting; updateActivity(); }, { rootMargin: "80px" });
  proximity.observe(orbit);
  motion.addEventListener("change", wake, { signal });
  document.addEventListener('visibilitychange', updateActivity, { signal });
  if (ready) Promise.resolve(ready).then(() => {
    entranceComplete = true;
    updateActivity();
  }, () => {
    entranceComplete = true;
    updateActivity();
  });
  choose(selected);
  render();
  return () => { destroyed = true; cancelVolumeSchedule(); volume?.destroy(); controller.abort(); resize.disconnect(); visibility.disconnect(); proximity.disconnect(); cancelAnimationFrame(frame); };
}
