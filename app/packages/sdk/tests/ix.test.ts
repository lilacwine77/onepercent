import { PROGRAM_ID } from "./program-id.js";
import { PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  IDL,
  binderPda,
  instruction,
  overridePayeeWritability,
  refundPullInstruction,
  settleInstruction,
  STUB_INSTRUCTIONS,
  stubInstruction,
} from "../src/index.js";
import { vectors } from "./vectors.js";
import * as sdk from "../src/index.js";
interface Sample {
  name: string;
  args: Record<string, unknown>;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}
function decodeValue(value: unknown, type: unknown): unknown {
  if (type === "pubkey") return new PublicKey(String(value));
  if (type === "u64" || type === "i64" || type === "u128" || type === "i128")
    return BigInt(String(value));
  if (type && typeof type === "object") {
    const t = type as Record<string, unknown>;
    if ("option" in t)
      return value === null ? null : decodeValue(value, t.option);
    if ("vec" in t)
      return (value as unknown[]).map((v) => decodeValue(v, t.vec));
    if ("array" in t) {
      const [inner] = t.array as unknown[];
      return (value as unknown[]).map((v) => decodeValue(v, inner));
    }
    if ("defined" in t) {
      const name = (t.defined as { name: string }).name;
      const definition = IDL.types?.find((d) => d.name === name);
      if (!definition) throw new Error(`Missing type ${name}`);
      if (definition.type.kind === "struct")
        return Object.fromEntries(
          (definition.type.fields ?? []).map((field) => {
            if (typeof field !== "object" || !("name" in field))
              throw new Error("Unnamed fields unsupported here");
            return [
              field.name,
              decodeValue(
                (value as Record<string, unknown>)[field.name],
                field.type,
              ),
            ];
          }),
        );
      if (definition.type.kind === "enum") {
        const [variantName, fields] = Object.entries(
          value as Record<string, unknown>,
        )[0]!;
        const variant = definition.type.variants.find(
          (v) => v.name === variantName,
        );
        if (!variant) throw new Error("Missing enum variant");
        return {
          [variantName]: Object.fromEntries(
            (variant.fields ?? []).map((field) => {
              if (typeof field !== "object" || !("name" in field))
                throw new Error("Unnamed enum field");
              return [
                field.name,
                decodeValue(
                  (fields as Record<string, unknown>)[field.name],
                  field.type,
                ),
              ];
            }),
          ),
        };
      }
    }
  }
  return value;
}
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
describe("instruction parity and A14", () => {
  it("matches Rust instruction data and ordered ToAccountMetas", () => {
    const samples = vectors<Sample[]>("ix");
    expect(new Set(samples.map((v) => v.name))).toEqual(
      new Set(IDL.instructions.map((i) => i.name)),
    );
    for (const v of samples) {
      const definition = IDL.instructions.find((i) => i.name === v.name)!;
      const args = Object.fromEntries(
        definition.args.map((arg) => [
          arg.name,
          decodeValue(v.args[arg.name], arg.type),
        ]),
      );
      const accounts = v.accounts.map((meta) => ({
        ...meta,
        pubkey: new PublicKey(meta.pubkey),
      }));
      const ix = instruction(PROGRAM_ID, v.name, args, accounts);
      expect(ix.data.toString("hex"), v.name).toBe(v.data);
      expect(ix.keys).toEqual(accounts);
      expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
      if (v.name === "settle")
        expect(v.accounts.slice(2).every((a) => !a.isWritable)).toBe(true);
      if (v.name === "refund_pull")
        expect(v.accounts[3]?.isWritable).toBe(false);
      if (v.name === "exec_begin" || v.name === "exec_end") {
        const position = v.name === "exec_begin" ? 8 : 7;
        const meta = definition.accounts[position]!;
        expect(meta.name).toBe("sol_dest");
        expect("writable" in meta ? meta.writable : false).toBe(false);
        expect(v.accounts[position]?.isWritable).toBe(false);
      }
    }
  });
  it("makes ordinary payees and fresh Binders writable", () => {
    const buyer = { address: key(1), executable: false };
    const wallet = { address: key(2), executable: false };
    const ix = settleInstruction(PROGRAM_ID, {
      pull: key(3),
      seq: 1n,
      pack: 0,
      buyer,
      wallets: [wallet, wallet, null, null],
    });
    expect(ix.keys.slice(2).every((meta) => meta.isWritable)).toBe(true);
    expect(
      ix.keys[8]?.pubkey.equals(binderPda(PROGRAM_ID, wallet.address)[0]),
    ).toBe(true);
    expect(ix.keys[9]?.pubkey.equals(ix.keys[8]!.pubkey)).toBe(true);
    expect(ix.keys[10]?.pubkey.equals(buyer.address)).toBe(true);
  });
  it("keeps reserved or executable payees read-only and shares placeholder flags", () => {
    for (const address of [
      SYSVAR_CLOCK_PUBKEY,
      SystemProgram.programId,
      key(9),
    ]) {
      const buyer = { address, executable: address.equals(key(9)) };
      const ix = settleInstruction(PROGRAM_ID, {
        pull: key(3),
        seq: 1n,
        pack: 0,
        buyer,
        wallets: [null, null, null, null],
      });
      expect(ix.keys.slice(2).every((meta) => !meta.isWritable)).toBe(true);
      expect(
        refundPullInstruction(PROGRAM_ID, { pull: key(3), seq: 1n, buyer })
          .keys[3]?.isWritable,
      ).toBe(false);
    }
  });
  it("a duplicate executable payee never acquires writable privileges through another slot", () => {
    const address = key(1);
    const keys: AccountMeta[] = [
      { pubkey: address, isSigner: false, isWritable: false },
      { pubkey: address, isSigner: false, isWritable: false },
    ];
    expect(
      overridePayeeWritability(
        keys,
        [
          { address, executable: true },
          { address, executable: false },
        ],
        [0, 1],
      ).every((meta) => !meta.isWritable),
    ).toBe(true);
  });
  it("declares the deferred instruction interfaces with the single signer", () => {
    for (const name of STUB_INSTRUCTIONS) {
      const ix = stubInstruction(PROGRAM_ID, name, key(1));
      expect(ix.keys).toEqual([
        { pubkey: key(1), isSigner: true, isWritable: false },
      ]);
      expect(ix.data.length).toBe(8);
    }
    expect(STUB_INSTRUCTIONS).toContain("spotlight_deposit");
    expect(STUB_INSTRUCTIONS).toContain("spotlight_take_back");
  });
});

// Builders derive canonical accounts; Rust vectors deliberately use numbered
// sample addresses, so their data and their account privileges are compared
// independently from the SDK's canonical-address assertions below.

describe("named instruction builders", () => {
  it.each([PROGRAM_ID, key(100), key(101)])(
    "encodes each named builder for %s against Rust bytes and meta ordering",
    (programId) => {
      const deployment = sdk.createDeploymentSelector({ localnet: programId })(
        "localnet",
      );
      for (const v of vectors<Sample[]>("ix")) {
        const a = v.args;
        const definition = IDL.instructions.find(
          (item) => item.name === v.name,
        )!;
        const decoded = Object.fromEntries(
          definition.args.map((arg) => [
            arg.name,
            decodeValue(a[arg.name], arg.type),
          ]),
        );
        const bigint = (name: string) => BigInt(String(a[name]));
        const number = (name: string) => Number(a[name]);
        const tokenProgram = sdk.EXTERNAL_IDS.splToken;
        let built;
        switch (v.name) {
          case "power_on":
            built = sdk.powerOnIx(deployment, {
              launchWallet: key(1),
              mint: key(4),
              tokenProgram,
            });
            break;
          case "collect_creator_fees":
            built = sdk.collectCreatorFeesIx(deployment, { payer: key(1) });
            break;
          case "claim_launch_fees": {
            const kind = Object.keys(
              a.kind as Record<string, unknown>,
            )[0]?.toLowerCase();
            const common = {
              payer: key(1),
              mint: key(7),
              baseVault: key(8),
              quoteVault: key(9),
            };
            built = sdk.claimLaunchFeesIx(
              deployment,
              kind === "pool"
                ? {
                    ...common,
                    kind,
                    pool: key(5),
                    position: key(17),
                    positionNftAccount: key(18),
                  }
                : { ...common, kind: kind === "curve" ? "curve" : "surplus" },
            );
            break;
          }
          case "initialize":
            built = sdk.initializeInstruction(programId, {
              authority: key(1),
              programData: key(3),
              params: decoded.params as sdk.InitParams,
            });
            break;
          case "admin_config":
            built = sdk.adminConfigInstruction(programId, {
              admin: key(1),
              action: { setPause: { bits: 3, paused: true } },
            });
            break;
          case "admin_list_mint":
            built = sdk.adminListMintInstruction(programId, {
              admin: key(1),
              mint: key(4),
              tokenProgram,
              class: number("class"),
              cap: bigint("cap"),
              oracle: new PublicKey(String(a.oracle)),
            });
            break;
          case "guardian":
            built = sdk.guardianInstruction(programId, {
              signer: key(1),
              action: { setPause: { bits: 3, paused: true } },
            });
            break;
          case "advance_phase":
            built = sdk.advancePhaseInstruction(programId);
            break;
          case "feed":
            built = sdk.feedInstruction(programId, {
              depositor: key(1),
              bags: (a.amounts as string[]).map((amount, i) => ({
                mint: key(41 + i),
                amount: BigInt(amount),
                tokenProgram,
              })),
              expiry: bigint("expiry"),
              nonce: number("nonce"),
              attIx: number("att_ix"),
            });
            break;
          case "take_back":
            built = sdk.takeBackInstruction(programId, {
              depositor: key(1),
              mint: key(4),
              tokenProgram,
              amount: bigint("amount"),
              deckIndex: number("deck_index"),
            });
            break;
          case "buy_packs":
            built = sdk.buyPacksInstruction(programId, {
              buyer: key(1),
              edition: number("edition"),
              qty: number("qty"),
              pullNonce: number("pull_nonce"),
              minLiveFlags: number("min_live_flags"),
              oracleQueue: key(7),
              referrer: decoded.referrer as PublicKey,
              hold: decoded.hold as sdk.HoldProof,
            });
            break;
          case "consume_randomness":
            built = sdk.consumeRandomnessInstruction(programId, {
              pull: key(1),
              buyer: key(6),
              seq: bigint("seq"),
              randomness: Uint8Array.from(a.randomness as number[]),
            });
            break;
          case "settle":
            built = sdk.settleInstruction(programId, {
              pull: key(1),
              seq: bigint("seq"),
              pack: number("pack"),
              buyer: { address: key(3), executable: false },
              referrer: { address: key(4), executable: false },
              wallets: [
                { address: key(5), executable: false },
                { address: key(6), executable: false },
                { address: key(7), executable: false },
                { address: key(8), executable: false },
              ],
            });
            break;
          case "refund_pull":
            built = sdk.refundPullInstruction(programId, {
              pull: key(1),
              seq: bigint("seq"),
              buyer: { address: key(4), executable: false },
            });
            break;
          case "redeem":
            built = sdk.redeemInstruction(programId, {
              owner: key(1),
              mint: key(3),
              tokenProgram,
              amount: bigint("amount"),
              cardIndex: number("card_index"),
            });
            break;
          case "close_vault":
            built = sdk.closeVaultInstruction(programId, {
              mint: key(2),
              tokenProgram,
              payer: key(6),
            });
            break;
          case "team_withdraw":
            built = sdk.teamWithdrawInstruction(programId, key(3));
            break;
          case "ping":
            built = sdk.pingInstruction(programId, key(1));
            break;
          case "exec_begin":
            built = sdk.execBeginIx(programId, {
              signer: key(1),
              mint: key(4),
              tokenProgram,
              kind: number("kind") as sdk.ExecKind,
              bucket: number("bucket"),
              amount: bigint("amount"),
              oracles: [key(10), key(11), key(12), key(13)],
            });
            break;
          case "exec_end":
            built = sdk.execEndIx(programId, {
              signer: key(1),
              mint: key(4),
              tokenProgram,
              kind: number("kind") as sdk.ExecKind,
            });
            break;
          case "sell_back":
            built = sdk.sellBackIx(programId, {
              owner: key(1),
              mint: key(5),
              tokenProgram,
              cards: decoded.cards as sdk.SellBackCard[],
              quoteLamports: bigint("quote_lamports"),
              expiry: bigint("expiry"),
              nonce: number("nonce"),
              attIx: number("att_ix"),
            });
            break;
          case "feed_back":
            built = sdk.feedBackIx(programId, {
              owner: key(1),
              cardIndices: decoded.card_indices as number[],
            });
            break;
          case "withdraw_owed":
            built = sdk.withdrawOwedIx(programId, { owner: key(1) });
            break;
          case "close_binder":
            built = sdk.closeBinderIx(programId, { owner: key(1) });
            break;
          default:
            built = sdk.stubInstruction(
              programId,
              v.name as sdk.StubInstruction,
              key(1),
            );
        }
        expect(built.programId.equals(programId), v.name).toBe(true);
        expect(built.data.toString("hex"), v.name).toBe(v.data);
        const expected = v.accounts.map((meta, i) => ({
          isSigner: meta.isSigner,
          isWritable:
            (v.name === "settle" && i >= 2) ||
            (v.name === "refund_pull" && i === 3) ||
            (v.name === "consume_randomness" && !meta.isSigner) ||
            (((v.name === "exec_begin" && i === 8) ||
              (v.name === "exec_end" && i === 7)) &&
              number("kind") === sdk.EXEC_KIND.stockSell)
              ? true
              : meta.isWritable,
        }));
        expect(
          built.keys
            .slice(0, expected.length)
            .map(({ isSigner, isWritable }) => ({ isSigner, isWritable })),
          v.name,
        ).toEqual(expected);
        const accounts = new Map(
          definition.accounts.map((meta, i) => [
            meta.name,
            built.keys[i]!.pubkey,
          ]),
        );
        if (accounts.has("config"))
          expect(
            accounts.get("config")!.equals(sdk.configPda(programId)[0]),
            v.name,
          ).toBe(true);
        if (accounts.has("machine"))
          expect(
            accounts.get("machine")!.equals(sdk.machinePda(programId)[0]),
            v.name,
          ).toBe(true);
        if (accounts.has("deck"))
          expect(
            accounts.get("deck")!.equals(sdk.deckPda(programId)[0]),
            v.name,
          ).toBe(true);
        if (accounts.has("vault_auth"))
          expect(
            accounts.get("vault_auth")!.equals(sdk.vaultAuthPda(programId)[0]),
            v.name,
          ).toBe(true);
        if (v.name === "buy_packs")
          expect(
            accounts
              .get("pull")!
              .equals(sdk.pullPda(programId, key(1), number("pull_nonce"))[0]),
          ).toBe(true);
      }
    },
  );
});
