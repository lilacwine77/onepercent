import { warnCause } from "@onepercent/service-kit";
/** Bounded background repair, independent of the transaction ingestion loop. */
export class IndexerMaintenance {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private running = false;
  private stopped = false;
  private nextAccounts = 0;
  private nextDeck = 0;
  private minSlot = 0n;
  private readonly retries = { accounts: 0, deck: 0 };
  private readonly requested = { accounts: 0, deck: 0 };
  constructor(
    private readonly options: {
      confirmedSlot(): Promise<bigint>;
      accounts(slot: bigint): Promise<unknown>;
      deck(slot: bigint): Promise<unknown>;
      accountSeconds: number;
      deckSeconds: number;
      retryMs: number;
      onFailure?: (
        kind: "accounts" | "deck",
        error: unknown,
        attempt: number,
      ) => Promise<void>;
      now?: () => number;
    },
  ) {}
  request(slot: bigint, full = false) {
    this.minSlot = slot > this.minSlot ? slot : this.minSlot;
    // Preserve an existing contention backoff when more transactions arrive.
    if (!this.retries.deck) this.nextDeck = 0;
    this.requested.deck++;
    if (full) {
      if (!this.retries.accounts) this.nextAccounts = 0;
      this.requested.accounts++;
    }
    if (this.running && !this.active) this.schedule();
  }
  start() {
    if (this.running || this.stopped) return;
    this.running = true;
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    const delay = Math.max(
      0,
      Math.min(this.nextAccounts, this.nextDeck) - this.now(),
    );
    this.timer = setTimeout(() => {
      void this.run();
    }, delay);
    this.timer.unref();
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  run(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.tick().finally(() => {
      this.active = undefined;
      if (this.running) this.schedule();
    });
    return this.active;
  }
  private async tick() {
    for (const kind of ["accounts", "deck"] as const) {
      if (this.stopped) return;
      const due = kind === "accounts" ? this.nextAccounts : this.nextDeck;
      if (this.now() < due) continue;
      const version = this.requested[kind];
      let next: number;
      try {
        const confirmed = await this.options.confirmedSlot();
        const slot = confirmed > this.minSlot ? confirmed : this.minSlot;
        await this.options[kind](slot);
        this.retries[kind] = 0;
        next =
          version !== this.requested[kind]
            ? 0
            : this.now() +
              (kind === "accounts"
                ? this.options.accountSeconds
                : this.options.deckSeconds) *
                1000;
      } catch (error) {
        const attempt = ++this.retries[kind];
        const interval =
          (kind === "accounts"
            ? this.options.accountSeconds
            : this.options.deckSeconds) * 1000;
        next =
          this.now() +
          Math.min(
            interval,
            this.options.retryMs * 2 ** Math.min(attempt - 1, 10),
          );
        await this.options
          .onFailure?.(kind, error, attempt)
          .catch((error) =>
            warnCause("indexer_reconcile_report_failed", error),
          );
      }
      if (kind === "accounts") this.nextAccounts = next;
      else this.nextDeck = next;
    }
  }
  async stop() {
    this.stopped = true;
    this.running = false;
    clearTimeout(this.timer);
    await this.active;
  }
}
