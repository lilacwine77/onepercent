// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import type { DeckEntry } from "@onepercent/sdk/browser";
import { accountIdentity, cardIdentity, withAccountLock } from "./account-lock";
import {
  enterSubmission,
  reconcileSubmission,
  rememberSubmission,
} from "../submission-guard";

const height = async () => 101;

describe("owner transaction lock", () => {
  it("keeps card identity across index movement and conservatively groups duplicates", () => {
    const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
    const entry: DeckEntry = {
      depositor: key(1),
      mint: key(2),
      amount: 100n,
      flags: 1,
      deposit: 10,
      _pad: new Uint8Array(3),
    };
    const original = { ...entry, deckIndex: 8 };
    const moved = { ...entry, deckIndex: 2 };
    expect(cardIdentity(moved)).toBe(cardIdentity(original));
    for (const changed of [
      { ...entry, depositor: key(3) },
      { ...entry, mint: key(3) },
      { ...entry, amount: 101n },
      { ...entry, flags: 2 },
      { ...entry, deposit: 11 },
    ])
      expect(cardIdentity(changed)).not.toBe(cardIdentity(entry));
  });

  it("allows a separate card exit during another card plan but blocks overlap", async () => {
    let finish: (() => void) | undefined;
    const first = withAccountLock(
      "solana:devnet",
      "scoped-owner",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      height,
      ["card-A"],
    );
    await expect(
      withAccountLock(
        "solana:devnet",
        "scoped-owner",
        async () => true,
        height,
        ["card-B"],
      ),
    ).resolves.toBe(true);
    await expect(
      withAccountLock(
        "solana:devnet",
        "scoped-owner",
        async () => true,
        height,
        ["card-A", "card-C"],
      ),
    ).rejects.toThrow("errors.generic");
    await expect(
      withAccountLock(
        "solana:devnet",
        "scoped-owner",
        async () => true,
        height,
      ),
    ).rejects.toThrow("errors.generic");
    finish!();
    await first;
  });

  it("blocks another flow for the same account until confirmation finishes", async () => {
    let finish: (() => void) | undefined;
    const first = withAccountLock(
      "devnet",
      "owner",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      height,
    );
    const second = vi.fn(async () => {});
    await expect(
      withAccountLock("devnet", "owner", second, height),
    ).rejects.toThrow("errors.generic");
    expect(second).not.toHaveBeenCalled();
    await expect(
      withAccountLock("devnet", "other", second, height),
    ).resolves.toBeUndefined();
    finish!();
    await first;
    await expect(
      withAccountLock("devnet", "owner", second, height),
    ).resolves.toBeUndefined();
  });
  it("releases on failure and isolates clusters", async () => {
    await expect(
      withAccountLock(
        "devnet",
        "owner",
        async () => {
          throw new Error("failure");
        },
        height,
      ),
    ).rejects.toThrow("failure");
    expect(
      await withAccountLock(
        "devnet",
        "owner",
        () => withAccountLock("mainnet", "owner", async () => true, height),
        height,
      ),
    ).toBe(true);
  });

  it("shares the Rip/Cards guard across route remounts in both directions", async () => {
    const identity = accountIdentity("solana:devnet", "route-owner");
    const releaseCards = await enterSubmission(identity, height);
    const feed = vi.fn(async () => {});
    await expect(
      withAccountLock("solana:devnet", "route-owner", feed, height),
    ).rejects.toThrow("errors.generic");
    expect(feed).not.toHaveBeenCalled();
    releaseCards();
    await withAccountLock(
      "solana:devnet",
      "route-owner",
      async () => {
        await expect(enterSubmission(identity, height)).rejects.toThrow(
          "errors.generic",
        );
      },
      height,
    );
    (await enterSubmission(identity, height))();
  });

  it("retains the existing uncertain-submission expiry guard before a Feed retry", async () => {
    const identity = accountIdentity("solana:devnet", "uncertain-owner");
    rememberSubmission(identity, 100);
    const retry = vi.fn(async () => {});
    await expect(
      withAccountLock(
        "solana:devnet",
        "uncertain-owner",
        retry,
        async () => 100,
      ),
    ).rejects.toThrow("errors.generic");
    expect(retry).not.toHaveBeenCalled();
    await expect(
      withAccountLock("solana:devnet", "uncertain-owner", retry, height),
    ).resolves.toBeUndefined();
  });

  it("keeps a Feed journal authoritative when another route sees a height past expiry", async () => {
    const identity = accountIdentity("solana:devnet", "journal-owner");
    rememberSubmission(identity, 100);
    const reconcile = vi.fn(async () => false);
    reconcileSubmission(identity, reconcile);
    await expect(enterSubmission(identity, async () => 1000)).rejects.toThrow(
      "errors.generic",
    );
    expect(reconcile).toHaveBeenCalledOnce();

    // A known receipt unlocks promptly, even before the blockhash expires.
    reconcile.mockResolvedValue(true);
    const heightRead = vi.fn(async () => 99);
    const release = await enterSubmission(identity, heightRead);
    expect(heightRead).not.toHaveBeenCalled();
    release();
  });
});
