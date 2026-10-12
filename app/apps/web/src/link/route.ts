export function matchLinkRoute(pathname: string): string | null {
  return /^\/link\/([0-9a-f]{32})\/?$/.exec(pathname)?.[1] ?? null;
}
