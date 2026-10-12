import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import {
  TOKEN_1PCT,
  PROGRAM_IDS,
  WSOL_MINT,
} from "../packages/config/src/index.js";
import {
  adminConfigInstruction,
  buildDbcLaunchConfig,
  dbcSwap2Ix,
  initializeDbcPoolIx,
  launchAddresses,
  quoteDbcExactOut,
} from "../packages/sdk/src/index.js";
import { DEPLOYMENT } from "../packages/sdk/tests/program-id.js";
import { executeLaunch } from "../packages/cli/src/launch/runtime.js";
import type { LaunchInput } from "../packages/cli/src/launch/input.js";
import type { LaunchPolicy } from "../packages/cli/src/launch/landing.js";

const token = new PublicKey(PROGRAM_IDS.splToken);
const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
const ata = (
  payer: PublicKey,
  account: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
) =>
  new TransactionInstruction({
    programId: new PublicKey(PROGRAM_IDS.associatedToken),
    keys: [
      meta(payer, true, true),
      meta(account, true),
      meta(owner),
      meta(mint),
      meta(SystemProgram.programId),
      meta(token),
    ],
    data: Buffer.from([1]),
  });

/** Proxima equivalent: only DBC/SPL instructions create the pool and buy tokens. */
export async function runProximaValidatorScenario(
  rpc: Connection,
  wallet: Keypair,
  mint: Keypair,
  input: LaunchInput,
  options: { directory: string; localPolicy: LaunchPolicy },
) {
  const founder = Keypair.generate(); // Only in memory; the deployer is the launch wallet.
  const a = launchAddresses({
    wallet: wallet.publicKey,
    mint: mint.publicKey,
    deployment: DEPLOYMENT,
  });
  const base = {
    ...input,
    flow: "proxima" as const,
    confirm: mint.publicKey.toBase58().slice(0, 8),
  };
  const call = (
    command: LaunchInput["command"],
    signer: Keypair | null = wallet,
  ) =>
    executeLaunch(
      { ...base, command },
      rpc,
      { wallet: signer, mint: null },
      (event) => console.log(JSON.stringify({ event: event.event, command })),
      options,
    );
  async function submit(
    ixs: TransactionInstruction[],
    signers: Keypair[] = [],
    lut?: string,
  ) {
    const table = lut
      ? (await rpc.getAddressLookupTable(new PublicKey(lut))).value
      : undefined;
    const latest = await rpc.getLatestBlockhash("confirmed");
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ...ixs,
        ],
      }).compileToV0Message(table ? [table] : []),
    );
    tx.sign([wallet, ...signers]);
    assert(tx.serialize().length <= 1232);
    const signature = await rpc.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
    });
    const receipt = await rpc.confirmTransaction(
      { signature, ...latest },
      "finalized",
    );
    assert.equal(receipt.value.err, null);
    return signature;
  }
  const now = await rpc.getBlockTime(await rpc.getSlot("finalized"));
  assert(now);
  await submit([
    adminConfigInstruction(DEPLOYMENT.programId, {
      admin: wallet.publicKey,
      action: {
        setSeason: {
          snapshot_slot: BigInt(await rpc.getSlot("finalized")),
          snapshot_ts: BigInt(now - 1),
          stock_up_ts: BigInt(now),
        },
      },
    }),
  ]);
  assert.equal(
    ((await call("check", null)) as { stage: string }).stage,
    "set-mint",
  );
  assert.equal(
    ((await call("set-mint")) as { stage: string }).stage,
    "stock-up",
  );
  await assert.rejects(
    () => call("set-mint", founder),
    /proxima_admin_required/,
  );
  await submit([
    adminConfigInstruction(DEPLOYMENT.programId, {
      admin: wallet.publicKey,
      action: { setRole: { role: 0, key: founder.publicKey } },
    }),
  ]);
  const handed = (await call("check", null)) as { admin: string };
  assert.equal(handed.admin, founder.publicKey.toBase58());
  assert.equal(
    ((await call("stock-up")) as { stage: string }).stage,
    "awaiting-proxima",
  );
  await assert.rejects(
    () => call("deposit"),
    /proxima_requires_awaiting-proxima/,
  );
  const lutResult = (await executeLaunch(
    { ...base, command: "lut" },
    rpc,
    { wallet, mint: null },
    () => undefined,
    options,
  )) as { lookupTable: string };
  const config = buildDbcLaunchConfig();
  const quote = quoteDbcExactOut(config, TOKEN_1PCT.devBuyAmount);
  const maxQuote = quote.maxQuoteIn;
  const externalSignature = await submit(
    [
      initializeDbcPoolIx({
        config: a.dbcConfig,
        mint: mint.publicKey,
        payer: wallet.publicKey,
        creator: wallet.publicKey,
        name: "External DBC test",
        symbol: "EXT",
        uri: "https://example.com/external.json",
      }),
      ata(wallet.publicKey, a.launchAta, wallet.publicKey, mint.publicKey),
      ata(
        wallet.publicKey,
        a.launchQuoteAta,
        wallet.publicKey,
        new PublicKey(WSOL_MINT),
      ),
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: a.launchQuoteAta,
        lamports: maxQuote,
      }),
      new TransactionInstruction({
        programId: token,
        keys: [meta(a.launchQuoteAta, true)],
        data: Buffer.from([17]),
      }),
      dbcSwap2Ix({
        config: a.dbcConfig,
        mint: mint.publicKey,
        user: wallet.publicKey,
        amountOut: TOKEN_1PCT.devBuyAmount,
        maxQuoteIn: maxQuote,
      }),
      new TransactionInstruction({
        programId: token,
        keys: [
          meta(a.launchQuoteAta, true),
          meta(wallet.publicKey, true),
          meta(wallet.publicKey, false, true),
        ],
        data: Buffer.from([9]),
      }),
    ],
    [mint],
    lutResult.lookupTable,
  );
  assert.equal(
    ((await call("check", null)) as { stage: string }).stage,
    "deposit",
  );
  await assert.rejects(
    () => call("deposit", founder),
    /proxima_launch_wallet_required/,
  );
  const deposited = await call("deposit");
  assert("stage" in deposited && "signature" in deposited);
  assert.equal(typeof deposited.signature, "string");
  assert.equal(deposited.stage, "power-on");
  const resumed = (await call("deposit")) as { reconciled: boolean };
  assert.equal(resumed.reconciled, true);
  assert.equal((await rpc.getAccountInfo(a.machine, "finalized"))!.data[10], 1);
  await assert.rejects(
    () => call("power-on", founder),
    /proxima_launch_wallet_required/,
  );
  const powered = await call("power-on");
  assert("stage" in powered && "signature" in powered);
  assert.equal(typeof powered.signature, "string");
  assert.equal(powered.stage, "powered-on");
  assert.notEqual(powered.signature, deposited.signature);
  const report = (await call("report", null)) as {
    ok: boolean;
    landedForm: string;
  };
  assert.equal(report.ok, true);
  assert.equal(report.landedForm, "proxima-separate");
  const replay = (await call("power-on")) as { reconciled: boolean };
  assert.equal(replay.reconciled, true);
  // Let validator transaction notifications drain before the parent stops it.
  await sleep(20);
  console.log(
    "D32 PASS: external DBC pool and exact dev buy, distinct founder admin, deposit and Power-On signatures, finalized checks and safe replay",
  );
  return {
    externalSignature,
    depositSignature: deposited.signature,
    powerOnSignature: powered.signature,
    report,
  };
}
