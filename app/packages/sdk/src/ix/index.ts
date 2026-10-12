import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import { EXTERNAL_IDS, RESERVED_KEYS } from "../constants.js";
import { instruction } from "./encoding.js";
export { instruction } from "./encoding.js";
import {
  binderPda,
  bondingCurvePda,
  configPda,
  deckPda,
  feeInPda,
  ledgerPda,
  machinePda,
  programIdentityPda,
  pullPda,
  scopedVrfIdentity,
  userAta,
  vaultAta,
  vaultAuthPda,
} from "../pda.js";

const ro = (pubkey: PublicKey): AccountMeta => ({
  pubkey,
  isSigner: false,
  isWritable: false,
});
const rw = (pubkey: PublicKey): AccountMeta => ({
  ...ro(pubkey),
  isWritable: true,
});
const signer = (pubkey: PublicKey, writable = false): AccountMeta => ({
  pubkey,
  isSigner: true,
  isWritable: writable,
});
export interface InitParams {
  admin: PublicKey;
  guardians: [PublicKey, PublicKey];
  keeper: PublicKey;
  executor: PublicKey;
  intake_signer: PublicKey;
  quote_signer: PublicKey;
  launch_wallet: PublicKey;
  team_wallet: PublicKey;
  team_wallets: [
    PublicKey,
    PublicKey,
    PublicKey,
    PublicKey,
    PublicKey,
    PublicKey,
    PublicKey,
    PublicKey,
  ];
  token_mint: PublicKey;
  vrf_queue: PublicKey;
  rent_buffer_lamports: bigint;
}
export function initializeInstruction(
  programId: PublicKey,
  input: {
    authority: PublicKey;
    programData: PublicKey;
    params: InitParams;
  },
) {
  return instruction(programId, "initialize", { params: input.params }, [
    signer(input.authority, true),
    ro(programId),
    ro(input.programData),
    rw(configPda(programId)[0]),
    rw(machinePda(programId)[0]),
    rw(deckPda(programId)[0]),
    rw(feeInPda(programId)[0]),
    ro(input.params.vrf_queue),
    ro(SystemProgram.programId),
  ]);
}
export type AdminAction =
  | { setRole: { role: number; key: PublicKey } }
  | { setTeam: { team_wallet: PublicKey; team_wallets: PublicKey[] } }
  | {
      setSeason: {
        snapshot_slot: bigint;
        snapshot_ts: bigint;
        stock_up_ts: bigint;
      };
    }
  | { setTokenMint: { mint: PublicKey } }
  | { addVrfQueue: { queue: PublicKey } }
  | { updateBucket: { index: number; enabled: boolean; cap: bigint } }
  | { setPause: { bits: number; paused: boolean } };
function enumValue(action: object): object {
  return Object.fromEntries(
    Object.entries(action).map(([name, value]) => [
      name[0]?.toUpperCase() + name.slice(1),
      value,
    ]),
  );
}
export function adminConfigInstruction(
  programId: PublicKey,
  input: {
    admin: PublicKey;
    action: AdminAction;
  },
) {
  const keys = [
    signer(input.admin),
    rw(configPda(programId)[0]),
    rw(machinePda(programId)[0]),
  ];
  if ("addVrfQueue" in input.action)
    keys.push(ro(input.action.addVrfQueue.queue));
  return instruction(
    programId,
    "admin_config",
    { action: enumValue(input.action) },
    keys,
  );
}
export function adminListMintInstruction(
  programId: PublicKey,
  input: {
    admin: PublicKey;
    mint: PublicKey;
    tokenProgram: PublicKey;
    class: number;
    cap: bigint;
    oracle: PublicKey;
  },
) {
  return instruction(
    programId,
    "admin_list_mint",
    { class: input.class, cap: input.cap, oracle: input.oracle },
    [
      signer(input.admin, true),
      ro(configPda(programId)[0]),
      rw(machinePda(programId)[0]),
      ro(input.mint),
      rw(ledgerPda(programId, input.mint)[0]),
      ro(vaultAta(programId, input.mint, input.tokenProgram)),
      ro(vaultAuthPda(programId)[0]),
      ro(input.tokenProgram),
      ro(SystemProgram.programId),
    ],
  );
}
export type GuardianAction =
  | { setPause: { bits: number; paused: boolean } }
  | { disableBucket: { index: number } }
  | { lowerCap: { index: number; cap: bigint } }
  | { disableRole: { role: number } }
  | { selectVrfQueue: { index: number } };
export function guardianInstruction(
  programId: PublicKey,
  input: {
    signer: PublicKey;
    action: GuardianAction;
  },
) {
  return instruction(
    programId,
    "guardian",
    { action: enumValue(input.action) },
    [
      signer(input.signer),
      rw(configPda(programId)[0]),
      rw(machinePda(programId)[0]),
    ],
  );
}
export function advancePhaseInstruction(programId: PublicKey) {
  return instruction(programId, "advance_phase", {}, [
    ro(configPda(programId)[0]),
    rw(machinePda(programId)[0]),
  ]);
}
export interface FeedBag {
  mint: PublicKey;
  amount: bigint;
  tokenProgram: PublicKey;
}
export function feedInstruction(
  programId: PublicKey,
  input: {
    depositor: PublicKey;
    bags: readonly FeedBag[];
    expiry: bigint;
    nonce: number;
    attIx: number;
  },
) {
  return instruction(
    programId,
    "feed",
    {
      amounts: input.bags.map((b) => b.amount),
      expiry: input.expiry,
      nonce: input.nonce,
      att_ix: input.attIx,
    },
    [
      signer(input.depositor, true),
      ro(configPda(programId)[0]),
      ro(machinePda(programId)[0]),
      rw(deckPda(programId)[0]),
      rw(binderPda(programId, input.depositor)[0]),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
      ro(SystemProgram.programId),
      ...input.bags.flatMap((b) => [
        ro(b.mint),
        ro(vaultAta(programId, b.mint, b.tokenProgram)),
        rw(ledgerPda(programId, b.mint)[0]),
        ro(bondingCurvePda(b.mint)[0]),
      ]),
    ],
  );
}
export interface ExitItem {
  mint: PublicKey;
  amount: bigint;
  tokenProgram: PublicKey;
}
export function takeBackInstruction(
  programId: PublicKey,
  input: ExitItem & { depositor: PublicKey; deckIndex: number },
) {
  return instruction(
    programId,
    "take_back",
    { deck_index: input.deckIndex, amount: input.amount },
    [
      signer(input.depositor, true),
      rw(deckPda(programId)[0]),
      rw(binderPda(programId, input.depositor)[0]),
      ro(input.mint),
      rw(ledgerPda(programId, input.mint)[0]),
      rw(vaultAta(programId, input.mint, input.tokenProgram)),
      ro(vaultAuthPda(programId)[0]),
      rw(userAta(input.depositor, input.mint, input.tokenProgram)),
      ro(input.tokenProgram),
      ro(machinePda(programId)[0]),
    ],
  );
}
export interface HoldProof {
  expiry: bigint;
  att_ix: number;
}
export function buyPacksInstruction(
  programId: PublicKey,
  input: {
    buyer: PublicKey;
    edition: number;
    qty: number;
    pullNonce: number;
    minLiveFlags: number;
    referrer?: PublicKey;
    hold?: HoldProof;
    oracleQueue: PublicKey;
  },
) {
  return instruction(
    programId,
    "buy_packs",
    {
      edition: input.edition,
      qty: input.qty,
      pull_nonce: input.pullNonce,
      min_live_flags: input.minLiveFlags,
      referrer: input.referrer ?? null,
      hold: input.hold ?? null,
    },
    [
      signer(input.buyer, true),
      ro(configPda(programId)[0]),
      rw(machinePda(programId)[0]),
      ro(deckPda(programId)[0]),
      rw(binderPda(programId, input.buyer)[0]),
      rw(pullPda(programId, input.buyer, input.pullNonce)[0]),
      rw(input.oracleQueue),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
      ro(SystemProgram.programId),
      ro(programIdentityPda(programId)[0]),
      ro(EXTERNAL_IDS.magicblockVrf),
      ro(SYSVAR_SLOT_HASHES_PUBKEY),
    ],
  );
}
export function consumeRandomnessInstruction(
  programId: PublicKey,
  input: {
    pull: PublicKey;
    buyer: PublicKey;
    randomness: Uint8Array;
    seq: bigint;
  },
) {
  return instruction(
    programId,
    "consume_randomness",
    { randomness: [...input.randomness], seq: input.seq },
    [
      signer(scopedVrfIdentity(programId)[0]),
      rw(input.pull),
      rw(machinePda(programId)[0]),
      rw(deckPda(programId)[0]),
      rw(binderPda(programId, input.buyer)[0]),
    ],
  );
}
export interface Payee {
  address: PublicKey;
  executable: boolean;
}
export interface SettleInput {
  pull: PublicKey;
  seq: bigint;
  pack: number;
  buyer: Payee;
  referrer?: Payee;
  wallets: readonly [Payee | null, Payee | null, Payee | null, Payee | null];
}
export function overridePayeeWritability(
  keys: readonly AccountMeta[],
  payees: readonly Payee[],
  indexes: readonly number[],
): AccountMeta[] {
  const readonly = new Set(
    payees
      .filter((p) => p.executable || RESERVED_KEYS.has(p.address.toBase58()))
      .map((p) => p.address.toBase58()),
  );
  return keys.map((meta, index) =>
    indexes.includes(index)
      ? {
          ...meta,
          isWritable:
            !readonly.has(meta.pubkey.toBase58()) &&
            !RESERVED_KEYS.has(meta.pubkey.toBase58()),
        }
      : { ...meta },
  );
}
export function settleInstruction(programId: PublicKey, input: SettleInput) {
  const wallets = input.wallets.map((p) => p ?? input.buyer);
  const payees = [input.buyer, input.referrer ?? input.buyer, ...wallets];
  const keys = [
    rw(input.pull),
    rw(machinePda(programId)[0]),
    ...payees.map((p) => ro(p.address)),
    ...input.wallets.map((p) =>
      ro(p ? binderPda(programId, p.address)[0] : input.buyer.address),
    ),
  ];
  return instruction(
    programId,
    "settle",
    { seq: input.seq, pack: input.pack },
    overridePayeeWritability(keys, payees, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  );
}
export function refundPullInstruction(
  programId: PublicKey,
  input: {
    pull: PublicKey;
    seq: bigint;
    buyer: Payee;
  },
) {
  return instruction(
    programId,
    "refund_pull",
    { seq: input.seq },
    overridePayeeWritability(
      [
        rw(input.pull),
        rw(machinePda(programId)[0]),
        rw(binderPda(programId, input.buyer.address)[0]),
        ro(input.buyer.address),
      ],
      [input.buyer],
      [3],
    ),
  );
}
export function redeemInstruction(
  programId: PublicKey,
  input: ExitItem & { owner: PublicKey; cardIndex: number },
) {
  return instruction(
    programId,
    "redeem",
    { card_index: input.cardIndex, amount: input.amount },
    [
      signer(input.owner, true),
      rw(binderPda(programId, input.owner)[0]),
      ro(input.mint),
      rw(ledgerPda(programId, input.mint)[0]),
      rw(vaultAta(programId, input.mint, input.tokenProgram)),
      ro(vaultAuthPda(programId)[0]),
      rw(userAta(input.owner, input.mint, input.tokenProgram)),
      ro(input.tokenProgram),
      ro(machinePda(programId)[0]),
    ],
  );
}
export function teamWithdrawInstruction(
  programId: PublicKey,
  teamWallet: PublicKey,
) {
  return instruction(programId, "team_withdraw", {}, [
    rw(machinePda(programId)[0]),
    ro(configPda(programId)[0]),
    rw(teamWallet),
  ]);
}
export function closeVaultInstruction(
  programId: PublicKey,
  input: {
    mint: PublicKey;
    payer: PublicKey;
    tokenProgram: PublicKey;
  },
) {
  return instruction(programId, "close_vault", {}, [
    ro(machinePda(programId)[0]),
    rw(input.mint),
    rw(ledgerPda(programId, input.mint)[0]),
    rw(vaultAta(programId, input.mint, input.tokenProgram)),
    ro(vaultAuthPda(programId)[0]),
    rw(input.payer),
    ro(input.tokenProgram),
  ]);
}
export function pingInstruction(
  programId: PublicKey,
  signerAddress: PublicKey,
) {
  return instruction(programId, "ping", {}, [signer(signerAddress)]);
}
export const STUB_INSTRUCTIONS = [
  "spotlight_deposit",
  "spotlight_take_back",
  "start_final_pull",
  "claim_final_sol",
  "claim_final_tokens",
] as const;
export type StubInstruction = (typeof STUB_INSTRUCTIONS)[number];
export function stubInstruction(
  programId: PublicKey,
  name: StubInstruction,
  signerAddress: PublicKey,
) {
  return instruction(programId, name, {}, [signer(signerAddress)]);
}

export { execBeginIx } from "./execBegin.js";
export type { ExecBeginInput } from "./execBegin.js";
export { execEndIx } from "./execEnd.js";
export type { ExecEndInput } from "./execEnd.js";
export { sellBackIx } from "./sellBack.js";
export type { SellBackInput } from "./sellBack.js";
export { feedBackIx } from "./feedBack.js";
export type { FeedBackInput } from "./feedBack.js";
export { withdrawOwedIx } from "./withdrawOwed.js";
export { closeBinderIx } from "./closeBinder.js";
export { powerOnIx } from "./powerOn.js";
export type { PowerOnInput } from "./powerOn.js";
export { collectCreatorFeesIx } from "./collectCreatorFees.js";
export { claimLaunchFeesIx } from "./claimLaunchFees.js";
export type { ClaimLaunchFeesInput, LaunchFeeKind } from "./claimLaunchFees.js";
