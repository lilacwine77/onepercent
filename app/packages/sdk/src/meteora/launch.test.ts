import { Buffer } from "buffer";
import { readFileSync } from "node:fs";
import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TOKEN_1PCT, TX_LIMITS } from "@onepercent/config";
import { describe, expect, expectTypeOf, it } from "vitest";
import { U64_MAX, discriminator } from "../bytes.js";
import { serializedSize } from "../tx/index.js";
import {
  buildLaunchCandidates,
  buildLaunchTransaction,
  launchAddresses,
  launchInstructionGroups,
  launchLookupAddresses,
  validateLaunchLookupTable,
  type LaunchTransactionOptions,
} from "../tx/launch.js";
import { powerOnIx } from "../ix/powerOn.js";
import { dbcPool, DBC_PROGRAM_ID } from "./index.js";

import { DEPLOYMENT } from "../../tests/program-id.js";
import { createDeploymentSelector } from "../deployment.js";

const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const wallet = key(1),
  mint = key(2),
  dbcConfig = new PublicKey(DEPLOYMENT.meteora.dbcConfig);
const options: LaunchTransactionOptions = {
  deployment: DEPLOYMENT,
  name: "Onepercent",
  symbol: "1PCT",
  uri: `https://example.com/${"x".repeat(60)}`,
  wallet,
  mint,
  blockhash: key(8).toBase58(),
  maxSolCost: 2_000_000_000n,
  computeUnitLimit: 600_000,
  computeUnitPriceMicroLamports: 1n,
  tip: { recipient: key(9), lamports: 1n },
};
const table = (opts = options) =>
  new AddressLookupTableAccount({
    key: key(11),
    state: {
      deactivationSlot: U64_MAX,
      lastExtendedSlot: 12,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: launchLookupAddresses(opts),
    },
  });

describe("M4.1 power_on account vector", () => {
  it("encodes the pinned twelve-account list and privileges", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "../../../../fixtures/meteora/power-on-vector.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    // This captured vector carries its own deployment identity, independently of
    // the current cluster-specific IDL used by the other launch tests.
    const vectorOptions = {
      ...options,
      deployment: createDeploymentSelector({ localnet: fixture.programId })(
        "localnet",
      ),
    };
    const addresses = launchAddresses(vectorOptions);
    const ix = powerOnIx(vectorOptions.deployment, {
      launchWallet: wallet,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    expect(launchInstructionGroups(vectorOptions).depositAndPowerOn[2]).toEqual(
      ix,
    );
    expect(ix.data.toString("hex")).toBe("7be51b871d820265");
    expect(ix.data).toEqual(discriminator("global", "power_on"));
    expect({
      programId: ix.programId.toBase58(),
      dataHex: ix.data.toString("hex"),
      accounts: ix.keys.map((meta) => ({
        address: meta.pubkey.toBase58(),
        signer: meta.isSigner,
        writable: meta.isWritable,
      })),
    }).toEqual({
      programId: fixture.programId,
      dataHex: fixture.dataHex,
      accounts: fixture.accounts,
    });
    expect(
      ix.keys.map((meta) => [
        meta.pubkey.toBase58(),
        meta.isSigner,
        meta.isWritable,
      ]),
    ).toEqual([
      [wallet.toBase58(), true, true],
      [addresses.config.toBase58(), false, false],
      [addresses.machine.toBase58(), false, true],
      [mint.toBase58(), false, false],
      [dbcPool(dbcConfig, mint).toBase58(), false, false],
      [dbcConfig.toBase58(), false, false],
      [addresses.feeIn.toBase58(), false, true],
      [addresses.ledger.toBase58(), false, true],
      [addresses.vault.toBase58(), false, false],
      [addresses.vaultAuth.toBase58(), false, false],
      [TOKEN_PROGRAM_ID.toBase58(), false, false],
      [SystemProgram.programId.toBase58(), false, false],
    ]);
  });
});

describe("atomic DBC launch transaction composition", () => {
  it("selects every launch address and instruction from one cluster deployment", () => {
    const ids = { localnet: key(98), devnet: key(99), mainnet: key(100) };
    const select = createDeploymentSelector(ids);
    for (const cluster of ["localnet", "devnet", "localnet"] as const) {
      const deployment = select(cluster);
      const selected = { ...options, deployment };
      const addresses = launchAddresses(selected);
      const groups = launchInstructionGroups(selected);
      expect(addresses.programId).toEqual(ids[cluster]);
      expect(addresses.machine).toEqual(
        PublicKey.findProgramAddressSync(
          [Buffer.from("machine")],
          ids[cluster],
        )[0],
      );
      expect(addresses.dbcConfig.toBase58()).toBe(deployment.meteora.dbcConfig);
      expect(
        groups.createAndBuy[0]!.keys.some((meta) =>
          meta.pubkey.equals(addresses.dbcConfig),
        ),
      ).toBe(true);
      expect(groups.depositAndPowerOn[2]).toEqual(
        powerOnIx(deployment, {
          launchWallet: wallet,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        }),
      );
      const candidate = buildLaunchCandidates({
        ...selected,
        lookupTable: table(selected),
      });
      expect(candidate.addresses).toEqual(addresses);
      expect(candidate.single.message.staticAccountKeys).toContainEqual(
        ids[cluster],
      );
    }
    const pendingMainnet = new Proxy(select("mainnet"), {
      get(deployment, property) {
        if (property === "meteoraConfigPin") return null;
        if (property === "meteora")
          throw new Error("METEORA_DBC_CONFIG is PENDING for mainnet");
        return Reflect.get(deployment, property, deployment);
      },
    });
    expect(() =>
      launchInstructionGroups({ ...options, deployment: pendingMainnet }),
    ).toThrow(/PENDING/);
    expectTypeOf<
      Extract<
        keyof LaunchTransactionOptions,
        "programId" | "cluster" | "dbcConfig"
      >
    >().toEqualTypeOf<never>();
  });

  it("wraps SOL, buys the exact DEV_BUY, closes wSOL, deposits and powers on", () => {
    const { createAndBuy, depositAndPowerOn } =
      launchInstructionGroups(options);
    expect(createAndBuy).toHaveLength(7);
    expect(createAndBuy[0]!.programId).toEqual(DBC_PROGRAM_ID);
    expect(
      createAndBuy[2]!.keys.some((meta) => meta.pubkey.equals(NATIVE_MINT)),
    ).toBe(true);
    expect(createAndBuy[3]!.data.readBigUInt64LE(4)).toBe(options.maxSolCost);
    expect(createAndBuy[4]!.data).toEqual(Buffer.from([17]));
    expect(createAndBuy[5]!.programId).toEqual(DBC_PROGRAM_ID);
    expect(createAndBuy[5]!.data.subarray(0, 8)).toEqual(
      discriminator("global", "swap2"),
    );
    expect(createAndBuy[6]!.data).toEqual(Buffer.from([9]));
    expect(depositAndPowerOn).toHaveLength(4);
    expect(depositAndPowerOn[1]!.data.readBigUInt64LE(1)).toBe(
      TOKEN_1PCT.devBuyAmount,
    );
    expect(depositAndPowerOn[1]!.programId).toEqual(TOKEN_PROGRAM_ID);
    expect(depositAndPowerOn[2]!.keys).toHaveLength(12);
    expect(depositAndPowerOn[3]!.data).toEqual(Buffer.from([9]));
  });
  it("requires only the disclosed wallet and vanity mint signers", () => {
    const tx = buildLaunchTransaction({ ...options, lookupTable: table() });
    expect(tx.message.version).toBe(0);
    expect(tx.message.header.numRequiredSignatures).toBe(2);
    expect(tx.message.staticAccountKeys.slice(0, 2)).toEqual([wallet, mint]);
    expect(serializedSize(tx)).toBe(tx.serialize().length);
    expect(serializedSize(tx)).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
    expect(tx.message.compiledInstructions).toHaveLength(14);
    const roundTrip = VersionedTransaction.deserialize(tx.serialize());
    expect(roundTrip.message.serialize()).toEqual(tx.message.serialize());
  });
  it("measures the standard and maximum metadata against the packet limit", () => {
    const standard = buildLaunchCandidates({
      ...options,
      lookupTable: table(),
    });
    expect(Buffer.byteLength(options.uri)).toBe(80);
    expect(standard.singleFits).toBe(true);
    expect(standard.singleSize).toBe(826);
    const maximum = buildLaunchCandidates({
      ...options,
      name: "n".repeat(32),
      symbol: "s".repeat(10),
      uri: `https://example.com/${"x".repeat(180)}`,
      lookupTable: table(),
    });
    expect(maximum.singleFits).toBe(true);
    expect(maximum.singleSize).toBe(975);
    expect(maximum.singleSize).toBe(maximum.single.serialize().length);
    expect(maximum.singleSize - standard.singleSize).toBe(149);
  });
  it("excludes signers, top-level programs and Sender tip from the frozen table", () => {
    const addresses = launchLookupAddresses(options);
    for (const excluded of [
      wallet,
      mint,
      options.tip.recipient,
      SystemProgram.programId,
      DBC_PROGRAM_ID,
    ])
      expect(addresses.some((address) => address.equals(excluded))).toBe(false);
    expect(() => validateLaunchLookupTable(table(), addresses, 12)).toThrow();
    expect(() =>
      validateLaunchLookupTable(table(), addresses, 13),
    ).not.toThrow();
    const mutable = table();
    mutable.state.authority = wallet;
    expect(() =>
      buildLaunchTransaction({ ...options, lookupTable: mutable }),
    ).toThrow();
    const wrong = table();
    wrong.state.addresses.push(key(33));
    expect(() =>
      buildLaunchTransaction({ ...options, lookupTable: wrong }),
    ).toThrow();
    const deactivated = table();
    deactivated.state.deactivationSlot = 100n;
    expect(() => validateLaunchLookupTable(deactivated, addresses)).toThrow();
  });
  it("reports oversized candidates and rejects malformed identities", () => {
    const candidates = buildLaunchCandidates(options);
    expect(candidates.singleFits).toBe(false);
    expect(candidates.singleSize).toBeGreaterThan(TX_LIMITS.maxTxBytes);
    expect(() => buildLaunchTransaction(options)).toThrow(/exceeds/);
    expect(() => buildLaunchCandidates({ ...options, mint: wallet })).toThrow();
    expect(launchAddresses(options).launchAta).not.toEqual(
      launchAddresses(options).vault,
    );
  });
});
