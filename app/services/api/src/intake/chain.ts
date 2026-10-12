import { createHash } from "node:crypto";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_IDS, PUMP_LAYOUTS } from "@onepercent/config";
import {
  deriveBondingCurve,
  hasDiscriminator,
  type MintSafetyClient,
} from "@onepercent/market";
import { u64StringSchema } from "@onepercent/db";
import type { JsonRpcClient } from "@onepercent/service-kit";
import { z } from "zod";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@onepercent/service-kit/intake";
import { publicKeySchema } from "./schema.js";
import { SignerError } from "../internal/error.js";

const integer = z.number().int().nonnegative().safe();
const accountSchema = z.object({
  owner: publicKeySchema,
  executable: z.boolean(),
  data: z.tuple([z.base64(), z.literal("base64")]),
});
export interface FeedState {
  slot: number;
  snapshotSlot: number;
  snapshotDate: string;
  tokenMint: string;
  teamWallets: string[];
  feedOpen: boolean;
  base: number;
  bits: number;
  freshInDeck: number;
}
export type WalletBag = {
  mint: string;
  amount: bigint;
  decimals: number;
  tokenProgram: string;
  source: string;
  mergeFrom: string[];
};
export type BagRead =
  | { ok: true; slot: number; bag: WalletBag }
  | { ok: false; slot: number; reason: "not_supported" | "not_pump_fun" };

function bytes(
  value: z.infer<typeof accountSchema>,
  owner: PublicKey,
  name: string,
  min: number,
): Buffer {
  const data = Buffer.from(value.data[0], "base64");
  if (
    value.owner !== owner.toBase58() ||
    value.executable ||
    data.length < min ||
    !data
      .subarray(0, 8)
      .equals(
        createHash("sha256").update(`account:${name}`).digest().subarray(0, 8),
      )
  ) {
    throw new SignerError(503, "chain_unavailable");
  }
  return data;
}
const pubkeyAt = (data: Buffer, offset: number) =>
  new PublicKey(data.subarray(offset, offset + 32)).toBase58();

// This role projection verifies a supplied deployment programId, uninitialized
// Binders and Feed eligibility; raw SDK decoders return a different account API.
export function decodeFeedState(input: {
  programId: PublicKey;
  wallet: PublicKey;
  slot: number;
  values: Array<z.infer<typeof accountSchema> | null>;
  now: number;
}): FeedState {
  const { programId, wallet, values, now, slot } = input;
  const [configAccount, machineAccount, binderAccount, ownerAccount] = values;
  if (
    !configAccount ||
    !machineAccount ||
    !ownerAccount ||
    ownerAccount.owner !== SystemProgram.programId.toBase58() ||
    ownerAccount.executable
  )
    throw new SignerError(503, "chain_unavailable");
  const config = bytes(configAccount, programId, "Config", 872);
  const machine = bytes(machineAccount, programId, "Machine", 3808);
  const configBump = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  )[1];
  const machineBump = PublicKey.findProgramAddressSync(
    [Buffer.from("machine")],
    programId,
  )[1];
  if (
    config.length !== 872 ||
    config[736] !== 1 ||
    config[737] !== configBump ||
    machine.length !== 3808 ||
    machine[8] !== 1 ||
    machine[9] !== machineBump
  )
    throw new SignerError(503, "chain_unavailable");
  let base = 0,
    bits = 0,
    freshInDeck = 0;
  // A prefunded System-owned, empty PDA is still an uninitialized Binder.
  if (
    binderAccount &&
    !(
      binderAccount.owner === SystemProgram.programId.toBase58() &&
      binderAccount.data[0] === "" &&
      !binderAccount.executable
    )
  ) {
    const binder = bytes(binderAccount, programId, "Binder", 112);
    const bump = PublicKey.findProgramAddressSync(
      [Buffer.from("binder"), wallet.toBuffer()],
      programId,
    )[1];
    if (
      pubkeyAt(binder, 8) !== wallet.toBase58() ||
      binder[110] !== bump ||
      binder.length !== 112 + 56 * binder.readUInt16LE(106) ||
      binder.readUInt16LE(104) + binder.readUInt16LE(108) >
        binder.readUInt16LE(106)
    )
      throw new SignerError(503, "chain_unavailable");
    base = binder.readUInt32LE(88);
    bits = binder.readUInt16LE(100);
    freshInDeck = binder.readUInt16LE(102);
  }
  const snapshotSlot = Number(config.readBigUInt64LE(712));
  const snapshotTs = Number(config.readBigInt64LE(720));
  if (
    !Number.isSafeInteger(snapshotSlot) ||
    snapshotSlot > slot ||
    !Number.isSafeInteger(snapshotTs) ||
    snapshotTs < 0
  )
    throw new SignerError(503, "chain_unavailable");
  const snapshotDate = new Date(snapshotTs * 1000);
  if (!Number.isFinite(snapshotDate.getTime()))
    throw new SignerError(503, "chain_unavailable");
  const teamWallets = [
    pubkeyAt(config, 264),
    ...Array.from({ length: 8 }, (_, i) => pubkeyAt(config, 296 + 32 * i)),
  ];
  return {
    slot,
    snapshotSlot,
    snapshotDate: snapshotDate.toISOString(),
    tokenMint: pubkeyAt(config, 552),
    teamWallets,
    feedOpen:
      config[739] === 1 &&
      [1, 2, 3].includes(machine[10]!) &&
      ((config[740]! | config[741]!) & 2) === 0 &&
      (machine.readBigInt64LE(56) === 0n ||
        BigInt(now) < machine.readBigInt64LE(56)),
    base,
    bits,
    freshInDeck,
  };
}

export function createFeedChainReader(
  rpc: Pick<JsonRpcClient, "request">,
  programId: PublicKey,
  safety: MintSafetyClient,
) {
  return {
    async state(wallet: string, now: number): Promise<FeedState> {
      const owner = new PublicKey(wallet);
      const addresses = ["config", "machine"].map(
        (seed) =>
          PublicKey.findProgramAddressSync([Buffer.from(seed)], programId)[0],
      );
      addresses.push(
        PublicKey.findProgramAddressSync(
          [Buffer.from("binder"), owner.toBuffer()],
          programId,
        )[0],
        owner,
      );
      const result = await rpc.request(
        "getMultipleAccounts",
        [
          addresses.map((p) => p.toBase58()),
          { commitment: "confirmed", encoding: "base64" },
        ],
        z.object({
          context: z.object({ slot: integer }),
          value: z.array(accountSchema.nullable()).length(4),
        }),
      );
      return decodeFeedState({
        programId,
        wallet: owner,
        slot: result.context.slot,
        values: result.value,
        now,
      });
    },
    async bag(
      wallet: string,
      mint: string,
      minContextSlot: number,
      signal?: AbortSignal,
    ): Promise<BagRead> {
      signal?.throwIfAborted();
      const mintSafety = await safety.getMintSafety(mint);
      signal?.throwIfAborted();
      if (mintSafety.slot < minContextSlot)
        throw new SignerError(503, "chain_unavailable");
      if (!mintSafety.safe)
        return { ok: false, slot: mintSafety.slot, reason: "not_supported" };
      minContextSlot = mintSafety.slot;
      const curve = await rpc.request(
        "getAccountInfo",
        [
          deriveBondingCurve(mint),
          { commitment: "confirmed", encoding: "base64", minContextSlot },
        ],
        z.object({
          context: z.object({ slot: integer }),
          value: accountSchema.nullable(),
        }),
        signal,
      );
      if (curve.context.slot < minContextSlot)
        throw new SignerError(503, "chain_unavailable");
      if (
        !curve.value ||
        curve.value.executable ||
        curve.value.owner !== PROGRAM_IDS.pumpFun ||
        !hasDiscriminator(
          Buffer.from(curve.value.data[0], "base64"),
          PUMP_LAYOUTS.bondingCurveDiscriminatorHex,
        )
      )
        return { ok: false, slot: curve.context.slot, reason: "not_pump_fun" };
      minContextSlot = curve.context.slot;
      const token = z.object({
        pubkey: publicKeySchema,
        account: z.object({
          owner: publicKeySchema,
          executable: z.boolean(),
          data: z.object({
            parsed: z.object({
              type: z.literal("account"),
              info: z.object({
                mint: publicKeySchema,
                owner: publicKeySchema,
                state: z.literal("initialized"),
                tokenAmount: z.object({
                  amount: u64StringSchema,
                  decimals: integer.max(255),
                }),
              }),
            }),
          }),
        }),
      });
      const result = await rpc.request(
        "getTokenAccountsByOwner",
        [
          wallet,
          { mint },
          { commitment: "confirmed", encoding: "jsonParsed", minContextSlot },
        ],
        z.object({
          context: z.object({ slot: integer }),
          value: z.array(token),
        }),
        signal,
      );
      if (
        result.context.slot < minContextSlot ||
        new Set(result.value.map((a) => a.pubkey)).size !== result.value.length
      )
        throw new SignerError(503, "chain_unavailable");
      const tokenProgram = mintSafety.ownerProgram;
      const ata = PublicKey.findProgramAddressSync(
        [
          new PublicKey(wallet).toBuffer(),
          new PublicKey(tokenProgram).toBuffer(),
          new PublicKey(mint).toBuffer(),
        ],
        new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
      )[0].toBase58();
      let amount = 0n;
      for (const a of result.value) {
        const info = a.account.data.parsed.info;
        if (
          a.account.executable ||
          a.account.owner !== tokenProgram ||
          info.owner !== wallet ||
          info.mint !== mint ||
          info.tokenAmount.decimals !== mintSafety.decimals
        )
          throw new SignerError(503, "chain_unavailable");
        amount += BigInt(info.tokenAmount.amount);
      }
      if (amount > (1n << 64n) - 1n)
        throw new SignerError(503, "chain_unavailable");
      return {
        ok: true,
        slot: result.context.slot,
        bag: {
          mint,
          amount,
          decimals: mintSafety.decimals,
          tokenProgram,
          source: ata,
          mergeFrom: result.value
            .filter((a) => a.pubkey !== ata)
            .map((a) => a.pubkey)
            .sort(),
        },
      };
    },
  };
}
