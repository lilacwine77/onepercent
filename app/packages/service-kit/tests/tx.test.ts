import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import { RpcError } from "../src/rpc.js";
import {
  computePriorityFeeLamports,
  createTxRpc,
  priorityPrice,
  signedTxPayer,
  TxSender,
  type SignedTxRecord,
  type TxJournal,
  type TxRpc,
  type TxSendRequest,
  type TxSenderOptions,
} from "../src/tx.js";

function fixture(overrides: Partial<TxSenderOptions> = {}) {
  const keypair = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const records = new Map<string, SignedTxRecord>();
  const attempts = new Map<string, number>();
  const journal: TxJournal = {
    read: vi.fn(async (job) => records.get(job) ?? null),
    write: vi.fn(async (job, record) => {
      records.set(job, { ...record });
    }),
    reserveAttempt: vi.fn(async (job, maxAttempts) => {
      const count = attempts.get(job) ?? 0;
      if (count >= maxAttempts) return null;
      attempts.set(job, count + 1);
      return count + 1;
    }),
  };
  const rpc = {
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    })),
    getRecentPrioritizationFees: vi.fn(async () => [
      { prioritizationFee: 1 },
      { prioritizationFee: 6 },
      { prioritizationFee: 4 },
      { prioritizationFee: 3 },
    ]),
    simulateTransaction: vi.fn<TxRpc["simulateTransaction"]>(async () => ({
      err: null,
    })),
    sendRawTransaction: vi.fn<TxRpc["sendRawTransaction"]>(async () => {
      return records.get("settle:fixture")!.signature;
    }),
    getSignatureStatuses: vi.fn<TxRpc["getSignatureStatuses"]>(async () => [
      { err: null, confirmationStatus: "confirmed" },
    ]),
    getBlockHeight: vi.fn<TxRpc["getBlockHeight"]>(async () => 99),
  } satisfies TxRpc;
  const options: TxSenderOptions = {
    role: "keeper",
    rpc,
    signer: {
      publicKey: keypair.publicKey,
      signTransaction: vi.fn((tx) => tx.sign([keypair])),
    },
    assertAuthorized: vi.fn(),
    assertLeader: vi.fn(),
    journal,
    sendMaxAttempts: 3,
    backoffBaseMs: 500,
    backoffMaxMs: 30_000,
    cuMarginBps: 2_000,
    maxComputeUnitPriceMicroLamports: 3n,
    sleep: vi.fn(async () => {}),
    random: () => 0.5,
    ...overrides,
  };
  const request: TxSendRequest = {
    job: "settle:fixture",
    computeUnitLimit: 20_000,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: recipient,
        lamports: 1n,
      }),
    ],
    isComplete: vi.fn(async () => false),
  };
  return {
    options,
    request,
    rpc,
    records,
    attempts,
    journal,
    keypair,
    recipient,
    sender: new TxSender(options),
  };
}

describe("TxSender", () => {
  it("derives a historical payer from verified signed bytes", async () => {
    const h = fixture();
    await h.sender.send(h.request);
    expect(signedTxPayer(h.records.get(h.request.job)!)).toEqual(
      h.keypair.publicKey,
    );
  });

  it.each(["signature", "payer", "message", "trailing"] as const)(
    "refuses historical ownership with altered %s evidence",
    async (mutation) => {
      const h = fixture();
      await h.sender.send(h.request);
      const record = { ...h.records.get(h.request.job)! };
      const original = Buffer.from(record.transactionBase64, "base64");
      const transaction = VersionedTransaction.deserialize(original);
      if (mutation === "signature") {
        transaction.signatures[0]!.fill(0);
        record.signature = bs58.encode(transaction.signatures[0]!);
      }
      if (mutation === "payer")
        transaction.message.staticAccountKeys[0] = Keypair.generate().publicKey;
      if (mutation === "message")
        transaction.message.recentBlockhash =
          Keypair.generate().publicKey.toBase58();
      record.transactionBase64 = (
        mutation === "trailing"
          ? Buffer.concat([original, Buffer.from([0])])
          : Buffer.from(transaction.serialize())
      ).toString("base64");
      expect(() => signedTxPayer(record)).toThrow("invalid_record");
    },
  );

  it("compares replay intent after global account privileges are compiled", async () => {
    const context = fixture();
    context.request.instructions = [
      ...context.request.instructions,
      new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [
          { pubkey: context.recipient, isSigner: false, isWritable: false },
        ],
        data: Buffer.alloc(0),
      }),
    ];
    await expect(context.sender.send(context.request)).resolves.toMatchObject({
      status: "confirmed",
    });
    await expect(
      new TxSender(context.options).send(context.request),
    ).resolves.toMatchObject({ status: "confirmed" });
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });
  it("builds and simulates v0, persists before send and confirms its own signature", async () => {
    const context = fixture();
    const result = await context.sender.send(context.request);
    expect(result).toEqual({
      status: "confirmed",
      signature: context.records.get(context.request.job)!.signature,
    });
    const bytes = context.rpc.sendRawTransaction.mock.calls[0]![0];
    const tx = VersionedTransaction.deserialize(bytes);
    expect(tx.version).toBe(0);
    expect(tx.signatures[0]!.some((byte) => byte !== 0)).toBe(true);
    const message = TransactionMessage.decompile(tx.message);
    expect(
      ComputeBudgetInstruction.decodeSetComputeUnitLimit(
        message.instructions[0]!,
      ).units,
    ).toBe(24_000);
    expect(
      ComputeBudgetInstruction.decodeSetComputeUnitPrice(
        message.instructions[1]!,
      ).microLamports,
    ).toBe(3n);
    expect(context.rpc.getRecentPrioritizationFees).toHaveBeenCalledWith(
      [
        context.keypair.publicKey.toBase58(),
        context.recipient.toBase58(),
      ].sort(),
      undefined,
    );
    expect(context.rpc.simulateTransaction).toHaveBeenCalledOnce();
    expect(
      vi.mocked(context.journal.write).mock.invocationCallOrder[0],
    ).toBeLessThan(context.rpc.sendRawTransaction.mock.invocationCallOrder[0]!);
  });

  it("fails closed while the measured fee cap is pending", async () => {
    const { sender, request, rpc, options } = fixture({
      maxComputeUnitPriceMicroLamports: null,
    });
    await expect(sender.send(request)).rejects.toMatchObject({
      code: "fee_cap_pending",
    });
    expect(rpc.getLatestBlockhash).not.toHaveBeenCalled();
    expect(options.signer.signTransaction).not.toHaveBeenCalled();
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("checks role and leadership before signing after asynchronous simulation", async () => {
    const { sender, request, rpc, options } = fixture();
    let allowed = true;
    options.assertAuthorized = () => {
      if (!allowed) throw new Error("role_disabled");
    };
    rpc.simulateTransaction.mockImplementation(async () => {
      allowed = false;
      return { err: null };
    });
    await expect(sender.send(request)).rejects.toThrow("role_disabled");
    expect(options.signer.signTransaction).not.toHaveBeenCalled();
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("does not send if leadership is lost while the signed record is written", async () => {
    const { sender, request, rpc, options, journal } = fixture();
    let leader = true;
    options.assertLeader = () => {
      if (!leader) throw new Error("not_leader");
    };
    vi.mocked(journal.write).mockImplementation(async () => {
      leader = false;
    });
    await expect(sender.send(request)).rejects.toThrow("not_leader");
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("requires a keeper leader guard", () => {
    expect(() => fixture({ assertLeader: undefined })).toThrow(
      "invalid_request",
    );
  });

  it("does not sign or submit a failed simulation", async () => {
    const { sender, request, rpc, options } = fixture();
    rpc.simulateTransaction.mockResolvedValue({
      err: { InstructionError: [0, 1] },
    });
    await expect(sender.send(request)).rejects.toMatchObject({
      code: "simulation_failed",
    });
    expect(options.signer.signTransaction).not.toHaveBeenCalled();
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("does not send before successful durable recording", async () => {
    const { sender, request, rpc, journal } = fixture();
    vi.mocked(journal.write).mockRejectedValue(
      new Error("database_unavailable"),
    );
    await expect(sender.send(request)).rejects.toThrow("database_unavailable");
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent and subsequent calls by the job and signature", async () => {
    const { sender, request, rpc } = fixture();
    const first = sender.send(request);
    expect(sender.send(request)).toBe(first);
    expect(await sender.send(request)).toEqual(await first);
    expect(await sender.send(request)).toEqual(await first);
    expect(rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("rejects reusing a job identifier for different instructions", async () => {
    const { sender, request } = fixture();
    const original = sender.send(request);
    await expect(
      sender.send({
        ...request,
        computeUnitLimit: request.computeUnitLimit + 1,
      }),
    ).rejects.toMatchObject({ code: "job_conflict" });
    await original;
    await expect(
      sender.send({
        ...request,
        computeUnitLimit: request.computeUnitLimit + 1,
      }),
    ).rejects.toMatchObject({ code: "job_conflict" });
  });

  it("reuses exactly the same bytes when a send response is lost", async () => {
    const { sender, request, rpc } = fixture();
    rpc.sendRawTransaction.mockRejectedValueOnce(
      new Error("connection_closed"),
    );
    rpc.getSignatureStatuses
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([null]);
    await expect(sender.send(request)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(rpc.sendRawTransaction.mock.calls[0]![0]).toEqual(
      rpc.sendRawTransaction.mock.calls[1]![0],
    );
    expect(rpc.getLatestBlockhash).toHaveBeenCalledOnce();
  });

  it("resumes a signed record after restart without signing another transaction", async () => {
    const context = fixture({ sendMaxAttempts: 1 });
    context.rpc.getSignatureStatuses.mockResolvedValue([null]);
    await expect(context.sender.send(context.request)).rejects.toMatchObject({
      code: "transaction_pending",
    });
    const restarted = new TxSender(context.options);
    context.rpc.getSignatureStatuses.mockResolvedValue([
      { err: null, confirmationStatus: "confirmed" },
    ]);
    await expect(restarted.send(context.request)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(context.rpc.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("fails closed on malformed persisted records before any RPC or signing", async () => {
    const context = fixture();
    vi.mocked(context.journal.read).mockResolvedValue({
      status: "signed",
    } as SignedTxRecord);
    await expect(context.sender.send(context.request)).rejects.toMatchObject({
      code: "invalid_record",
    });
    expect(context.rpc.getLatestBlockhash).not.toHaveBeenCalled();
    expect(context.options.signer.signTransaction).not.toHaveBeenCalled();
    expect(context.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects a corrupt stored signature and a signed record with different intent", async () => {
    const context = fixture();
    await context.sender.send(context.request);
    const record = context.records.get(context.request.job)!;
    const tx = VersionedTransaction.deserialize(
      Buffer.from(record.transactionBase64, "base64"),
    );
    tx.signatures[0]![0] = tx.signatures[0]![0]! ^ 1;
    context.records.set(context.request.job, {
      ...record,
      signature: bs58.encode(tx.signatures[0]!),
      transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    });
    await expect(context.sender.send(context.request)).rejects.toMatchObject({
      code: "invalid_record",
    });
    const message = TransactionMessage.decompile(tx.message);
    message.instructions[2] = SystemProgram.transfer({
      fromPubkey: context.keypair.publicKey,
      toPubkey: context.recipient,
      lamports: 2n,
    });
    const changed = new VersionedTransaction(message.compileToV0Message());
    changed.sign([context.keypair]);
    context.records.set(context.request.job, {
      ...record,
      signature: bs58.encode(changed.signatures[0]!),
      transactionBase64: Buffer.from(changed.serialize()).toString("base64"),
    });
    await expect(context.sender.send(context.request)).rejects.toMatchObject({
      code: "job_conflict",
    });
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("rebuilds only after finalized expiry, history recheck and chain reconciliation", async () => {
    const { sender, request, rpc, options } = fixture();
    rpc.getSignatureStatuses
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([null]);
    rpc.getBlockHeight.mockResolvedValue(101);
    await expect(sender.send(request)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(rpc.getLatestBlockhash).toHaveBeenCalledTimes(2);
    expect(rpc.getBlockHeight).toHaveBeenCalledWith("finalized", undefined);
    expect(request.isComplete).toHaveBeenCalledWith("finalized");
    expect(rpc.sendRawTransaction.mock.calls[0]![0]).not.toEqual(
      rpc.sendRawTransaction.mock.calls[1]![0],
    );
    expect(options.signer.signTransaction).toHaveBeenCalledTimes(2);
  });

  it("catches a confirmation arriving between expiry and the final history recheck", async () => {
    const { sender, request, rpc } = fixture();
    rpc.getSignatureStatuses
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([null]);
    rpc.getBlockHeight.mockResolvedValue(101);
    await expect(sender.send(request)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(rpc.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("does not rebuild after chain reconciliation finds a completed action", async () => {
    const { sender, request, rpc } = fixture();
    rpc.getSignatureStatuses.mockResolvedValue([null]);
    rpc.getBlockHeight.mockResolvedValue(101);
    vi.mocked(request.isComplete).mockImplementation(async (commitment) => {
      return commitment === "finalized";
    });
    await expect(sender.send(request)).resolves.toMatchObject({
      status: "reconciled",
    });
    expect(rpc.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("keeps ambiguous results pending and bounds attempts and jitter", async () => {
    const { sender, request, rpc, options, records } = fixture({
      sendMaxAttempts: 4,
      backoffMaxMs: 800,
    });
    rpc.getSignatureStatuses.mockResolvedValue([null]);
    await expect(sender.send(request)).rejects.toMatchObject({
      code: "transaction_pending",
    });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(4);
    expect(options.sleep).toHaveBeenNthCalledWith(1, 500, undefined);
    expect(options.sleep).toHaveBeenNthCalledWith(2, 650, undefined);
    expect(options.sleep).toHaveBeenNthCalledWith(3, 650, undefined);
    expect(records.get(request.job)?.status).toBe("signed");
    expect(rpc.getLatestBlockhash).toHaveBeenCalledOnce();
  });

  it("aborts after leadership is lost during backoff", async () => {
    const { sender, request, rpc, options } = fixture();
    let leader = true;
    options.assertLeader = () => {
      if (!leader) throw new Error("not_leader");
    };
    options.sleep = async () => {
      leader = false;
    };
    rpc.getSignatureStatuses.mockResolvedValue([null]);
    await expect(sender.send(request)).rejects.toThrow("not_leader");
    expect(rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("refuses additional signers and conflicting compute-budget instructions", async () => {
    const { sender, request, rpc } = fixture();
    const foreign = Keypair.generate().publicKey;
    await expect(
      sender.send({
        ...request,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: foreign,
            toPubkey: foreign,
            lamports: 1n,
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      sender.send({
        ...request,
        instructions: [
          ...request.instructions,
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100n }),
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects a provider signature inconsistent with the locally signed bytes", async () => {
    const { sender, request, rpc } = fixture();
    rpc.sendRawTransaction.mockResolvedValue("different-signature");
    await expect(sender.send(request)).rejects.toMatchObject({
      code: "signature_mismatch",
    });
  });

  it("records landed failures and stops rebuilding when the durable budget is exhausted", async () => {
    const { sender, request, rpc } = fixture();
    rpc.getSignatureStatuses.mockResolvedValue([
      { err: { InstructionError: [0, 1] }, confirmationStatus: "finalized" },
    ]);
    await expect(sender.send(request)).rejects.toMatchObject({
      code: "transaction_failed",
    });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(3);
  });

  it("reconciles and rebuilds a landed failure within the same call", async () => {
    const { sender, request, rpc, journal, attempts } = fixture();
    rpc.getSignatureStatuses.mockResolvedValueOnce([
      { err: { InstructionError: [0, 1] }, confirmationStatus: "finalized" },
    ]);
    await expect(sender.send(request)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(
      vi
        .mocked(journal.write)
        .mock.calls.some(([, record]) => record.status === "failed"),
    ).toBe(true);
    expect(request.isComplete).toHaveBeenCalledWith("confirmed");
    expect(rpc.getLatestBlockhash).toHaveBeenCalledTimes(2);
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(attempts.get(request.job)).toBe(2);
  });

  it("recovers a persisted failed record after restart without resetting attempts", async () => {
    const context = fixture();
    context.rpc.getSignatureStatuses.mockResolvedValueOnce([
      { err: { InstructionError: [0, 1] }, confirmationStatus: "finalized" },
    ]);
    vi.mocked(context.request.isComplete)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("reconcile_unavailable"));
    await expect(context.sender.send(context.request)).rejects.toThrow(
      "reconcile_unavailable",
    );
    expect(context.records.get(context.request.job)?.status).toBe("failed");
    const previousSignature = context.records.get(
      context.request.job,
    )?.signature;
    await expect(
      new TxSender(context.options).send(context.request),
    ).resolves.toMatchObject({ status: "confirmed" });
    expect(context.records.get(context.request.job)?.signature).not.toBe(
      previousSignature,
    );
    expect(context.attempts.get(context.request.job)).toBe(2);
  });

  it("replaces expired absent records when a refreshed job has a different fingerprint", async () => {
    const context = fixture();
    context.rpc.getSignatureStatuses.mockRejectedValueOnce(
      new Error("rpc_unavailable"),
    );
    await expect(context.sender.send(context.request)).rejects.toThrow(
      "rpc_unavailable",
    );
    const previousSignature = context.records.get(
      context.request.job,
    )?.signature;
    context.rpc.getSignatureStatuses
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([null]);
    context.rpc.getBlockHeight.mockResolvedValue(101);
    const refreshed = { ...context.request, computeUnitLimit: 30_000 };
    await expect(
      new TxSender(context.options).send(refreshed),
    ).resolves.toMatchObject({ status: "confirmed" });
    expect(refreshed.isComplete).toHaveBeenCalledWith("confirmed");
    expect(context.rpc.getBlockHeight).toHaveBeenCalledWith(
      "finalized",
      undefined,
    );
    expect(context.records.get(context.request.job)?.signature).not.toBe(
      previousSignature,
    );
    expect(context.attempts.get(context.request.job)).toBe(2);
  });

  it("refuses a changed job while the earlier signature can still land", async () => {
    const context = fixture();
    context.rpc.getSignatureStatuses.mockRejectedValueOnce(
      new Error("rpc_unavailable"),
    );
    await expect(context.sender.send(context.request)).rejects.toThrow(
      "rpc_unavailable",
    );
    context.rpc.getSignatureStatuses.mockResolvedValue([null]);
    await expect(
      new TxSender(context.options).send({
        ...context.request,
        computeUnitLimit: 30_000,
      }),
    ).rejects.toMatchObject({ code: "job_conflict" });
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledOnce();
    expect(context.attempts.get(context.request.job)).toBe(1);
  });

  it("shares durable builds while bounded replays across calls and restarts cost no attempts", async () => {
    const context = fixture();
    context.rpc.getSignatureStatuses.mockRejectedValueOnce(
      new Error("rpc_unavailable"),
    );
    await expect(context.sender.send(context.request)).rejects.toThrow(
      "rpc_unavailable",
    );
    expect(context.attempts.get(context.request.job)).toBe(1);
    context.rpc.getSignatureStatuses.mockResolvedValue([null]);
    for (let call = 1; call <= 2; call += 1) {
      await expect(
        new TxSender(context.options).send(context.request),
      ).rejects.toMatchObject({ code: "transaction_pending" });
      expect(context.attempts.get(context.request.job)).toBe(1);
      expect(context.rpc.sendRawTransaction).toHaveBeenCalledTimes(
        1 + call * 3,
      );
    }
    context.rpc.getSignatureStatuses.mockResolvedValue([
      { err: null, confirmationStatus: "confirmed" },
    ]);
    await expect(
      new TxSender(context.options).send(context.request),
    ).resolves.toMatchObject({ status: "confirmed" });
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledTimes(7);
    expect(context.options.signer.signTransaction).toHaveBeenCalledOnce();
    expect(context.journal.reserveAttempt).toHaveBeenCalledOnce();
  });

  it("does not consume signed-record budget for simulations that fail", async () => {
    const context = fixture({ sendMaxAttempts: 2 });
    context.rpc.simulateTransaction.mockResolvedValue({
      err: { InstructionError: [0, 1] },
    });
    for (let i = 0; i < 3; i += 1) {
      await expect(
        new TxSender(context.options).send(context.request),
      ).rejects.toMatchObject({ code: "simulation_failed" });
    }
    expect(context.attempts.get(context.request.job)).toBeUndefined();
    expect(context.journal.reserveAttempt).not.toHaveBeenCalled();
    expect(context.rpc.simulateTransaction).toHaveBeenCalledTimes(3);
    expect(context.options.signer.signTransaction).not.toHaveBeenCalled();
    expect(context.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each([99, 100])(
    "keeps a preflight-rejected resend ambiguous before finalized expiry at height %s",
    async (height) => {
      const context = fixture();
      context.rpc.getSignatureStatuses.mockResolvedValue([null]);
      context.rpc.getBlockHeight.mockResolvedValue(height);
      context.rpc.sendRawTransaction
        .mockRejectedValueOnce(new Error("response_lost"))
        .mockRejectedValue(new RpcError(-32002, "BlockhashNotFound"));

      await expect(context.sender.send(context.request)).rejects.toMatchObject({
        code: "transaction_pending",
      });

      expect(context.rpc.sendRawTransaction).toHaveBeenCalledTimes(3);
      const submitted = context.rpc.sendRawTransaction.mock.calls.map(
        ([bytes]) => Buffer.from(bytes).toString("base64"),
      );
      expect(new Set(submitted).size).toBe(1);
      expect(context.rpc.getLatestBlockhash).toHaveBeenCalledOnce();
      expect(context.options.signer.signTransaction).toHaveBeenCalledOnce();
      expect(context.records.get(context.request.job)?.status).toBe("signed");
      expect(
        vi
          .mocked(context.journal.write)
          .mock.calls.every(([, record]) => record.status === "signed"),
      ).toBe(true);
      expect(context.request.isComplete).not.toHaveBeenCalledWith("finalized");
    },
  );

  it("keeps a stored signed record ambiguous when its first resend after restart is preflight-rejected", async () => {
    const context = fixture();
    context.rpc.sendRawTransaction.mockRejectedValueOnce(
      new Error("response_lost"),
    );
    context.rpc.getSignatureStatuses.mockRejectedValueOnce(
      new Error("rpc_unavailable"),
    );
    await expect(context.sender.send(context.request)).rejects.toThrow(
      "rpc_unavailable",
    );
    const stored = { ...context.records.get(context.request.job)! };
    expect(stored.status).toBe("signed");

    context.rpc.getSignatureStatuses.mockResolvedValue([null]);
    context.rpc.sendRawTransaction.mockRejectedValue(
      new RpcError(-32002, "BlockhashNotFound"),
    );
    await expect(
      new TxSender(context.options).send(context.request),
    ).rejects.toMatchObject({ code: "transaction_pending" });

    expect(context.records.get(context.request.job)).toEqual(stored);
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledTimes(4);
    for (const [bytes] of context.rpc.sendRawTransaction.mock.calls) {
      expect(Buffer.from(bytes).toString("base64")).toBe(
        stored.transactionBase64,
      );
    }
    expect(context.rpc.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(context.options.signer.signTransaction).toHaveBeenCalledOnce();
    expect(context.attempts.get(context.request.job)).toBe(1);
    expect(context.request.isComplete).not.toHaveBeenCalledWith("finalized");
  });

  it.each([false, true])(
    "reconciles finalized state after a rejected resend expires (complete=%s)",
    async (complete) => {
      const context = fixture();
      context.rpc.sendRawTransaction
        .mockRejectedValueOnce(new Error("response_lost"))
        .mockRejectedValueOnce(new RpcError(-32002, "BlockhashNotFound"));
      context.rpc.getSignatureStatuses.mockImplementation(async () =>
        context.rpc.sendRawTransaction.mock.calls.length >= 3
          ? [{ err: null, confirmationStatus: "confirmed" }]
          : [null],
      );
      context.rpc.getBlockHeight
        .mockResolvedValueOnce(99)
        .mockResolvedValue(101);
      vi.mocked(context.request.isComplete).mockImplementation(
        async (commitment) => commitment === "finalized" && complete,
      );

      await expect(context.sender.send(context.request)).resolves.toMatchObject(
        { status: complete ? "reconciled" : "confirmed" },
      );
      expect(
        context.rpc.getBlockHeight.mock.calls.every(
          ([commitment]) => commitment === "finalized",
        ),
      ).toBe(true);
      expect(context.request.isComplete).toHaveBeenCalledWith("finalized");
      const expiredHeightRead =
        context.rpc.getBlockHeight.mock.invocationCallOrder[1]!;
      const historyRecheck =
        context.rpc.getSignatureStatuses.mock.invocationCallOrder[4]!;
      const finalCheckIndex = vi
        .mocked(context.request.isComplete)
        .mock.calls.findIndex(([commitment]) => commitment === "finalized");
      const completeCheck = vi.mocked(context.request.isComplete).mock
        .invocationCallOrder[finalCheckIndex]!;
      expect(historyRecheck).toBeGreaterThan(expiredHeightRead);
      expect(completeCheck).toBeGreaterThan(historyRecheck);
      expect(context.rpc.getLatestBlockhash).toHaveBeenCalledTimes(
        complete ? 1 : 2,
      );
      expect(context.rpc.sendRawTransaction).toHaveBeenCalledTimes(
        complete ? 2 : 3,
      );
      if (!complete) {
        expect(
          context.rpc.getLatestBlockhash.mock.invocationCallOrder[1]!,
        ).toBeGreaterThan(completeCheck);
        expect(context.rpc.sendRawTransaction.mock.calls[2]![0]).not.toEqual(
          context.rpc.sendRawTransaction.mock.calls[0]![0],
        );
      }
    },
  );

  it("persists a first-submission preflight rejection as definitive without ambiguous signature polling", async () => {
    const context = fixture({ sendMaxAttempts: 1 });
    context.rpc.sendRawTransaction.mockRejectedValue(
      new RpcError(-32002, { InstructionError: [0, 1] }),
    );
    await expect(context.sender.send(context.request)).rejects.toMatchObject({
      code: "transaction_failed",
    });
    expect(context.records.get(context.request.job)?.status).toBe("failed");
    expect(context.rpc.getSignatureStatuses).not.toHaveBeenCalled();
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledOnce();
    expect(context.rpc.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(context.rpc.getBlockHeight).not.toHaveBeenCalled();
  });

  it("treats AlreadyProcessed as prior submission and verifies its status before success", async () => {
    const context = fixture();
    context.rpc.sendRawTransaction.mockRejectedValueOnce(
      new RpcError(-32002, "AlreadyProcessed"),
    );
    context.rpc.getSignatureStatuses.mockResolvedValueOnce([null]);
    await expect(context.sender.send(context.request)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledOnce();
    expect(context.rpc.getSignatureStatuses).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(context.journal.write)
        .mock.calls.some(([, record]) => record.status === "failed"),
    ).toBe(false);
  });

  it("keeps AlreadyProcessed pending if history has not verified a landing", async () => {
    const context = fixture();
    context.rpc.sendRawTransaction.mockRejectedValueOnce(
      new RpcError(-32002, "AlreadyProcessed"),
    );
    context.rpc.getSignatureStatuses.mockResolvedValue([null]);
    await expect(context.sender.send(context.request)).rejects.toMatchObject({
      code: "transaction_pending",
    });
    expect(context.records.get(context.request.job)?.status).toBe("signed");
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });
});

describe("transaction fee arithmetic", () => {
  it("uses nearest-rank p75 and applies a bigint cap", () => {
    expect(priorityPrice([], 100n)).toBe(0n);
    expect(
      priorityPrice(
        [90, 10, 50, 40].map((prioritizationFee) => ({ prioritizationFee })),
        100n,
      ),
    ).toBe(50n);
    expect(priorityPrice([{ prioritizationFee: 100 }], 20n)).toBe(20n);
    expect(() => priorityPrice([{ prioritizationFee: 1.5 }], 20n)).toThrow();
    expect(computePriorityFeeLamports(200_000n, 7n)).toBe(2n);
    expect(computePriorityFeeLamports(200_000n, 5n)).toBe(1n);
  });
});

describe("transaction RPC boundary", () => {
  it("uses confirmed blockhashes, full signature history and explicit preflight", async () => {
    const requests: Array<{ method: string; params: unknown[] }> = [];
    const rpc = createTxRpc({
      async request(method, params, schema) {
        requests.push({ method, params });
        const responses: Record<string, unknown> = {
          getLatestBlockhash: {
            value: { blockhash: "fixture-blockhash", lastValidBlockHeight: 9 },
          },
          getSignatureStatuses: { value: [null] },
          sendTransaction: "fixture-signature",
        };
        return schema.parse(responses[method]);
      },
    });
    await rpc.getLatestBlockhash();
    await rpc.getSignatureStatuses(["fixture-signature"]);
    await rpc.sendRawTransaction(new Uint8Array([1]));
    expect(requests).toEqual([
      { method: "getLatestBlockhash", params: [{ commitment: "confirmed" }] },
      {
        method: "getSignatureStatuses",
        params: [["fixture-signature"], { searchTransactionHistory: true }],
      },
      {
        method: "sendTransaction",
        params: [
          "AQ==",
          {
            encoding: "base64",
            preflightCommitment: "confirmed",
            skipPreflight: false,
            maxRetries: 0,
          },
        ],
      },
    ]);
  });

  it("rejects malformed provider fee samples at the RPC boundary", async () => {
    const rpc = createTxRpc({
      async request(_method, _params, schema) {
        return schema.parse([{ prioritizationFee: "1" }]);
      },
    });
    await expect(rpc.getRecentPrioritizationFees([])).rejects.toThrow();
  });
});

describe("explicit migration account signer", () => {
  function migration() {
    const context = fixture();
    const mint = Keypair.generate();
    context.request.instructions = [
      SystemProgram.createAccount({
        fromPubkey: context.keypair.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: 1,
        space: 82,
        programId: SystemProgram.programId,
      }),
    ];
    context.options.signer.signTransaction = vi.fn((tx) =>
      tx.sign([context.keypair, mint]),
    );
    return { ...context, mint };
  }
  it("keeps the default payer-only rule and rejects a duplicate allowlist entry", async () => {
    const context = migration();
    await expect(context.sender.send(context.request)).rejects.toMatchObject({
      code: "invalid_request",
    });
    context.request.additionalSigners = [context.keypair.publicKey];
    await expect(context.sender.send(context.request)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(context.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("persists both verified signatures and restarts without the ephemeral private material", async () => {
    const context = migration();
    context.request.additionalSigners = [context.mint.publicKey];
    await expect(context.sender.send(context.request)).resolves.toMatchObject({
      status: "confirmed",
    });
    const record = context.records.get(context.request.job)!;
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(record.transactionBase64, "base64"),
    );
    expect(transaction.signatures).toHaveLength(2);
    context.options.signer.signTransaction = vi.fn(() => {
      throw new Error("no_new_signing");
    });
    await expect(
      new TxSender(context.options).send(context.request),
    ).resolves.toMatchObject({ status: "confirmed" });
    expect(context.options.signer.signTransaction).not.toHaveBeenCalled();
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledOnce();
    transaction.signatures[1]!.fill(0);
    context.records.set(context.request.job, {
      ...record,
      transactionBase64: Buffer.from(transaction.serialize()).toString(
        "base64",
      ),
    });
    await expect(
      new TxSender(context.options).send(context.request),
    ).rejects.toMatchObject({ code: "invalid_record" });
  });
  it("rejects an unlisted signer in a valid persisted transaction", async () => {
    const context = migration();
    context.request.additionalSigners = [context.mint.publicKey];
    await context.sender.send(context.request);
    context.request.additionalSigners = [Keypair.generate().publicKey];
    await expect(
      new TxSender(context.options).send(context.request),
    ).rejects.toMatchObject({ code: "invalid_record" });
    expect(context.rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });
  it("replaces the disposable signer only after finalized expiry, history and state reconciliation", async () => {
    const context = migration();
    context.request.additionalSigners = [context.mint.publicKey];
    context.rpc.getSignatureStatuses
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([null]);
    context.rpc.getBlockHeight.mockResolvedValue(101);
    const replacement = Keypair.generate();
    context.request.rebuild = vi.fn(async () => {
      expect(context.rpc.getBlockHeight).toHaveBeenCalledWith(
        "finalized",
        undefined,
      );
      expect(context.rpc.getSignatureStatuses).toHaveBeenCalledTimes(3);
      expect(context.request.isComplete).toHaveBeenCalledWith("finalized");
      context.options.signer.signTransaction = vi.fn((tx) =>
        tx.sign([context.keypair, replacement]),
      );
      return {
        instructions: [
          SystemProgram.createAccount({
            fromPubkey: context.keypair.publicKey,
            newAccountPubkey: replacement.publicKey,
            lamports: 1,
            space: 82,
            programId: SystemProgram.programId,
          }),
        ],
        additionalSigners: [replacement.publicKey],
        computeUnitLimit: context.request.computeUnitLimit,
      };
    });
    await expect(context.sender.send(context.request)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(context.request.rebuild).toHaveBeenCalledOnce();
    const sent = context.rpc.sendRawTransaction.mock.calls.map(([bytes]) =>
      VersionedTransaction.deserialize(bytes),
    );
    expect(sent).toHaveLength(2);
    expect(
      sent[0]!.message.staticAccountKeys[1]!.equals(context.mint.publicKey),
    ).toBe(true);
    expect(
      sent[1]!.message.staticAccountKeys[1]!.equals(replacement.publicKey),
    ).toBe(true);
    expect(context.journal.write).toHaveBeenLastCalledWith(
      context.request.job,
      expect.anything(),
    );
    expect(
      vi
        .mocked(context.journal.write)
        .mock.calls.some(([, , plan]) =>
          plan?.additionalSigners?.[0]?.equals(replacement.publicKey),
        ),
    ).toBe(true);
  });
});
