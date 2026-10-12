import { warnCause } from "@onepercent/service-kit";
import { lookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import { BlockList, isIP, type TcpNetConnectOpts } from "node:net";
import { WEB } from "@onepercent/config";
import type { TokenMetadata } from "./values.js";
export interface LogoImage {
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}
export function permittedLogoUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    const host = url.hostname.toLowerCase();
    if (
      !WEB.logoHosts.some((pattern) =>
        pattern.startsWith("*.")
          ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1
          : host === pattern,
      )
    )
      return null;
    return url;
  } catch (error) {
    warnCause("web_logo_url_invalid", error);
    return null;
  }
}
/** Allow-listed gateways an IPFS image is also tried on, in this order. */
const IPFS_GATEWAYS = [
  "ipfs.filebase.io",
  "gateway.pinata.cloud",
  "ipfs.io",
] as const;
/**
 * The allow-listed URLs to try for a metadata image: the URL itself when its host
 * is allowed, then, for IPFS content (a `/ipfs/<cid>` path on any host or a
 * `<cid>.ipfs.<host>` subdomain), the same content on the allowed gateways. Public
 * gateways rate-limit (ipfs.io answers 429 to busy egress addresses) and some
 * tokens point at gateways off the list; the content is the same everywhere.
 */
export function logoCandidates(uri: string): URL[] {
  const urls: URL[] = [];
  const add = (value: string) => {
    const url = permittedLogoUrl(value);
    if (url && !urls.some((known) => known.href === url.href)) urls.push(url);
  };
  add(uri);
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch (error) {
    warnCause("web_logo_url_invalid", error);
    return urls;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return urls;
  const path = /^\/ipfs\/([A-Za-z0-9]{46,100})(\/[\w.-]+)*\/?$/.exec(
    parsed.pathname,
  );
  const subdomain = /^([a-z0-9]{46,100})\.ipfs\.[a-z0-9.-]+$/.exec(
    parsed.hostname,
  );
  const content = path
    ? parsed.pathname.slice("/ipfs/".length)
    : subdomain && /^(\/[\w.-]+)*\/?$/.test(parsed.pathname)
      ? `${subdomain[1]}${parsed.pathname === "/" ? "" : parsed.pathname}`
      : null;
  if (content)
    for (const gateway of IPFS_GATEWAYS)
      add(`https://${gateway}/ipfs/${content}`);
  return urls;
}
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
export function publicLogoAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  if (address.toLowerCase().startsWith("::ffff:")) {
    const suffix = address.slice(7);
    if (isIP(suffix) === 4) return publicLogoAddress(suffix);
    return false;
  }
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}
export function logoType(bytes: Uint8Array): LogoImage["type"] | null {
  const b = Buffer.from(bytes);
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "image/jpeg";
  if (
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (b.length >= 6 && ["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6)))
    return "image/gif";
  return null;
}
export type LogoTransport = (
  url: URL,
  signal: AbortSignal,
) => Promise<Uint8Array>;
// DNS results are checked and pinned into the TLS request; no second lookup or redirect.
export const downloadLogo: LogoTransport = async (url, signal) => {
  if (!permittedLogoUrl(url.href)) throw new Error("Logo host refused");
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicLogoAddress(address))
  )
    throw new Error("Logo address refused");
  const selected = addresses[0]!;
  signal.throwIfAborted();
  return new Promise<Uint8Array>((resolve, reject) => {
    // HTTPS passes TCP options through to the socket connector.
    const options: RequestOptions &
      Pick<TcpNetConnectOpts, "autoSelectFamily"> = {
      signal,
      autoSelectFamily: true,
      lookup: (_host, lookupOptions, callback) =>
        lookupOptions.all
          ? callback(null, addresses)
          : callback(null, selected.address, selected.family),
    };
    const req = request(url, options, (response) => {
      if (
        response.statusCode !== 200 ||
        Number(response.headers["content-length"] ?? 0) > WEB.logoMaxBytes
      ) {
        response.destroy();
        reject(new Error("Logo response refused"));
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > WEB.logoMaxBytes) {
          response.destroy(new Error("Logo too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => resolve(Buffer.concat(chunks)));
    });
    req.once("error", reject);
    req.end();
  });
};
export const LOGO_CACHE_MAX_BYTES = 64 * 1_024 * 1_024;
export const LOGO_NEGATIVE_CACHE_MS = 300_000;
const LOGO_CACHE_MAX_ENTRIES = 5_000;
const LOGO_POSITIVE_CACHE_MS = 86_400_000;
export class LogoProxy {
  private readonly cache = new Map<
    string,
    { until: number; image: LogoImage | null }
  >();
  private cachedBytes = 0;
  private readonly pending = new Map<string, Promise<LogoImage | null>>();
  readonly missedHosts = new Map<string, number>();
  constructor(
    private readonly metadata: (
      mints: string[],
    ) => Promise<Record<string, TokenMetadata | undefined>>,
    private readonly transport: LogoTransport = downloadLogo,
    private readonly now: () => number = Date.now,
  ) {}
  cacheUsage() {
    return { bytes: this.cachedBytes, entries: this.cache.size };
  }
  private remove(mint: string) {
    const entry = this.cache.get(mint);
    if (entry) this.cachedBytes -= entry.image?.bytes.byteLength ?? 0;
    this.cache.delete(mint);
  }
  hasCached(mint: string): boolean {
    const entry = this.cache.get(mint);
    if (!entry) return false;
    if (entry.until <= this.now()) {
      this.remove(mint);
      return false;
    }
    return true;
  }
  async get(mint: string): Promise<LogoImage | null> {
    if (this.hasCached(mint)) {
      const entry = this.cache.get(mint)!;
      this.cache.delete(mint);
      this.cache.set(mint, entry);
      return entry.image;
    }
    const active = this.pending.get(mint);
    if (active) return active;
    const work = this.load(mint);
    this.pending.set(mint, work);
    try {
      const image = await work;
      const bytes = image?.bytes.byteLength ?? 0;
      this.remove(mint);
      while (
        this.cache.size >= LOGO_CACHE_MAX_ENTRIES ||
        this.cachedBytes + bytes > LOGO_CACHE_MAX_BYTES
      )
        this.remove(this.cache.keys().next().value!);
      this.cache.set(mint, {
        image,
        until:
          this.now() +
          (image ? LOGO_POSITIVE_CACHE_MS : LOGO_NEGATIVE_CACHE_MS),
      });
      this.cachedBytes += bytes;
      return image;
    } finally {
      this.pending.delete(mint);
    }
  }
  private async load(mint: string): Promise<LogoImage | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const uri = (await this.metadata([mint]))[mint]?.logoURI;
          if (!uri) return null;
          const candidates = logoCandidates(uri);
          if (!candidates.length) {
            try {
              const host = new URL(uri).hostname;
              if (this.missedHosts.has(host) || this.missedHosts.size < 100)
                this.missedHosts.set(
                  host,
                  (this.missedHosts.get(host) ?? 0) + 1,
                );
            } catch (error) {
              warnCause("web_logo_host_invalid", error);
              /* No host. */
            }
            return null;
          }
          for (const url of candidates) {
            try {
              const bytes = await this.transport(url, controller.signal);
              if (bytes.length > WEB.logoMaxBytes) continue;
              const type = logoType(bytes);
              if (type) return { bytes, type };
            } catch (error) {
              warnCause("web_logo_fetch_failed", error);
              if (controller.signal.aborted) return null;
            }
          }
          return null;
        })(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, WEB.logoTimeoutMs);
        }),
      ]);
    } catch (error) {
      warnCause("web_logo_unavailable", error);
      return null;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
