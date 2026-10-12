import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { EXECUTOR_POLICY, WSOL_MINT } from "@onepercent/config";
import {
  createDeploymentSelector,
  configPda,
  machinePda,
  feeInPda,
  dbcPoolPda,
  ledgerPda,
  vaultAta,
  vaultAuthPda,
  userAta,
  EXTERNAL_IDS,
  encodeConfig,
  encodeMachine,
  encodeMintLedger,
  collectCreatorFeesIx,
  claimLaunchFeesIx,
} from "@onepercent/sdk";
import { readMeteora, type ExecAccountReading } from "@onepercent/sdk/server";
import type { JsonRpcClient } from "@onepercent/service-kit";
import { ExecutorSource } from "./source.js";
import { planExecutor } from "./policy.js";
import { checkPlan, composeExecutor, stubSwap } from "./compose.js";
import { executorP1 } from "./p1.js";

const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
function captured(name: string) {
  const value = JSON.parse(
    readFileSync(
      new URL(
        `../../../../fixtures/meteora/accounts/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    address: string;
    account: { owner: string; data: [string, "base64"] };
  };
  return {
    address: new PublicKey(value.address),
    owner: new PublicKey(value.account.owner),
    data: Buffer.from(value.account.data[0], "base64"),
  };
}
function token(
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  native = false,
): ExecAccountReading {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data[108] = 1;
  if (native) data.writeUInt32LE(1, 109);
  return { address, owner: EXTERNAL_IDS.splToken, data };
}
function fixture(migrated: boolean, cluster: "localnet" | "devnet") {
  const programId = key(cluster === "localnet" ? 41 : 42);
  const deployment = createDeploymentSelector({ [cluster]: programId })(
    cluster,
  );
  const curve = captured(migrated ? "dbc-migrated" : "dbc-active");
  const active = migrated ? "damm-migrated" : "dbc-active";
  const base = captured(`${active}-base-vault`),
    quote = captured(`${active}-quote-vault`);
  const pool = migrated
    ? captured(active)
    : {
        address: SystemProgram.programId,
        owner: SystemProgram.programId,
        data: Buffer.alloc(0),
      };
  // Synthetic active liquidity clears the configured minimum tranche for both kinds.
  if (!migrated) {
    curve.data.writeBigUInt64LE(100_000_000_000n, 240);
    quote.data.writeBigUInt64LE(100_000_000_000n, 64);
  }
  const mint = new PublicKey(curve.data.subarray(136, 168));
  const dbcConfig = new PublicKey(deployment.meteora.dbcConfig);
  dbcConfig.toBuffer().copy(curve.data, 72);
  curve.address = dbcPoolPda(mint, dbcConfig)[0];
  const signer = key(2);
  type WireAccount = {
    owner: string;
    executable: boolean;
    lamports: number;
    data: [string, "base64"];
  };
  const accounts = new Map<string, WireAccount>();
  const put = (account: ExecAccountReading, lamports = 1_000_000) =>
    accounts.set(account.address.toBase58(), {
      owner: account.owner.toBase58(),
      executable: false,
      lamports,
      data: [Buffer.from(account.data).toString("base64"), "base64"],
    });
  for (const account of [curve, pool, base, quote]) put(account);
  const config = {
    address: configPda(programId)[0],
    owner: programId,
    data: encodeConfig({
      bump: configPda(programId)[1],
      executor: signer,
      token_mint: mint,
    }),
  };
  put(config);
  put(
    {
      address: machinePda(programId)[0],
      owner: programId,
      data: encodeMachine({
        bump: machinePda(programId)[1],
        phase: 3,
        token_mint: mint,
        end_ts: 50_000n,
        burn_sol: 5_000_000_000n,
        jackpot_sol: 5_000_000_000n,
      }),
    },
    100_000_000_000,
  );
  const clock = Buffer.alloc(40);
  clock.writeBigInt64LE(3700n, 32);
  put({
    address: SYSVAR_CLOCK_PUBKEY,
    owner: new PublicKey("Sysvar1111111111111111111111111111111111111"),
    data: clock,
  });
  const mintData = Buffer.alloc(82);
  mintData[44] = 6;
  mintData[45] = 1;
  put({ address: mint, owner: EXTERNAL_IDS.splToken, data: mintData });
  put({
    address: ledgerPda(programId, mint)[0],
    owner: programId,
    data: encodeMintLedger({ mint, accounted: 0n }),
  });
  put(
    token(
      vaultAta(programId, mint, EXTERNAL_IDS.splToken),
      mint,
      vaultAuthPda(programId)[0],
    ),
  );
  put(
    token(
      userAta(signer, new PublicKey(WSOL_MINT), EXTERNAL_IDS.splToken),
      new PublicKey(WSOL_MINT),
      signer,
      true,
    ),
  );
  const configData = Buffer.alloc(1048);
  Buffer.from([26, 108, 14, 123, 116, 230, 129, 43]).copy(configData);
  new PublicKey(WSOL_MINT).toBuffer().copy(configData, 8);
  feeInPda(programId)[0].toBuffer().copy(configData, 40);
  put({ address: dbcConfig, owner: EXTERNAL_IDS.meteoraDbc, data: configData });
  const request = vi.fn(
    async (
      method: string,
      params: unknown[],
      _schema?: unknown,
      _signal?: unknown,
    ) => {
      void _schema;
      void _signal;
      if (method === "getAccountInfo")
        return {
          context: { slot: 123 },
          value: accounts.get(params[0] as string) ?? null,
        };
      if (method === "getMultipleAccounts")
        return {
          context: { slot: 124 },
          value: (params[0] as string[]).map(
            (address) => accounts.get(address) ?? null,
          ),
        };
      if (method === "getMinimumBalanceForRentExemption") return 25_000_000;
      throw new Error("unexpected_rpc");
    },
  );
  const source = new ExecutorSource(
    { request } as unknown as JsonRpcClient,
    deployment,
  );
  return {
    source,
    deployment,
    programId,
    signer,
    mint,
    accounts,
    quote,
    put,
    request,
  };
}
const lut = new AddressLookupTableAccount({
  key: key(8),
  state: {
    deactivationSlot: (1n << 64n) - 1n,
    lastExtendedSlot: 0,
    lastExtendedSlotStartIndex: 0,
    addresses: [],
  },
});

describe("executor with the actual P1 contract", () => {
  it.each([
    [false, "localnet"],
    [true, "localnet"],
    [false, "devnet"],
    [true, "devnet"],
  ] as const)(
    "reads and composes both kinds with migrated=%s on %s",
    async (migrated, cluster) => {
      const f = fixture(migrated, cluster);
      const { snapshot, reference } = await f.source.reference(
        await f.source.snapshot(),
      );
      expect(snapshot.slot).toBe(124);
      const venue = readMeteora(
        reference.readings.oracles,
        f.mint,
        new PublicKey(f.deployment.meteora.dbcConfig),
      );
      expect(reference.quoteReserve).toBe(venue.recordedQuote);
      for (const kind of ["burn", "jackpot"] as const) {
        const decision = planExecutor(
          kind,
          snapshot,
          reference,
          EXECUTOR_POLICY,
        );
        if (!decision.ok) throw new Error(decision.reason);
        const checked = checkPlan(executorP1, decision.plan, f.signer);
        const swap = stubSwap(
          f.deployment,
          f.signer,
          f.mint,
          checked.expected,
          decision.plan.amount,
          key(9),
        );
        const input = {
          plan: decision.plan,
          p1: executorP1,
          signer: f.signer,
          swap,
          protocolLut: lut,
          blockhash: key(7).toBase58(),
          tipLamports: f.deployment.cluster === "devnet" ? 0n : 1_000_000n,
          computeUnitLimit: 100_000,
        };
        const composed = composeExecutor(input);
        expect(
          composed.instructions.filter((ix) =>
            ix.programId.equals(f.programId),
          ),
        ).toHaveLength(2);
        const own = composed.instructions.filter((ix) =>
          ix.programId.equals(f.programId),
        );
        expect(own[0]!.data[8]).toBe(kind === "burn" ? 3 : 4);
        // Fee claims cannot be injected anywhere in an exec transaction.
        const feeInstructions = [
          collectCreatorFeesIx(f.deployment, { payer: f.signer }),
          ...(["curve", "surplus"] as const).map((kind) =>
            claimLaunchFeesIx(f.deployment, {
              kind,
              payer: f.signer,
              mint: f.mint,
              baseVault: reference.oracles[2],
              quoteVault: reference.oracles[3],
            }),
          ),
        ];
        for (const fee of feeInstructions)
          expect(() =>
            composeExecutor({
              ...input,
              swap: { ...swap, setup: [...swap.setup, fee] },
            }),
          ).toThrow("ExecPairing");
      }
      const batch = f.request.mock.calls
        .filter(([method]) => method === "getMultipleAccounts")
        .at(-1)!;
      expect(batch[1][0]).toEqual(
        expect.arrayContaining([
          machinePda(f.programId)[0].toBase58(),
          ...reference.oracles.map((key) => key.toBase58()),
        ]),
      );
    },
  );
  it("ignores donated quote funds for tranche sizing and rejects a wrong vault owner", async () => {
    const f = fixture(true, "localnet");
    const original = await f.source.reference(await f.source.snapshot());
    f.quote.data.writeBigUInt64LE(
      f.quote.data.readBigUInt64LE(64) + 100_000_000_000n,
      64,
    );
    f.put(f.quote);
    expect(
      (await f.source.reference(await f.source.snapshot())).reference
        .quoteReserve,
    ).toBe(original.reference.quoteReserve);
    f.quote.owner = key(90);
    f.put(f.quote);
    await expect(f.source.reference(await f.source.snapshot())).rejects.toThrow(
      "AccountMismatch",
    );
  });
  it("models only an absent canonical source ATA and obtains rent from RPC", async () => {
    const f = fixture(false, "localnet");
    const src = userAta(
      f.signer,
      new PublicKey(WSOL_MINT),
      EXTERNAL_IDS.splToken,
    );
    f.accounts.delete(src.toBase58());
    const { snapshot, reference } = await f.source.reference(
      await f.source.snapshot(),
    );
    const decision = planExecutor("burn", snapshot, reference, EXECUTOR_POLICY);
    if (!decision.ok) throw new Error(decision.reason);
    expect(
      checkPlan(executorP1, decision.plan, f.signer).minOut,
    ).toBeGreaterThan(0n);
    expect(f.request).toHaveBeenCalledWith(
      "getMinimumBalanceForRentExemption",
      [165, { commitment: "confirmed" }],
      expect.anything(),
      undefined,
    );
  });
  it.each(["burn", "jackpot"] as const)(
    "%s accepts the exact one-lamport wSOL donation through the real reader and P1 preflight",
    async (kind) => {
      const f = fixture(false, "localnet");
      const src = token(
        userAta(f.signer, new PublicKey(WSOL_MINT), EXTERNAL_IDS.splToken),
        new PublicKey(WSOL_MINT),
        f.signer,
        true,
      );
      (src.data as Buffer).writeBigUInt64LE(1n, 64);
      f.put(src);
      expect(await f.source.residue(f.signer)).toBe(1n);
      const { snapshot, reference } = await f.source.reference(
        await f.source.snapshot(),
      );
      const decision = planExecutor(kind, snapshot, reference, EXECUTOR_POLICY);
      if (!decision.ok) throw new Error(decision.reason);
      expect(
        checkPlan(executorP1, decision.plan, f.signer).minOut,
      ).toBeGreaterThan(0n);
    },
  );
});

function receiptFixture(loaded: boolean) {
  const f = fixture(false, "localnet");
  const src = userAta(
    f.signer,
    new PublicKey(WSOL_MINT),
    EXTERNAL_IDS.splToken,
  ).toBase58();
  const event = Buffer.alloc(90);
  createHash("sha256").update("event:ExecEnded").digest().copy(event, 0, 0, 8);
  event[8] = 3;
  event[9] = 255;
  f.mint.toBuffer().copy(event, 10);
  const balance = {
    accountIndex: loaded ? 3 : 1,
    mint: WSOL_MINT,
    owner: f.signer.toBase58(),
    programId: EXTERNAL_IDS.splToken.toBase58(),
    uiTokenAmount: { amount: "0" },
  };
  const transaction = {
    transaction: {
      signatures: ["test-signature"],
      message: {
        accountKeys: [
          f.signer.toBase58(),
          ...(loaded ? [] : [src]),
          EXTERNAL_IDS.splToken.toBase58(),
          f.programId.toBase58(),
        ],
        instructions: [
          {
            programIdIndex: loaded ? 1 : 2,
            accounts: [balance.accountIndex, 0, 0],
            data: "A",
          },
          { programIdIndex: loaded ? 2 : 3, accounts: [], data: "exec-begin" },
        ],
      },
    },
    meta: {
      err: null,
      logMessages: [
        `Program ${f.programId} invoke [1]`,
        `Program data: ${event.toString("base64")}`,
        `Program ${f.programId} success`,
      ],
      loadedAddresses: {
        writable: loaded ? [src] : [],
        readonly: [] as string[],
      },
      postTokenBalances: [balance],
      preTokenBalances: [{ ...balance, uiTokenAmount: { amount: "1" } }],
    },
  };
  const rpc = {
    request: async (method: string, params: unknown[]) =>
      method === "getTransaction" ? transaction : f.request(method, params),
  };
  return {
    ...f,
    source: new ExecutorSource(rpc as unknown as JsonRpcClient, f.deployment),
    balance,
    transaction,
  };
}

describe("executor transaction residue evidence", () => {
  it("reconciles a legacy signed plan against its historical pre-balance", async () => {
    const f = receiptFixture(true);
    f.transaction.transaction.message.instructions.shift();
    f.balance.uiTokenAmount.amount = "1";
    expect(
      (await f.source.receipt("test-signature", f.signer)).sourceResidue,
    ).toBe(0n);
    f.balance.uiTokenAmount.amount = "2";
    expect(
      (await f.source.receipt("test-signature", f.signer)).sourceResidue,
    ).toBe(1n);
    f.transaction.meta.preTokenBalances = [];
    expect(
      (await f.source.receipt("test-signature", f.signer)).sourceResidue,
    ).toBe(2n);
  });
  it.each([false, true])(
    "reads the source post-state with loaded=%s, despite later outside credits",
    async (loaded) => {
      const f = receiptFixture(loaded);
      const src = token(
        userAta(f.signer, new PublicKey(WSOL_MINT), EXTERNAL_IDS.splToken),
        new PublicKey(WSOL_MINT),
        f.signer,
        true,
      );
      (src.data as Buffer).writeBigUInt64LE(1n, 64);
      f.put(src);
      expect(await f.source.residue(f.signer)).toBe(1n);
      expect(
        (await f.source.receipt("test-signature", f.signer)).sourceResidue,
      ).toBe(0n);
      f.balance.uiTokenAmount.amount = "1";
      expect(
        (await f.source.receipt("test-signature", f.signer)).sourceResidue,
      ).toBe(1n);
    },
  );
  it.each([
    "missing",
    "duplicate",
    "account",
    "owner",
    "mint",
    "program",
  ] as const)("rejects %s post-state evidence", async (mutation) => {
    const f = receiptFixture(true);
    if (mutation === "missing") f.transaction.meta.postTokenBalances = [];
    if (mutation === "duplicate")
      f.transaction.meta.postTokenBalances.push(f.balance);
    if (mutation === "account") f.balance.accountIndex = 0;
    if (mutation === "owner") f.balance.owner = key(5).toBase58();
    if (mutation === "mint") f.balance.mint = key(5).toBase58();
    if (mutation === "program")
      f.balance.programId = EXTERNAL_IDS.token2022.toBase58();
    await expect(f.source.receipt("test-signature", f.signer)).rejects.toThrow(
      "executor_residue_unavailable",
    );
  });
  it.each(["signature", "signer"] as const)(
    "binds receipt to the expected %s",
    async (field) => {
      const f = receiptFixture(false);
      if (field === "signature")
        f.transaction.transaction.signatures[0] = "another-signature";
      if (field === "signer")
        f.transaction.transaction.message.accountKeys[0] = key(5).toBase58();
      await expect(
        f.source.receipt("test-signature", f.signer),
      ).rejects.toThrow("executor_receipt_binding");
    },
  );
});
