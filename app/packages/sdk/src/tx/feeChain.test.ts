import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
import { meteoraForCluster } from "@onepercent/config";
import {
  buildFeeChainTransaction,
  feeChainInstructions,
  type FeeChainInput,
} from "./feeChain.js";
import {
  migrationDammV2Ix,
  decodeDbcFeePool,
  decodeDammFeePool,
  dammLaunchPoolPda,
  METEORA_FEE_LAYOUT,
} from "../meteora/fees.js";
import { EXTERNAL_IDS } from "../constants.js";
import { DEPLOYMENT, PROGRAM_ID } from "../../tests/program-id.js";
import { DBC_LAUNCH_LAYOUT, DAMM_CLAIM_LAYOUT } from "../meteora/launch.js";
const key = () => Keypair.generate().publicKey;
const discriminator = (name: string) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
function input(migrated = false): FeeChainInput {
  const common = {
    payer: key(),
    mint: key(),
    baseVault: key(),
    quoteVault: key(),
  };
  return {
    deployment: DEPLOYMENT,
    claim: migrated
      ? {
          ...common,
          kind: "pool",
          pool: dammLaunchPoolPda(common.mint),
          position: key(),
          positionNftAccount: key(),
        }
      : { ...common, kind: "curve" },
    feeInLamports: 700n,
    feeInRentMinimum: 700n,
  };
}
describe("M4.2 atomic trading fee chain", () => {
  it("uses Curve then collection then OnAir with no pause or market instructions", () => {
    const plan = feeChainInstructions({ ...input(), withAdvancePhase: true });
    expect(plan.map((ix) => ix.data.subarray(0, 8))).toEqual(
      ["claim_launch_fees", "collect_creator_fees", "advance_phase"].map(
        discriminator,
      ),
    );
    expect(plan.every((ix) => ix.programId.equals(PROGRAM_ID))).toBe(true);
    expect(plan[0]!.data[8]).toBe(0);
  });
  it("uses Pool, Surplus once, then collection and replenishes only the rent shortfall", () => {
    const plan = input(true);
    const claim = plan.claim;
    const instructions = feeChainInstructions({
      ...plan,
      feeInLamports: 600n,
      surplus: { ...claim, kind: "surplus" },
    });
    expect(instructions[0]!.programId.equals(SystemProgram.programId)).toBe(
      true,
    );
    expect(instructions[0]!.data.readBigUInt64LE(4)).toBe(100n);
    expect(instructions.slice(1, 3).map((ix) => ix.data[8])).toEqual([1, 2]);
    expect(instructions[3]!.data).toEqual(
      discriminator("collect_creator_fees"),
    );
    expect(feeChainInstructions(plan).map((ix) => ix.data[8])).toEqual([
      1,
      undefined,
    ]);
    expect(() =>
      feeChainInstructions({
        ...input(),
        surplus: { ...claim, kind: "surplus" },
      }),
    ).toThrow("fee_chain_invalid_order");
  });
  it("builds a v0 atomic transaction with frozen addresses and checks its packet size", () => {
    const plan = input(true);
    plan.surplus = { ...plan.claim, kind: "surplus" };
    const instructions = feeChainInstructions(plan);
    const addresses = [
      ...new Map(
        instructions.flatMap((ix) =>
          ix.keys
            .filter((meta) => !meta.isSigner)
            .map(({ pubkey }) => [pubkey.toBase58(), pubkey] as const),
        ),
      ).values(),
    ];
    const table = new AddressLookupTableAccount({
      key: key(),
      state: {
        deactivationSlot: (1n << 64n) - 1n,
        lastExtendedSlot: 1,
        lastExtendedSlotStartIndex: 0,
        addresses,
      },
    });
    const tx = buildFeeChainTransaction({
      ...plan,
      payer: plan.claim.payer,
      blockhash: PublicKey.default.toBase58(),
      computeUnitLimit: 300_000,
      priorityFeeMicroLamports: 1n,
      lookupTables: [table],
    });
    expect(tx.serialize().length).toBeLessThanOrEqual(1232);
    expect(
      TransactionMessage.decompile(tx.message, {
        addressLookupTableAccounts: [table],
      })
        .instructions.slice(2)
        .map((ix) => ix.data),
    ).toEqual(instructions.map((ix) => ix.data));
    table.state.authority = key();
    expect(() =>
      buildFeeChainTransaction({
        ...plan,
        payer: plan.claim.payer,
        blockhash: PublicKey.default.toBase58(),
        computeUnitLimit: 300_000,
        priorityFeeMicroLamports: 1n,
        lookupTables: [table],
      }),
    ).toThrow("fee_chain_lookup_table_not_frozen");
  });
});
it("matches the pinned DBC migration discriminator and 25 fixed account privileges plus the DAMM config", () => {
  const idl = JSON.parse(
    readFileSync(
      new URL("../../../../fixtures/meteora/dbc.json", import.meta.url),
      "utf8",
    ),
  ) as {
    instructions: {
      name: string;
      discriminator: number[];
      accounts: { signer?: boolean; writable?: boolean; optional?: boolean }[];
    }[];
  };
  const expected = idl.instructions.find(
    (ix) => ix.name === "migration_damm_v2",
  )!;
  const instruction = migrationDammV2Ix({
    payer: key(),
    mint: key(),
    dbcConfig: new PublicKey(meteoraForCluster("localnet").dbcConfig),
    curve: key(),
    baseVault: key(),
    quoteVault: key(),
    positionMint: key(),
  });
  expect(instruction.programId.equals(EXTERNAL_IDS.meteoraDbc)).toBe(true);
  expect(instruction.data).toEqual(Buffer.from(expected.discriminator));
  expect(instruction.keys).toHaveLength(expected.accounts.length + 1);
  expected.accounts.forEach((account, index) =>
    expect({
      signer: instruction.keys[index]!.isSigner,
      writable: instruction.keys[index]!.isWritable,
    }).toEqual({
      signer: account.optional ? false : !!account.signer,
      writable: account.optional ? false : !!account.writable,
    }),
  );
});
it("decodes migrated and surplus flags plus wide Q64 prices without number conversion", () => {
  const curve = Buffer.alloc(DBC_LAUNCH_LAYOUT.pool.minLength);
  Buffer.from(DBC_LAUNCH_LAYOUT.pool.discriminator).copy(curve);
  curve[METEORA_FEE_LAYOUT.curve.migrated] = 1;
  curve[METEORA_FEE_LAYOUT.curve.surplus] = 1;
  curve.writeBigUInt64LE(7n, 288);
  expect(decodeDbcFeePool(curve)).toMatchObject({
    migrated: true,
    surplusClaimed: true,
    sqrtPrice: 7n << 64n,
  });
  const pool = Buffer.alloc(DAMM_CLAIM_LAYOUT.pool.minLength);
  Buffer.from(DAMM_CLAIM_LAYOUT.pool.discriminator).copy(pool);
  pool.writeBigUInt64LE(9n, 464);
  expect(decodeDammFeePool(pool).sqrtPrice).toBe(9n << 64n);
});
