import './concept-video.css';

// ?v= moves with every new cut (the app's player follows it): /media/ is cached
// for an hour, and no cache may keep an older picture, poster or captions.
const FILM_MEDIA = {
  poster: '/media/onepercent-explained.webp?v=10',
  captions: '/media/onepercent-explained.vtt?v=10',
  film: '/media/onepercent-explained.mp4?v=10',
};
/** The film's length (25 s), until its metadata arrives. */
const FILM_SECONDS = 25;

/** One media element drives both the curved WebGL screen and its CRT fallback. */
export function initConceptVideo({ dialog, trigger, stage, getTelevision, onOpen, onClose }) {
  const video = dialog.querySelector('video');
  const track = video.querySelector('track');
  const viewport = dialog.querySelector('[data-film-viewport]');
  const fallback = dialog.querySelector('[data-film-fallback]');
  const closeButton = dialog.querySelector('[data-concept-close]');
  const playButton = dialog.querySelector('[data-film-play]');
  const replayButton = dialog.querySelector('[data-film-replay]');
  const muteButton = dialog.querySelector('[data-film-mute]');
  const captionsButton = dialog.querySelector('[data-film-captions]');
  const seek = dialog.querySelector('[data-film-seek]');
  const time = dialog.querySelector('[data-film-time]');
  const caption = dialog.querySelector('[data-film-caption]');
  const errorMessage = dialog.querySelector('[data-concept-error]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const home = stage.parentElement;
  const listeners = [];
  let opener = trigger, active = false, loaded = false, destroyed = false;
  let actor, homeMarker, previousStyle, stageAnimation, fallbackAnimation;
  let revision = 0, backdropPressed = false, captionsEnabled = false;
  let resumeOnVisible = false, previousOverflow = '';
  let playbackReady = false, preparing = false;
  const pending = new Set();
  const current = id => active && id === revision && dialog.dataset.state !== 'closing';
  function cancelPending() {
    for (const cancel of pending) cancel();
    pending.clear();
  }
  function delay(ms) {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); pending.delete(done); resolve(); };
      const timer = setTimeout(done, ms);
      pending.add(done);
    });
  }
  function firstFrame() {
    const available = () => video.readyState >= video.HAVE_CURRENT_DATA && !video.seeking;
    if (available()) return Promise.resolve(true);
    return new Promise(resolve => {
      const events = ['loadeddata', 'canplay', 'seeked', 'error'];
      const done = event => {
        // Reopening seeks back to the first frame. loadeddata only fires once
        // per resource; later seeks report readiness through canplay/seeked.
        if (event && event.type !== 'error' && !available()) return;
        for (const name of events) video.removeEventListener(name, done);
        pending.delete(done);
        resolve(Boolean(event && event.type !== 'error' && available()));
      };
      pending.add(done);
      for (const name of events) video.addEventListener(name, done);
      if (video.error) done();
    });
  }
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  const clock = seconds => {
    const value = Math.max(0, Math.floor(seconds || 0));
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
  };
  const bounds = rect => ({
    left: rect.left + 'px', top: rect.top + 'px',
    width: rect.width + 'px', height: rect.height + 'px',
  });
  function updateCaption() {
    const cues = [...(video.textTracks[0]?.activeCues || [])];
    caption.textContent = cues.map(cue => cue.text).join('\n');
    caption.hidden = !captionsEnabled || !cues.length;
  }
  function updateControls() {
    const duration = Number.isFinite(video.duration) ? video.duration : FILM_SECONDS;
    seek.max = String(duration);
    seek.value = String(video.currentTime);
    seek.style.setProperty('--film-progress', (video.currentTime / duration * 100) + '%');
    seek.setAttribute('aria-valuetext', clock(video.currentTime) + ' of ' + clock(duration));
    time.textContent = clock(video.currentTime) + ' / ' + clock(duration);
    playButton.textContent = preparing ? 'Starting…' : video.error ? 'Retry' : video.ended ? 'Replay' : video.paused ? 'Play' : 'Pause';
    playButton.disabled = preparing;
    replayButton.disabled = !playbackReady;
    seek.disabled = !playbackReady;
    muteButton.textContent = video.muted ? 'Sound off' : 'Sound on';
    muteButton.setAttribute('aria-label', video.muted ? 'Unmute sound' : 'Mute sound');
    muteButton.setAttribute('aria-pressed', String(video.muted));
    updateCaption();
  }
  function play() {
    if (!active || dialog.dataset.state === 'closing') return;
    if (video.error) {
      playbackReady = false;
      video.load();
    }
    if (!playbackReady) {
      if (!preparing && dialog.dataset.state !== 'opening') {
        if (video.error) video.load();
        preparePlayback(revision);
      }
      return;
    }
    if (video.ended) video.currentTime = 0;
    errorMessage.hidden = true;
    // The element was primed in the click; if a browser still requires another
    // gesture, the visible Play button remains available without losing time.
    video.play()?.catch(() => {
      if (active && video.error) errorMessage.hidden = false;
      updateControls();
    });
  }
  async function preparePlayback(id) {
    if (!current(id)) return;
    preparing = true;
    errorMessage.hidden = true;
    dialog.dataset.state = 'preparing';
    updateControls();
    const available = await firstFrame();
    if (!current(id)) return;
    if (!available) {
      preparing = false;
      dialog.dataset.state = 'ready';
      errorMessage.hidden = false;
      updateControls();
      return;
    }
    if (dialog.dataset.mode === 'live') {
      try { await actor.revealFilm({ duration: motion.matches ? 0 : 400 }); }
      catch { if (current(id)) showFallback(); }
    }
    if (!current(id)) return;
    if (video.error) {
      preparing = playbackReady = false;
      dialog.dataset.state = 'ready';
      errorMessage.hidden = false;
      updateControls();
      return;
    }
    if (dialog.dataset.mode === 'fallback') {
      dialog.dataset.broadcast = 'film';
      if (!motion.matches) await delay(400);
    }
    if (!current(id)) return;
    playbackReady = true;
    preparing = false;
    dialog.dataset.state = 'playing';
    if (document.hidden) resumeOnVisible = true;
    else play();
    updateControls();
  }
  function animateStage(target, duration) {
    const from = bounds(stage.getBoundingClientRect());
    stageAnimation?.cancel();
    Object.assign(stage.style, from);
    if (!duration) {
      Object.assign(stage.style, bounds(target));
      actor?.resize();
      return Promise.resolve();
    }
    const animation = stage.animate([from, bounds(target)], {
      duration, easing: 'cubic-bezier(.22,.68,.14,1)', fill: 'forwards',
    });
    stageAnimation = animation;
    return animation.finished.catch(() => {}).then(() => {
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
      if (previousStyle === null) stage.removeAttribute('style');
      else stage.setAttribute('style', previousStyle);
      actor?.resize();
    }
    home.classList.remove('is-film-open');
  }
  function showFallback(animate = false) {
    dialog.dataset.mode = 'fallback';
    actor?.exitFilm?.({ duration: 0 });
    actor?.setPaused(true);
    if (playbackReady) dialog.dataset.broadcast = 'film';
    if (!animate || motion.matches) return Promise.resolve();
    const source = home.getBoundingClientRect();
    const glass = fallback.querySelector('.concept-video__glass');
    const destination = glass.getBoundingClientRect();
    const scale = Math.min(source.width / destination.width, source.height / destination.height) * .72;
    fallbackAnimation = glass.animate([
      { transform: 'translate(' + (source.left + source.width / 2 - destination.left - destination.width / 2) + 'px,' +
        (source.top + source.height / 2 - destination.top - destination.height / 2) + 'px) scale(' + scale + ')', opacity: 0 },
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
    ], { duration: 650, easing: 'cubic-bezier(.22,.68,.14,1)' });
    return fallbackAnimation.finished.catch(() => {});
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
    actor?.exitFilm?.({ duration: 0 });
    restoreStage();
    document.documentElement.style.overflow = previousOverflow;
    delete dialog.dataset.state;
    if (dialog.open) dialog.close();
    actor?.setPaused(false);
    actor = null;
    onClose?.();
    if (!destroyed && opener?.isConnected) opener.focus({ preventScroll: true });
  }
  async function close({ immediate = false } = {}) {
    if (!active || dialog.dataset.state === 'closing') return;
    dialog.dataset.state = 'closing';
    const closing = ++revision;
    cancelPending();
    video.pause();
    resumeOnVisible = false;
    dialog.dataset.broadcast = 'idle';
    const duration = immediate || motion.matches ? 0 : 650;
    const returning = actor?.exitFilm?.({ duration }) || Promise.resolve();
    if (homeMarker) await Promise.all([returning, animateStage(home.getBoundingClientRect(), duration)]);
    else if (duration) {
      const animation = fallback.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 650, fill: 'forwards', easing: 'ease-in-out' });
      await animation.finished.catch(() => {});
      animation.cancel();
    }
    if (closing === revision) finishClose();
  }
  function open(source = trigger) {
    if (active || destroyed) return;
    opener = source instanceof HTMLElement ? source : trigger;
    if (!loaded) {
      video.poster = FILM_MEDIA.poster;
      track.src = FILM_MEDIA.captions;
      video.src = FILM_MEDIA.film;
      dialog.querySelector('[data-film-idle]').src = '/assets/crt-screen.png?v=2';
      video.textTracks[0].mode = 'hidden';
      loaded = true;
    }
    if (video.error) video.load();
    video.preload = 'auto';
    // Prime this media element within user activation, then stop synchronously.
    // Neither its clock nor its audio may run while the television is moving.
    video.play()?.catch(() => {});
    video.pause();
    if (video.readyState > 0) video.currentTime = 0;
    active = true;
    playbackReady = false;
    preparing = true;
    const opening = ++revision;
    dialog.dataset.state = 'opening';
    dialog.dataset.broadcast = 'idle';
    errorMessage.hidden = true;
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const original = stage.getBoundingClientRect();
    actor = getTelevision?.();
    dialog.showModal();
    onOpen?.();
    home.classList.add('is-film-open');
    closeButton.focus({ preventScroll: true });
    const duration = motion.matches ? 0 : 900;
    let entering;
    if (actor?.renderReady && !actor.contextLost && !actor.destroyed) {
      previousStyle = stage.getAttribute('style');
      homeMarker = document.createComment('television-home');
      stage.before(homeMarker);
      Object.assign(stage.style, bounds(original));
      dialog.append(stage);
      dialog.dataset.mode = 'live';
      actor.setPaused(false);
      actor.resize();
      entering = Promise.all([
        actor.enterFilm(video, { duration }),
        animateStage(viewport.getBoundingClientRect(), duration),
      ]);
    } else {
      entering = showFallback(true);
    }
    updateControls();
    Promise.resolve(entering).catch(() => {
      if (opening === revision && active) showFallback();
    }).then(async () => {
      if (!current(opening)) return;
      if (!motion.matches) await delay(100);
      if (current(opening)) preparePlayback(opening);
    });
  }
  function togglePlayback() {
    if (video.paused || video.ended) play();
    else { resumeOnVisible = false; video.pause(); }
  }
  function onVisibility() {
    if (!active || dialog.dataset.state === 'closing') return;
    if (document.hidden) {
      resumeOnVisible = !video.paused && !video.ended;
      video.pause();
    } else if (resumeOnVisible) {
      resumeOnVisible = false;
      play();
    }
  }
  listen(trigger, 'click', () => open(trigger));
  listen(closeButton, 'click', () => close());
  listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  listen(dialog, 'close', () => { if (!dialog.open) finishClose(); });
  listen(playButton, 'click', togglePlayback);
  listen(replayButton, 'click', () => { video.currentTime = 0; play(); });
  listen(muteButton, 'click', () => { video.muted = !video.muted; updateControls(); });
  listen(captionsButton, 'click', () => {
    captionsEnabled = !captionsEnabled;
    captionsButton.setAttribute('aria-pressed', String(captionsEnabled));
    captionsButton.setAttribute('aria-label', captionsEnabled ? 'Hide English captions' : 'Show English captions');
    updateCaption();
  });
  listen(seek, 'input', () => {
    if (video.readyState > 0) video.currentTime = Number(seek.value);
    updateControls();
  });
  listen(dialog, 'keydown', event => {
    if (event.code === 'Space' && !/^(BUTTON|INPUT)$/.test(document.activeElement.tagName)) {
      event.preventDefault(); togglePlayback();
    }
  });
  const outsideTV = event => {
    if (event.target !== dialog) return false;
    const rect = (dialog.dataset.mode === 'live' && actor?.getFilmScreenBounds?.()) || fallback.querySelector('.concept-video__glass').getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.left + rect.width || event.clientY < rect.top || event.clientY > rect.top + rect.height;
  };
  listen(dialog, 'pointerdown', event => { backdropPressed = outsideTV(event); });
  listen(dialog, 'pointerup', event => {
    if (backdropPressed && outsideTV(event)) close();
    backdropPressed = false;
  });
  listen(dialog, 'pointercancel', () => { backdropPressed = false; });
  listen(stage, 'crt:error', () => { if (active) showFallback(); });
  listen(window, 'resize', () => {
    if (active && homeMarker && dialog.dataset.state !== 'closing') animateStage(viewport.getBoundingClientRect(), 0);
  });
  listen(document, 'visibilitychange', onVisibility);
  listen(motion, 'change', () => {
    if (!active || !motion.matches) return;
    fallbackAnimation?.cancel();
    if (dialog.dataset.state === 'closing') finishClose();
    else if (homeMarker) animateStage(viewport.getBoundingClientRect(), 0);
  });
  listen(video, 'error', () => { if (active) errorMessage.hidden = false; });
  for (const event of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'volumechange', 'seeked']) listen(video, event, updateControls);
  listen(track, 'load', () => { video.textTracks[0].mode = 'hidden'; updateCaption(); });
  if (video.textTracks[0]) listen(video.textTracks[0], 'cuechange', updateCaption);

  return {
    open, close,
    get isOpen() { return active; },
    destroy() {
      destroyed = true;
      finishClose();
      listeners.forEach(remove => remove());
      if (loaded) {
        video.removeAttribute('src'); video.removeAttribute('poster'); track.removeAttribute('src');
        video.load();
      }
    },
  };
}

/** Hit-test the visible poster pixels, including when WebGL is unavailable. */
export function bindTelevisionPoster({ container, image, isActive, onActivate }) {
  let press = null;
  let pixels;
  let sampleWidth;
  let sampleHeight;
  function hit(event) {
    if (!image.complete || !image.naturalWidth) return false;
    const r = image.getBoundingClientRect();
    const scale = Math.min(r.width / image.naturalWidth, r.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const x = (event.clientX - r.left - (r.width - width) / 2) / width;
    const y = (event.clientY - r.top - (r.height - height) / 2) / height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return false;
    if (!pixels) {
      const canvas = document.createElement('canvas');
      sampleWidth = canvas.width = Math.max(1, Math.round(image.naturalWidth * Math.min(1, 256 / image.naturalWidth)));
      sampleHeight = canvas.height = Math.max(1, Math.round(image.naturalHeight * sampleWidth / image.naturalWidth));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return false;
      try {
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
        pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      } catch { return false; }
    }
    const offset = (Math.floor(y * sampleHeight) * sampleWidth + Math.floor(x * sampleWidth)) * 4;
    return pixels[offset + 3] > 100;
  }
  function cancel() { press = null; }
  function down(event) {
    press = isActive() && event.button === 0 && event.isPrimary !== false && hit(event)
      ? { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false }
      : null;
  }
  function move(event) {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) press.moved = true;
    if (event.pointerType !== 'touch' && isActive()) container.style.cursor = hit(event) ? 'pointer' : '';
  }
  function up(event) {
    const tap = press;
    press = null;
    if (!tap || tap.id !== event.pointerId || tap.moved || !isActive()) return;
    if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 12 && hit(event)) onActivate();
  }
  function leave() { cancel(); container.style.cursor = ''; }
  const events = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['pointerleave', leave]];
  for (const [name, handler] of events) container.addEventListener(name, handler, { passive: true });
  window.addEventListener('scroll', cancel, { passive: true });
  window.addEventListener('wheel', cancel, { passive: true });
  return () => {
    for (const [name, handler] of events) container.removeEventListener(name, handler);
    window.removeEventListener('scroll', cancel);
    window.removeEventListener('wheel', cancel);
    container.style.cursor = '';
    pixels = null;
  };
}
