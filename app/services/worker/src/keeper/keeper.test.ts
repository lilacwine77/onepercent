import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, it, expect, vi } from "vitest";
import {
  RpcError,
  TxSenderError,
  TxSender,
  type SignedTxRecord,
  type TxSendRequest,
  type TxSendResult,
  type TxRpc,
  type TxInstructionPlan,
} from "@onepercent/service-kit";
import { Keeper, type KeeperOptions } from "./keeper.js";
import {
  intentSchema,
  jobId,
  settleIntents,
  nextPhase,
  type KeeperIntent,
} from "./jobs.js";
import { keeperParamsSchema } from "./params.js";
import {
  chainDate,
  encodeInstructionPlan,
  type KeeperJob,
  type KeeperStore,
} from "./store.js";
import type { KeeperPull, KeeperSnapshot, KeeperLedger } from "./adapter.js";
import { settleInstruction } from "./adapter.js";

// Recorded PARAMS §26.1 / M1 CU report values, used only as test inputs.
const params = keeperParamsSchema.parse({
  SERVICES: {
    keeper: {
      scanSeconds: 10,
      closeVaultPassSeconds: 3600,
      teamWithdrawSeconds: 3600,
      sendMaxAttempts: 5,
      backoffBaseMs: 500,
      backoffMaxMs: 30000,
      settleBacklogAlertSeconds: 60,
      settleP95TargetSeconds: 5,
    },
    monitor: { vrfExpiryClusterPerWallet24h: 3 },
    landing: { cuMarginBps: 2000, maxComputeUnitPriceMicroLamports: 10000 },
  },
  TX_LIMITS: { settlePacksPerTx: 2, maxTxBytes: 1232 },
  VRF: { timeoutSeconds: 300 },
  MONITOR: {
    vrfQueueOccupancyAlertBps: 5000,
    vrfExpiriesPerThousandRipsAlert: 1,
  },
  CU_LIMITS: { settle: [28000, 53000], refundPull: 13000 },
});
class MemoryStore implements KeeperStore {
  jobs = new Map<string, KeeperJob>();
  async ensure(intent: KeeperIntent, now: Date) {
    const id = jobId(intent);
    if (!this.jobs.has(id))
      this.jobs.set(id, {
        id,
        kind: intent.kind,
        payload: { intent },
        status: "pending",
        attempts: 0,
        next_attempt_at: now,
        last_error: null,
        signature: null,
      });
    return this.jobs.get(id)!;
  }
  async claim(id: string) {
    return this.jobs.get(id)!;
  }
  async due(now: Date) {
    const priority = (job: KeeperJob) =>
      job.kind === "settle" ? 0 : job.kind === "refund" ? 1 : 2;
    return [...this.jobs.values()]
      .filter(
        (job) =>
          (["pending", "sent", "failed"].includes(job.status) ||
            (job.status === "confirmed" && !job.payload.finalized)) &&
          job.next_attempt_at <= now,
      )
      .sort((left, right) => priority(left) - priority(right));
  }
  async budget(
    id: string,
    units: number,
    instructions: readonly TransactionInstruction[],
  ) {
    this.jobs.get(id)!.payload.computeUnitLimit = units;
    this.jobs.get(id)!.payload.instructions =
      encodeInstructionPlan(instructions);
  }
  async finish(
    id: string,
    status: KeeperJob["status"],
    reason: string | null,
    next: Date,
    finalized = false,
  ) {
    Object.assign(this.jobs.get(id)!.payload, {
      finalized,
      ...(status === "confirmed" ? { confirmationObserved: true } : {}),
    });
    Object.assign(this.jobs.get(id)!, {
      status,
      last_error: reason,
      next_attempt_at: next,
    });
  }
  async skip(id: string, reason: string) {
    const job = this.jobs.get(id)!;
    const changed = job.status !== "skipped";
    Object.assign(job, { status: "skipped", last_error: reason });
    return changed;
  }
  async read(id: string) {
    return this.jobs.get(id)!.payload.transaction ?? null;
  }
  async write(id: string, record: SignedTxRecord, plan?: TxInstructionPlan) {
    if (plan) {
      this.jobs.get(id)!.payload.computeUnitLimit = plan.computeUnitLimit;
      this.jobs.get(id)!.payload.instructions = encodeInstructionPlan(
        plan.instructions,
      );
    }
    if (record.status === "signed")
      this.jobs.get(id)!.payload.finalized = false;
    this.jobs.get(id)!.payload.transaction = record;
  }
  async reserveAttempt(id: string, max: number) {
    const job = this.jobs.get(id)!;
    return job.attempts < max ? ++job.attempts : null;
  }
}
const key = () => Keypair.generate().publicKey;
function makePull(status: 1 | 2, seq: bigint, qty = 1): KeeperPull {
  return {
    address: key(),
    seq,
    buyer: key(),
    referrer: PublicKey.default,
    createdTs: 1n,
    revealedTs: 995n,
    buyerNonce: 0,
    settledMask: 0,
    qty,
    status,
    packs: Array.from({ length: qty }, () => ({
      houseMask: 15,
      freshMask: 0,
      royalties: [],
    })),
  };
}
function harness() {
  const store = new MemoryStore();
  let now = 1000n;
  let active = true;
  const pulls = [makePull(2, 1n, 3), makePull(1, 2n)];
  const ledger: KeeperLedger = {
    address: key(),
    mint: key(),
    payer: key(),
    accounted: 0n,
  };
  const snapshot: KeeperSnapshot = {
    asOfSlot: 10,
    config: {
      seasonSet: true,
      stockUpTs: 500n,
      teamWallet: key(),
      activeQueue: 0,
      vrfQueues: [],
      vrfProgram: key(),
    },
    machine: {
      phase: 0,
      nextSeq: 3n,
      onAirTs: 2000n,
      endTs: 3000n,
      teamSol: 1n,
      buckets: [],
    },
  };
  const ledgerMap = new Map([[ledger.mint.toBase58(), ledger]]);
  const instructions = (kind: string) =>
    new TransactionInstruction({
      programId: key(),
      keys: [],
      data: Buffer.from(kind),
    });
  const chain: KeeperOptions["chain"] = {
    chainNow: vi.fn(async () => now),
    snapshot: vi.fn(async () => snapshot),
    scanPulls: vi.fn(async (status) =>
      pulls.filter((p) => p.status === status),
    ),
    pull: vi.fn(
      async (address) => pulls.find((p) => p.address.equals(address)) ?? null,
    ),
    pullCompletion: vi.fn(async (address, commitment, signal) => ({
      pull: await chain.pull(address, commitment, signal),
      nextSeq: snapshot.machine.nextSeq,
    })),
    zeroLedgers: vi.fn(async () =>
      [...ledgerMap.values()].filter((l) => l.accounted === 0n),
    ),
    ledger: vi.fn(async (mint) => ledgerMap.get(mint.toBase58()) ?? null),
    closeVaultState: vi.fn(async () => ({
      vaultExists: true,
      payerWritable: true,
      tokenProgram: key(),
    })),
    settle: vi.fn(async () => [instructions("settle")]),
    refund: vi.fn(async () => instructions("refund")),
    advance: vi.fn(() => instructions("advance")),
    closeVault: vi.fn(() => instructions("close")),
    teamWithdraw: vi.fn(() => instructions("team")),
  };
  const sender = {
    send: vi.fn<(request: TxSendRequest) => Promise<TxSendResult>>(
      async (request) => {
        const intent = store.jobs.get(request.job)!.payload.intent;
        switch (intent.kind) {
          case "settle": {
            const pull = pulls.find((p) => p.seq.toString() === intent.seq)!;
            intent.packs.forEach((pack) => {
              pull.settledMask |= 1 << pack;
            });
            break;
          }
          case "refund":
            pulls.splice(
              pulls.findIndex((p) => p.seq.toString() === intent.seq),
              1,
            );
            break;
          case "advance":
            snapshot.machine.phase = intent.to;
            break;
          case "close-vault":
            ledgerMap.delete(intent.mint);
            break;
          case "team-withdraw":
            snapshot.machine.teamSol = 0n;
            break;
        }
        return {
          status: "confirmed" as const,
          signature: `sig-${request.job}`,
          finalized: true,
        };
      },
    ),
  };
  const hooks = {
    alert: vi.fn(async () => undefined),
    result: vi.fn(),
    latency: vi.fn(),
    log: vi.fn(),
  };
  const options: KeeperOptions = {
    chain,
    store,
    params,
    sender,
    assertLeader: () => {
      if (!active) throw new Error("not_leader");
    },
    measure: vi.fn(async () => 2000),
    hooks,
  };
  return {
    keeper: new Keeper(options),
    options,
    store,
    chain,
    pulls,
    snapshot,
    ledger,
    ledgerMap,
    sender,
    hooks,
    signal: new AbortController().signal,
    setNow: (value: bigint) => {
      now = value;
    },
    loseLeader: () => {
      active = false;
    },
  };
}

describe("keeper v1 cranks", () => {
  it("runs every crank twice with one transaction per keyed job", async () => {
    const h = harness();
    await h.keeper.scan(h.signal);
    await h.keeper.scan(h.signal);
    expect(h.sender.send).toHaveBeenCalledTimes(6);
    expect([...h.store.jobs.values()].map((j) => j.kind)).toEqual([
      "settle",
      "settle",
      "refund",
      "advance",
      "close-vault",
      "team-withdraw",
    ]);
    expect(
      [...h.store.jobs.values()].every((j) => j.status === "confirmed"),
    ).toBe(true);
    expect(h.hooks.latency.mock.calls).toEqual([[5], [5]]);
    expect(h.chain.settle).toHaveBeenNthCalledWith(
      1,
      h.pulls[0],
      [0, 1],
      h.signal,
    );
    expect(h.chain.settle).toHaveBeenNthCalledWith(
      2,
      h.pulls[0],
      [2],
      h.signal,
    );
    expect(h.sender.send.mock.calls.map(([r]) => r.computeUnitLimit)).toEqual([
      53000, 28000, 13000, 2000, 2000, 2000,
    ]);
  });
  it("uses chain time for the inclusive refund boundary even with a fast host clock", async () => {
    const h = harness();
    h.setNow(300n);
    const host = vi.spyOn(Date, "now").mockReturnValue(9_999_999_999_999);
    try {
      await h.keeper.scan(h.signal);
      expect(h.chain.refund).not.toHaveBeenCalled();
      h.setNow(301n);
      await h.keeper.scan(h.signal);
      expect(h.chain.refund).toHaveBeenCalledTimes(1);
    } finally {
      host.mockRestore();
    }
  });
  it("re-reads before refund and does not refund a concurrently revealed Pull", async () => {
    const h = harness();
    vi.mocked(h.chain.pull).mockImplementation(async (address) => {
      const pull = h.pulls.find((p) => p.address.equals(address));
      if (pull?.status === 1) pull.status = 2;
      return pull ?? null;
    });
    await h.keeper.scan(h.signal);
    expect(h.chain.refund).not.toHaveBeenCalled();
    expect(h.store.jobs.get("refund:2")!.status).toBe("confirmed");
  });
  it("exits keep running when Config reads fail or a monitor is unavailable", async () => {
    const h = harness();
    vi.mocked(h.chain.snapshot).mockRejectedValue(
      new Error("config_unavailable"),
    );
    await h.keeper.scan(h.signal);
    expect(h.sender.send).toHaveBeenCalledTimes(3);
    expect(h.hooks.log).toHaveBeenCalledWith({
      reason: "periodic_scan_failed",
      cause: { code: "config_unavailable", detail: "config_unavailable" },
    });
  });
  it("skips a non-writable ledger payer and alerts once across repeated scans", async () => {
    const h = harness();
    vi.mocked(h.chain.closeVaultState).mockResolvedValue({
      vaultExists: true,
      payerWritable: false,
      tokenProgram: key(),
    });
    await h.keeper.scan(h.signal);
    await new Keeper(h.options).scan(h.signal);
    expect(h.chain.closeVault).not.toHaveBeenCalled();
    expect(
      h.hooks.alert.mock.calls.filter(
        (call: unknown[]) => call[1] === "payer_not_writable",
      ),
    ).toHaveLength(1);
    expect(
      [...h.store.jobs.values()].find((j) => j.kind === "close-vault")!.status,
    ).toBe("skipped");
  });
  it.each(["listed", "absent"])("does not close a %s vault", async (reason) => {
    const h = harness();
    if (reason === "listed")
      h.snapshot.machine.buckets.push({ mint: h.ledger.mint, class: 1 });
    else
      vi.mocked(h.chain.closeVaultState).mockResolvedValue({
        vaultExists: false,
        payerWritable: true,
        tokenProgram: key(),
      });
    await h.keeper.scan(h.signal);
    expect(h.chain.closeVault).not.toHaveBeenCalled();
  });
  it("re-checks accounted and listed state immediately before a close", async () => {
    const h = harness();
    vi.mocked(h.chain.ledger).mockImplementation(async () => ({
      ...h.ledger,
      accounted: 1n,
    }));
    await h.keeper.scan(h.signal);
    expect(h.chain.closeVault).not.toHaveBeenCalled();
    expect(
      [...h.store.jobs.values()].find((j) => j.kind === "close-vault")!.status,
    ).toBe("skipped");
  });
  it("makes an extra close pass on transition to Done and hourly thereafter", async () => {
    const h = harness();
    await h.keeper.scan(h.signal);
    h.ledgerMap.set(h.ledger.mint.toBase58(), h.ledger);
    h.snapshot.machine.phase = 6;
    h.setNow(1001n);
    await h.keeper.scan(h.signal);
    expect(h.chain.zeroLedgers).toHaveBeenCalledTimes(2);
    h.setNow(4601n);
    await h.keeper.scan(h.signal);
    expect(h.chain.zeroLedgers).toHaveBeenCalledTimes(3);
  });
  it("does not change group keys after a partial client-prepended settlement", () => {
    const pull = makePull(2, 5n, 4);
    const before = settleIntents(pull, 2).map(jobId);
    pull.settledMask = 1;
    expect(settleIntents(pull, 2).map(jobId)).toEqual(before);
  });
  it("aborts before any send when leadership is lost during a chain read", async () => {
    const h = harness();
    vi.mocked(h.chain.pull).mockImplementation(async () => {
      h.loseLeader();
      return h.pulls[0]!;
    });
    await expect(h.keeper.scan(h.signal)).rejects.toThrow("not_leader");
    expect(h.sender.send).not.toHaveBeenCalled();
  });
  it("keeps failed jobs due later and lets unrelated exits finish", async () => {
    const h = harness();
    h.sender.send.mockRejectedValueOnce(
      new TxSenderError("transaction_pending"),
    );
    await h.keeper.scan(h.signal);
    expect(h.store.jobs.get("settle:1:0,1")!.status).toBe("failed");
    expect(h.store.jobs.get("refund:2")!.status).toBe("confirmed");
    await h.keeper.scan(h.signal);
    expect(h.sender.send).toHaveBeenCalledTimes(6);
    h.setNow(1031n);
    await h.keeper.scan(h.signal);
    expect(h.sender.send).toHaveBeenCalledTimes(7);
  });
  it.each([-32004, -32016, -32007, -32009])(
    "defers a lagging node (%s) without failing jobs or blocking other exits",
    async (code) => {
      const h = harness();
      const read = h.chain.pullCompletion;
      let lagging = true;
      h.chain.pullCompletion = async (address, commitment, signal) => {
        if (lagging && address.equals(h.pulls[0]!.address))
          throw new RpcError(code);
        return read(address, commitment, signal);
      };
      await h.keeper.scan(h.signal);
      expect(h.store.jobs.get("settle:1:0,1")).toMatchObject({
        status: "pending",
        attempts: 0,
        last_error: null,
      });
      expect(h.store.jobs.get("refund:2")!.status).toBe("confirmed");
      expect(h.hooks.result).not.toHaveBeenCalledWith("settle", "failed");
      expect(h.hooks.alert).not.toHaveBeenCalled();
      lagging = false;
      await h.keeper.scan(h.signal);
      expect(h.store.jobs.get("settle:1:0,1")!.status).toBe("confirmed");
      expect(h.store.jobs.get("settle:1:2")!.status).toBe("confirmed");
      const jobs = h.sender.send.mock.calls.map(([request]) => request.job);
      expect(new Set(jobs).size).toBe(jobs.length);
    },
  );
  it("resumes persisted instructions, even if fresh payee flags would differ", async () => {
    const h = harness();
    const intent = settleIntents(h.pulls[0]!, 2)[0]!;
    const job = await h.store.ensure(intent, chainDate(1000n));
    const signer = Keypair.generate();
    const instruction = new TransactionInstruction({
      programId: key(),
      keys: [],
      data: Buffer.from("old-plan"),
    });
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 53000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
          instruction,
        ],
      }).compileToV0Message(),
    );
    transaction.sign([signer]);
    job.payload.computeUnitLimit = 53000;
    job.payload.instructions = encodeInstructionPlan([instruction]);
    job.payload.transaction = {
      fingerprint: "a".repeat(64),
      signature: "test",
      transactionBase64: Buffer.from(transaction.serialize()).toString(
        "base64",
      ),
      lastValidBlockHeight: 123,
      status: "signed",
    };
    await h.keeper.scan(h.signal);
    expect(
      h.sender.send.mock.calls[0]![0].instructions[0]!.data.toString(),
    ).toBe("old-plan");
    expect(h.chain.settle).toHaveBeenCalledTimes(1);
  });
  it("advances only the S3 transitions at their exact timestamps", () => {
    const h = harness();
    expect(nextPhase(h.snapshot, 499n)).toBeNull();
    expect(nextPhase(h.snapshot, 500n)).toBe(1);
    h.snapshot.machine.phase = 1;
    expect(nextPhase(h.snapshot, 4000n)).toBeNull();
    h.snapshot.machine.phase = 2;
    expect(nextPhase(h.snapshot, 2000n)).toBe(3);
    h.snapshot.machine.phase = 3;
    expect(nextPhase(h.snapshot, 3000n)).toBe(4);
    h.snapshot.machine.phase = 2;
    h.snapshot.machine.onAirTs = 0n;
    expect(nextPhase(h.snapshot, 900000n)).toBeNull();
    h.snapshot.machine.phase = 3;
    h.snapshot.machine.endTs = 0n;
    expect(nextPhase(h.snapshot, 900000n)).toBeNull();
    h.snapshot.machine.phase = 5;
    expect(nextPhase(h.snapshot, 900000n)).toBeNull();
  });
  it("fails closed until the M1/P0 parameters exist", () => {
    expect(() => keeperParamsSchema.parse({})).toThrow();
    expect(
      keeperParamsSchema.parse({
        ...params,
        SERVICES: {
          ...params.SERVICES,
          landing: {
            ...params.SERVICES.landing,
            maxComputeUnitPriceMicroLamports: null,
          },
        },
      }).SERVICES.landing.maxComputeUnitPriceMicroLamports,
    ).toBeNull();
  });
});

describe("exact instruction journal replay", () => {
  it("replays the same bytes after a lost reply when the referrer equals the fee payer", async () => {
    const h = harness();
    h.pulls.splice(1);
    const pull = h.pulls[0]!;
    pull.qty = 1;
    h.ledgerMap.clear();
    h.snapshot.machine.phase = 1;
    h.snapshot.machine.teamSol = 0n;
    const signer = Keypair.generate();
    const instruction = settleInstruction(
      {
        pull: pull.address,
        seq: pull.seq,
        pack: 0,
        buyer: { address: pull.buyer, executable: false },
        referrer: { address: signer.publicKey, executable: false },
        wallets: [null, null, null, null],
      },
      key(),
    );
    vi.mocked(h.chain.settle).mockResolvedValue([instruction]);
    const id = jobId(settleIntents(pull, 2)[0]!);
    const firstTerm = new AbortController();
    const sent: Buffer[] = [];
    let landed = false;
    const rpc: TxRpc = {
      getLatestBlockhash: vi.fn(async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 100,
      })),
      getRecentPrioritizationFees: vi.fn(async () => [
        { prioritizationFee: 1 },
      ]),
      simulateTransaction: vi.fn(async () => ({ err: null })),
      getBlockHeight: vi.fn(async () => 99),
      getSignatureStatuses: vi.fn(async () => [
        landed ? { err: null, confirmationStatus: "confirmed" as const } : null,
      ]),
      sendRawTransaction: vi.fn(async (bytes) => {
        sent.push(Buffer.from(bytes));
        if (sent.length === 1) {
          firstTerm.abort(new Error("lost_term"));
          throw new Error("lost_reply");
        }
        landed = true;
        return h.store.jobs.get(id)!.payload.transaction!.signature;
      }),
    };
    const sender = (signal: AbortSignal) =>
      new TxSender({
        rpc,
        signer: {
          publicKey: signer.publicKey,
          signTransaction: (transaction) => transaction.sign([signer]),
        },
        role: "keeper",
        assertAuthorized: () => undefined,
        assertLeader: () => signal.throwIfAborted(),
        journal: h.store,
        sendMaxAttempts: 5,
        backoffBaseMs: 1,
        backoffMaxMs: 1,
        cuMarginBps: 2000,
        maxComputeUnitPriceMicroLamports: 1n,
        sleep: async () => undefined,
      });
    await expect(
      new Keeper({ ...h.options, sender: sender(firstTerm.signal) }).scan(
        firstTerm.signal,
      ),
    ).rejects.toThrow("lost_term");
    const saved = h.store.jobs.get(id)!;
    expect(saved.payload.instructions?.[0]?.keys[3]?.isSigner).toBe(false);
    const promoted = TransactionMessage.decompile(
      VersionedTransaction.deserialize(sent[0]!).message,
    ).instructions[2]!;
    expect(promoted.keys[3]?.isSigner).toBe(true);
    const signature = saved.payload.transaction!.signature;
    const secondTerm = new AbortController();
    await new Keeper({ ...h.options, sender: sender(secondTerm.signal) }).scan(
      secondTerm.signal,
    );
    expect(sent).toHaveLength(2);
    expect(sent[1]!.equals(sent[0]!)).toBe(true);
    expect(h.store.jobs.get(id)!.payload.transaction!.signature).toBe(
      signature,
    );
    expect(h.store.jobs.get(id)!.status).toBe("confirmed");
    expect(h.store.jobs.get(id)!.attempts).toBe(1);
    expect(rpc.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(h.chain.settle).toHaveBeenCalledTimes(1);
  });

  it("refuses a signed journal with no exact original plan", async () => {
    const h = harness();
    const intent = settleIntents(h.pulls[0]!, 2)[0]!;
    const job = await h.store.ensure(intent, chainDate(1000n));
    job.payload.computeUnitLimit = 53000;
    job.payload.transaction = {
      fingerprint: "a".repeat(64),
      signature: "1".repeat(64),
      transactionBase64: "AA==",
      lastValidBlockHeight: 100,
      status: "signed",
    };
    await h.keeper.scan(h.signal);
    expect(
      h.sender.send.mock.calls.some(([request]) => request.job === job.id),
    ).toBe(false);
    expect(job.status).toBe("failed");
    expect(h.hooks.alert).toHaveBeenCalledWith(
      `keeper_job:${job.id}`,
      "job_failed",
      { job: job.id, kind: "settle" },
    );
  });
});

it("follows confirmed jobs through a fork and finality without another plan or duplicate latency", async () => {
  const h = harness();
  const pull = makePull(2, 80n);
  h.pulls.splice(0, h.pulls.length, pull);
  h.snapshot.machine.phase = 1;
  h.snapshot.machine.teamSol = 0n;
  h.ledgerMap.clear();
  const signer = Keypair.generate();
  const sent: Buffer[] = [];
  let observation: "confirmed" | "finalized" | null = null;
  const id = jobId(settleIntents(pull, 2)[0]!);
  const write = vi.spyOn(h.store, "write");
  const rpc: TxRpc = {
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 100,
    })),
    getRecentPrioritizationFees: async () => [{ prioritizationFee: 1 }],
    simulateTransaction: async () => ({ err: null }),
    getBlockHeight: async () => 99,
    getSignatureStatuses: async () => [
      observation === null
        ? null
        : { err: null, confirmationStatus: observation },
    ],
    sendRawTransaction: async (bytes) => {
      sent.push(Buffer.from(bytes));
      observation = "confirmed";
      pull.settledMask = 1;
      return h.store.jobs.get(id)!.payload.transaction!.signature;
    },
  };
  const sender = new TxSender({
    rpc,
    signer: {
      publicKey: signer.publicKey,
      signTransaction: (tx) => tx.sign([signer]),
    },
    role: "keeper",
    assertAuthorized: () => undefined,
    assertLeader: () => undefined,
    journal: h.store,
    sendMaxAttempts: 5,
    backoffBaseMs: 1,
    backoffMaxMs: 1,
    cuMarginBps: 2000,
    maxComputeUnitPriceMicroLamports: 1n,
    sleep: async () => undefined,
  });
  const keeper = new Keeper({ ...h.options, sender });
  await keeper.scan(h.signal);
  expect(h.store.jobs.get(id)!.payload.finalized).toBe(false);
  expect(h.store.jobs.get(id)!.status).toBe("confirmed");
  const signed = h.store.jobs.get(id)!.payload.transaction!;
  // Old confirmed jobs predate the observation marker.
  delete h.store.jobs.get(id)!.payload.confirmationObserved;
  observation = null;
  pull.settledMask = 0;
  h.setNow(1010n);
  await keeper.scan(h.signal);
  expect(
    write.mock.calls.some(
      ([, value]) =>
        value.status === "signed" &&
        value.signature === signed.signature &&
        value.transactionBase64 === signed.transactionBase64,
    ),
  ).toBe(true);
  expect(sent).toHaveLength(2);
  expect(sent[1]!.equals(sent[0]!)).toBe(true);
  expect(h.chain.settle).toHaveBeenCalledTimes(1);
  expect(rpc.getLatestBlockhash).toHaveBeenCalledTimes(1);
  expect(h.hooks.latency).toHaveBeenCalledTimes(1);
  observation = "finalized";
  h.setNow(1020n);
  await keeper.scan(h.signal);
  expect(h.store.jobs.get(id)!.payload.finalized).toBe(true);
  expect(await h.store.due(chainDate(1020n))).toEqual([]);
  expect(sent).toHaveLength(2);
});

it("defers the rest of a close pass when a reveal arrives during the first ledger read", async () => {
  const h = harness();
  h.pulls.splice(0);
  h.snapshot.machine.phase = 1;
  h.snapshot.machine.teamSol = 0n;
  const secondLedger = { ...h.ledger, address: key(), mint: key() };
  h.ledgerMap.set(secondLedger.mint.toBase58(), secondLedger);
  let requested = false;
  let announced = false;
  h.options.shouldYield = () => requested;
  const order: string[] = [];
  vi.mocked(h.chain.closeVaultState).mockImplementation(async (ledger) => {
    order.push(`read:${ledger.mint}`);
    if (!announced) {
      announced = true;
      h.pulls.push(makePull(2, 77n));
      requested = true;
    }
    return { vaultExists: true, payerWritable: true, tokenProgram: key() };
  });
  const send = h.sender.send.getMockImplementation()!;
  h.sender.send.mockImplementation(async (request) => {
    order.push(`send:${h.store.jobs.get(request.job)!.kind}`);
    return send(request);
  });
  await h.keeper.scan(h.signal);
  expect(order).toEqual([`read:${h.ledger.mint}`]);
  expect(h.sender.send).not.toHaveBeenCalled();
  expect(h.chain.closeVaultState).toHaveBeenCalledTimes(1);

  requested = false;
  await h.keeper.scan(h.signal);
  expect(order[1]).toBe("send:settle");
  expect(order.indexOf(`read:${secondLedger.mint}`)).toBeGreaterThan(
    order.indexOf("send:settle"),
  );
  expect(h.pulls[0]!.settledMask).toBe(1);
  expect(h.ledgerMap.size).toBe(0);
  expect(
    vi.mocked(h.chain.scanPulls).mock.calls.map(([status]) => status),
  ).toEqual([2, 1, 2, 1]);
});

it("finishes an in-flight send before yielding and settles the new reveal before the next close", async () => {
  const h = harness();
  h.pulls.splice(0);
  h.snapshot.machine.phase = 1;
  h.snapshot.machine.teamSol = 0n;
  const secondLedger = { ...h.ledger, address: key(), mint: key() };
  h.ledgerMap.set(secondLedger.mint.toBase58(), secondLedger);
  let requested = false;
  let announced = false;
  h.options.shouldYield = () => requested;
  const order: string[] = [];
  const send = h.sender.send.getMockImplementation()!;
  h.sender.send.mockImplementation(async (request) => {
    const job = h.store.jobs.get(request.job)!;
    order.push(job.kind);
    if (job.kind === "close-vault" && !announced) {
      announced = true;
      h.pulls.push(makePull(2, 78n));
      requested = true;
      await Promise.resolve();
      expect(request.signal?.aborted).toBe(false);
    }
    return send(request);
  });
  await h.keeper.scan(h.signal);
  expect(order).toEqual(["close-vault"]);
  expect([...h.store.jobs.values()].map((job) => job.status)).toEqual([
    "confirmed",
    "pending",
  ]);
  requested = false;
  await h.keeper.scan(h.signal);
  expect(order).toEqual(["close-vault", "settle", "close-vault"]);
  expect(h.pulls[0]!.settledMask).toBe(1);
  expect(h.ledgerMap.size).toBe(0);
});

it("requires finalized Machine.next_seq evidence before completing an absent Pull", async () => {
  const h = harness();
  const intent = settleIntents(h.pulls[0]!, 2)[0]!;
  if (intent.kind !== "settle") throw new Error("invalid_fixture");
  const job = await h.store.ensure(intent, chainDate(1000n));
  h.pulls.length = 0;
  vi.mocked(h.chain.pullCompletion).mockImplementation(
    async (_address, commitment) => ({
      pull: null,
      nextSeq: commitment === "finalized" ? 1n : 2n,
    }),
  );
  await h.keeper.scan(h.signal);
  expect(job.status).toBe("confirmed");
  expect(job.payload.finalized).toBe(false);
  expect(h.chain.pullCompletion).toHaveBeenCalledWith(
    new PublicKey(intent.address),
    "finalized",
    h.signal,
  );
  h.setNow(1010n);
  vi.mocked(h.chain.pullCompletion).mockResolvedValue({
    pull: null,
    nextSeq: 2n,
  });
  await h.keeper.scan(h.signal);
  expect(job.payload.finalized).toBe(true);
});

it("finalizes successful exit transactions even when current state is incomplete", async () => {
  const h = harness();
  h.sender.send.mockResolvedValue({
    status: "confirmed",
    signature: "fixture",
    finalized: true,
  });
  await h.keeper.scan(h.signal);
  for (const job of h.store.jobs.values()) {
    if (job.kind === "advance") continue;
    expect(job.status).toBe("confirmed");
    expect(job.payload.finalized).toBe(true);
  }
  expect(await h.store.due(chainDate(1010n))).toEqual([]);
});

it("stops polling a finalized team withdrawal after new revenue arrives", async () => {
  const h = harness();
  h.pulls.length = 0;
  h.ledgerMap.clear();
  h.snapshot.machine.phase = 1;
  const send = h.sender.send.getMockImplementation()!;
  h.sender.send.mockImplementationOnce(async (request) => {
    const result = await send(request);
    await h.store.write(request.job, {
      fingerprint: "a".repeat(64),
      signature: "team-signature",
      transactionBase64: "AA==",
      lastValidBlockHeight: 100,
      status: "confirmed",
      finalized: false,
    });
    return { ...result, finalized: false };
  });
  await h.keeper.scan(h.signal);
  const job = h.store.jobs.get("team-withdraw:0")!;
  expect(job.payload.finalized).toBe(false);
  h.snapshot.machine.teamSol = 2n;
  h.sender.send.mockResolvedValue({
    status: "confirmed",
    signature: "team-signature",
    finalized: true,
  });
  h.setNow(1010n);
  await h.keeper.scan(h.signal);
  expect(job.status).toBe("confirmed");
  expect(job.payload.finalized).toBe(true);
  expect(h.snapshot.machine.teamSol).toBe(2n);
  expect(h.sender.send).toHaveBeenCalledTimes(2);
  expect(h.chain.teamWithdraw).toHaveBeenCalledTimes(1);
  h.setNow(1020n);
  await h.keeper.scan(h.signal);
  expect(await h.store.due(chainDate(1020n))).toEqual([]);
  expect(h.sender.send).toHaveBeenCalledTimes(2);
});

it("rearms a finalized advance no-op at the next scan window", async () => {
  const h = harness();
  h.pulls.length = 0;
  h.ledgerMap.clear();
  h.snapshot.machine.teamSol = 0n;
  h.sender.send.mockResolvedValueOnce({
    status: "confirmed",
    signature: "advance-no-op",
    finalized: true,
  });
  await h.keeper.scan(h.signal);
  const noEffect = h.store.jobs.get("advance:0:1:100")!;
  expect(noEffect.status).toBe("skipped");
  expect(noEffect.last_error).toBe("no_effect");
  expect(h.snapshot.machine.phase).toBe(0);
  h.setNow(1009n);
  await h.keeper.scan(h.signal);
  expect(h.sender.send).toHaveBeenCalledTimes(1);
  h.setNow(1010n);
  await h.keeper.scan(h.signal);
  expect(h.sender.send.mock.calls.map(([request]) => request.job)).toEqual([
    "advance:0:1:100",
    "advance:0:1:101",
  ]);
  const advanced = h.store.jobs.get("advance:0:1:101")!;
  expect(advanced.status).toBe("confirmed");
  expect(advanced.payload.finalized).toBe(true);
  expect(h.snapshot.machine.phase).toBe(1);
  h.setNow(1020n);
  await h.keeper.scan(h.signal);
  expect(h.sender.send).toHaveBeenCalledTimes(2);
});

it("keeps legacy advance payloads readable while new windows use distinct job IDs", () => {
  const legacy = intentSchema.parse({ kind: "advance", from: 0, to: 1 });
  expect(jobId(legacy)).toBe("advance:0:1");
  expect(jobId(intentSchema.parse({ ...legacy, window: "100" }))).toBe(
    "advance:0:1:100",
  );
});

it("still requires finalized completion for a reconciled job", async () => {
  const h = harness();
  h.sender.send.mockResolvedValue({ status: "reconciled" });
  await h.keeper.scan(h.signal);
  const job = h.store.jobs.get("settle:1:0,1")!;
  expect(job.status).toBe("confirmed");
  expect(job.payload.finalized).toBe(false);
  expect(h.chain.pullCompletion).toHaveBeenCalledWith(
    h.pulls[0]!.address,
    "finalized",
    h.signal,
  );
});

it("skips an unneeded fresh rebuild without an error or signing attempt", async () => {
  const h = harness();
  h.sender.send.mockImplementation(async (request) => {
    if (request.job === "settle:1:0,1") {
      h.pulls.length = 0;
      expect(
        await request.rebuild!({
          reason: "expired",
          previous: {} as SignedTxRecord,
          signal: h.signal,
        }),
      ).toBeNull();
      return { status: "skipped" };
    }
    return { status: "confirmed", signature: "fixture", finalized: false };
  });
  await h.keeper.scan(h.signal);
  const job = h.store.jobs.get("settle:1:0,1")!;
  expect(job.status).toBe("skipped");
  expect(job.attempts).toBe(0);
  expect(h.hooks.alert).not.toHaveBeenCalledWith(
    `keeper_job:${job.id}`,
    expect.anything(),
    expect.anything(),
  );
});

it("skips a fresh settle whose reveal reverted before instruction construction", async () => {
  const h = harness();
  const pull = makePull(2, 9n);
  h.pulls.splice(0, h.pulls.length, pull);
  h.snapshot.machine.phase = 1;
  h.snapshot.machine.teamSol = 0n;
  h.ledgerMap.clear();
  vi.mocked(h.chain.pull)
    .mockResolvedValueOnce(pull)
    .mockResolvedValue({ ...pull, status: 1 });
  await h.keeper.scan(h.signal);
  const job = h.store.jobs.get("settle:9:0")!;
  expect(job.status).toBe("skipped");
  expect(job.attempts).toBe(0);
  expect(h.sender.send).not.toHaveBeenCalled();
  expect(h.hooks.alert).not.toHaveBeenCalled();
});

describe("launch phase fee integration", () => {
  it("keeps existing exits and plain maintenance independent of an unavailable launch LUT", async () => {
    const h = harness();
    h.options.lookupTables = vi.fn(async () => {
      throw new Error("fee_lookup_table_unavailable");
    });
    await h.keeper.scan(h.signal);
    expect(h.options.lookupTables).not.toHaveBeenCalled();
    expect(h.sender.send).toHaveBeenCalledTimes(6);
    expect(
      h.sender.send.mock.calls.every(
        ([request]) => request.lookupTables === undefined,
      ),
    ).toBe(true);
    expect(
      [...h.store.jobs.values()].every((job) => job.status === "confirmed"),
    ).toBe(true);
  });
  it("a missing launch LUT blocks the atomic OnAir job while settle and refund continue", async () => {
    const h = harness();
    h.snapshot.machine.phase = 2;
    h.setNow(2000n);
    h.options.lookupTables = vi.fn(async () => {
      throw new Error("fee_lookup_table_unavailable");
    });
    h.options.fees = {
      discover: vi.fn(async () => undefined),
      complete: vi.fn(async () => false),
      instructions: vi.fn(async () => [h.chain.advance()]),
    };
    await h.keeper.scan(h.signal);
    expect(h.options.lookupTables).toHaveBeenCalledOnce();
    expect(h.store.jobs.get("advance:2:3:200")!.status).toBe("failed");
    expect(
      [...h.store.jobs.values()]
        .filter((job) => job.kind === "settle" || job.kind === "refund")
        .every((job) => job.status === "confirmed"),
    ).toBe(true);
    expect(
      h.sender.send.mock.calls.some(([request]) =>
        request.job.startsWith("advance:"),
      ),
    ).toBe(false);
  });
  function season() {
    const h = harness();
    h.pulls.length = 0;
    h.ledgerMap.clear();
    h.snapshot.machine.teamSol = 0n;
    const collection = new TransactionInstruction({
      programId: key(),
      keys: [],
      data: Buffer.from("collection"),
    });
    const fees = {
      discover: vi.fn(async (now: bigint) => {
        if (h.snapshot.machine.phase >= 4)
          await h.store.ensure(
            {
              kind: "fee-chain",
              season: "100",
              reason: "buys-closed",
              window: "3000",
            },
            chainDate(now),
          );
      }),
      instructions: vi.fn(async (intent: KeeperIntent) =>
        intent.kind === "advance"
          ? [collection, h.chain.advance()]
          : [collection],
      ),
      complete: vi.fn(async () => false),
    };
    h.options.fees = fees;
    return { ...h, fees, collection };
  }
  it("sends collection and OnAir advance together even without a periodic fee job", async () => {
    const h = season();
    h.snapshot.machine.phase = 2;
    h.setNow(2000n);
    await h.keeper.scan(h.signal);
    expect(h.sender.send).toHaveBeenCalledOnce();
    const request = h.sender.send.mock.calls[0]![0];
    expect(
      request.instructions.map((instruction) => instruction.data.toString()),
    ).toEqual(["collection", "advance"]);
    expect(h.snapshot.machine.phase).toBe(3);
    expect(h.fees.instructions).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "advance", from: 2, to: 3 }),
      2000n,
      h.signal,
    );
  });
  it("closes buys first and collects under the new phase within the same scan", async () => {
    const h = season();
    h.snapshot.machine.phase = 3;
    h.setNow(3000n);
    await h.keeper.scan(h.signal);
    expect(h.sender.send.mock.calls.map(([request]) => request.job)).toEqual([
      "advance:3:4:300",
      "fee-chain:100:buys-closed:3000",
    ]);
    expect(
      h.sender.send.mock.calls[0]![0].instructions.map((instruction) =>
        instruction.data.toString(),
      ),
    ).toEqual(["advance"]);
    expect(h.snapshot.machine.phase).toBe(4);
    h.setNow(1_000_000n);
    await h.keeper.scan(h.signal);
    expect(
      [...h.store.jobs.values()].every(
        (job) => job.kind === "advance" || job.kind === "fee-chain",
      ),
    ).toBe(true);
    expect(h.snapshot.machine.phase).toBe(4);
  });
});
