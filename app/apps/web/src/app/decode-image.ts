const decoding = new Map<string, Promise<void>>();

/**
 * Resolves once the image at `url` is downloaded and decoded, and never rejects:
 * a view waits on it so a large image never shows half-painted. Shared per URL,
 * so the view that then shows the image finds it decoded.
 */
export function decodeImage(url: string): Promise<void> {
  let ready = decoding.get(url);
  if (!ready) {
    const image = new Image();
    image.src = url;
    ready =
      typeof image.decode === "function"
        ? image.decode().catch(() => undefined)
        : Promise.resolve();
    decoding.set(url, ready);
  }
  return ready;
}
