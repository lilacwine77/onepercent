import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyWallet, type ClassifyWalletInput } from "../src/classify.js";
import type { RawAccount, ReasonCode } from "../src/types.js";
import type { Bucket } from "../src/xray-result.js";
interface SerializedAccount {
  address: string;
  owner: string;
  lamports: string;
  dataBase64: string;
  source: string;
  derivedFrom: string;
  change: string;
}
interface WalletFixture {
  name: string;
  owner: string;
  source: string;
  note: string;
  slotS: number;
  solUsd: number;
  tokenAccounts: SerializedAccount[];
  mints: Record<string, string>;
  curves: Record<string, string>;
  prices: ClassifyWalletInput["prices"];
  exitCaps: Record<string, string | null>;
  exitCapsSource: string;
  snapshot: Record<
    string,
    { balanceAtS: string | null; mintFirstSeenSlot?: number }
  >;
  expected: {
    counts: {
      bags: number;
      feedable: number;
      checkAtFeed: number;
      notFeedable: number;
      sellable: number;
      empty: number;
      notInSet: number;
    };
    mints: Record<string, { buckets: Bucket[]; reason?: ReasonCode }>;
  };
}
const root = new URL("../fixtures/", import.meta.url);
const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, root)), "utf8")) as T;
const account = (raw: SerializedAccount): RawAccount => ({
  address: raw.address,
  owner: raw.owner,
  lamports: BigInt(raw.lamports),
  data: Buffer.from(raw.dataBase64, "base64"),
});

describe("synthetic wallet expectations over recorded mints", () => {
  it.each(["trencher", "clean", "mixed"])(
    "classifies %s with the documented synthetic owner",
    (name) => {
      const fixture = readJson<WalletFixture>(`wallets/${name}.json`);
      expect(fixture.source).toBe("synthetic");
      expect(fixture.exitCapsSource).toContain("synthetic");
      expect(fixture.note).toContain("not a real wallet scan");
      const result = classifyWallet({
        owner: fixture.owner,
        tokenAccounts: fixture.tokenAccounts.map(account),
        mints: new Map(
          Object.entries(fixture.mints).map(([mint, path]) => [
            mint,
            account(readJson<SerializedAccount>(path)),
          ]),
        ),
        curves: new Map(
          Object.entries(fixture.curves).map(([mint, path]) => [
            mint,
            account(readJson<SerializedAccount>(path)),
          ]),
        ),
        prices: fixture.prices,
        exitCaps: new Map(
          Object.entries(fixture.exitCaps).map(([mint, cap]) => [
            mint,
            cap === null ? null : BigInt(cap),
          ]),
        ),
        solUsd: fixture.solUsd,
        slotS: fixture.slotS,
        snapshot: new Map(
          Object.entries(fixture.snapshot).map(([mint, evidence]) => [
            mint,
            {
              ...evidence,
              balanceAtS:
                evidence.balanceAtS === null
                  ? null
                  : BigInt(evidence.balanceAtS),
            },
          ]),
        ),
      });
      const count = (bucket: Bucket) =>
        result.bags.filter((bag) => bag.buckets.includes(bucket)).length;
      expect({
        bags: count("feedable") + count("not_feedable_season"),
        feedable: result.bags.filter(
          (bag) =>
            bag.buckets.includes("feedable") &&
            bag.reason !== "snapshot_at_feed",
        ).length,
        checkAtFeed: result.bags.filter(
          (bag) => bag.reason === "snapshot_at_feed",
        ).length,
        notFeedable: count("not_feedable_season"),
        sellable: count("sell"),
        empty: result.empties.length,
        notInSet: count("not_in_set"),
      }).toEqual(fixture.expected.counts);
      expect(
        Object.fromEntries(
          result.bags.map((bag) => [
            bag.mint,
            {
              buckets: bag.buckets,
              ...(bag.reason ? { reason: bag.reason } : {}),
            },
          ]),
        ),
      ).toEqual(fixture.expected.mints);
      expect(result.skippedTokenAccounts).toBe(0);
      expect(result.bags.every((bag) => !bag.buckets.includes("close"))).toBe(
        true,
      );
      const ranks = result.bags.map((bag) =>
        bag.buckets.includes("feedable")
          ? 0
          : bag.buckets.includes("not_feedable_season")
            ? 1
            : 2,
      );
      expect(ranks).toEqual([...ranks].sort());
      if (name === "trencher") {
        expect(result.bags.length).toBeGreaterThanOrEqual(12);
        expect(result.empties.length).toBeGreaterThanOrEqual(5);
      }
      for (const raw of fixture.tokenAccounts) {
        expect(raw.source).toBe("synthetic");
        expect(raw.derivedFrom).toBeTruthy();
        expect(raw.change).toBeTruthy();
      }
    },
  );
  it("keeps derivation provenance on every synthetic fixture", () => {
    for (const file of readdirSync(
      fileURLToPath(new URL("synthetic/", root)),
    )) {
      if (!file.endsWith(".json")) continue;
      const raw = readJson<SerializedAccount>(`synthetic/${file}`);
      expect(raw.source).toBe("synthetic");
      expect(raw.derivedFrom).toBeTruthy();
      expect(raw.change).toBeTruthy();
    }
  });
});
