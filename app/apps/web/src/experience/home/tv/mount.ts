/** Viewport coordinates of the TV's glass (the film's hit area). */
export interface FilmBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** What the film player needs from the live TV (the landing's crt-tv.js contract). */
export interface FilmTelevision {
  readonly renderReady: boolean;
  readonly contextLost: boolean;
  readonly destroyed: boolean;
  setPaused(value: boolean): void;
  resize(): void;
  enterFilm(
    video: HTMLVideoElement,
    options?: { duration?: number },
  ): Promise<boolean>;
  revealFilm(options?: { duration?: number }): Promise<boolean>;
  exitFilm(options?: { duration?: number }): Promise<boolean>;
  getFilmScreenBounds(): FilmBounds | null;
}
export interface TvHandle {
  ready: Promise<void>;
  television: FilmTelevision;
  replay(): void;
  destroy(): void;
}
/**
 * The 3D TV needs WebGL2 on a real GPU and no Save-Data; otherwise the poster
 * stays (it is the same picture). Software renderers (SwiftShader, llvmpipe)
 * would spend hundreds of ms per frame, so they keep the poster too.
 */
export async function mountTv(
  container: HTMLElement,
): Promise<TvHandle | null> {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData) return null;
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) return null;
  const info = probe.getExtension("WEBGL_debug_renderer_info");
  const renderer = info
    ? String(probe.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : "";
  probe.getExtension("WEBGL_lose_context")?.loseContext();
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer))
    return null;
  const { createTelevision } = await import("./experience-3d");
  const tv = createTelevision(container, false);
  return {
    ready: tv.ready,
    television: tv,
    replay: () => tv.replay(),
    destroy: () => tv.destroy(),
  };
}
