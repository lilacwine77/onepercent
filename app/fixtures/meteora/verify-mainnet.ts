import { MAINNET_GENESIS_HASH } from "../../packages/config/src/genesis.js";
/** Read-only replay: unsigned simulations only, with fresh in-memory identities. */
import { writeFile } from "node:fs/promises";
import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../packages/sdk/package.json", import.meta.url),
);
const {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} = require("@solana/spl-token");
import {
  buildDbcLaunchConfig,
  createDbcConfigIx,
  initializeDbcPoolIx,
  dbcSwap2Ix,
  quoteDbcExactOut,
  deriveDbcCurve,
  dbcPool,
  decodeDbcConfig,
  decodeDbcPool,
  dbcConfigMismatches,
} from "../../packages/sdk/src/meteora/index.js";
const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  "confirmed",
);
if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH)
  throw new Error("Mainnet genesis required for unsigned evidence");
const payer = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"),
  config = Keypair.generate().publicKey,
  mint = Keypair.generate().publicKey;
const feeIn = PublicKey.findProgramAddressSync(
  [Buffer.from("fee_in")],
  new PublicKey("11111111111111111111111111111112"),
)[0];
const baseAta = getAssociatedTokenAddressSync(mint, payer),
  quoteAta = getAssociatedTokenAddressSync(NATIVE_MINT, payer),
  pool = dbcPool(config, mint);
const quote = quoteDbcExactOut(buildDbcLaunchConfig(), 40_000_000_000_000n);
const all: TransactionInstruction[] = [
  createDbcConfigIx({ config, payer, feeIn }),
  initializeDbcPoolIx({
    config,
    mint,
    payer,
    name: "T",
    symbol: "T",
    uri: "https://x.co",
  }),
  createAssociatedTokenAccountIdempotentInstruction(
    payer,
    baseAta,
    payer,
    mint,
  ),
  createAssociatedTokenAccountIdempotentInstruction(
    payer,
    quoteAta,
    payer,
    NATIVE_MINT,
  ),
  SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: quoteAta,
    lamports: quote.maxQuoteIn,
  }),
  createSyncNativeInstruction(quoteAta),
  dbcSwap2Ix({
    config,
    mint,
    user: payer,
    amountOut: quote.amountOut,
    maxQuoteIn: quote.maxQuoteIn,
  }),
];
const selectedInstructions = process.env.CONFIG_ONLY ? all.slice(0, 1) : all;
const recent = await connection.getLatestBlockhash();
const tx = new VersionedTransaction(
  new TransactionMessage({
    payerKey: payer,
    recentBlockhash: recent.blockhash,
    instructions: selectedInstructions,
  }).compileToV0Message(),
);
const result = await connection.simulateTransaction(tx, {
  sigVerify: false,
  replaceRecentBlockhash: true,
  accounts: {
    encoding: "base64",
    addresses: [config, pool, mint, baseAta].map((x) => x.toBase58()),
  },
});
const clean = (v: unknown) =>
  JSON.parse(
    JSON.stringify(v, (_k, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
function simulatedData(index: number): Buffer | undefined {
  const account = result.value.accounts?.[index];
  if (!account) return undefined;
  const encoded = account.data[0];
  if (typeof encoded !== "string" || account.data[1] !== "base64")
    throw new Error(`Invalid simulated account encoding at index ${index}`);
  return Buffer.from(encoded, "base64");
}
const configData = simulatedData(0);
const poolData = simulatedData(1);
const parsed = configData ? decodeDbcConfig(configData) : undefined;
const data = {
  capturedAt: new Date().toISOString(),
  transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
  instructions: selectedInstructions.map((ix) => ({
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    dataHex: ix.data.toString("hex"),
  })),
  kind: "unsigned-mainnet-simulation",
  slot: result.context.slot,
  err: result.value.err,
  unitsConsumed: result.value.unitsConsumed,
  logs: result.value.logs,
  addresses: {
    payer: payer.toBase58(),
    config: config.toBase58(),
    feeIn: feeIn.toBase58(),
    mint: mint.toBase58(),
    pool: pool.toBase58(),
    baseAta: baseAta.toBase58(),
  },
  curve: clean(deriveDbcCurve()),
  quote: clean(quote),
  accounts: result.value.accounts,
  config: parsed ? clean(parsed) : undefined,
  configMismatches: parsed ? dbcConfigMismatches(parsed, feeIn) : undefined,
  pool: poolData ? clean(decodeDbcPool(poolData)) : undefined,
};
await writeFile(
  new URL(
    process.env.CONFIG_ONLY
      ? "./mainnet-config-simulation.json"
      : "./mainnet-launch-simulation.json",
    import.meta.url,
  ),
  JSON.stringify(data, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    slot: data.slot,
    err: data.err,
    units: data.unitsConsumed,
    configMismatches: data.configMismatches,
  }),
);
