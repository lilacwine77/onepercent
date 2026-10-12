import { PublicKey, SystemProgram } from "@solana/web3.js";
import { type ServiceRuntime, warnCause } from "@onepercent/service-kit";
import { verifyPull } from "@onepercent/sdk/verify";
import { onePctLiveIndex, releaseTimes } from "@onepercent/sdk";
import {
  ConfigResponse,
  MachineResponse,
  MeResponse,
  VerifyResponse,
  StatusResponse,
  type FeatureFlags,
  type VrfStatus,
} from "@onepercent/sdk/api";
import { z } from "zod";
import {
  decodeBinderHeader,
  decodeBinderCards,
  BINDER_HEADER_BYTES,
  BINDER_CARD_BYTES,
  decodeConfig,
  decodeDeckHeader,
  decodeMachine,
  decodePullHeader,
  PublicDataUnavailable,
  safeNumber,
} from "./draft-layouts.js";
import { maxQty, readEconomics, rotateHour } from "./math.js";
import {
  readEditionMix,
  readMeMirror,
  readStatusMirror,
  readVerifyMirror,
} from "./mirror.js";
import { feedBackEstimate } from "@onepercent/config";
import { configBeforeProgram } from "./config.js";
import { loadPublicSettings, type PublicSettings } from "../settings.js";
import { readBlock0, readCreatorFees } from "./season.js";

export { PublicDataUnavailable } from "./draft-layouts.js";
export type DraftConfig = ReturnType<typeof decodeConfig>;
export class PublicDataNotFound extends Error {
  constructor() {
    super("not_found");
    this.name = "PublicDataNotFound";
  }
}
type Runtime = Pick<ServiceRuntime, "rpc" | "pool" | "env" | "redis">;
export interface PublicDataOptions {
  runtime: Runtime;
  flags: FeatureFlags;
  vrf?: (config: DraftConfig) => Promise<VrfStatus>;
  signerReadiness?: () => Promise<StatusResponse["signers"]>;
}
const accountSchema = z
  .object({
    owner: z.string(),
    executable: z.boolean(),
    data: z.tuple([
      z
        .string()
        .regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        ),
      z.literal("base64"),
    ]),
  })
  .nullable();
const contextSchema = z.object({ slot: z.number().int().safe().nonnegative() });

export function createPublicData(options: PublicDataOptions) {
  const { runtime } = options;
  const program = new PublicKey(runtime.env.PROGRAM_ID);
  const pda = (seed: string, extra: Buffer[] = []) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed), ...extra], program)[0];
  const decodeAccount = (
    value: z.infer<typeof accountSchema>,
    allowUninitializedBinder = false,
  ) => {
    if (!value) return null;
    if (
      allowUninitializedBinder &&
      value.owner === SystemProgram.programId.toBase58() &&
      !value.executable &&
      value.data[0] === ""
    )
      return null;
    if (value.executable || value.owner !== program.toBase58())
      throw new PublicDataUnavailable("account_owner_mismatch");
    return Buffer.from(value.data[0], "base64");
  };
  const readAccount = async (
    address: PublicKey,
    dataSlice?: { offset: number; length: number },
    minContextSlot?: number,
    allowUninitializedBinder = false,
  ) => {
    const response = await runtime.rpc.request(
      "getAccountInfo",
      [
        address.toBase58(),
        {
          encoding: "base64",
          commitment: "confirmed",
          ...(dataSlice ? { dataSlice } : {}),
          ...(minContextSlot === undefined ? {} : { minContextSlot }),
        },
      ],
      z.object({ context: contextSchema, value: accountSchema }),
    );
    return {
      slot: response.context.slot,
      data: decodeAccount(response.value, allowUninitializedBinder),
    };
  };
  const readCoreAccounts = async () => {
    const response = await runtime.rpc.request(
      "getMultipleAccounts",
      [
        [pda("config").toBase58(), pda("machine").toBase58()],
        { encoding: "base64", commitment: "confirmed" },
      ],
      z.object({
        context: contextSchema,
        value: z.tuple([accountSchema, accountSchema]),
      }),
    );
    const [configBytes, machineBytes] = response.value.map((value) =>
      decodeAccount(value),
    );
    return {
      asOfSlot: response.context.slot,
      config: configBytes ? decodeConfig(configBytes) : null,
      machine: machineBytes ? decodeMachine(machineBytes) : null,
    };
  };
  const readCore = async () => {
    const core = await readCoreAccounts();
    if (!core.config || !core.machine)
      throw new PublicDataUnavailable("machine_unavailable");
    return { ...core, config: core.config, machine: core.machine };
  };
  const readBinder = async (owner: string) => {
    const address = pda("binder", [new PublicKey(owner).toBuffer()]);
    // Bound each RPC body and concurrent reads. Bookend the confirmed slices
    // with the Binder header; ordinary bank advancement is allowed. Retry
    // once when card count/reservations/nonces change during the read.
    const cardsPerSlice = Math.floor(65_536 / BINDER_CARD_BYTES);
    for (let attempt = 0; attempt < 2; attempt++) {
      const first = await readAccount(
        address,
        { offset: 0, length: BINDER_HEADER_BYTES },
        undefined,
        true,
      );
      if (!first.data) return { slot: first.slot, binder: null };
      const header = decodeBinderHeader(first.data, owner);
      if (header.len === 0)
        return { slot: first.slot, binder: { ...header, cards: [] } };
      const cards: ReturnType<typeof decodeBinderCards> = [];
      let consistent = true;
      let latestSlot = first.slot;
      for (
        let start = 0;
        start < header.len && consistent;
        start += cardsPerSlice * 4
      ) {
        const pages = await Promise.all(
          Array.from(
            {
              length: Math.min(
                4,
                Math.ceil((header.len - start) / cardsPerSlice),
              ),
            },
            async (_, i) => {
              const index = start + i * cardsPerSlice;
              const length =
                Math.min(cardsPerSlice, header.len - index) * BINDER_CARD_BYTES;
              const page = await readAccount(
                address,
                {
                  offset: BINDER_HEADER_BYTES + index * BINDER_CARD_BYTES,
                  length,
                },
                first.slot,
              );
              latestSlot = Math.max(latestSlot, page.slot);
              if (
                !page.data ||
                page.data.length !== length ||
                page.slot < first.slot
              )
                return null;
              return decodeBinderCards(page.data, index);
            },
          ),
        );
        for (const page of pages) {
          if (!page) consistent = false;
          else cards.push(...page);
        }
      }
      if (consistent) {
        const last = await readAccount(
          address,
          { offset: 0, length: BINDER_HEADER_BYTES },
          latestSlot,
        );
        if (last.slot >= first.slot && last.data?.equals(first.data))
          return { slot: first.slot, binder: { ...header, cards } };
      }
    }
    throw new PublicDataUnavailable("inconsistent_snapshot");
  };
  const readVrf = async (config: DraftConfig): Promise<VrfStatus> =>
    options.vrf
      ? options.vrf(config)
      : {
          queue: config.vrf.queues[config.vrf.activeIndex] ?? null,
          occupancyBps: null,
          oldestItemAgeSeconds: null,
          busy: false,
        };

  return {
    block0: () => readBlock0(runtime.pool),
    creatorFees: (limit: number) => readCreatorFees(runtime.pool, limit),
    async config() {
      const initial = configBeforeProgram(runtime.env, options.flags);
      if (initial.paramsHash === null) return initial;
      const { asOfSlot, config, machine } = await readCoreAccounts();
      if (!config || !machine)
        return ConfigResponse.parse({ ...initial, asOfSlot });
      return ConfigResponse.parse({
        ...initial,
        asOfSlot,
        phase: machine.phase,
        roles: config.roles,
        vrf: config.vrf,
        season: {
          snapshotSlot: config.snapshotSlot,
          snapshotTs: config.snapshotTs,
          stockUpTs: config.stockUpTs,
          powerOnTs: machine.powerOnTs,
          onAirTs: machine.onAirTs,
          endTs: machine.endTs,
          finalTs: machine.finalTs,
        },
        paused: config.paused,
      });
    },
    async machine() {
      const economics = readEconomics();
      const [core, deckAccount, now, mix] = await Promise.all([
        readCore(),
        readAccount(pda("deck"), { offset: 0, length: 64 }),
        runtime.rpc.chainNow(),
        // The Feed back estimate's edition mix; without the indexer, the default mix.
        readEditionMix(runtime.pool).catch((error) => {
          warnCause("edition_mix_unavailable", error);
          return [0, 0, 0, 0] as [number, number, number, number];
        }),
      ]);
      if (!deckAccount.data)
        throw new PublicDataUnavailable("deck_unavailable");
      const deck = decodeDeckHeader(deckAccount.data);
      const m = rotateHour(core.machine, now);
      const releases =
        m.season.on_air_ts === 0n ? null : releaseTimes(m.season);
      if (m.reservedDust > BigInt(deck.len))
        throw new PublicDataUnavailable("inconsistent_snapshot");
      const book = m.stockSol + m.buckets.reduce((sum, b) => sum + b.cost, 0n);
      const target = economics.STOCK.targetBaseLamports + m.hitOutLastHour;
      const proportional =
        (m.solAtHourStart *
          BigInt(economics.SELL_BACK.hourlyBudgetBpsOfStockSol)) /
        BigInt(economics.BPS_DENOMINATOR);
      const budget =
        proportional > economics.SELL_BACK.hourlyBudgetMinLamports
          ? proportional
          : economics.SELL_BACK.hourlyBudgetMinLamports;
      return MachineResponse.parse({
        asOfSlot: Math.min(core.asOfSlot, deckAccount.slot),
        phase: m.phase,
        stock: {
          stockSol: m.stockSol.toString(),
          book: book.toString(),
          target: target.toString(),
          belowTarget: book < target,
          buckets: m.buckets
            .filter((b) => b.class !== 0)
            .map((b) => ({
              index: b.index,
              mint: b.mint,
              class: b.class === 1 ? "MAJOR" : "TRENDING",
              enabled: b.enabled === 1,
              amount: b.amount.toString(),
              cost: b.cost.toString(),
              reserved: b.reserved.toString(),
              free: (b.cost - b.reserved).toString(),
              cap: b.cap.toString(),
            })),
        },
        coverage: {
          maxQty: economics.PACK_EDITIONS.map((_, i) =>
            maxQty(i, deck.len, m, economics),
          ),
        },
        deck: {
          len: deck.len,
          reservedDust: m.reservedDust.toString(),
          free: safeNumber(BigInt(deck.len) - m.reservedDust),
        },
        jackpot: {
          tokens: m.jackpotTokens.toString(),
          cost: m.jackpotCost.toString(),
          sol: m.jackpotSol.toString(),
        },
        onePct: m.onePct.map((card, index) => ({
          ...card,
          ...(releases ? { releaseTs: safeNumber(releases[index]!) } : {}),
        })),
        tokenMint: m.season.token_mint.equals(PublicKey.default)
          ? null
          : m.season.token_mint.toBase58(),
        onePctLiveIndex: onePctLiveIndex(m.season, now),
        burn: {
          burnSol: m.season.burn_sol.toString(),
          burnedTotal: m.season.burned_total.toString(),
          lastBurnTs: safeNumber(m.season.last_burn_ts),
          burnPaidHour: ((now > 0n ? now : 0n) / 3_600n !==
          m.season.burn_hour_index
            ? 0n
            : m.season.burn_paid_hour
          ).toString(),
        },
        finalPull: null,
        sellBack: {
          budget: budget.toString(),
          paidHour: m.sbPaidHour.toString(),
          floor: economics.SELL_BACK.solFloorLamports.toString(),
        },
        pendingPulls: m.pendingPulls.toString(),
        vrf: await readVrf(core.config),
        feedBack: { estimate: feedBackEstimate(mix).toString(), mix },
      });
    },
    async me(wallet: string) {
      const owner = new PublicKey(wallet).toBase58();
      const [binderAccount, mirror] = await Promise.all([
        readBinder(owner),
        readMeMirror(runtime.pool, owner),
      ]);
      return MeResponse.parse({
        ...mirror,
        asOfSlot: Math.min(binderAccount.slot, mirror.asOfSlot),
        binder: binderAccount.binder,
      });
    },
    async verify(seq: string) {
      const mirror = await readVerifyMirror(runtime.pool, seq);
      if (!mirror) throw new PublicDataNotFound();
      // An open account may confirm identity, but may never add a reveal absent
      // from the indexer's committed events. Closed Pulls remain verifiable.
      if (mirror.status === "pending" || mirror.status === "revealed") {
        const account = await readAccount(new PublicKey(mirror.pull));
        if (account.data) {
          const header = decodePullHeader(account.data);
          if (
            header.seq !== mirror.seq ||
            header.buyer !== mirror.buyer ||
            header.buyerNonce !== mirror.buyerNonce ||
            header.qty !== mirror.qty
          )
            throw new PublicDataUnavailable("pull_identity_mismatch");
        }
      }
      const packs = mirror.packs.map((p) => ({
        ...p,
        dust: p.dust.map((d) => ({
          deckLenBefore: d.deckLenBefore,
          index: d.deckIndex,
          movedFrom: d.movedFrom,
          mint: d.mint,
          amount: d.amount,
          depositor: d.depositor,
          refund: d.refund,
        })),
      }));
      const check = mirror.randomness
        ? await verifyPull({
            programId: program.toBase58(),
            pull: {
              seq: mirror.seq,
              buyer: mirror.buyer,
              edition: mirror.edition,
              qty: mirror.qty,
              liveFlags: mirror.liveFlags,
              holder: mirror.holder,
              randomness: mirror.randomness,
            },
            packs,
          })
        : null;
      return VerifyResponse.parse({ ...mirror, packs, check });
    },
    async status() {
      const [mirror, core, signers] = await Promise.all([
        readStatusMirror(runtime.pool),
        readCore(),
        options.signerReadiness?.() ??
          Promise.resolve({
            intake: "unavailable" as const,
            quote: "unavailable" as const,
          }),
      ]);
      const indexer = await readIndexerStatus(
        runtime.redis,
        core.asOfSlot,
        loadPublicSettings(),
      );
      return StatusResponse.parse({
        asOfSlot: Math.min(mirror.asOfSlot, core.asOfSlot),
        indexer,
        keeper: mirror.keeper,
        signers,
        vrf: await readVrf(core.config),
      });
    },
  };
}

/** S1 scan watermark, including idle slots; event rows are not a lag signal. */
export async function readIndexerStatus(
  redis: Pick<ServiceRuntime["redis"], "get">,
  currentSlot: number,
  settings: Pick<PublicSettings, "indexer" | "transport">,
  now: () => number = Date.now,
) {
  try {
    const raw = await redis.get("onepct:indexer:status");
    if (!raw) return { lagSlots: null };
    const status = z
      .object({
        scanSlot: z
          .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
          .transform(safeNumber),
        checkedAt: z.iso.datetime({ offset: true }),
      })
      .parse(JSON.parse(raw));
    // S1 retains checkedAt from its last successful scan even when a later poll
    // fails. Allow one polling interval and one budget for each primary I/O;
    // beyond that, a saved Redis lag cannot establish current indexer health.
    const maxAgeMs =
      settings.indexer.pollMs +
      settings.transport.rpcTimeoutMs +
      settings.transport.dbStatementTimeoutMs +
      settings.transport.redisCommandTimeoutMs;
    const ageMs = now() - Date.parse(status.checkedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= maxAgeMs)
      return { lagSlots: null };
    return { lagSlots: Math.max(0, currentSlot - status.scanSlot) };
  } catch (error) {
    warnCause("indexer_status_unavailable", error);
    return { lagSlots: null };
  }
}
