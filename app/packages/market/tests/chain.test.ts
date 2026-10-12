import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import type { Clock } from "../src/clock.js";
import { createExitCapClient } from "../src/chain/exit-cap.js";
import { createHoldersClient } from "../src/chain/holders.js";
import { createMintSafetyClient } from "../src/chain/mint-safety.js";
import {
  decodeBondingCurve,
  decodePumpPool,
  deriveBondingCurve,
  deriveCanonicalPool,
} from "../src/chain/pump-layouts.js";
import {
  BPS_DENOMINATOR,
  CHAIN_LAYOUT,
  HIT_LIST,
  MARKET,
  STOCK,
} from "../src/params.js";
import { fixtureFetch } from "../src/testing.js";

const file = (name: string) =>
  new URL(`./fixtures/rpc/${name}.json`, import.meta.url);
interface RecordedAccount {
  request: { body: { params: string[] } };
  response: {
    body: {
      result: { context: { slot: number }; value: { data: [string, string] } };
    };
  };
  provenance: {
    mint: string;
    length: number;
    expectedDecoded: Record<string, unknown>;
    layoutSha256: string;
  };
}
const read = <T = RecordedAccount>(name: string): T =>
  JSON.parse(readFileSync(file(name), "utf8")) as T;
const bytes = (name: string) =>
  Buffer.from(read(name).response.body.result.value.data[0], "base64");
const mint = (name: string) => read(name).provenance.mint;
const major = (symbol: string) =>
  HIT_LIST.launchMajors.find((token) => token.symbol === symbol)!.mint;
const sampleMint = mint("curve-151-pqc");
const clock: Clock = {
  nowMs: () => Date.parse("2026-10-08T20:00:00Z"),
  sleep: () => new Promise(() => {}),
  random: () => 0,
};
function options(names: string[]) {
  return {
    fetch: vi.fn(fixtureFetch(names.map(file))),
    clock,
    env: {
      pythHermesUrl: "https://hermes.pyth.network",
      solanaRpcUrl: "https://rpc.invalid/",
    },
  };
}
const jsonSafe = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, field: unknown) =>
      typeof field === "bigint" ? field.toString() : field,
    ),
  );

describe("published Pump layouts checked against live chain evidence", () => {
  const curves = [
    "curve-81-a",
    "curve-81-b",
    "curve-150-pnut",
    "curve-150-fartcoin",
    "curve-166-live",
    "curve-166-complete",
    "curve-115-non-sol",
    "curve-151-pqc",
  ];
  for (const name of curves)
    it(`verifies every consumed offset against the independently walked official IDL: ${name}`, () => {
      const fixture = read(name);
      expect(bytes(name).length).toBe(fixture.provenance.length);
      expect(fixture.provenance.layoutSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(jsonSafe(decodeBondingCurve(bytes(name)))).toEqual(
        fixture.provenance.expectedDecoded,
      );
      expect(deriveBondingCurve(fixture.provenance.mint)).toBe(
        fixture.request.body.params[0],
      );
    });
  it("defaults fully absent appended fields and rejects partially present ones", () => {
    expect(decodeBondingCurve(bytes("curve-short-legacy"))).toMatchObject({
      creator: PublicKey.default.toBase58(),
      mayhem: false,
      cashback: false,
      quoteMint: PublicKey.default.toBase58(),
      creatorFeeBps: 0n,
    });
    expect(() => decodeBondingCurve(bytes("curve-partial-field"))).toThrowError(
      expect.objectContaining({ code: "PROVIDER_SCHEMA" }),
    );
  });
  it("verifies pool offsets and preserves signed virtual reserves", () => {
    expect(jsonSafe(decodePumpPool(bytes("pool-pqc")))).toMatchObject(
      read("pool-pqc").provenance.expectedDecoded,
    );
    expect(deriveCanonicalPool(sampleMint)).toBe(
      read("pool-pqc").request.body.params[0],
    );
    expect(
      decodePumpPool(bytes("pool-negative-virtual")).virtualQuoteReserves,
    ).toBe(-17n);
  });
});

describe("exit caps distinguish absent origins from unavailable evidence", () => {
  it("reads real SOL reserves, mayhem and a non-SOL quote separately", async () => {
    for (const name of ["curve-81-a", "curve-166-live", "curve-115-non-sol"]) {
      const opts = options([name]);
      const decoded = decodeBondingCurve(bytes(name));
      await expect(
        createExitCapClient(opts).getExitCap(mint(name)),
      ).resolves.toEqual({
        kind: "curve",
        realQuoteLamports: decoded.realQuoteReserves,
        feeBps: MARKET.exitCap.curveFeeBps,
        mayhem: decoded.mayhem,
        solQuote: decoded.quoteMint === PublicKey.default.toBase58(),
        slot: read(name).response.body.result.context.slot,
      });
      expect(opts.fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("caps a completed curve at its real vault, ignoring positive or negative virtual reserves", async () => {
    const balance = read<{
      response: { body: { result: { value: { amount: string } } } };
    }>("vault-pqc");
    for (const pool of ["pool-pqc", "pool-negative-virtual"]) {
      const opts = options(["curve-151-pqc", pool, "vault-pqc"]);
      expect(
        await createExitCapClient(opts).getExitCap(sampleMint),
      ).toMatchObject({
        kind: "pumpswap",
        realQuoteLamports: BigInt(balance.response.body.result.value.amount),
        feeBps: STOCK.trendingPoolFeeAllowanceBps,
        solQuote: true,
        mayhem: false,
      });
      expect(opts.fetch).toHaveBeenCalledTimes(3);
    }
  });
  it("returns none for confirmed absent origins, non-matching ownership/discriminators and older migrations", async () => {
    for (const name of [
      "curve-wif-absent",
      "curve-wrong-owner",
      "curve-wrong-discriminator",
    ]) {
      const queriedMint =
        name === "curve-wif-absent" ? major("WIF") : mint("curve-81-a");
      await expect(
        createExitCapClient(options([name])).getExitCap(queriedMint),
      ).resolves.toEqual({ kind: "none" });
    }
    await expect(
      createExitCapClient(
        options(["curve-150-pnut", "pool-pnut-absent"]),
      ).getExitCap(major("PNUT")),
    ).resolves.toEqual({ kind: "none" });
  });
  it("fails closed for RPC errors, malformed fields and a required missing vault", async () => {
    await expect(
      createExitCapClient(options(["curve-rpc-error"])).getExitCap(
        mint("curve-81-a"),
      ),
    ).rejects.toMatchObject({ code: "EXIT_CAP_UNAVAILABLE" });
    await expect(
      createExitCapClient(options(["curve-partial-field"])).getExitCap(
        mint("curve-166-live"),
      ),
    ).rejects.toMatchObject({ code: "EXIT_CAP_UNAVAILABLE" });
    await expect(
      createExitCapClient(
        options(["curve-151-pqc", "pool-pqc", "vault-missing"]),
      ).getExitCap(sampleMint),
    ).rejects.toMatchObject({ code: "EXIT_CAP_UNAVAILABLE" });
  });
  it("rejects invalid mints before I/O", async () => {
    const opts = options([]);
    await expect(
      createExitCapClient(opts).getExitCap("invalid"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(opts.fetch).not.toHaveBeenCalled();
  });
});

describe("mint safety and top holders use RPC evidence", () => {
  it("accepts SPL and metadata-only Token-2022; refuses PUMP transfer hook", async () => {
    const spl = await createMintSafetyClient(
      options(["mint-wif"]),
    ).getMintSafety(major("WIF"));
    expect(spl).toMatchObject({
      safe: true,
      mintAuthorityDisabled: true,
      freezeAuthorityDisabled: true,
      extensions: [],
    });
    const metadataMint = read("mint-catcraft").request.body.params[0]!;
    const metadata = await createMintSafetyClient(
      options(["mint-catcraft"]),
    ).getMintSafety(metadataMint);
    expect(metadata.safe).toBe(true);
    expect(metadata.extensions).toEqual(
      expect.arrayContaining(["MetadataPointer", "TokenMetadata"]),
    );
    const pump = await createMintSafetyClient(
      options(["mint-pump"]),
    ).getMintSafety(read("mint-pump").request.body.params[0]!);
    expect(pump.safe).toBe(false);
    expect(pump.extensions).toContain("TransferHook");
  });
  it("refuses authority, decimals and extension boundary violations", async () => {
    for (const name of [
      "mint-freeze-authority",
      "mint-decimals-high",
      "mint-disallowed-extension",
    ]) {
      expect(
        (
          await createMintSafetyClient(options([name])).getMintSafety(
            read(name).request.body.params[0]!,
          )
        ).safe,
      ).toBe(false);
    }
  });
  it("excludes the canonical pool and computes an exact ceiling from the remaining top ten", async () => {
    const holders = await createHoldersClient(
      options([
        "holders-pqc-largest",
        "holders-pqc-owners",
        "holders-pqc-supply",
      ]),
    ).getTopHolders(sampleMint);
    expect(holders.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: deriveCanonicalPool(sampleMint),
          reason: "canonical_pool",
        }),
      ]),
    );
    const top = holders.holders
      .slice(0, CHAIN_LAYOUT.topHolderCount)
      .reduce((sum, account) => sum + account.amount, 0n);
    expect(BigInt(holders.top10Bps) * holders.supply).toBeGreaterThanOrEqual(
      top * BigInt(BPS_DENOMINATOR),
    );
    expect(BigInt(holders.top10Bps - 1) * holders.supply).toBeLessThan(
      top * BigInt(BPS_DENOMINATOR),
    );
  });
  it("lists pool, curve, incinerator and all other PDA exclusions individually", async () => {
    const holders = await createHoldersClient(
      options([
        "holders-pqc-largest",
        "holders-exclusions",
        "holders-pqc-supply",
      ]),
    ).getTopHolders(sampleMint);
    expect(holders.excluded.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        "canonical_pool",
        "bonding_curve",
        "incinerator",
        "off_curve",
      ]),
    );
    expect(
      holders.holders.every(({ owner }) =>
        PublicKey.isOnCurve(new PublicKey(owner).toBytes()),
      ),
    ).toBe(true);
  });
  it("does not turn unavailable supply into a zero concentration", async () => {
    await expect(
      createHoldersClient(
        options([
          "holders-pqc-largest",
          "holders-pqc-owners",
          "holders-zero-supply",
        ]),
      ).getTopHolders(sampleMint),
    ).rejects.toMatchObject({ code: "PROVIDER_SCHEMA" });
  });
});
