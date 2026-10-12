import { webDeployment } from "../data/deployment";
import { TX_LIMITS, WEB } from "@onepercent/config";
import {
  buildSettleTransaction,
  type BuiltTransaction,
} from "@onepercent/sdk/browser";
import {
  planSettle,
  readClock,
  readPayees,
  readPull,
} from "@onepercent/sdk/rescue";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { readMeHints } from "../data/cards";
import type { WalletSession } from "../wallet/session";
import { EngineError } from "./engine/errors";
import { checkBuiltTransaction, executeTransactions } from "./runtime";

type SettleGroup = { pull: string; seq: bigint; indices: number[] };
export interface PreparedSettles {
  groups: SettleGroup[];
  feeLamports: bigint;
}
const empty = (): PreparedSettles => ({ groups: [], feeLamports: 0n });
const belongs = (
  pull: NonNullable<Awaited<ReturnType<typeof readPull>>>,
  owner: PublicKey,
) =>
  pull.buyer.equals(owner) ||
  pull.packs.some((pack) =>
    pack.royalties.some(
      (royalty, index) =>
        !(pack.house_mask & (1 << index)) && royalty.depositor.equals(owner),
    ),
  );

/** Optional housekeeping is discovered from hints, checked on chain and priced before approval. */
export async function prepareSettles(input: {
  rpc: Connection;
  owner: PublicKey;
  blockhash: string;
}): Promise<PreparedSettles> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<PreparedSettles>((resolve) => {
    timer = setTimeout(() => {
      stopped = true;
      resolve(empty());
    }, WEB.httpTimeoutMs);
  });
  const collect = async (): Promise<PreparedSettles> => {
    try {
      const hints = await readMeHints(input.owner);
      if (stopped || !hints.pulls.settleable.length) return empty();
      const clock = await readClock(input.rpc);
      const addresses = [
        ...new Set(hints.pulls.settleable.map((hint) => hint.pull)),
      ];
      const prepared = empty();
      for (const value of addresses) {
        if (stopped || prepared.groups.length >= TX_LIMITS.txPerSignAll) break;
        try {
          const address = new PublicKey(value);
          const pull = await readPull(
            input.rpc,
            webDeployment().programId,
            address,
          );
          if (
            !pull ||
            pull.status !== 2 ||
            !belongs(pull, input.owner) ||
            pull.revealed_ts <= 0n ||
            clock.unixTimestamp <
              pull.revealed_ts + BigInt(WEB.settlePrependAfterSeconds)
          )
            continue;
          const plan = await planSettle({
            rpc: input.rpc,
            programId: webDeployment().programId,
            wallet: input.owner,
            blockhash: input.blockhash,
            pulls: [address],
          });
          for (const entry of plan.transactions) {
            if (stopped || prepared.groups.length >= TX_LIMITS.txPerSignAll)
              break;
            if (!entry.indices?.length) continue;
            checkBuiltTransaction(entry.transaction, input.owner);
            const message =
              entry.transaction instanceof Transaction
                ? entry.transaction.compileMessage()
                : entry.transaction.message;
            const [simulation, fee] = await Promise.all([
              input.rpc.simulateTransaction(new VersionedTransaction(message), {
                sigVerify: false,
                replaceRecentBlockhash: true,
                commitment: "confirmed",
              }),
              input.rpc.getFeeForMessage(message, "confirmed"),
            ]);
            if (
              simulation.value.err ||
              fee.value === null ||
              !Number.isSafeInteger(fee.value) ||
              fee.value < 0
            )
              continue;
            if (stopped) return empty();
            prepared.groups.push({
              pull: value,
              seq: pull.seq,
              indices: entry.indices,
            });
            prepared.feeLamports += BigInt(fee.value);
          }
        } catch {
          /* A failed optional Pull never hides the owner's action. */
        }
      }
      return prepared;
    } catch {
      return empty();
    }
  };
  try {
    return await Promise.race([collect(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function buildGroup(
  rpc: Connection,
  wallet: PublicKey,
  group: SettleGroup,
  blockhash: string,
): Promise<BuiltTransaction> {
  const address = new PublicKey(group.pull);
  const pull = await readPull(rpc, webDeployment().programId, address);
  if (
    !pull ||
    pull.status !== 2 ||
    pull.seq !== group.seq ||
    !belongs(pull, wallet)
  )
    throw new EngineError("errors.pullPending");
  const indices = group.indices.filter(
    (index) => !(pull.settled_mask & (1 << index)),
  );
  if (!indices.length) throw new EngineError("errors.cardMoved");
  const keys = [
    pull.buyer,
    pull.referrer,
    ...indices.flatMap((index) =>
      pull.packs[index]!.royalties.map((royalty) => royalty.depositor),
    ),
  ];
  const rows = await readPayees(rpc, [
    ...new Map(keys.map((key) => [key.toBase58(), key])).values(),
  ]);
  const payee = (address: PublicKey) => ({
    address,
    executable: rows.find((row) => row.address.equals(address))!.executable,
  });
  return buildSettleTransaction(webDeployment().programId, {
    wallet,
    blockhash,
    packs: indices.map((index) => {
      const pack = pull.packs[index]!;
      return {
        pull: address,
        seq: pull.seq,
        pack: index,
        buyer: payee(pull.buyer),
        referrer: pull.referrer.equals(PublicKey.default)
          ? undefined
          : payee(pull.referrer),
        wallets: pack.royalties.map((royalty, position) =>
          pack.house_mask & (1 << position) ? null : payee(royalty.depositor),
        ) as unknown as Parameters<
          typeof buildSettleTransaction
        >[1]["packs"][number]["wallets"],
      };
    }),
  });
}

/** A keeper race or refused simulation is skipped; an ambiguous signed submission is never retried. */
export async function runSettles(input: {
  rpc: Connection;
  session: WalletSession;
  chain: "solana:devnet" | "solana:mainnet";
  prepared: PreparedSettles;
  progress?(confirmed: number, total: number): void;
}) {
  const { account, generation } = input.session.snapshot();
  if (!account) throw new EngineError("wallet.noAccount");
  const owner = new PublicKey(account.address);
  let confirmed = 0;
  for (const group of input.prepared.groups) {
    if (input.session.snapshot().generation !== generation)
      throw new EngineError("errors.cardMoved");
    const landed = async () => {
      const pull = await readPull(
        input.rpc,
        webDeployment().programId,
        new PublicKey(group.pull),
      );
      return (
        !pull ||
        (pull.seq === group.seq &&
          group.indices.every(
            (index) => (pull.settled_mask & (1 << index)) !== 0,
          ))
      );
    };
    try {
      if (await landed()) continue;
    } catch {
      continue;
    }
    const result = await executeTransactions({
      rpc: input.rpc,
      session: input.session,
      chain: input.chain,
      items: [
        {
          id: `settle:${group.pull}:${group.indices.join(",")}`,
          phase: 0,
          build: ({ blockhash }) =>
            buildGroup(input.rpc, owner, group, blockhash),
          landed,
        },
      ],
    });
    if (result.submitted && result.unknown.size)
      throw new EngineError("errors.generic");
    if (result.copyKey === "errors.walletNo")
      throw new EngineError("errors.walletNo");
    if (result.phase === "done") confirmed++;
    input.progress?.(confirmed, input.prepared.groups.length);
  }
}
