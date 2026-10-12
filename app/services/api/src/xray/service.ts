import { warnCause } from "@onepercent/service-kit";
import { PublicKey } from "@solana/web3.js";
import { XRAY } from "@onepercent/eligibility";
import type { XrayResult } from "@onepercent/eligibility/xray-result";
import type { NameResolver } from "./provider-types.js";
import { MemoryCache, type CacheStore } from "./cache.js";
import { buildShareLinks } from "./share.js";
import { XrayError } from "./error.js";
import { scanWallet, type ScanDependencies, type ScanRecord } from "./scan.js";

export function canonicalAddress(input: string): string | null {
  if (input.length < 32 || input.length > 44) return null;
  try {
    const key = new PublicKey(input);
    return key.toBase58() === input ? input : null;
  } catch (error) {
    warnCause("xray_address_invalid", error);
    return null;
  }
}
export interface ServiceDependencies extends ScanDependencies {
  names: NameResolver;
  snsEnabled?: boolean;
  cache?: CacheStore<ScanRecord>;
  deadlineMs?: number;
  allowedAddresses?: ReadonlySet<string>;
}
export class XrayService {
  private readonly cache: CacheStore<ScanRecord>;
  private readonly inflight = new Map<string, Promise<ScanRecord>>();
  constructor(private readonly deps: ServiceDependencies) {
    this.cache = deps.cache ?? new MemoryCache();
  }
  private async resolve(input: string): Promise<string> {
    const trimmed = input.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(trimmed))
      throw new XrayError("evm_not_supported", 400);
    let address = canonicalAddress(trimmed);
    if (
      !address &&
      this.deps.snsEnabled &&
      /^[^\s/]{1,100}\.sns$/i.test(trimmed)
    ) {
      let resolved: string | null;
      try {
        resolved = await this.deps.names.resolve(trimmed.toLowerCase());
      } catch (error) {
        warnCause("name_resolution_failed", error);
        throw new XrayError("name_resolution_failed", 502);
      }
      if (!resolved)
        throw new XrayError(
          this.deps.allowedAddresses ? "not_in_fixtures" : "name_not_found",
          404,
        );
      address = canonicalAddress(resolved);
      if (!address) throw new XrayError("name_resolution_failed", 502);
    }
    if (!address) throw new XrayError("invalid_address", 400);
    if (this.deps.allowedAddresses && !this.deps.allowedAddresses.has(address))
      throw new XrayError("not_in_fixtures", 404);
    return address;
  }
  private deadline<T>(
    work: Promise<T>,
    duration = this.deps.deadlineMs ?? 10_000,
    onTimeout?: () => void,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new XrayError("scan_timeout", 504));
        onTimeout?.();
      }, duration);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }
  private async scanRecord(input: string): Promise<ScanRecord> {
    const started = Date.now();
    const address = await this.deadline(this.resolve(input));
    const cached = this.cache.get(address);
    if (cached)
      return { ...cached, result: { ...cached.result, cached: true } };
    const budget = Math.max(
      0,
      (this.deps.deadlineMs ?? 10_000) - (Date.now() - started),
    );
    const existing = this.inflight.get(address);
    if (existing) return this.deadline(existing, budget);
    const controller = new AbortController();
    const pending = this.deadline(
      scanWallet(address, this.deps, controller.signal, Date.now() + budget),
      budget,
      () => controller.abort(),
    )
      .then((record) => {
        // Retry provider gaps on the next request; never freeze a partial scan for 24 h.
        if (!record.result.valuesPartial)
          this.cache.set(address, record, XRAY.cacheSeconds);
        return record;
      })
      .finally(() => {
        this.inflight.delete(address);
      });
    this.inflight.set(address, pending);
    return pending;
  }
  async getRecord(
    input: string,
    options: { ref?: string } = {},
  ): Promise<ScanRecord> {
    const record = structuredClone(await this.scanRecord(input));
    const result = record.result;
    // Referral links belong to this request, never the address-keyed scan cache.
    return {
      ...record,
      result: {
        ...result,
        share: buildShareLinks(result.address, {
          ...options,
          publicWebUrl: this.deps.publicWebUrl,
          publicApiUrl: this.deps.publicApiUrl,
          scannedAt: result.scannedAt,
          bags: result.counts.bags,
          title: result.card.title,
        }),
      },
    };
  }
  async get(
    input: string,
    options: { ref?: string } = {},
  ): Promise<XrayResult> {
    return (await this.getRecord(input, options)).result;
  }
}
// Lazy in-process entry point for the bot and Blinks, sharing the API's cache.
export const xrayService = {
  async get(
    input: string,
    options: { ref?: string } = {},
  ): Promise<XrayResult> {
    const { getDefaultXrayDependencies } = await import("./deps.js");
    return (await getDefaultXrayDependencies()).service.get(input, options);
  },
};
