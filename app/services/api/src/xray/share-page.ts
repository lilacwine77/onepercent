import { warnCause } from "@onepercent/service-kit";
import { SHARE_COPY, xraySegments } from "@onepercent/eligibility/copy";
import { shortAddress } from "@onepercent/eligibility/format";
import type { XrayResult } from "@onepercent/eligibility/xray-result";
import { MemoryCache } from "./cache.js";
import { XrayError } from "./error.js";
import { sharePageUrl } from "./share.js";

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}
export class SharePageRenderer {
  private readonly shells = new MemoryCache<string>();
  constructor(
    private readonly publicWebUrl: string,
    private readonly shellUrl?: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async render(result: XrayResult): Promise<string> {
    const ref =
      new URL(result.share.landscapeUrl).searchParams.get("ref") ?? undefined;
    const page = sharePageUrl(result.address, this.publicWebUrl, ref);
    const title = SHARE_COPY.title(shortAddress(result.address));
    const fields = {
      "og:title": title,
      "og:description": xraySegments(result),
      "og:image": result.share.landscapeUrl,
      "og:image:width": "1200",
      "og:image:height": "630",
      "og:url": page,
      "twitter:card": "summary_large_image",
      "twitter:image": result.share.landscapeUrl,
    };
    const tags = Object.entries(fields)
      .map(
        ([name, value]) =>
          `<meta ${name.startsWith("twitter:") ? "name" : "property"}="${escapeHtml(name)}" content="${escapeHtml(value)}">`,
      )
      .join("\n");
    if (!this.shellUrl)
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${tags}</head><body><a href="${escapeHtml(page)}">${escapeHtml(SHARE_COPY.fallbackLink)}</a></body></html>`;
    const cleaned = await this.cleanShell();
    return cleaned.replace(/<\/head\s*>/i, `${tags}\n</head>`);
  }
  /** The app shell without share metadata, for addresses whose scan failed:
   * the app then shows its own error state instead of a raw API error. */
  async renderShell(address: string): Promise<string> {
    if (!this.shellUrl) {
      const page = sharePageUrl(address, this.publicWebUrl);
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(SHARE_COPY.title(shortAddress(address)))}</title></head><body><a href="${escapeHtml(page)}">${escapeHtml(SHARE_COPY.fallbackLink)}</a></body></html>`;
    }
    return this.cleanShell();
  }
  private async cleanShell(): Promise<string> {
    const shellUrl = this.shellUrl!;
    let shell = this.shells.get(shellUrl);
    if (!shell) {
      try {
        const response = await this.fetcher(shellUrl, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error();
        shell = await response.text();
        if (!/<\/head\s*>/i.test(shell)) throw new Error();
        this.shells.set(shellUrl, shell, 600);
      } catch (error) {
        warnCause("xray_shell_unavailable", error);
        throw new XrayError("upstream_failed", 502);
      }
    }
    // Remove shell defaults so crawlers see exactly one canonical set of tags.
    return shell.replace(
      /<meta\b[^>]*\b(?:property|name)\s*=\s*["'](?:og:|twitter:)[^"']*["'][^>]*>/gi,
      "",
    );
  }
}
