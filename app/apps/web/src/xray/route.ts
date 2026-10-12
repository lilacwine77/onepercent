export interface XrayRouteMatch {
  input: string;
}
export function matchXrayPath(pathname: string): XrayRouteMatch | null {
  if (pathname === "/x") return { input: "" };
  const match = /^\/x\/([^/]+)$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const input = decodeURIComponent(match[1]);
    // D9: name resolution stays behind the API's SNS flag; no old registry names.
    if (
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input) &&
      !/^[a-z0-9][a-z0-9-]{0,62}\.sns$/i.test(input)
    )
      return null;
    return { input };
  } catch {
    return null;
  }
}
