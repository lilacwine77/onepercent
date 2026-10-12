/**
 * The 1% TV film: the landing's player (src/concept-video.js), ported. One
 * <video> drives both the curved WebGL glass (the live TV turns to face the
 * viewer and the film plays on its screen) and the CSS CRT fallback (no WebGL,
 * Save-Data, reduced motion). Nothing loads before the first open; the media
 * stream from the app's own origin (/landing/ is the landing's synced copy).
 */
import { copy } from "../copy";
import type { FilmTelevision } from "../tv/mount";
import "./film.css";

// ?v= moves with every new cut (the landing's version too), so no cache keeps
// an older picture, poster or captions next to the new film.
const MEDIA = {
  film: "/landing/onepercent-explained.mp4?v=10",
  poster: "/landing/onepercent-explained.webp?v=10",
  captions: "/experience/home/onepercent-explained.vtt?v=10",
  idle: "/experience/home/crt-screen-1536.webp",
};
/** The film's length (25 s), until its metadata arrives. */
const FILM_SECONDS = 25;

export interface FilmPlayer {
  open(opener?: HTMLElement | null): void;
  close(options?: { immediate?: boolean }): Promise<void>;
  readonly isOpen: boolean;
  destroy(): void;
}

type Props = Record<string, string>;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string)[]
) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props))
    node.setAttribute(name, value);
  node.append(...children);
  return node;
}
const clock = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};
const bounds = (rect: DOMRect | DOMRectReadOnly) => ({
  left: `${rect.left}px`,
  top: `${rect.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
});

/** The dialog, as the landing's index.html has it (strings from the home copy). */
function build() {
  const title = h(
    "h2",
    { id: "film-title", class: "sr-only" },
    copy("home.film.title"),
  );
  const closeButton = h(
    "button",
    { type: "button", class: "film__close" },
    copy("home.film.close"),
    " ",
    h("span", { "aria-hidden": "true" }, "×"),
  );
  const idle = h("img", { class: "film__idle", alt: "" });
  const track = h("track", {
    kind: "captions",
    srclang: "en",
    label: copy("home.film.captionsLabel"),
  });
  const video = h(
    "video",
    {
      playsinline: "",
      preload: "none",
      tabindex: "-1",
      "aria-label": copy("home.film.label"),
    },
    track,
  );
  const glass = h("div", { class: "film__glass" }, idle, video);
  const fallback = h("div", { class: "film__fallback" }, glass);
  const caption = h("p", { class: "film__caption" });
  caption.hidden = true;
  const viewport = h("div", { class: "film__viewport" }, fallback, caption);
  const seek = h("input", {
    class: "film__progress",
    type: "range",
    min: "0",
    max: String(FILM_SECONDS),
    step: "0.01",
    value: "0",
    "aria-label": copy("home.film.position"),
  });
  const playButton = h("button", { type: "button" }, copy("home.film.pause"));
  const replayButton = h(
    "button",
    { type: "button", "aria-label": copy("home.film.replayLabel") },
    copy("home.film.replay"),
  );
  const time = h(
    "span",
    { class: "film__time", "aria-live": "off" },
    copy("home.film.time", { t: clock(0), d: clock(FILM_SECONDS) }),
  );
  const muteButton = h(
    "button",
    {
      type: "button",
      "aria-label": copy("home.film.mute"),
      "aria-pressed": "false",
    },
    copy("home.film.soundOn"),
  );
  const captionsButton = h(
    "button",
    {
      type: "button",
      "aria-label": copy("home.film.captionsShow"),
      "aria-pressed": "false",
    },
    copy("home.film.cc"),
  );
  const controls = h(
    "div",
    { class: "film__controls" },
    seek,
    h(
      "div",
      { class: "film__buttons" },
      playButton,
      replayButton,
      time,
      muteButton,
      captionsButton,
    ),
  );
  const errorMessage = h(
    "p",
    { class: "film__error", role: "status" },
    copy("home.film.error"),
  );
  errorMessage.hidden = true;
  const dialog = h(
    "dialog",
    { class: "film", "aria-labelledby": "film-title" },
    title,
    closeButton,
    viewport,
    controls,
    errorMessage,
  );
  return {
    dialog,
    closeButton,
    idle,
    track,
    video,
    glass,
    fallback,
    viewport,
    caption,
    seek,
    playButton,
    replayButton,
    time,
    muteButton,
    captionsButton,
    errorMessage,
  };
}

/**
 * @param stage the live TV's canvas host: it moves into the dialog while the film plays
 * @param home where the stage lives in the hero (its rect is the way back)
 * @param art the hero's TV block: `is-film-open` hides its poster meanwhile
 */
export function initFilm({
  stage,
  home,
  art,
  getTelevision,
  reducedMotion,
  onOpen,
  onClose,
}: {
  stage: HTMLElement;
  home: HTMLElement;
  art: HTMLElement;
  getTelevision(): FilmTelevision | null;
  reducedMotion(): boolean;
  onOpen?(): void;
  onClose?(): void;
}): FilmPlayer {
  const ui = build();
  const { dialog, video, track, viewport, glass, caption, seek, time } = ui;
  const { closeButton, playButton, replayButton, muteButton } = ui;
  const { captionsButton, errorMessage } = ui;
  document.body.append(dialog);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => reducedMotion() || motion.matches;
  const listeners: (() => void)[] = [];
  let opener: HTMLElement | null = null;
  let active = false;
  let loaded = false;
  let destroyed = false;
  let actor: FilmTelevision | null = null;
  let homeMarker: Comment | null = null;
  let previousStyle = "";
  let stageAnimation: Animation | null = null;
  let fallbackAnimation: Animation | null = null;
  let revision = 0;
  let backdropPressed = false;
  let captionsEnabled = false;
  let resumeOnVisible = false;
  let previousOverflow = "";
  let playbackReady = false;
  let preparing = false;
  const pending = new Set<() => void>();
  const current = (id: number) =>
    active && id === revision && dialog.dataset.state !== "closing";
  function cancelPending() {
    for (const cancel of pending) cancel();
    pending.clear();
  }
  function delay(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        pending.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      pending.add(done);
    });
  }
  function firstFrame() {
    const available = () =>
      video.readyState >= video.HAVE_CURRENT_DATA && !video.seeking;
    if (available()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const events = ["loadeddata", "canplay", "seeked", "error"];
      const done = (event?: Event) => {
        // Reopening seeks back to the first frame: loadeddata fires once per
        // resource, later seeks report readiness through canplay/seeked.
        if (event && event.type !== "error" && !available()) return;
        for (const name of events) video.removeEventListener(name, done);
        pending.delete(done);
        resolve(Boolean(event && event.type !== "error" && available()));
      };
      pending.add(done);
      for (const name of events) video.addEventListener(name, done);
      if (video.error) done();
    });
  }
  function listen(
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }
  function updateCaption() {
    const cues = [...(video.textTracks[0]?.activeCues ?? [])] as VTTCue[];
    caption.textContent = cues.map((cue) => cue.text).join("\n");
    caption.hidden = !captionsEnabled || !cues.length;
  }
  function updateControls() {
    const duration = Number.isFinite(video.duration)
      ? video.duration
      : FILM_SECONDS;
    seek.max = String(duration);
    seek.value = String(video.currentTime);
    seek.style.setProperty(
      "--film-progress",
      `${(video.currentTime / duration) * 100}%`,
    );
    seek.setAttribute(
      "aria-valuetext",
      copy("home.film.timeOf", {
        t: clock(video.currentTime),
        d: clock(duration),
      }),
    );
    time.textContent = copy("home.film.time", {
      t: clock(video.currentTime),
      d: clock(duration),
    });
    playButton.textContent = copy(
      preparing
        ? "home.film.starting"
        : video.error
          ? "home.film.retry"
          : video.ended
            ? "home.film.replay"
            : video.paused
              ? "home.film.play"
              : "home.film.pause",
    );
    playButton.disabled = preparing;
    replayButton.disabled = !playbackReady;
    seek.disabled = !playbackReady;
    muteButton.textContent = copy(
      video.muted ? "home.film.soundOff" : "home.film.soundOn",
    );
    muteButton.setAttribute(
      "aria-label",
      copy(video.muted ? "home.film.unmute" : "home.film.mute"),
    );
    muteButton.setAttribute("aria-pressed", String(video.muted));
    updateCaption();
  }
  function play() {
    if (!active || dialog.dataset.state === "closing") return;
    if (video.error) {
      playbackReady = false;
      video.load();
    }
    if (!playbackReady) {
      if (!preparing && dialog.dataset.state !== "opening") {
        if (video.error) video.load();
        void preparePlayback(revision);
      }
      return;
    }
    if (video.ended) video.currentTime = 0;
    errorMessage.hidden = true;
    // Primed in the click; if a browser still wants another gesture, the
    // visible Play button stays available without losing time.
    video.play()?.catch(() => {
      if (active && video.error) errorMessage.hidden = false;
      updateControls();
    });
  }
  async function preparePlayback(id: number) {
    if (!current(id)) return;
    preparing = true;
    errorMessage.hidden = true;
    dialog.dataset.state = "preparing";
    updateControls();
    const available = await firstFrame();
    if (!current(id)) return;
    if (!available) {
      preparing = false;
      dialog.dataset.state = "ready";
      errorMessage.hidden = false;
      updateControls();
      return;
    }
    if (dialog.dataset.mode === "live" && actor) {
      try {
        await actor.revealFilm({ duration: reduced() ? 0 : 400 });
      } catch {
        if (current(id)) void showFallback();
      }
    }
    if (!current(id)) return;
    if (video.error) {
      preparing = playbackReady = false;
      dialog.dataset.state = "ready";
      errorMessage.hidden = false;
      updateControls();
      return;
    }
    if (dialog.dataset.mode === "fallback") {
      dialog.dataset.broadcast = "film";
      if (!reduced()) await delay(400);
    }
    if (!current(id)) return;
    playbackReady = true;
    preparing = false;
    dialog.dataset.state = "playing";
    if (document.hidden) resumeOnVisible = true;
    else play();
    updateControls();
  }
  function animateStage(target: DOMRect, duration: number) {
    const from = bounds(stage.getBoundingClientRect());
    stageAnimation?.cancel();
    Object.assign(stage.style, from);
    if (!duration) {
      Object.assign(stage.style, bounds(target));
      actor?.resize();
      return Promise.resolve();
    }
    const animation = stage.animate([from, bounds(target)], {
      duration,
      easing: "cubic-bezier(.22,.68,.14,1)",
      fill: "forwards",
    });
    stageAnimation = animation;
    return animation.finished
      .catch(() => undefined)
      .then(() => {
        if (stageAnimation !== animation) return;
        Object.assign(stage.style, bounds(target));
        animation.cancel();
        stageAnimation = null;
        actor?.resize();
      });
  }
  function restoreStage() {
    stageAnimation?.cancel();
    stageAnimation = null;
    if (homeMarker) {
      homeMarker.replaceWith(stage);
      homeMarker = null;
      stage.style.cssText = previousStyle;
      actor?.resize();
    }
    art.classList.remove("is-film-open");
  }
  function showFallback(animate = false) {
    dialog.dataset.mode = "fallback";
    void actor?.exitFilm({ duration: 0 });
    actor?.setPaused(true);
    if (playbackReady) dialog.dataset.broadcast = "film";
    if (!animate || reduced()) return Promise.resolve();
    const source = home.getBoundingClientRect();
    const destination = glass.getBoundingClientRect();
    const scale =
      Math.min(
        source.width / destination.width,
        source.height / destination.height,
      ) * 0.72;
    const dx =
      source.left + source.width / 2 - destination.left - destination.width / 2;
    const dy =
      source.top + source.height / 2 - destination.top - destination.height / 2;
    fallbackAnimation = glass.animate(
      [
        {
          transform: `translate(${dx}px,${dy}px) scale(${scale})`,
          opacity: 0,
        },
        { transform: "translate(0,0) scale(1)", opacity: 1 },
      ],
      { duration: 650, easing: "cubic-bezier(.22,.68,.14,1)" },
    );
    return fallbackAnimation.finished.then(
      () => undefined,
      () => undefined,
    );
  }
  function finishClose() {
    if (!active) return;
    revision++;
    cancelPending();
    active = false;
    playbackReady = preparing = false;
    resumeOnVisible = false;
    video.pause();
    if (video.readyState > 0) video.currentTime = 0;
    fallbackAnimation?.cancel();
    void actor?.exitFilm({ duration: 0 });
    restoreStage();
    document.documentElement.style.overflow = previousOverflow;
    delete dialog.dataset.state;
    if (dialog.open) dialog.close();
    actor?.setPaused(false);
    actor = null;
    onClose?.();
    if (!destroyed && opener?.isConnected)
      opener.focus({ preventScroll: true });
  }
  async function close({ immediate = false } = {}) {
    if (!active || dialog.dataset.state === "closing") return;
    dialog.dataset.state = "closing";
    const closing = ++revision;
    cancelPending();
    video.pause();
    resumeOnVisible = false;
    dialog.dataset.broadcast = "idle";
    const duration = immediate || reduced() ? 0 : 650;
    const returning = actor?.exitFilm({ duration }) ?? Promise.resolve(true);
    if (homeMarker)
      await Promise.all([
        returning,
        animateStage(home.getBoundingClientRect(), duration),
      ]);
    else if (duration) {
      const animation = ui.fallback.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(.9)" },
        ],
        { duration: 650, fill: "forwards", easing: "ease-in-out" },
      );
      await animation.finished.catch(() => undefined);
      animation.cancel();
    }
    if (closing === revision) finishClose();
  }
  function open(source: HTMLElement | null = null) {
    if (active || destroyed) return;
    opener = source;
    if (!loaded) {
      video.poster = MEDIA.poster;
      track.src = MEDIA.captions;
      video.src = MEDIA.film;
      ui.idle.src = MEDIA.idle;
      const captions = video.textTracks[0];
      if (captions) captions.mode = "hidden";
      loaded = true;
    }
    if (video.error) video.load();
    video.preload = "auto";
    // Prime the element inside the user activation, then stop at once: neither
    // its clock nor its sound may run while the TV is moving.
    video.play()?.catch(() => undefined);
    video.pause();
    if (video.readyState > 0) video.currentTime = 0;
    active = true;
    playbackReady = false;
    preparing = true;
    const opening = ++revision;
    dialog.dataset.state = "opening";
    dialog.dataset.broadcast = "idle";
    errorMessage.hidden = true;
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const original = stage.getBoundingClientRect();
    actor = getTelevision();
    dialog.showModal();
    onOpen?.();
    art.classList.add("is-film-open");
    closeButton.focus({ preventScroll: true });
    const duration = reduced() ? 0 : 900;
    let entering: Promise<unknown>;
    if (actor?.renderReady && !actor.contextLost && !actor.destroyed) {
      const television = actor;
      previousStyle = stage.style.cssText;
      homeMarker = document.createComment("television-home");
      stage.before(homeMarker);
      Object.assign(stage.style, bounds(original));
      dialog.append(stage);
      dialog.dataset.mode = "live";
      television.setPaused(false);
      television.resize();
      entering = Promise.all([
        television.enterFilm(video, { duration }),
        animateStage(viewport.getBoundingClientRect(), duration),
      ]);
    } else entering = showFallback(true);
    updateControls();
    void entering
      .catch(() => {
        if (opening === revision && active) void showFallback();
      })
      .then(async () => {
        if (!current(opening)) return;
        if (!reduced()) await delay(100);
        if (current(opening)) void preparePlayback(opening);
      });
  }
  function togglePlayback() {
    if (video.paused || video.ended) play();
    else {
      resumeOnVisible = false;
      video.pause();
    }
  }
  function onVisibility() {
    if (!active || dialog.dataset.state === "closing") return;
    if (document.hidden) {
      resumeOnVisible = !video.paused && !video.ended;
      video.pause();
    } else if (resumeOnVisible) {
      resumeOnVisible = false;
      play();
    }
  }
  listen(closeButton, "click", () => void close());
  listen(dialog, "cancel", (event) => {
    event.preventDefault();
    void close();
  });
  listen(dialog, "close", () => {
    if (!dialog.open) finishClose();
  });
  listen(playButton, "click", togglePlayback);
  listen(replayButton, "click", () => {
    video.currentTime = 0;
    play();
  });
  listen(muteButton, "click", () => {
    video.muted = !video.muted;
    updateControls();
  });
  listen(captionsButton, "click", () => {
    captionsEnabled = !captionsEnabled;
    captionsButton.setAttribute("aria-pressed", String(captionsEnabled));
    captionsButton.setAttribute(
      "aria-label",
      copy(
        captionsEnabled ? "home.film.captionsHide" : "home.film.captionsShow",
      ),
    );
    updateCaption();
  });
  listen(seek, "input", () => {
    if (video.readyState > 0) video.currentTime = Number(seek.value);
    updateControls();
  });
  listen(dialog, "keydown", (event) => {
    const tag = document.activeElement?.tagName ?? "";
    if (
      (event as KeyboardEvent).code === "Space" &&
      !/^(BUTTON|INPUT)$/.test(tag)
    ) {
      event.preventDefault();
      togglePlayback();
    }
  });
  const outsideTV = (event: Event) => {
    if (event.target !== dialog) return false;
    const { clientX: x, clientY: y } = event as PointerEvent;
    const rect =
      (dialog.dataset.mode === "live" && actor?.getFilmScreenBounds()) ||
      glass.getBoundingClientRect();
    return (
      x < rect.left ||
      x > rect.left + rect.width ||
      y < rect.top ||
      y > rect.top + rect.height
    );
  };
  listen(dialog, "pointerdown", (event) => {
    backdropPressed = outsideTV(event);
  });
  listen(dialog, "pointerup", (event) => {
    if (backdropPressed && outsideTV(event)) void close();
    backdropPressed = false;
  });
  listen(dialog, "pointercancel", () => {
    backdropPressed = false;
  });
  // Context loss while the film plays: the CSS TV takes over.
  listen(stage, "crt:error", () => {
    if (active) void showFallback();
  });
  listen(window, "resize", () => {
    if (active && homeMarker && dialog.dataset.state !== "closing")
      void animateStage(viewport.getBoundingClientRect(), 0);
  });
  listen(document, "visibilitychange", onVisibility);
  listen(motion, "change", () => {
    if (!active || !motion.matches) return;
    fallbackAnimation?.cancel();
    if (dialog.dataset.state === "closing") finishClose();
    else if (homeMarker) void animateStage(viewport.getBoundingClientRect(), 0);
  });
  listen(video, "error", () => {
    if (active) errorMessage.hidden = false;
  });
  for (const event of [
    "play",
    "pause",
    "ended",
    "timeupdate",
    "loadedmetadata",
    "volumechange",
    "seeked",
  ])
    listen(video, event, updateControls);
  listen(track, "load", () => {
    const captions = video.textTracks[0];
    if (captions) captions.mode = "hidden";
    updateCaption();
  });
  const captions = video.textTracks[0];
  if (captions) listen(captions, "cuechange", updateCaption);

  return {
    open,
    close,
    get isOpen() {
      return active;
    },
    destroy() {
      destroyed = true;
      finishClose();
      listeners.forEach((remove) => remove());
      if (loaded) {
        video.removeAttribute("src");
        video.removeAttribute("poster");
        track.removeAttribute("src");
        video.load();
      }
      dialog.remove();
    },
  };
}

/** Taps on the poster's visible pixels open the film too (no WebGL, or before the TV is live). */
export function bindTelevisionPoster({
  container,
  image,
  isActive,
  onActivate,
}: {
  container: HTMLElement;
  image: HTMLImageElement;
  isActive(): boolean;
  onActivate(): void;
}) {
  let press: { x: number; y: number; id: number; moved: boolean } | null = null;
  let pixels: Uint8ClampedArray | null = null;
  let sampleWidth = 0;
  let sampleHeight = 0;
  function hit(event: PointerEvent) {
    if (!image.complete || !image.naturalWidth) return false;
    const r = image.getBoundingClientRect();
    const scale = Math.min(
      r.width / image.naturalWidth,
      r.height / image.naturalHeight,
    );
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = (event.clientX - r.left - (r.width - width) / 2) / width;
    const y = (event.clientY - r.top - (r.height - height) / 2) / height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return false;
    if (!pixels) {
      const canvas = document.createElement("canvas");
      sampleWidth = canvas.width = Math.max(
        1,
        Math.round(image.naturalWidth * Math.min(1, 256 / image.naturalWidth)),
      );
      sampleHeight = canvas.height = Math.max(
        1,
        Math.round((image.naturalHeight * sampleWidth) / image.naturalWidth),
      );
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return false;
      try {
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
        pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      } catch {
        return false;
      }
    }
    const offset =
      (Math.floor(y * sampleHeight) * sampleWidth +
        Math.floor(x * sampleWidth)) *
      4;
    return (pixels[offset + 3] ?? 0) > 100;
  }
  const cancel = () => {
    press = null;
  };
  const down = (event: PointerEvent) => {
    press =
      isActive() &&
      event.button === 0 &&
      event.isPrimary !== false &&
      hit(event)
        ? {
            x: event.clientX,
            y: event.clientY,
            id: event.pointerId,
            moved: false,
          }
        : null;
  };
  const move = (event: PointerEvent) => {
    if (
      press?.id === event.pointerId &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12
    )
      press.moved = true;
    if (event.pointerType !== "touch" && isActive())
      container.style.cursor = hit(event) ? "pointer" : "";
  };
  const up = (event: PointerEvent) => {
    const tap = press;
    press = null;
    if (!tap || tap.id !== event.pointerId || tap.moved || !isActive()) return;
    if (
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 12 &&
      hit(event)
    )
      onActivate();
  };
  const leave = () => {
    cancel();
    container.style.cursor = "";
  };
  const events: [string, (event: PointerEvent) => void][] = [
    ["pointerdown", down],
    ["pointermove", move],
    ["pointerup", up],
    ["pointercancel", cancel],
    ["pointerleave", leave],
  ];
  for (const [name, handler] of events)
    container.addEventListener(name, handler as EventListener, {
      passive: true,
    });
  window.addEventListener("scroll", cancel, { passive: true });
  window.addEventListener("wheel", cancel, { passive: true });
  return () => {
    for (const [name, handler] of events)
      container.removeEventListener(name, handler as EventListener);
    window.removeEventListener("scroll", cancel);
    window.removeEventListener("wheel", cancel);
    container.style.cursor = "";
    pixels = null;
  };
}
