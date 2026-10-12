import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { meteoraForCluster, WSOL_MINT } from "@onepercent/config";
import { EXTERNAL_IDS } from "@onepercent/sdk/constants";
import { machineLayout } from "@onepercent/sdk/layouts";
import {
  dbcPoolPda,
  feeInPda,
  machinePda,
  dammLaunchPoolPda,
  meteoraPda,
} from "@onepercent/sdk";
import type { JsonRpcClient } from "@onepercent/service-kit";
import { FeeChainReader } from "./chain.js";
const PROGRAM_ID = new PublicKey(new Uint8Array(32).fill(41));
const key = () => Keypair.generate().publicKey;
function fixture() {
  const mint = key();
  const payer = key();
  const config = new PublicKey(meteoraForCluster("localnet").dbcConfig);
  const curveKey = dbcPoolPda(mint, config)[0];
  const feeIn = feeInPda(PROGRAM_ID)[0];
  const accounts = new Map<
    string,
    {
      owner: string;
      executable: boolean;
      lamports: number;
      data: [string, "base64"];
    }
  >();
  const put = (
    address: PublicKey,
    owner: PublicKey,
    data: Buffer | Uint8Array,
    lamports = 1000,
  ) =>
    accounts.set(address.toBase58(), {
      owner: owner.toBase58(),
      executable: false,
      lamports,
      data: [Buffer.from(data).toString("base64"), "base64"],
    });
  const curve = Buffer.alloc(424);
  Buffer.from([213, 224, 5, 209, 98, 69, 119, 92]).copy(curve);
  config.toBuffer().copy(curve, 72);
  mint.toBuffer().copy(curve, 136);
  key().toBuffer().copy(curve, 168);
  key().toBuffer().copy(curve, 200);
  const configBytes = Buffer.alloc(1048);
  Buffer.from([26, 108, 14, 123, 116, 230, 129, 43]).copy(configBytes);
  new PublicKey(WSOL_MINT).toBuffer().copy(configBytes, 8);
  feeIn.toBuffer().copy(configBytes, 40);
  configBytes[239] = 100;
  configBytes.writeBigUInt64LE(85_000_000_000n, 264);
  put(config, EXTERNAL_IDS.meteoraDbc, configBytes);
  put(curveKey, EXTERNAL_IDS.meteoraDbc, curve);
  put(
    machinePda(PROGRAM_ID)[0],
    PROGRAM_ID,
    machineLayout.encode({
      phase: 3,
      version: 1,
      power_on_ts: 100n,
      on_air_ts: 1000n,
      end_ts: 2000n,
      token_mint: mint,
    }),
  );
  put(feeIn, SystemProgram.programId, Buffer.alloc(0), 600);
  const positions: unknown[] = [];
  const history: unknown[] = [];
  const transactions = new Map<string, unknown>();
  const rpc = {
    request: vi.fn(async (method: string, args: unknown[]) => {
      if (method === "getMinimumBalanceForRentExemption") return 700;
      if (method === "getProgramAccounts") return positions;
      if (method === "getSignaturesForAddress") return history;
      if (method === "getTransaction")
        return transactions.get(args[0] as string) ?? null;
      if (method === "getMultipleAccounts")
        return {
          context: { slot: 100 },
          value: (args[0] as string[]).map(
            (address) => accounts.get(address) ?? null,
          ),
        };
      throw new Error("unexpected_rpc");
    }),
  };
  const reader = new FeeChainReader({
    rpc: rpc as unknown as JsonRpcClient,
    payer,
    programId: PROGRAM_ID,
    cluster: "localnet",
  });
  return {
    mint,
    payer,
    curveKey,
    curve,
    config,
    configBytes,
    put,
    accounts,
    positions,
    history,
    transactions,
    rpc,
    reader,
    feeIn,
  };
}
function migratedFixture() {
  const f = fixture();
  f.curve[305] = 1;
  f.put(f.curveKey, EXTERNAL_IDS.meteoraDbc, f.curve);
  const poolKey = dammLaunchPoolPda(f.mint);
  const pool = Buffer.alloc(1112);
  Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]).copy(pool);
  f.mint.toBuffer().copy(pool, 168);
  new PublicKey(WSOL_MINT).toBuffer().copy(pool, 200);
  const baseVault = key();
  const quoteVault = key();
  baseVault.toBuffer().copy(pool, 232);
  quoteVault.toBuffer().copy(pool, 264);
  pool[484] = 1;
  f.put(poolKey, EXTERNAL_IDS.meteoraDammV2, pool);
  const authority = meteoraPda(EXTERNAL_IDS.meteoraDammV2, "pool_authority");
  const token = (mint: PublicKey, owner: PublicKey, amount: bigint) => {
    const bytes = Buffer.alloc(165);
    mint.toBuffer().copy(bytes);
    owner.toBuffer().copy(bytes, 32);
    bytes.writeBigUInt64LE(amount, 64);
    return bytes;
  };
  f.put(baseVault, EXTERNAL_IDS.splToken, token(f.mint, authority, 10n));
  f.put(
    quoteVault,
    EXTERNAL_IDS.splToken,
    token(new PublicKey(WSOL_MINT), authority, 10n),
  );
  const nftMint = key();
  const position = meteoraPda(EXTERNAL_IDS.meteoraDammV2, "position", [
    nftMint,
  ]);
  const nft = meteoraPda(EXTERNAL_IDS.meteoraDammV2, "position_nft_account", [
    nftMint,
  ]);
  const positionBytes = Buffer.alloc(408);
  Buffer.from([170, 188, 143, 228, 122, 64, 247, 208]).copy(positionBytes);
  poolKey.toBuffer().copy(positionBytes, 8);
  nftMint.toBuffer().copy(positionBytes, 40);
  f.put(position, EXTERNAL_IDS.meteoraDammV2, positionBytes);
  f.positions.push({
    pubkey: position.toBase58(),
    account: f.accounts.get(position.toBase58()),
  });
  f.put(nft, EXTERNAL_IDS.token2022, token(nftMint, f.feeIn, 1n));
  const migration = {
    slot: 50,
    transaction: {
      signatures: ["migration"],
      message: {
        accountKeys: [
          EXTERNAL_IDS.meteoraDbc,
          f.curveKey,
          key(),
          f.config,
          key(),
          poolKey,
          nftMint,
          nft,
          position,
        ].map((address) => address.toBase58()),
        instructions: [
          {
            programIdIndex: 0,
            accounts: [1, 2, 3, 4, 5, 6, 7, 8],
            data: "TCqN7bA2Pd9",
          },
        ],
      },
    },
    meta: {
      err: null as unknown,
      innerInstructions: [] as unknown[],
      loadedAddresses: { writable: [] as string[], readonly: [] as string[] },
    },
  };
  f.history.push({ signature: "migration", slot: 50, err: null });
  f.transactions.set("migration", migration);
  return {
    f,
    nft,
    nftMint,
    token,
    poolKey,
    position,
    positionBytes,
    migration,
  };
}
describe("live Meteora fee chain reader", () => {
  it("defers claims when the machine records an exec in flight", async () => {
    const f = fixture();
    f.put(
      machinePda(PROGRAM_ID)[0],
      PROGRAM_ID,
      machineLayout.encode({ phase: 3, token_mint: f.mint, exec: { kind: 3 } }),
    );
    await expect(f.reader.read("confirmed")).rejects.toThrow("ExecInFlight");
  });
  it("uses current rent and detects curve completion from reserves", async () => {
    const f = fixture();
    f.curve.writeBigUInt64LE(85_000_000_000n, 240);
    f.put(f.curveKey, EXTERNAL_IDS.meteoraDbc, f.curve);
    const state = await f.reader.read("confirmed");
    expect(state).toMatchObject({
      migrationDue: true,
      migrated: false,
      waiting: true,
      input: { feeInLamports: 600n, feeInRentMinimum: 700n },
    });
    const instruction = f.reader.collection(state!)[0]!;
    expect(instruction.data.readBigUInt64LE(4)).toBe(100n);
  });
  it("collects Curve without consulting migration history", async () => {
    const f = fixture();
    const state = await f.reader.read("confirmed");
    expect(state!.input.claim.kind).toBe("curve");
    expect(f.reader.collection(state!)).not.toHaveLength(0);
    expect(
      f.rpc.request.mock.calls.some(
        ([method]) =>
          method === "getTransaction" || method === "getSignaturesForAddress",
      ),
    ).toBe(false);
  });
  it("fails closed when the configured partner is not FeeIn", async () => {
    const f = fixture();
    key().toBuffer().copy(f.configBytes, 40);
    f.put(f.config, EXTERNAL_IDS.meteoraDbc, f.configBytes);
    await expect(f.reader.read("confirmed")).rejects.toThrow(
      "fee_in_creator_changed",
    );
  });
  it("selects Surplus from the live DBC flag and confirms FeeIn owns the migrated position NFT", async () => {
    const { f, nft, nftMint, token } = migratedFixture();
    expect((await f.reader.read("confirmed"))!.input.surplus?.kind).toBe(
      "surplus",
    );
    f.curve[306] = 1;
    f.put(f.curveKey, EXTERNAL_IDS.meteoraDbc, f.curve);
    expect((await f.reader.read("finalized"))!.input.surplus).toBeUndefined();
    f.put(nft, EXTERNAL_IDS.token2022, token(nftMint, key(), 1n));
    await expect(f.reader.read("confirmed")).rejects.toThrow(
      "fee_in_creator_changed",
    );
  });
  it("collects from the proven migration position despite an empty FeeIn-owned position donated by a third party", async () => {
    const { f, token, poolKey, position } = migratedFixture();
    const extraMint = key();
    const extraPosition = meteoraPda(EXTERNAL_IDS.meteoraDammV2, "position", [
      extraMint,
    ]);
    const extraNft = meteoraPda(
      EXTERNAL_IDS.meteoraDammV2,
      "position_nft_account",
      [extraMint],
    );
    const bytes = Buffer.alloc(408);
    Buffer.from([170, 188, 143, 228, 122, 64, 247, 208]).copy(bytes);
    poolKey.toBuffer().copy(bytes, 8);
    extraMint.toBuffer().copy(bytes, 40);
    f.put(extraPosition, EXTERNAL_IDS.meteoraDammV2, bytes);
    f.put(extraNft, EXTERNAL_IDS.token2022, token(extraMint, f.feeIn, 1n));
    f.positions.unshift({
      pubkey: extraPosition.toBase58(),
      account: f.accounts.get(extraPosition.toBase58()),
    });
    const state = await f.reader.read("confirmed");
    expect(state!.input.claim).toMatchObject({ kind: "pool", position });
    expect(f.reader.collection(state!, true)).toHaveLength(5);
    // Immutable finalized provenance is cached, but current ownership is reread.
    await f.reader.read("finalized");
    expect(
      f.rpc.request.mock.calls.filter(
        ([method]) => method === "getTransaction",
      ),
    ).toHaveLength(1);
  });
  it("retains finalized provenance across an account-only replay while rechecking live state", async () => {
    const { f, position, nft, nftMint, token } = migratedFixture();
    await f.reader.read("confirmed");
    f.history.length = 0;
    f.transactions.clear();
    f.put(
      machinePda(PROGRAM_ID)[0],
      PROGRAM_ID,
      machineLayout.encode({
        phase: 4,
        token_mint: f.mint,
        power_on_ts: 100n,
        on_air_ts: 101n,
        end_ts: 102n,
      }),
    );
    expect(await f.reader.read("confirmed")).toMatchObject({
      phase: 4,
      input: { claim: { kind: "pool", position } },
    });
    const cold = new FeeChainReader({
      rpc: f.rpc as unknown as JsonRpcClient,
      payer: f.payer,
      programId: PROGRAM_ID,
      cluster: "localnet",
    });
    await expect(cold.read("confirmed")).rejects.toThrow(
      "fee_migration_history_unavailable",
    );
    f.put(nft, EXTERNAL_IDS.token2022, token(nftMint, key(), 1n));
    await expect(f.reader.read("confirmed")).rejects.toThrow(
      "fee_in_creator_changed",
    );
  });
  it("resolves a migration via CPI with loaded v0 accounts", async () => {
    const { f, migration, position } = migratedFixture();
    const ix = migration.transaction.message.instructions[0]!;
    migration.meta.loadedAddresses.writable =
      migration.transaction.message.accountKeys.splice(5);
    migration.meta.innerInstructions.push({ index: 0, instructions: [ix] });
    migration.transaction.message.instructions = [];
    expect((await f.reader.read("confirmed"))!.input.claim).toMatchObject({
      position,
    });
  });
  it.each([
    "missing",
    "failed",
    "wrong_pool",
    "wrong_program",
    "wrong_slot",
    "wrong_signature",
    "wrong_position",
  ])(
    "defers collection without canonical migration proof: %s",
    async (mutation) => {
      const { f, migration } = migratedFixture();
      if (mutation === "missing") f.transactions.clear();
      if (mutation === "failed")
        migration.meta.err = { InstructionError: [0, 1] };
      if (mutation === "wrong_pool")
        migration.transaction.message.accountKeys[5] = key().toBase58();
      if (mutation === "wrong_program")
        migration.transaction.message.accountKeys[0] = key().toBase58();
      if (mutation === "wrong_position")
        migration.transaction.message.accountKeys[8] = key().toBase58();
      if (mutation === "wrong_slot") migration.slot++;
      if (mutation === "wrong_signature")
        migration.transaction.signatures[0] = "unrelated";
      await expect(f.reader.read("confirmed")).rejects.toThrow();
    },
  );
  it("signs only the prepared disposable migration account and destroys its in-memory capability", async () => {
    const f = fixture();
    const state = await f.reader.read("confirmed");
    const instructions = f.reader.migration(state!);
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: f.payer,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions,
      }).compileToV0Message(),
    );
    const sign = vi.spyOn(transaction, "sign");
    f.reader.signAuxiliary(transaction);
    expect(transaction.signatures[1]!.some((byte) => byte !== 0)).toBe(true);
    expect(
      sign.mock.calls[0]![0][0]!.secretKey.every((byte) => byte === 0),
    ).toBe(true);
    expect(() => f.reader.signAuxiliary(transaction)).toThrow(
      "fee_auxiliary_signer_missing",
    );
  });
});
