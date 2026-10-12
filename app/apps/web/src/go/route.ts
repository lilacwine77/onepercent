export function matchGoRoute(pathname: string): string | null {
  return /^\/go\/([0-9a-f]{32})\/?$/.exec(pathname)?.[1] ?? null;
}
