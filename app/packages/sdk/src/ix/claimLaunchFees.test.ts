import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Idl } from "@anchor-lang/core";
import { BorshInstructionCoder } from "../anchor.js";
import idl from "../idl/onepercent.json" with { type: "json" };
import { METEORA_BY_CLUSTER } from "@onepercent/config";
import { EXTERNAL_IDS } from "../constants.js";
import { createDeploymentSelector } from "../deployment.js";
import { DEPLOYMENT, PROGRAM_ID } from "../../tests/program-id.js";
import { feeInPda, userAta } from "../pda.js";
import { claimLaunchFeesIx } from "./claimLaunchFees.js";

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const fixture = (name: string): Idl =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../fixtures/meteora/${name}`, import.meta.url),
      "utf8",
    ),
  ) as Idl;

describe("Meteora fee claim ABI", () => {
  it.each(["curve", "surplus"] as const)(
    "uses the selected cluster's IDs, pins and sentinels for %s claims",
    (kind) => {
      const programIds = { localnet: key(41), devnet: key(42) };
      const selectDeployment = createDeploymentSelector(programIds);
      const feeIns: PublicKey[] = [];
      for (const cluster of ["localnet", "devnet", "localnet"] as const) {
        const programId = programIds[cluster];
        const feeIn = PublicKey.findProgramAddressSync(
          [Buffer.from("fee_in")],
          programId,
        )[0];
        const ix = claimLaunchFeesIx(selectDeployment(cluster), {
          kind,
          payer: key(1),
          mint: key(2),
          baseVault: key(3),
          quoteVault: key(4),
        });
        expect(ix.programId).toEqual(programId);
        expect(ix.keys[1]?.pubkey).toEqual(
          PublicKey.findProgramAddressSync(
            [Buffer.from("machine")],
            programId,
          )[0],
        );
        expect(ix.keys[2]?.pubkey).toEqual(feeIn);
        expect(ix.keys[3]?.pubkey).toEqual(
          userAta(feeIn, NATIVE_MINT, EXTERNAL_IDS.splToken),
        );
        expect(ix.keys[5]?.pubkey).toEqual(
          new PublicKey(METEORA_BY_CLUSTER[cluster].dbcConfig),
        );
        expect(ix.keys.slice(16)).toEqual([
          { pubkey: programId, isSigner: false, isWritable: false },
          { pubkey: programId, isSigner: false, isWritable: false },
          kind === "curve"
            ? {
                pubkey: userAta(feeIn, key(2), EXTERNAL_IDS.splToken),
                isSigner: false,
                isWritable: true,
              }
            : { pubkey: programId, isSigner: false, isWritable: false },
        ]);
        feeIns.push(feeIn);
      }
      expect(feeIns[0]).not.toEqual(feeIns[1]);
      expect(feeIns[0]).toEqual(feeIns[2]);
    },
  );

  it("excludes deployment overrides from claim inputs", () => {
    expectTypeOf<
      Extract<
        keyof Parameters<typeof claimLaunchFeesIx>[1],
        "cluster" | "programId" | "dbcConfig"
      >
    >().toEqualTypeOf<never>();
  });

  it("pins the DBC quote-only arguments and DAMM both-token claim", () => {
    for (const [file, name, args] of [
      ["dbc.json", "claim_trading_fee", ["max_amount_a", "max_amount_b"]],
      ["dbc.json", "partner_withdraw_surplus", []],
      ["damm-v2.json", "claim_position_fee", []],
    ] as const) {
      const definition = fixture(file).instructions.find(
        (entry) => entry.name === name,
      );
      expect(definition?.args.map((arg) => arg.name)).toEqual(args);
      expect(definition?.discriminator).toEqual([
        ...createHash("sha256")
          .update(`global:${name}`)
          .digest()
          .subarray(0, 8),
      ]);
    }
    const nft = fixture("damm-v2.json")
      .instructions.find((entry) => entry.name === "claim_position_fee")
      ?.accounts.find((entry) => entry.name === "position_nft_account");
    expect(nft).toBeDefined();
    expect(nft).not.toHaveProperty("writable", true);
    expect(nft).not.toHaveProperty("signer", true);
  });

  it.each(["curve", "surplus"] as const)(
    "builds the fixed %s accounts with no delegated NFT authority",
    (kind) => {
      const ix = claimLaunchFeesIx(DEPLOYMENT, {
        kind,
        payer: key(1),
        mint: key(2),
        baseVault: key(3),
        quoteVault: key(4),
      });
      expect(ix.keys).toHaveLength(19);
      expect(
        ix.keys.filter((meta) => meta.isSigner).map((meta) => meta.pubkey),
      ).toEqual([key(1)]);
      expect(ix.keys[3]?.pubkey).toEqual(
        userAta(feeInPda(PROGRAM_ID)[0], NATIVE_MINT, EXTERNAL_IDS.splToken),
      );
      expect(ix.keys[12]?.pubkey).toEqual(EXTERNAL_IDS.meteoraDbc);
      expect(ix.keys.slice(16)).toEqual([
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
        kind === "curve"
          ? {
              pubkey: userAta(
                feeInPda(PROGRAM_ID)[0],
                key(2),
                EXTERNAL_IDS.splToken,
              ),
              isSigner: false,
              isWritable: true,
            }
          : { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      ]);
      const decoded = new BorshInstructionCoder(idl as Idl).decode(ix.data);
      expect(decoded?.name).toBe("claim_launch_fees");
      expect(decoded?.data).toEqual({
        kind: kind === "curve" ? { Curve: {} } : { Surplus: {} },
      });
    },
  );
});

it("derives the Pool destinations and keeps its NFT read-only", () => {
  const ix = claimLaunchFeesIx(DEPLOYMENT, {
    kind: "pool",
    payer: key(1),
    mint: key(2),
    baseVault: key(3),
    quoteVault: key(4),
    pool: key(5),
    position: key(6),
    positionNftAccount: key(7),
  });
  expect(ix.keys).toHaveLength(19);
  expect(ix.keys[4]?.pubkey).toEqual(key(5));
  expect(ix.keys[12]?.pubkey).toEqual(EXTERNAL_IDS.meteoraDammV2);
  expect(ix.keys[16]).toEqual({
    pubkey: key(6),
    isSigner: false,
    isWritable: true,
  });
  expect(ix.keys[17]).toEqual({
    pubkey: key(7),
    isSigner: false,
    isWritable: false,
  });
  expect(ix.keys[18]?.pubkey).toEqual(
    userAta(feeInPda(PROGRAM_ID)[0], key(2), EXTERNAL_IDS.splToken),
  );
  expect(new BorshInstructionCoder(idl as Idl).decode(ix.data)?.data).toEqual({
    kind: { Pool: {} },
  });
});

it("refuses the PENDING mainnet launch pin", () => {
  const mainnet = createDeploymentSelector({ mainnet: key(9) })("mainnet");
  expect(() =>
    claimLaunchFeesIx(mainnet, {
      kind: "curve",
      payer: key(1),
      mint: key(2),
      baseVault: key(3),
      quoteVault: key(4),
    }),
  ).toThrow(/PENDING/);
});
