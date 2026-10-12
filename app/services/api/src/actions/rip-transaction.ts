import { warnCause } from "@onepercent/service-kit";
import { createHash } from "node:crypto";
import {
  ACCOUNT_SIZES,
  CARDS_PER_PACK,
  CU_LIMITS,
  PACK_EDITIONS,
  TX_LIMITS,
  VRF,
  WEB,
} from "@onepercent/config";
import { solCost, t } from "@onepercent/copy";
import {
  binderHeaderLayout,
  binderPda,
  buildBuyPacksTransaction,
  machinePda,
  programError,
} from "@onepercent/sdk";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { z } from "zod";
import { RIP_COPY } from "./rip-copy.js";
import { publicKey, type RipDependencies, type RipSnapshot } from "./rip.js";

const uint = z.number().int().safe().nonnegative();
const base64 = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const context = z.object({ slot: uint });
export class RipSimulationError extends Error {}
export function validateRipTransaction(
  programId: PublicKey,
  tx: Transaction,
  account: PublicKey,
  qty: number,
): Buffer {
  const message = tx.compileMessage();
  if (
    message.header.numRequiredSignatures !== 1 ||
    !message.accountKeys[0]?.equals(account) ||
    !tx.feePayer?.equals(account)
  )
    throw new Error("invalid_rip_signer");
  const buyDiscriminator = createHash("sha256")
    .update("global:buy_packs")
    .digest()
    .subarray(0, 8);
  const buys = tx.instructions.filter((ix) => ix.programId.equals(programId));
  if (
    buys.length !== 1 ||
    !buys[0]!.data.subarray(0, 8).equals(buyDiscriminator)
  )
    throw new Error("invalid_rip_instruction");
  const data = buys[0]!.data;
  if (
    data[9] !== qty ||
    !buys[0]!.keys[0]?.pubkey.equals(account) ||
    !buys[0]!.keys[0]?.isSigner
  )
    throw new Error("invalid_rip_buyer");
  const refTag = data[15];
  const proofOffset = refTag === 0 ? 16 : refTag === 1 ? 48 : -1;
  if (
    proofOffset < 0 ||
    data.length !== proofOffset + 1 ||
    data[proofOffset] !== 0
  )
    throw new Error("invalid_rip_proof");
  let units = 0;
  let prices = 0;
  for (const ix of tx.instructions) {
    if (ix.programId.equals(programId)) continue;
    if (!ix.programId.equals(ComputeBudgetProgram.programId))
      throw new Error("invalid_rip_program");
    if (ix.data[0] === 2 && ix.data.length === 5) {
      units++;
      if (
        ix.data.readUInt32LE(1) !==
        (qty === 1 ? CU_LIMITS.buyPacks.x1 : CU_LIMITS.buyPacks.x10)
      )
        throw new Error("invalid_rip_compute");
    } else if (ix.data[0] === 3 && ix.data.length === 9) {
      prices++;
      if (ix.data.readBigUInt64LE(1) > BigInt(WEB.priorityFeeCapMicroLamports))
        throw new Error("invalid_rip_priority");
    } else throw new Error("invalid_rip_budget");
  }
  if (units !== 1 || prices !== 1) throw new Error("invalid_rip_budget");
  const bytes = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  if (
    bytes.length > TX_LIMITS.maxTxBytes ||
    bytes[0] !== 1 ||
    bytes.subarray(1, 65).some((byte) => byte !== 0) ||
    tx.signatures.some((entry) => entry.signature !== null)
  )
    throw new Error("invalid_rip_wire");
  return bytes;
}
async function simulationMessage(
  err: unknown,
  logs: string[],
  snapshot: RipSnapshot,
  edition: number,
  cost: () => Promise<bigint>,
): Promise<string> {
  const shortfall = logs
    .flatMap((line) => {
      const match = /insufficient lamports (\d+), need (\d+)/i.exec(line);
      return match ? [BigInt(match[2]!) - BigInt(match[1]!)] : [];
    })
    .reduce((largest, amount) => (amount > largest ? amount : largest), 0n);
  if (shortfall > 0n || err === "InsufficientFundsForFee") {
    try {
      const missing = await cost();
      const required = missing > shortfall ? missing : shortfall;
      return required > 0n
        ? RIP_COPY.insufficientSol(solCost(required))
        : RIP_COPY.simulation();
    } catch (error) {
      warnCause("rip_simulation_decode_failed", error);
      return RIP_COPY.simulation();
    }
  }
  const custom = z
    .object({ InstructionError: z.tuple([uint, z.object({ Custom: uint })]) })
    .safeParse(err);
  // The SDK maps Anchor names from logs; the numeric fallback is valid only for our instruction.
  const mapped = programError(
    custom.success && custom.data.InstructionError[0] === 2
      ? custom.data.InstructionError[1].Custom
      : err,
    {
      programId: new PublicKey(snapshot.config.programId),
      instruction: "buy_packs",
      logs,
    },
  );
  switch (mapped.copyKey) {
    case "machineChanged":
      return RIP_COPY.machineChanged;
    case "refilling":
      return RIP_COPY.refilling(edition, snapshot.machine);
    case "hungry":
      return RIP_COPY.hungry;
    case "busy":
      return RIP_COPY.busy;
    case "myCardsFull":
      return RIP_COPY.myCardsFull;
    case "seasonOver":
      return RIP_COPY.seasonOver();
    case "computeBudgetExceeded":
      return t("errors.computeBudgetExceeded");
    case "tooLong":
      return t("errors.tooLong");
    default:
      return RIP_COPY.simulation();
  }
}

async function missingLamports(
  rpc: RipDependencies["rpc"],
  tx: Transaction,
  input: { account: PublicKey; edition: number; qty: number },
  binder: ReturnType<typeof binderHeaderLayout.decode> | null,
): Promise<bigint> {
  const edition = PACK_EDITIONS[input.edition];
  if (!edition) throw new Error("rip_edition_missing");
  const currentSize =
    ACCOUNT_SIZES.binderHeader + (binder?.cap ?? 0) * ACCOUNT_SIZES.cardSlot;
  // grow_binder can add at most the new cards. Ignore spare capacity and
  // donated lamports so this estimate never understates its rent top-up.
  const maximumCap = Math.min(
    0xffff,
    (binder?.cap ?? 0) + input.qty * (CARDS_PER_PACK.dust + CARDS_PER_PACK.hit),
  );
  const grownSize =
    ACCOUNT_SIZES.binderHeader + maximumCap * ACCOUNT_SIZES.cardSlot;
  const rent = (bytes: number) =>
    rpc.request(
      "getMinimumBalanceForRentExemption",
      [bytes, { commitment: "confirmed" }],
      uint,
    );
  const [balance, fee, pullRent, currentRent, grownRent] = await Promise.all([
    rpc.request(
      "getBalance",
      [input.account.toBase58(), { commitment: "confirmed" }],
      z.object({ context, value: uint }),
    ),
    rpc.request(
      "getFeeForMessage",
      [
        tx.compileMessage().serialize().toString("base64"),
        { commitment: "confirmed" },
      ],
      z.object({ context, value: uint.nullable() }),
    ),
    rent(ACCOUNT_SIZES.pullHeader + input.qty * ACCOUNT_SIZES.pullPerPack),
    rent(currentSize),
    rent(grownSize),
  ]);
  if (fee.value === null || grownRent < currentRent)
    throw new Error("rip_cost_unavailable");
  const required =
    BigInt(input.qty) * edition.priceLamports +
    VRF.feeLamports +
    BigInt(fee.value) +
    BigInt(pullRent) +
    (binder ? 0n : BigInt(currentRent)) +
    BigInt(grownRent - currentRent);
  return required - BigInt(balance.value);
}
export async function buildRipTransaction(
  rpc: RipDependencies["rpc"],
  snapshot: RipSnapshot,
  input: {
    account: PublicKey;
    edition: number;
    qty: number;
    minLiveFlags: number;
    ref?: string;
  },
): Promise<string> {
  const programId = publicKey(snapshot.config.programId);
  if (!programId || programId.equals(PublicKey.default))
    throw new Error("rip_program_missing");
  const queue = snapshot.config.vrf?.queues[snapshot.config.vrf.activeIndex];
  if (!queue || !publicKey(queue) || queue === PublicKey.default.toBase58())
    throw new Error("rip_queue_missing");
  const [account, latest, fees] = await Promise.all([
    rpc.request(
      "getAccountInfo",
      [
        binderPda(programId, input.account)[0].toBase58(),
        {
          encoding: "base64",
          commitment: "confirmed",
          dataSlice: { offset: 0, length: ACCOUNT_SIZES.binderHeader },
        },
      ],
      z.object({
        context,
        value: z
          .object({
            owner: z.string(),
            executable: z.boolean(),
            data: z.tuple([base64, z.literal("base64")]),
          })
          .nullable(),
      }),
    ),
    rpc.request(
      "getLatestBlockhash",
      [{ commitment: "confirmed" }],
      z.object({
        context,
        value: z.object({
          blockhash: z
            .string()
            .refine((value) => publicKey(value) !== undefined),
          lastValidBlockHeight: uint,
        }),
      }),
    ),
    rpc.request(
      "getRecentPrioritizationFees",
      [[machinePda(programId)[0].toBase58()]],
      z.array(z.object({ slot: uint, prioritizationFee: uint })),
    ),
  ]);
  let binder: ReturnType<typeof binderHeaderLayout.decode> | null = null;
  const uninitializedBinder =
    account.value?.owner === SystemProgram.programId.toBase58() &&
    !account.value.executable &&
    account.value.data[0] === "";
  if (account.value && !uninitializedBinder) {
    if (
      account.value.owner !== programId.toBase58() ||
      account.value.executable
    )
      throw new Error("rip_binder_owner");
    binder = binderHeaderLayout.decode(
      Buffer.from(account.value.data[0], "base64"),
    );
    if (!binder.owner.equals(input.account))
      throw new Error("rip_binder_identity");
  }
  const candidate = publicKey(input.ref);
  const referrer =
    candidate &&
    !candidate.equals(input.account) &&
    !candidate.equals(PublicKey.default) &&
    (!binder ||
      (binder.referrer.equals(PublicKey.default) && binder.season_spend === 0n))
      ? candidate
      : undefined;
  const ordered = fees
    .map((entry) => entry.prioritizationFee)
    .sort((a, b) => a - b);
  const priority = Math.min(
    ordered[Math.floor(ordered.length / 2)] ?? 0,
    WEB.priorityFeeCapMicroLamports,
  );
  // Omit the optional SDK proof; buy_packs encodes this as None.
  const tx = buildBuyPacksTransaction(programId, {
    wallet: input.account,
    blockhash: latest.value.blockhash,
    priorityFeeMicroLamports: BigInt(priority),
    edition: input.edition,
    qty: input.qty,
    pullNonce: binder?.pull_nonce ?? 0,
    minLiveFlags: input.minLiveFlags,
    referrer,
    oracleQueue: new PublicKey(queue),
  });
  if (!(tx instanceof Transaction)) throw new Error("rip_legacy_required");
  const bytes = validateRipTransaction(programId, tx, input.account, input.qty);
  const transaction = bytes.toString("base64");
  const simulated = await rpc.request(
    "simulateTransaction",
    [
      transaction,
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      },
    ],
    z.object({
      context,
      value: z.object({
        err: z.json().nullable(),
        logs: z.array(z.string()).nullable(),
      }),
    }),
  );
  if (simulated.value.err !== null)
    throw new RipSimulationError(
      await simulationMessage(
        simulated.value.err,
        simulated.value.logs ?? [],
        snapshot,
        input.edition,
        () => missingLamports(rpc, tx, input, binder),
      ),
    );
  return transaction;
}
