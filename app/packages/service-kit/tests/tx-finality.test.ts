import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { RpcError } from "../src/rpc.js";
import {
  TxSender,
  type SignedTxRecord,
  type TxInstructionPlan,
  type TxJournal,
  type TxRpc,
  type TxSendRequest,
} from "../src/tx.js";

function fixture(maxAttempts = 3) {
  const signer = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const records = new Map<string, SignedTxRecord>();
  const plans = new Map<string, TxInstructionPlan>();
  let attempts = 0;
  let blockhash = 0;
  const trace: string[] = [];
  const journal: TxJournal = {
    read: vi.fn(async (job) => records.get(job) ?? null),
    write: vi.fn(async (job, record, plan) => {
      trace.push(`write:${record.status}`);
      records.set(job, { ...record });
      if (plan) plans.set(job, plan);
    }),
    reserveAttempt: vi.fn(async () => {
      if (attempts >= maxAttempts) return null;
      trace.push("reserve");
      return ++attempts;
    }),
  };
  const rpc = {
    getLatestBlockhash: vi.fn(async () => {
      trace.push("blockhash");
      return {
        blockhash: new PublicKey(Buffer.alloc(32, ++blockhash)).toBase58(),
        lastValidBlockHeight: 100,
      };
    }),
    getRecentPrioritizationFees: vi.fn(async () => [{ prioritizationFee: 1 }]),
    simulateTransaction: vi.fn<TxRpc["simulateTransaction"]>(async () => ({
      err: null,
    })),
    sendRawTransaction: vi.fn<TxRpc["sendRawTransaction"]>(async () => {
      trace.push("send");
      return records.get("settle:finality")!.signature;
    }),
    getSignatureStatuses: vi.fn<TxRpc["getSignatureStatuses"]>(async () => {
      trace.push("history");
      return [{ err: null, confirmationStatus: "confirmed" }];
    }),
    getBlockHeight: vi.fn<TxRpc["getBlockHeight"]>(async () => {
      trace.push("height:finalized");
      return 99;
    }),
  } satisfies TxRpc;
  const request: TxSendRequest = {
    job: "settle:finality",
    computeUnitLimit: 20000,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: recipient,
        lamports: 1n,
      }),
    ],
    isComplete: vi.fn(async (commitment: "confirmed" | "finalized") => {
      trace.push(`complete:${commitment}`);
      return false;
    }),
  };
  const sign = vi.fn((transaction: VersionedTransaction) =>
    transaction.sign([signer]),
  );
  const options = {
    rpc,
    journal,
    role: "keeper" as const,
    signer: { publicKey: signer.publicKey, signTransaction: sign },
    assertAuthorized: () => undefined,
    assertLeader: () => undefined,
    sendMaxAttempts: maxAttempts,
    backoffBaseMs: 1,
    backoffMaxMs: 1,
    cuMarginBps: 0,
    maxComputeUnitPriceMicroLamports: 1n,
    sleep: async () => undefined,
  };
  const freshPlan: TxInstructionPlan = {
    instructions: [
      new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [{ pubkey: recipient, isSigner: false, isWritable: false }],
        data: Buffer.from("new-payee-flags"),
      }),
    ],
    computeUnitLimit: 21000,
  };
  const rebuild = vi.fn<NonNullable<TxSendRequest["rebuild"]>>(async () => {
    trace.push("rebuild");
    return freshPlan;
  });
  return {
    rpc,
    journal,
    request,
    records,
    plans,
    trace,
    sign,
    options,
    freshPlan,
    rebuild,
    attempts: () => attempts,
    sender: new TxSender(options),
  };
}

describe("D21 sender finality and rebuild boundary", () => {
  it("demotes a reverted confirmation to signed and resends exactly the same bytes before expiry", async () => {
    const h = fixture(2);
    await h.sender.send(h.request);
    const prior = { ...h.records.get(h.request.job)! };
    h.rpc.getSignatureStatuses.mockResolvedValue([null]);
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).rejects.toMatchObject({ code: "transaction_pending" });
    expect(h.records.get(h.request.job)).toEqual({
      ...prior,
      status: "signed",
      finalized: false,
    });
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledTimes(3);
    expect(h.rpc.sendRawTransaction.mock.calls[1]![0]).toEqual(
      h.rpc.sendRawTransaction.mock.calls[0]![0],
    );
    expect(h.sign).toHaveBeenCalledOnce();
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.attempts()).toBe(1);
    h.rpc.getSignatureStatuses.mockResolvedValue([
      { err: null, confirmationStatus: "finalized" },
    ]);
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).resolves.toMatchObject({ status: "confirmed", finalized: true });
    expect(h.records.get(h.request.job)?.finalized).toBe(true);
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledTimes(3);
  });

  it("retains confirmed evidence when the history read itself fails", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    const prior = { ...h.records.get(h.request.job)! };
    h.rpc.getSignatureStatuses.mockRejectedValue(new Error("rpc_unavailable"));
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).rejects.toThrow("rpc_unavailable");
    expect(h.records.get(h.request.job)).toEqual(prior);
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.sign).toHaveBeenCalledOnce();
  });

  it("keeps processed errors and rejected resends ambiguous", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    h.rpc.getSignatureStatuses.mockResolvedValue([
      { err: { InstructionError: [0, 1] }, confirmationStatus: "processed" },
    ]);
    h.rpc.sendRawTransaction.mockRejectedValue(
      new RpcError(-32002, "BlockhashNotFound"),
    );
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).rejects.toMatchObject({ code: "transaction_pending" });
    expect(h.records.get(h.request.job)?.status).toBe("signed");
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.sign).toHaveBeenCalledOnce();
    expect(h.request.isComplete).not.toHaveBeenCalledWith("finalized");
  });

  it("rechecks history after finalized expiry and avoids replacement when confirmation arrives", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    h.rpc.getSignatureStatuses
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([{ err: null, confirmationStatus: "finalized" }]);
    h.rpc.getBlockHeight.mockResolvedValue(101);
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).resolves.toMatchObject({ status: "confirmed", finalized: true });
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.sign).toHaveBeenCalledOnce();
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("reconciles finalized action state before offering an expired record to the callback", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    h.rpc.getSignatureStatuses.mockResolvedValue([null]);
    h.rpc.getBlockHeight.mockResolvedValue(101);
    vi.mocked(h.request.isComplete).mockImplementation(
      async (commitment) => commitment === "finalized",
    );
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).resolves.toMatchObject({ status: "reconciled", finalized: true });
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.sign).toHaveBeenCalledOnce();
  });

  it("rebuilds fresh flags only after finalized expiry, history and finalized reconciliation", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    const old = { ...h.records.get(h.request.job)! };
    h.trace.length = 0;
    h.rpc.getSignatureStatuses.mockImplementation(async () => {
      h.trace.push("history");
      return h.rpc.sendRawTransaction.mock.calls.length > 1
        ? [{ err: null, confirmationStatus: "finalized" }]
        : [null];
    });
    h.rpc.getBlockHeight.mockImplementation(async () => {
      h.trace.push("height:finalized");
      return 101;
    });
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).resolves.toMatchObject({ status: "confirmed", finalized: true });
    expect(h.rebuild).toHaveBeenCalledOnce();
    expect(h.rebuild.mock.calls[0]![0]).toMatchObject({
      reason: "expired",
      previous: { ...old, status: "signed", finalized: false },
    });
    const height = h.trace.indexOf("height:finalized");
    const history = h.trace.indexOf("history", height + 1);
    const final = h.trace.indexOf("complete:finalized", history + 1);
    const rebuild = h.trace.indexOf("rebuild");
    expect(height).toBeGreaterThanOrEqual(0);
    expect(history).toBeGreaterThan(height);
    expect(final).toBeGreaterThan(history);
    expect(rebuild).toBeGreaterThan(final);
    expect(h.trace.indexOf("blockhash")).toBeGreaterThan(rebuild);
    expect(h.records.get(h.request.job)?.fingerprint).not.toBe(old.fingerprint);
    expect(h.records.get(h.request.job)?.signature).not.toBe(old.signature);
    expect(h.plans.get(h.request.job)).toEqual(h.freshPlan);
    expect(h.attempts()).toBe(2);
    const newWrite = vi
      .mocked(h.journal.write)
      .mock.calls.find(
        ([, record, plan]) =>
          record.signature !== old.signature && plan !== undefined,
      );
    expect(newWrite?.[2]).toEqual(h.freshPlan);
  });

  it("preserves old signed bytes and their plan if the fresh-plan callback fails", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    const old = { ...h.records.get(h.request.job)! };
    const plan = h.plans.get(h.request.job);
    h.rpc.getSignatureStatuses.mockResolvedValue([null]);
    h.rpc.getBlockHeight.mockResolvedValue(101);
    h.rebuild.mockRejectedValue(new Error("fresh_read_failed"));
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).rejects.toThrow("fresh_read_failed");
    expect(h.records.get(h.request.job)).toEqual({
      ...old,
      status: "signed",
      finalized: false,
      expired: true,
    });
    expect(h.plans.get(h.request.job)).toBe(plan);
    expect(h.sign).toHaveBeenCalledOnce();
    expect(h.attempts()).toBe(1);
  });

  it("refreshes a finalized failure only after finalized application reconciliation", async () => {
    const h = fixture();
    h.request.rebuild = h.rebuild;
    h.rpc.getSignatureStatuses
      .mockResolvedValueOnce([
        { err: { InstructionError: [0, 1] }, confirmationStatus: "finalized" },
      ])
      .mockResolvedValue([{ err: null, confirmationStatus: "finalized" }]);
    await expect(h.sender.send(h.request)).resolves.toMatchObject({
      status: "confirmed",
      finalized: true,
    });
    expect(h.rebuild.mock.calls[0]![0]).toMatchObject({
      reason: "failed",
      previous: { status: "failed", finalized: true },
    });
    expect(h.trace.indexOf("rebuild")).toBeGreaterThan(
      h.trace.indexOf("complete:finalized"),
    );
    expect(h.attempts()).toBe(2);
    expect(h.plans.get(h.request.job)).toEqual(h.freshPlan);
  });

  it("retains definitive first-submission preflight semantics while refreshing the replacement plan", async () => {
    const h = fixture();
    h.request.rebuild = h.rebuild;
    h.rpc.sendRawTransaction.mockRejectedValueOnce(
      new RpcError(-32002, { InstructionError: [0, 1] }),
    );
    await expect(h.sender.send(h.request)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(h.rebuild).toHaveBeenCalledOnce();
    expect(h.rebuild.mock.calls[0]![0].reason).toBe("failed");
    expect(h.rpc.getBlockHeight).not.toHaveBeenCalled();
    expect(h.trace.indexOf("rebuild")).toBeGreaterThan(
      h.trace.indexOf("complete:finalized"),
    );
    expect(h.attempts()).toBe(2);
  });

  it("does not sign a replacement or reset attempts after the shared budget is exhausted", async () => {
    const h = fixture(1);
    await h.sender.send(h.request);
    h.rpc.getSignatureStatuses.mockResolvedValue([null]);
    h.rpc.getBlockHeight.mockResolvedValue(101);
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).rejects.toMatchObject({ code: "transaction_pending" });
    expect(h.rebuild).toHaveBeenCalledOnce();
    expect(h.records.get(h.request.job)?.expired).toBe(true);
    expect(h.attempts()).toBe(1);
    expect(h.sign).toHaveBeenCalledOnce();
    h.rpc.getSignatureStatuses.mockResolvedValue([
      { err: null, confirmationStatus: "finalized" },
    ]);
    await expect(
      new TxSender(h.options).send(h.request),
    ).resolves.toMatchObject({
      status: "confirmed",
      finalized: true,
    });
    expect(h.records.get(h.request.job)?.expired).toBeUndefined();
    expect(h.sign).toHaveBeenCalledOnce();
  });
});

describe("sender reconciliation without submission", () => {
  async function persisted() {
    const h = fixture();
    await h.sender.send(h.request);
    return h;
  }

  function expectNoSubmission(h: ReturnType<typeof fixture>) {
    // These calls belong only to the original transaction used by the fixture.
    expect(h.rpc.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(h.rpc.getRecentPrioritizationFees).toHaveBeenCalledOnce();
    expect(h.rpc.simulateTransaction).toHaveBeenCalledOnce();
    expect(h.journal.reserveAttempt).toHaveBeenCalledOnce();
    expect(h.sign).toHaveBeenCalledOnce();
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledOnce();
    expect(h.rebuild).not.toHaveBeenCalled();
  }

  it("refuses absent signed evidence even when the business state looks complete", async () => {
    const h = fixture();
    vi.mocked(h.request.isComplete).mockResolvedValue(true);
    await expect(
      h.sender.send({ ...h.request, reconcileOnly: true }),
    ).rejects.toMatchObject({ code: "transaction_pending" });
    expect(h.request.isComplete).not.toHaveBeenCalled();
    expect(h.rpc.getLatestBlockhash).not.toHaveBeenCalled();
    expect(h.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(h.journal.reserveAttempt).not.toHaveBeenCalled();
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("returns finalized receipt status without rebuilding or replaying", async () => {
    const h = await persisted();
    h.rpc.getSignatureStatuses.mockResolvedValue([
      { err: null, confirmationStatus: "finalized" },
    ]);
    await expect(
      h.sender.send({ ...h.request, reconcileOnly: true, rebuild: h.rebuild }),
    ).resolves.toEqual({
      status: "confirmed",
      signature: h.records.get(h.request.job)!.signature,
      finalized: true,
    });
    expectNoSubmission(h);
  });

  it.each(["missing", "confirmed_error"] as const)(
    "preserves ambiguous %s history without replaying its bytes",
    async (history) => {
      const h = await persisted();
      const original = { ...h.records.get(h.request.job)! };
      h.rpc.getSignatureStatuses.mockResolvedValue([
        history === "missing"
          ? null
          : {
              err: { InstructionError: [0, "Custom"] },
              confirmationStatus: "confirmed",
            },
      ]);
      await expect(
        h.sender.send({
          ...h.request,
          reconcileOnly: true,
          rebuild: h.rebuild,
        }),
      ).rejects.toMatchObject({
        code: "transaction_pending",
        signature: original.signature,
      });
      expect(h.records.get(h.request.job)).toEqual({
        ...original,
        status: "signed",
        finalized: false,
      });
      expectNoSubmission(h);
    },
  );

  it("retires an expired signature only after finalized height and a final history read", async () => {
    const h = await persisted();
    const original = { ...h.records.get(h.request.job)! };
    h.rpc.getSignatureStatuses.mockClear().mockImplementation(async () => {
      h.trace.push("history");
      return [null];
    });
    h.rpc.getBlockHeight.mockImplementation(async () => {
      h.trace.push("height:finalized");
      return 101;
    });
    h.trace.length = 0;
    await expect(
      h.sender.send({ ...h.request, reconcileOnly: true, rebuild: h.rebuild }),
    ).resolves.toEqual({ status: "skipped", signature: original.signature });
    expect(h.rpc.getSignatureStatuses).toHaveBeenCalledTimes(2);
    expect(
      h.trace.filter((step) => ["history", "height:finalized"].includes(step)),
    ).toEqual(["history", "height:finalized", "history"]);
    expect(h.records.get(h.request.job)?.expired).toBe(true);
    expectNoSubmission(h);
  });

  it("retires a finalized failure without creating a replacement", async () => {
    const h = await persisted();
    const original = h.records.get(h.request.job)!;
    h.rpc.getSignatureStatuses.mockResolvedValue([
      {
        err: { InstructionError: [0, "Custom"] },
        confirmationStatus: "finalized",
      },
    ]);
    await expect(
      h.sender.send({ ...h.request, reconcileOnly: true, rebuild: h.rebuild }),
    ).resolves.toEqual({ status: "skipped", signature: original.signature });
    expect(h.records.get(h.request.job)).toMatchObject({
      status: "failed",
      finalized: true,
    });
    expectNoSubmission(h);
  });

  it("does not turn unavailable history into replacement permission", async () => {
    const h = await persisted();
    h.rpc.getSignatureStatuses.mockRejectedValue(new Error("rpc_unavailable"));
    await expect(
      h.sender.send({ ...h.request, reconcileOnly: true, rebuild: h.rebuild }),
    ).rejects.toThrow("rpc_unavailable");
    expectNoSubmission(h);
  });

  it.each([false, true])(
    "refuses to share a running request with a different submission mode (first=%s)",
    async (reconcileOnly) => {
      const h = await persisted();
      let release!: () => void;
      h.rpc.getSignatureStatuses.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [{ err: null, confirmationStatus: "finalized" }];
      });
      const first = h.sender.send({ ...h.request, reconcileOnly });
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      await expect(
        h.sender.send({ ...h.request, reconcileOnly: !reconcileOnly }),
      ).rejects.toMatchObject({ code: "job_conflict" });
      release();
      await expect(first).resolves.toMatchObject({
        status: "confirmed",
        finalized: true,
      });
      expectNoSubmission(h);
    },
  );
});

describe("definitive failure evidence", () => {
  it("polls a confirmed error without replacement or new send attempts until failure finalizes", async () => {
    const h = fixture();
    h.rpc.getSignatureStatuses.mockResolvedValue([
      { err: { InstructionError: [0, 1] }, confirmationStatus: "confirmed" },
    ]);
    await expect(
      h.sender.send({ ...h.request, rebuild: h.rebuild }),
    ).rejects.toMatchObject({ code: "transaction_pending" });
    const prior = { ...h.records.get(h.request.job)! };
    expect(prior.status).toBe("signed");
    expect(prior.failureProof).toBeUndefined();
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledOnce();
    expect(h.attempts()).toBe(1);
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.sign).toHaveBeenCalledOnce();
    expect(h.request.isComplete).not.toHaveBeenCalledWith("finalized");
    h.rpc.getSignatureStatuses
      .mockResolvedValueOnce([
        { err: { InstructionError: [0, 1] }, confirmationStatus: "finalized" },
      ])
      .mockResolvedValue([{ err: null, confirmationStatus: "finalized" }]);
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).resolves.toMatchObject({ status: "confirmed", finalized: true });
    expect(h.rebuild).toHaveBeenCalledOnce();
    expect(h.rebuild.mock.calls[0]![0]).toMatchObject({
      reason: "failed",
      previous: { signature: prior.signature, finalized: true },
    });
    expect(h.attempts()).toBe(2);
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
  });

  it("rechecks and demotes a legacy failed record with no definitive proof", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    const previous = {
      ...h.records.get(h.request.job)!,
      status: "failed" as const,
    };
    h.records.set(h.request.job, previous);
    h.rpc.getSignatureStatuses.mockResolvedValue([null]);
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).rejects.toMatchObject({ code: "transaction_pending" });
    expect(h.records.get(h.request.job)).toEqual({
      ...previous,
      status: "signed",
      finalized: false,
    });
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.sign).toHaveBeenCalledOnce();
    for (const [bytes] of h.rpc.sendRawTransaction.mock.calls)
      expect(Buffer.from(bytes).toString("base64")).toBe(
        previous.transactionBase64,
      );
    h.rpc.getSignatureStatuses.mockResolvedValue([
      { err: null, confirmationStatus: "finalized" },
    ]);
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).resolves.toMatchObject({ status: "confirmed", finalized: true });
  });

  it("persists first-submission preflight proof for a safe replacement after restart", async () => {
    const h = fixture();
    h.rpc.sendRawTransaction.mockRejectedValueOnce(
      new RpcError(-32002, { InstructionError: [0, 1] }),
    );
    vi.mocked(h.request.isComplete)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("reconcile_unavailable"));
    await expect(
      h.sender.send({ ...h.request, rebuild: h.rebuild }),
    ).rejects.toThrow("reconcile_unavailable");
    const previous = { ...h.records.get(h.request.job)! };
    expect(previous).toMatchObject({
      status: "failed",
      failureProof: "preflight",
      finalized: false,
    });
    expect(h.rpc.getSignatureStatuses).not.toHaveBeenCalled();
    vi.mocked(h.request.isComplete).mockResolvedValue(false);
    await expect(
      new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
    ).resolves.toMatchObject({ status: "confirmed" });
    expect(h.rebuild.mock.calls[0]![0]).toMatchObject({
      reason: "failed",
      previous,
    });
    expect(h.records.get(h.request.job)?.failureProof).toBeUndefined();
    expect(h.attempts()).toBe(2);
    expect(h.rpc.getBlockHeight).not.toHaveBeenCalled();
  });
});

describe("D23 durable signature budget", () => {
  it.each([99, 100])(
    "resends one live signature at height %s then rebuilds exactly once after finalized expiry",
    async (height) => {
      const h = fixture(2);
      h.rpc.getSignatureStatuses.mockResolvedValue([null]);
      h.rpc.getBlockHeight.mockResolvedValue(height);
      await expect(
        h.sender.send({ ...h.request, rebuild: h.rebuild }),
      ).rejects.toMatchObject({ code: "transaction_pending" });
      const first = { ...h.records.get(h.request.job)! };
      expect(h.attempts()).toBe(1);
      expect(h.rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
      expect(h.rebuild).not.toHaveBeenCalled();
      expect(first.expired).toBeUndefined();
      expect(
        new Set(
          h.rpc.sendRawTransaction.mock.calls.map(([bytes]) =>
            Buffer.from(bytes).toString("base64"),
          ),
        ).size,
      ).toBe(1);

      h.rpc.getBlockHeight.mockResolvedValue(101);
      h.rpc.getSignatureStatuses.mockImplementation(async () =>
        h.sign.mock.calls.length === 2
          ? [{ err: null, confirmationStatus: "finalized" }]
          : [null],
      );
      await expect(
        new TxSender(h.options).send({ ...h.request, rebuild: h.rebuild }),
      ).resolves.toMatchObject({ status: "confirmed", finalized: true });
      expect(h.attempts()).toBe(2);
      expect(h.journal.reserveAttempt).toHaveBeenCalledTimes(2);
      expect(h.rebuild).toHaveBeenCalledOnce();
      expect(h.rebuild.mock.calls[0]![0]).toMatchObject({
        reason: "expired",
        previous: { signature: first.signature, expired: true },
      });
      expect(h.sign).toHaveBeenCalledTimes(2);
      expect(h.rpc.sendRawTransaction).toHaveBeenCalledTimes(3);
      expect(h.records.get(h.request.job)?.signature).not.toBe(first.signature);
      expect(h.records.get(h.request.job)?.expired).toBeUndefined();
    },
  );

  it("confirms at three seconds with one durable attempt despite repeated sends", async () => {
    const h = fixture(5);
    let elapsed = 0;
    const sender = new TxSender({
      ...h.options,
      backoffBaseMs: 1_000,
      backoffMaxMs: 1_000,
      sleep: async (milliseconds) => {
        elapsed += milliseconds;
      },
    });
    h.rpc.getSignatureStatuses.mockImplementation(async () =>
      elapsed >= 3_000
        ? [{ err: null, confirmationStatus: "confirmed" }]
        : [null],
    );
    await expect(sender.send(h.request)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(elapsed).toBe(3_000);
    expect(h.attempts()).toBe(1);
    expect(h.sign).toHaveBeenCalledOnce();
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledTimes(3);
  });

  it("polls a live record while application completion is confirmed without replaying", async () => {
    const h = fixture();
    h.rpc.getSignatureStatuses.mockRejectedValueOnce(
      new Error("rpc_unavailable"),
    );
    await expect(h.sender.send(h.request)).rejects.toThrow("rpc_unavailable");
    const first = { ...h.records.get(h.request.job)! };
    h.rpc.getSignatureStatuses.mockResolvedValue([null]);
    vi.mocked(h.request.isComplete).mockImplementation(
      async (commitment) => commitment === "confirmed",
    );
    await expect(new TxSender(h.options).send(h.request)).rejects.toMatchObject(
      {
        code: "transaction_pending",
        signature: first.signature,
      },
    );
    expect(h.attempts()).toBe(1);
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledOnce();
    expect(h.records.get(h.request.job)).toEqual(first);
    vi.mocked(h.request.isComplete).mockResolvedValue(true);
    await expect(new TxSender(h.options).send(h.request)).resolves.toEqual({
      status: "reconciled",
      signature: first.signature,
      finalized: true,
    });
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("skips fresh work no longer needed after safe expiry without reserving or clearing evidence", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    const first = { ...h.records.get(h.request.job)! };
    h.rpc.getSignatureStatuses.mockResolvedValue([null]);
    h.rpc.getBlockHeight.mockResolvedValue(101);
    h.rebuild.mockResolvedValue(null);
    await expect(
      new TxSender(h.options).send({
        ...h.request,
        rebuild: h.rebuild,
      }),
    ).resolves.toEqual({ status: "skipped", signature: first.signature });
    expect(h.records.get(h.request.job)).toEqual({
      ...first,
      status: "signed",
      finalized: false,
      expired: true,
    });
    expect(h.attempts()).toBe(1);
    expect(h.sign).toHaveBeenCalledOnce();
    expect(h.rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("reserves only after simulation succeeds and before signing and persisting", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    const simulation = h.rpc.simulateTransaction.mock.invocationCallOrder[0]!;
    const reservation = vi.mocked(h.journal.reserveAttempt).mock
      .invocationCallOrder[0]!;
    const signature = h.sign.mock.invocationCallOrder[0]!;
    const persisted = vi.mocked(h.journal.write).mock.invocationCallOrder[0]!;
    const sent = h.rpc.sendRawTransaction.mock.invocationCallOrder[0]!;
    expect(simulation).toBeLessThan(reservation);
    expect(reservation).toBeLessThan(signature);
    expect(signature).toBeLessThan(persisted);
    expect(persisted).toBeLessThan(sent);
  });
});
