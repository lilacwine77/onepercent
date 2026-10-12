/**
 * A deploy replaces the hashed chunks a page was built with: a lazy import of an old
 * chunk then 404s (Chrome "Failed to fetch dynamically imported module", Firefox
 * "error loading dynamically imported module", Safari "Importing a module script
 * failed", Vite's "Unable to preload CSS"). A full reload loads the new build.
 */
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk \S+ failed/i;
export function isChunkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return CHUNK_ERROR.test(message);
}

/** The page reload (an object, so tests can stub it: jsdom's location is fixed). */
export const page = { reload: () => window.location.reload() };

const KEY = "onepercent.chunkReload";
/** A second failure this soon after a reload is a real one: show it, don't loop. */
const GUARD_MS = 30_000;
/**
 * Reloads the page once for a stale chunk. Returns false, and leaves the error to the
 * error boundary, when it already reloaded in the last 30 s or cannot remember it
 * (no sessionStorage: a reload could loop).
 */
export function reloadOnce(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (now - last < GUARD_MS) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    return false;
  }
  page.reload();
  return true;
}
