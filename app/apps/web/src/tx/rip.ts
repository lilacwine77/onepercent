import { webDeployment } from "../data/deployment";
import {
  ACCOUNT_SIZES,
  CARDS_PER_PACK,
  PACK_EDITIONS,
  VRF,
  type EditionId,
} from "@onepercent/config";
import {
  buildBuyPacksTransaction,
  pullPda,
  type Binder,
  type BuiltTransaction,
  type Config,
  type Machine,
} from "@onepercent/sdk/browser";
import { PublicKey } from "@solana/web3.js";
import type { VrfStatus } from "@onepercent/sdk/api";
import { editionLiveFlags, editionModels } from "../adapters/edition";
import type { PlanItem } from "./engine/progress";
import { EngineError } from "./engine/errors";

export interface RipSnapshot {
  config: Config;
  machine: Machine;
  deckLen: number;
  binder: Binder | null;
  binderLamports: bigint;
  nowTs: bigint;
  vrf: VrfStatus | null;
}

/** Called on the tap, and again by the engine before the final simulation. */
export async function planRip(input: {
  wallet: PublicKey;
  edition: EditionId;
  qty: number;
  packsEnabled: boolean | (() => boolean);
  referral?: string;
  read(): Promise<RipSnapshot>;
  rent(size: number): Promise<bigint>;
  exists(address: PublicKey): Promise<boolean>;
}) {
  const packsEnabled = () =>
    typeof input.packsEnabled === "function"
      ? input.packsEnabled()
      : input.packsEnabled;
  if (!packsEnabled()) throw new EngineError("common.networkError");
  const snapshot = await input.read();
  const edition = PACK_EDITIONS.find((item) => item.id === input.edition);
  if (!edition || !Number.isSafeInteger(input.qty) || input.qty < 1)
    throw new EngineError("errors.generic");
  const model = editionModels({ ...snapshot, qty: input.qty }).find(
    (item) => item.id === input.edition,
  )!;
  if (model.state !== "covered" || input.qty > model.maxQty)
    throw new EngineError(model.stateLine.key);
  const nonce = snapshot.binder?.pull_nonce ?? 0;
  const address = pullPda(webDeployment().programId, input.wallet, nonce)[0];
  const minLiveFlags = editionLiveFlags(model);
  const oracleQueue = snapshot.config.vrf_queues[snapshot.config.active_queue];
  if (
    !oracleQueue ||
    oracleQueue.equals(PublicKey.default) ||
    snapshot.vrf?.queue !== oracleQueue.toBase58()
  )
    throw new EngineError("common.networkError");
  let referrer: PublicKey | undefined;
  if (
    input.referral &&
    (!snapshot.binder ||
      (snapshot.binder.referrer.equals(PublicKey.default) &&
        snapshot.binder.season_spend === 0n))
  ) {
    try {
      const candidate = new PublicKey(input.referral);
      if (
        !candidate.equals(input.wallet) &&
        !candidate.equals(PublicKey.default)
      )
        referrer = candidate;
    } catch {
      /* Aliases wait for their resolver. */
    }
  }
  const slots = input.qty * (CARDS_PER_PACK.dust + CARDS_PER_PACK.hit);
  const nextCap = Math.max(
    snapshot.binder?.cap ?? 0,
    (snapshot.binder?.len ?? 0) + (snapshot.binder?.reserved ?? 0) + slots,
  );
  const [pullDeposit, binderFloor, binderHeader] = await Promise.all([
    input.rent(
      ACCOUNT_SIZES.pullHeader + ACCOUNT_SIZES.pullPerPack * input.qty,
    ),
    input.rent(ACCOUNT_SIZES.binderHeader + ACCOUNT_SIZES.cardSlot * nextCap),
    snapshot.binder
      ? Promise.resolve(0n)
      : input.rent(ACCOUNT_SIZES.binderHeader),
  ]);
  const floor =
    binderFloor + (snapshot.binder?.sol_owed ?? 0n) - snapshot.binderLamports;
  const binderDeposit = floor > 0n ? floor : 0n;
  const item: PlanItem<BuiltTransaction> = {
    id: address.toBase58(),
    phase: 1,
    async build(blockhash) {
      if (!packsEnabled()) throw new EngineError("common.networkError");
      const fresh = await input.read();
      if ((fresh.binder?.pull_nonce ?? 0) !== nonce)
        throw new EngineError("errors.cardMoved");
      const latest = editionModels({ ...fresh, qty: input.qty }).find(
        (item) => item.id === input.edition,
      )!;
      if (
        latest.state !== "covered" ||
        (minLiveFlags & ~editionLiveFlags(latest)) !== 0 ||
        !fresh.config.vrf_queues[fresh.config.active_queue]?.equals(
          oracleQueue,
        ) ||
        fresh.vrf?.queue !== oracleQueue.toBase58() ||
        !packsEnabled()
      )
        throw new EngineError("errors.simulation");
      const freshCap = Math.max(
        fresh.binder?.cap ?? 0,
        (fresh.binder?.len ?? 0) + (fresh.binder?.reserved ?? 0) + slots,
      );
      const [freshPullRent, freshBinderRent] = await Promise.all([
        input.rent(
          ACCOUNT_SIZES.pullHeader + ACCOUNT_SIZES.pullPerPack * input.qty,
        ),
        input.rent(
          ACCOUNT_SIZES.binderHeader + ACCOUNT_SIZES.cardSlot * freshCap,
        ),
      ]);
      const freshDeposit =
        freshBinderRent + (fresh.binder?.sol_owed ?? 0n) - fresh.binderLamports;
      if (freshPullRent > pullDeposit || freshDeposit > binderDeposit)
        throw new EngineError("rip.machineChanged");
      return buildBuyPacksTransaction(webDeployment().programId, {
        wallet: input.wallet,
        blockhash: blockhash.blockhash,
        edition: edition.index,
        qty: input.qty,
        pullNonce: nonce,
        minLiveFlags,
        oracleQueue,
        ...(referrer ? { referrer } : {}),
      });
    },
    async landed() {
      if (await input.exists(address)) return true;
      // The keeper may already have closed a settled Pull before reconciliation.
      return ((await input.read()).binder?.pull_nonce ?? 0) > nonce;
    },
  };
  return {
    address,
    nonce,
    referrer,
    edition,
    qty: input.qty,
    item,
    costs: {
      price: edition.priceLamports * BigInt(input.qty),
      drawFee: VRF.feeLamports,
      pullDeposit,
      binderHeader,
      cardSlots:
        binderDeposit > binderHeader ? binderDeposit - binderHeader : 0n,
      binderDeposit,
    },
  };
}
