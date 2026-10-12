import { expect, it, vi } from "vitest";
import {
  AddressLookupTableAccount,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import { RpcError, TxSender } from "@onepercent/service-kit";
import type { ServiceRuntime, TxRpc } from "@onepercent/service-kit";
import { StockStore } from "./store.js";
import { privateLanding } from "./landing.js";

it.each([
  ["saved", "BlockhashNotFound"],
  ["legacy", "BlockhashNotFound"],
  ["expired", "BlockhashNotFound"],
  ...[6071, 6072, 6073, 6074].map((code) => ["saved", code]),
])(
  "recovers a signed plan with unavailable LUTs (%s, %s) after ambiguous submission",
  async (mode, rejection) => {
    const id = "db421600-04df-4d03-a711-6304259b7545";
    let state: Record<string, unknown> = {};
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("SELECT id,state"))
        return { rows: state.done ? [] : [{ id, state }] };
      if (sql.startsWith("SELECT state"))
        return { rows: values?.[1] === state.claim ? [{ state }] : [] };
      if (sql.startsWith("UPDATE stock_plans SET state=state")) {
        const owns = values?.[2] === state.claim;
        if (owns) state = { ...state, ...JSON.parse(String(values?.[1])) };
        return { rowCount: owns ? 1 : 0, rows: [] };
      }
      if (sql.includes("jsonb_set")) {
        const attempts = Number(state.attempts);
        if (values?.[1] !== state.claim || attempts >= Number(values?.[2]))
          return { rows: [] };
        state.attempts = attempts + 1;
        return { rows: [{ attempts: attempts + 1 }] };
      }
      throw new Error("unexpected query");
    });
    const pool = { query } as unknown as ServiceRuntime["pool"];
    const journal = new StockStore(pool, () => {});
    state = { claim: journal.term, attempts: 0, done: false };
    const key = Keypair.generate();
    let landed = false;
    const rpc = {
      getLatestBlockhash: vi.fn(async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 100,
      })),
      getRecentPrioritizationFees: async () => [],
      simulateTransaction: async () => ({ err: null }),
      sendRawTransaction: vi.fn(async () => {
        throw new RpcError(
          -32002,
          typeof rejection === "number"
            ? { InstructionError: [2, { Custom: rejection }] }
            : rejection,
        );
      }),
      getSignatureStatuses: vi.fn(async () => [
        landed && mode !== "expired"
          ? { err: null, confirmationStatus: "finalized" as const }
          : null,
      ]),
      getBlockHeight: vi.fn(async () =>
        landed && mode === "expired" ? 101 : 99,
      ),
    } satisfies TxRpc;
    const transport = vi.fn(async () => {
      throw new Error("response_lost_after_acceptance");
    });
    const signer = {
      publicKey: key.publicKey,
      signTransaction: vi.fn(
        (
          tx: Parameters<
            NonNullable<ServiceRuntime["key"]>["signTransaction"]
          >[0],
        ) => tx.sign([key]),
      ),
    };
    const options = {
      role: "keeper" as const,
      rpc: privateLanding(
        rpc,
        "https://sender.helius-rpc.com/fast",
        () => {},
        () => {},
        transport,
      ),
      signer,
      journal,
      assertAuthorized() {},
      assertLeader() {},
      sendMaxAttempts: 2,
      backoffBaseMs: 1,
      backoffMaxMs: 1,
      cuMarginBps: 2000,
      maxComputeUnitPriceMicroLamports: 3n,
      sleep: async () => {},
    };
    const rebuild = vi.fn(async () => {
      await journal.update(id, { done: true });
      return null;
    });
    const destination = Keypair.generate().publicKey;
    const table = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: {
        deactivationSlot: (1n << 64n) - 1n,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [Keypair.generate().publicKey, destination],
      },
    });
    const request = {
      job: id,
      lookupTables: [table],
      instructions: [
        SystemProgram.transfer({
          fromPubkey: key.publicKey,
          toPubkey: destination,
          lamports: 1,
        }),
      ],
      computeUnitLimit: 20000,
      isComplete: async () => false,
      rebuild,
    };
    await expect(new TxSender(options).send(request)).rejects.toThrow(
      "transaction_pending",
    );
    expect(rebuild).not.toHaveBeenCalled();
    expect(rpc.getBlockHeight).toHaveBeenCalledWith("finalized", undefined);
    const signed = await journal.read(id);
    expect(signed).toMatchObject({ status: "signed" });
    expect(signed).not.toHaveProperty("failureProof");
    const restarted = new StockStore(pool, () => {});
    expect(await restarted.pending()).toBe(id);
    if (mode === "legacy") delete state.lookupAddresses;
    const unavailableLookup = vi.fn(async () => {
      throw new Error("lut_unavailable");
    });
    const restored = await Reflect.apply(restarted.restore, restarted, [
      id,
      unavailableLookup,
    ]);
    expect(unavailableLookup).not.toHaveBeenCalled();
    rebuild.mockImplementation(async () => {
      await restarted.update(id, { done: true });
      return null;
    });
    landed = true;
    const result = await new TxSender({ ...options, journal: restarted }).send({
      ...request,
      ...restored!,
    });
    if (mode === "expired") {
      expect(result.status).toBe("skipped");
      expect(rebuild).toHaveBeenCalledTimes(1);
      expect(signer.signTransaction).toHaveBeenCalledTimes(1);
      return;
    }
    expect(result).toMatchObject({
      status: "confirmed",
      signature: signed!.signature,
      finalized: true,
    });
    expect((await restarted.read(id))!.transactionBase64).toBe(
      signed!.transactionBase64,
    );
    expect(signer.signTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(rebuild).not.toHaveBeenCalled();
  },
);
