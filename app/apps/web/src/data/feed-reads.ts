import { SERVICES, XRAY } from "@onepercent/config";
import {
  FEED_BACKGROUND_RPC_SHARE,
  MILLISECONDS_PER_MINUTE,
  WEB,
} from "@onepercent/config/web";
import { unpackMint } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import { createRpc } from "./rpc";

const cancelled = () =>
  Object.assign(new Error("Background read cancelled"), { name: "AbortError" });
export const isReadCancelled = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

/** All Feed background RPCs share one lane and at most a quarter of the proxy quota.
 * Transaction reads bypass this lane. Starting an action cancels the entire old
 * poll, including queued calls and later stages, until that poll has settled. */
export class FeedReads {
  private controller: AbortController | null = null;
  private settled: Promise<void> = Promise.resolve();
  private tail: Promise<unknown> = Promise.resolve();
  private recent: number[] = [];
  private exclusive = false;
  private backoffMs: number = WEB.machinePollMs;
  private nextPoll = 0;
  readonly rpc = createRpc(undefined, (run) => this.read(run));

  beginAction() {
    this.exclusive = true;
    this.controller?.abort(cancelled());
  }
  endAction() {
    this.exclusive = false;
  }
  cancel() {
    this.controller?.abort(cancelled());
  }
  degraded() {
    this.backoffMs = Math.min(this.backoffMs * 2, WEB.configRefreshMs);
  }
  healthy() {
    this.backoffMs = WEB.machinePollMs;
  }

  async poll(run: (signal: AbortSignal) => Promise<void>, force = false) {
    if (this.exclusive) return;
    if (force && this.controller) await this.settled;
    if (
      this.exclusive ||
      this.controller ||
      (!force && Date.now() < this.nextPoll)
    )
      return;
    const controller = new AbortController();
    this.controller = controller;
    let release: () => void = () => {};
    this.settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await run(controller.signal);
    } finally {
      // A rejected Promise.all can leave sibling reads queued or in flight.
      // Retire the complete group before a later poll replaces its controller.
      controller.abort(cancelled());
      this.nextPoll = Date.now() + this.backoffMs;
      this.controller = null;
      release();
    }
  }

  private read<T>(run: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    const controller = this.controller;
    if (!controller || controller.signal.aborted || this.exclusive)
      return Promise.reject(cancelled());
    const { signal } = controller;
    const result = this.tail
      .catch(() => {})
      .then(async () => {
        if (signal.aborted) throw cancelled();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        const stopped = new Promise<never>((_, reject) => {
          abort = () => reject(cancelled());
          signal.addEventListener("abort", abort, { once: true });
        });
        try {
          const now = Date.now();
          this.recent = this.recent.filter(
            (at) => now - at < MILLISECONDS_PER_MINUTE,
          );
          const budget = Math.floor(
            SERVICES.api.rpcPerMinutePerIp * FEED_BACKGROUND_RPC_SHARE,
          );
          if (!Number.isSafeInteger(budget) || budget < 1)
            throw new Error("Invalid background RPC budget");
          const delay =
            this.recent.length >= budget
              ? Math.max(0, this.recent[0]! + MILLISECONDS_PER_MINUTE - now)
              : 0;
          if (delay)
            await Promise.race([
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, delay);
              }),
              stopped,
            ]);
          if (signal.aborted) throw cancelled();
          // Count every attempt, including transport and provider failures.
          // Small reads can finish promptly; the rolling cap preserves exit capacity.
          this.recent.push(Date.now());
          return await Promise.race([run(signal), stopped]);
        } finally {
          clearTimeout(timer);
          if (abort) signal.removeEventListener("abort", abort);
        }
      });
    this.tail = result;
    return result;
  }
}

/** Mint decimals are immutable. Cache successful reads and retry unknown mints. */
export async function readMintDecimals(
  rpc: Pick<Connection, "getMultipleAccountsInfo">,
  mints: readonly PublicKey[],
  cache: Record<string, number>,
) {
  const missing = [
    ...new Map(mints.map((mint) => [mint.toBase58(), mint])).values(),
  ].filter((mint) => cache[mint.toBase58()] === undefined);
  for (let start = 0; start < missing.length; start += XRAY.accountsPerBatch) {
    const batch = missing.slice(start, start + XRAY.accountsPerBatch);
    const infos = await rpc.getMultipleAccountsInfo(batch, "confirmed");
    batch.forEach((mint, index) => {
      const info = infos[index];
      if (!info) return;
      try {
        cache[mint.toBase58()] = unpackMint(mint, info, info.owner).decimals;
      } catch {
        /* An unreadable scale stays unavailable. */
      }
    });
  }
  return { ...cache };
}
