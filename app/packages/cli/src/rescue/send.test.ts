import { PROGRAM_ID } from "../../../sdk/tests/program-id.js";
import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { IDL, redeemInstruction } from "@onepercent/sdk";
import type { RescueTransaction } from "@onepercent/sdk/rescue";
import {
  canRetryCardMoved,
  sendRescueTransaction,
  type SenderOptions,
} from "./send.js";
import { PROGRAM_IDS, RESCUE, SERVICES } from "@onepercent/config";

function setup() {
  const signer = Keypair.generate();
  const item: RescueTransaction = {
    action: "redeem",
    addresses: [signer.publicKey.toBase58()],
    slot: 12,
    transaction: new Transaction({
      feePayer: signer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    ),
  };
  const simulateTransaction = vi.fn().mockResolvedValue({
    context: { slot: 12 },
    value: { err: null, logs: [], unitsConsumed: 10 },
  });
  const getBlockHeight = vi.fn().mockResolvedValue(1);
  const getSignatureStatuses = vi.fn().mockResolvedValue({
    context: { slot: 12 },
    value: [{ slot: 12, err: null, confirmationStatus: "confirmed" }],
  });
  const sendRawTransaction = vi
    .fn()
    .mockRejectedValue(new Error("lost response with provider credentials"));
  const emit = vi.fn();
  const confirm = vi.fn().mockResolvedValue(true);
  const options: SenderOptions = {
    programId: PROGRAM_ID,
    rpc: {
      simulateTransaction,
      getBlockHeight,
      getSignatureStatuses,
      sendRawTransaction,
    } as unknown as SenderOptions["rpc"],
    signer,
    emit,
    confirm,
    dryRun: false,
    unsigned: false,
    yes: false,
    sleep: async () => {},
  };
  return {
    item,
    options,
    simulateTransaction,
    getBlockHeight,
    getSignatureStatuses,
    sendRawTransaction,
    emit,
    confirm,
  };
}

function cardMovedSetup() {
  const s = setup();
  s.item.transaction = new Transaction({
    feePayer: s.options.signer!.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    redeemInstruction(PROGRAM_ID, {
      owner: s.options.signer!.publicKey,
      mint: Keypair.generate().publicKey,
      tokenProgram: new PublicKey(PROGRAM_IDS.splToken),
      cardIndex: 0,
      amount: 1n,
    }),
  );
  const code = IDL.errors!.find((entry) => entry.name === "CardMoved")!.code;
  return {
    ...s,
    failure: {
      slot: 12,
      err: { InstructionError: [0, { Custom: code }] },
      confirmationStatus: "confirmed",
    },
  };
}

describe("rescue transaction consent and reconciliation", () => {
  it("simulates before prompt and again before sending; reconciles lost send responses", async () => {
    const s = setup();
    expect((await sendRescueTransaction(s.options, s.item, 100)).state).toBe(
      "confirmed",
    );
    expect(s.simulateTransaction).toHaveBeenCalledTimes(2);
    expect(s.simulateTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      s.confirm.mock.invocationCallOrder[0]!,
    );
    expect(s.confirm.mock.invocationCallOrder[0]).toBeLessThan(
      s.simulateTransaction.mock.invocationCallOrder[1]!,
    );
    expect(s.simulateTransaction.mock.invocationCallOrder[1]).toBeLessThan(
      s.sendRawTransaction.mock.invocationCallOrder[0]!,
    );
    expect(s.simulateTransaction.mock.calls[0]?.[1]).toMatchObject({
      sigVerify: false,
      replaceRecentBlockhash: true,
      minContextSlot: 12,
    });
    expect(s.getSignatureStatuses.mock.calls[0]?.[1]).toEqual({
      searchTransactionHistory: true,
    });
    expect(JSON.stringify(s.emit.mock.calls)).not.toContain("credentials");
  });
  it.each(["dryRun", "unsigned"] as const)(
    "%s simulates without prompt or send",
    async (mode) => {
      const s = setup();
      expect(
        (
          await sendRescueTransaction(
            { ...s.options, [mode]: true, signer: undefined },
            s.item,
            100,
          )
        ).state,
      ).toBe("preview");
      expect(s.sendRawTransaction).not.toHaveBeenCalled();
      expect(s.confirm).not.toHaveBeenCalled();
      if (mode === "unsigned")
        expect(s.emit.mock.calls[0]?.[0]).toHaveProperty("unsigned");
    },
  );
  it("refuses failed simulation and honours declined confirmation", async () => {
    const s = setup();
    s.simulateTransaction.mockResolvedValueOnce({
      context: { slot: 12 },
      value: { err: "failure", logs: [] },
    });
    expect((await sendRescueTransaction(s.options, s.item, 100)).state).toBe(
      "failed",
    );
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.sendRawTransaction).not.toHaveBeenCalled();
    s.confirm.mockResolvedValue(false);
    expect((await sendRescueTransaction(s.options, s.item, 100)).state).toBe(
      "cancelled",
    );
    expect(s.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("detects expiry after a prompt before signing", async () => {
    const s = setup();
    s.getBlockHeight.mockResolvedValue(101);
    expect((await sendRescueTransaction(s.options, s.item, 100)).state).toBe(
      "expired",
    );
    expect(s.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("requires finalized expiry and another history lookup before allowing rebuild", async () => {
    const s = setup();
    s.getBlockHeight.mockResolvedValueOnce(1).mockResolvedValue(101);
    s.getSignatureStatuses.mockResolvedValue({
      context: { slot: 12 },
      value: [null],
    });
    expect((await sendRescueTransaction(s.options, s.item, 100)).state).toBe(
      "expired",
    );
    expect(s.getBlockHeight).toHaveBeenLastCalledWith("finalized");
    expect(s.getSignatureStatuses).toHaveBeenCalledTimes(2);
    expect(s.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("bounds CardMoved retries using RESCUE config", async () => {
    const s = cardMovedSetup();
    s.simulateTransaction.mockResolvedValue({
      context: { slot: 12 },
      value: { err: s.failure.err, logs: [] },
    });
    expect((await sendRescueTransaction(s.options, s.item, 100)).state).toBe(
      "card-moved",
    );
    expect(canRetryCardMoved(RESCUE.cardMovedRetries - 1)).toBe(true);
    expect(canRetryCardMoved(RESCUE.cardMovedRetries)).toBe(false);
    expect(s.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("waits for finalized CardMoved before allowing a signed attempt to be rebuilt", async () => {
    const s = cardMovedSetup();
    s.getSignatureStatuses
      .mockResolvedValueOnce({ value: [s.failure] })
      .mockResolvedValueOnce({
        value: [{ ...s.failure, confirmationStatus: "finalized" }],
      });
    const pause = vi.fn(async () => {
      expect(s.emit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "failed" }),
      );
      expect(s.sendRawTransaction).toHaveBeenCalledTimes(1);
    });
    s.options.sleep = pause;
    const result = await sendRescueTransaction(s.options, s.item, 100);
    expect(result).toEqual({
      state: "card-moved",
      signature: expect.any(String),
    });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(s.getSignatureStatuses).toHaveBeenCalledTimes(2);
    expect(s.emit).toHaveBeenLastCalledWith({
      type: "failed",
      signature: result.signature,
      error: "CardMoved",
    });
  });
  it("reconciles success of the same signature after a fork removes confirmed CardMoved", async () => {
    const s = cardMovedSetup();
    s.getSignatureStatuses
      .mockResolvedValueOnce({ value: [s.failure] })
      .mockResolvedValueOnce({ value: [null] })
      .mockResolvedValueOnce({
        value: [{ slot: 14, err: null, confirmationStatus: "finalized" }],
      });
    const result = await sendRescueTransaction(s.options, s.item, 100);
    expect(result.state).toBe("confirmed");
    expect(s.getSignatureStatuses).toHaveBeenCalledTimes(3);
    for (const call of s.getSignatureStatuses.mock.calls)
      expect(call).toEqual([
        [result.signature],
        { searchTransactionHistory: true },
      ]);
    expect(s.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(
      s.emit.mock.calls.filter(([row]) => row.type === "signed"),
    ).toHaveLength(1);
    expect(s.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "failed" }),
    );
  });
  it("allows rebuild after confirmed CardMoved only once finalized expiry precedes absent history", async () => {
    const s = cardMovedSetup();
    s.getBlockHeight.mockResolvedValueOnce(1).mockResolvedValue(101);
    s.getSignatureStatuses
      .mockResolvedValueOnce({ value: [s.failure] })
      .mockResolvedValueOnce({ value: [null] });
    expect((await sendRescueTransaction(s.options, s.item, 100)).state).toBe(
      "expired",
    );
    expect(s.getBlockHeight).toHaveBeenLastCalledWith("finalized");
    const expiryCheck = s.getBlockHeight.mock.invocationCallOrder[1]!;
    expect(s.getSignatureStatuses.mock.invocationCallOrder[0]).toBeLessThan(
      expiryCheck,
    );
    expect(s.getSignatureStatuses.mock.invocationCallOrder[1]).toBeGreaterThan(
      expiryCheck,
    );
    expect(s.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it.each(["unexpired", "unfinalized history", "unavailable history"])(
    "keeps confirmed CardMoved ambiguous at timeout with %s",
    async (scenario) => {
      const s = cardMovedSetup();
      s.getSignatureStatuses.mockResolvedValue({ value: [s.failure] });
      if (scenario !== "unexpired")
        s.getBlockHeight.mockResolvedValueOnce(1).mockResolvedValue(101);
      if (scenario === "unavailable history")
        s.getSignatureStatuses
          .mockResolvedValueOnce({ value: [s.failure] })
          .mockRejectedValue(new Error("history unavailable"));
      let now = 0;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
      s.options.sleep = async () => {
        now += SERVICES.transport.rpcTimeoutMs;
      };
      try {
        expect(
          (await sendRescueTransaction(s.options, s.item, 100)).state,
        ).toBe("ambiguous");
        expect(s.sendRawTransaction).toHaveBeenCalledTimes(1);
        expect(s.emit).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: "failed" }),
        );
        expect(s.getSignatureStatuses).toHaveBeenCalledTimes(
          scenario === "unexpired" ? 1 : 2,
        );
      } finally {
        clock.mockRestore();
      }
    },
  );
  it("does not interpret another program's custom code as CardMoved", async () => {
    const s = setup();
    const code = IDL.errors!.find((entry) => entry.name === "CardMoved")!.code;
    s.simulateTransaction.mockResolvedValue({
      context: { slot: 12 },
      value: { err: { InstructionError: [0, { Custom: code }] }, logs: [] },
    });
    expect((await sendRescueTransaction(s.options, s.item, 100)).state).toBe(
      "failed",
    );
  });
  it("leaves an ambiguous signature unresolved without re-signing", async () => {
    const s = setup();
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    s.getSignatureStatuses.mockResolvedValue({
      context: { slot: 12 },
      value: [null],
    });
    s.options.sleep = async () => {
      now += 20_000;
    };
    try {
      expect((await sendRescueTransaction(s.options, s.item, 100)).state).toBe(
        "ambiguous",
      );
      expect(s.sendRawTransaction).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });
});
