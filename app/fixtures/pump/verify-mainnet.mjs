import { MAINNET_GENESIS_HASH } from "../../packages/config/dist/genesis.js";
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  createV2Ix,
  buyV3Ix,
  curveCollectStepIx,
  collectCreatorFeeV2Ix,
  poolCollectStepIx,
  transferCreatorFeesToPumpIx,
  decodeGlobal,
  decodeFeeConfig,
  devBuyQuote,
  bondingCurve,
  mintAuthority,
  creatorVault,
  pumpAta,
  PUMP_PROGRAM_ID,
} from "../../packages/sdk/src/pump/index.ts";
import { inspectLaunchPoststate } from "./inspect-poststate.mjs";
import { TOKEN_1PCT } from "../../packages/config/src/index.ts";

// Reads and unsigned simulations only. Never loads a wallet or sends a transaction.
const url =
  process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const dir = new URL("../mainnet/pump/", import.meta.url);
const checkedAt = new Date().toISOString();
const json = (value) =>
  `${JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
async function rpc(method, params) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (response.status === 429) {
      await new Promise((resolve) =>
        setTimeout(resolve, 2_000 + attempt * 1_000),
      );
      continue;
    }
    if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
    const result = await response.json();
    if (result.error)
      throw new Error(`${method}: ${JSON.stringify(result.error)}`);
    return result.result;
  }
  throw new Error(`${method} rate limited`);
}
const genesisHash = await rpc("getGenesisHash", []);
if (genesisHash !== MAINNET_GENESIS_HASH)
  throw new Error("Mainnet genesis required");
const account = (key) =>
  rpc("getAccountInfo", [
    key.toString(),
    { encoding: "base64", commitment: "confirmed" },
  ]);
async function saveAccount(name, address, value, slot, simulated = false) {
  if (!value) return { address: address.toString(), present: false };
  const data = Buffer.from(value.data[0], "base64");
  const meta = {
    address: address.toString(),
    slot,
    checkedAt,
    simulated,
    owner: value.owner,
    lamports: value.lamports,
    executable: value.executable,
    bytes: data.length,
    sha256: sha256(data),
  };
  await writeFile(new URL(`${name}.bin`, dir), data);
  await writeFile(new URL(`${name}.meta.json`, dir), json(meta));
  return meta;
}
const wallet = new PublicKey(
  (await readFile(new URL("global.bin", dir))).subarray(41, 73),
);
const walletBefore = await account(wallet);
if (
  !walletBefore.value ||
  walletBefore.value.owner !== SystemProgram.programId.toBase58() ||
  walletBefore.value.lamports < 2_000_000_000
)
  throw new Error("Public simulation payer lacks balance");
const blockhash = (
  await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])
).value.blockhash;
async function simulate(name, instructions, addresses) {
  const transaction = new Transaction({
    feePayer: wallet,
    recentBlockhash: blockhash,
  }).add(...instructions);
  const bytes = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  await writeFile(new URL(`${name}-transaction.bin`, dir), bytes);
  const result = await rpc("simulateTransaction", [
    bytes.toString("base64"),
    {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: addresses.map(String) },
    },
  ]);
  const accounts = [];
  for (let index = 0; index < addresses.length; index++)
    accounts.push(
      await saveAccount(
        `${name}-post-${index}`,
        addresses[index],
        result.value.accounts?.[index],
        result.context.slot,
        true,
      ),
    );
  const logs = (result.value.logs ?? []).map((line) =>
    line.startsWith("Program data:") ||
    (line.startsWith("Program log:") &&
      !line.startsWith("Program log: Instruction:"))
      ? `External program log sha256:${sha256(line)}`
      : line,
  );
  const report = {
    checkedAt,
    slot: result.context.slot,
    bytes: bytes.length,
    signatureVerification: false,
    signed: false,
    sent: false,
    err: result.value.err,
    unitsConsumed: result.value.unitsConsumed,
    logs,
    accounts,
  };
  await writeFile(new URL(`./${name}.json`, import.meta.url), json(report));
  console.log(
    name,
    json({
      err: report.err,
      bytes: report.bytes,
      unitsConsumed: report.unitsConsumed,
      slot: report.slot,
    }).trim(),
  );
  return { report, values: result.value.accounts };
}
const globalRead = await account(
  new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"),
);
const feeRead = await account(
  new PublicKey("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt"),
);
const global = decodeGlobal(Buffer.from(globalRead.value.data[0], "base64"));
const fees = decodeFeeConfig(Buffer.from(feeRead.value.data[0], "base64"));
const quote = devBuyQuote(global, fees, TOKEN_1PCT.devBuyAmount);
const mint = new PublicKey(randomBytes(32));
const program = new PublicKey("DoNH1Cxvv9umyWV9i77LEK4CoqTotDxPRzPxPBzjMJpe");
const feeIn = PublicKey.findProgramAddressSync(
  [Buffer.from("fee_in")],
  program,
)[0];
const ataProgram = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const token2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const buyerAta = pumpAta(wallet, mint);
const ataIx = new TransactionInstruction({
  programId: ataProgram,
  data: Buffer.from([1]),
  keys: [
    { pubkey: wallet, isSigner: true, isWritable: true },
    { pubkey: buyerAta, isSigner: false, isWritable: true },
    { pubkey: wallet, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: token2022, isSigner: false, isWritable: false },
  ],
});
const v3 = await simulate(
  "v3-launch-prefix",
  [
    createV2Ix({
      creatorFeeBps: 0n,
      mint,
      wallet,
      name: "Launch rehearsal",
      symbol: "TEST",
      uri: "https://example.com/rehearsal.json",
      creator: feeIn,
    }),
    ataIx,
    buyV3Ix({
      mint,
      wallet,
      amount: TOKEN_1PCT.devBuyAmount,
      maxSolCost: quote,
      buybackFeeRecipient: global.buybackFeeRecipients[0],
    }),
  ],
  [mint, bondingCurve(mint), buyerAta, wallet],
);
const poststate = v3.report.err
  ? null
  : inspectLaunchPoststate(
      ...v3.values.slice(0, 3),
      feeIn,
      global.tokenTotalSupply,
    );
const graduatedMint = new PublicKey(
  "ADPN2aqzY5RhkBC7bNQWFhTFFEYKY4drHUQG887Cpump",
);
const pool = new PublicKey("7mQDGteiaD4Tkupg9hStyPQNeSTNTRaUEhh1zJ1awp8x");
const poolBytes = await readFile(new URL("graduated_pool.bin", dir));
const curveBytes = await readFile(new URL("graduated_curve.bin", dir));
const creator = new PublicKey(curveBytes.subarray(49, 81));
const v4 = await simulate(
  "v4-graduated-fees",
  [
    curveCollectStepIx({ payer: wallet, mint: graduatedMint, creator }),
    poolCollectStepIx({
      payer: wallet,
      pool,
      creator,
      poolQuoteTokenAccount: new PublicKey(poolBytes.subarray(171, 203)),
    }),
    transferCreatorFeesToPumpIx({ creator }),
    collectCreatorFeeV2Ix({ creator }),
  ],
  [creatorVault(creator), creator, bondingCurve(graduatedMint), pool],
);
const signatures = await rpc("getSignaturesForAddress", [
  mintAuthority().toBase58(),
  { limit: 12, commitment: "confirmed" },
]);
let fresh;
for (const entry of signatures) {
  if (entry.err) continue;
  const found = await rpc("getTransaction", [
    entry.signature,
    {
      encoding: "json",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 1,
    },
  ]);
  if (!found) continue;
  const loaded = found.meta.loadedAddresses;
  const keys = [
    ...found.transaction.message.accountKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ].map((key) => new PublicKey(key));
  for (const instruction of found.transaction.message.instructions) {
    const alphabet =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let value = 0n;
    for (const character of instruction.data)
      value = value * 58n + BigInt(alphabet.indexOf(character));
    let hex = value.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    const dataBytes = Buffer.from(hex, "hex");
    if (
      !keys[instruction.programIdIndex].equals(PUMP_PROGRAM_ID) ||
      dataBytes.subarray(0, 8).toString("hex") !== "d6904cec5f8b31b4"
    )
      continue;
    const freshMint = keys[instruction.accounts[0]];
    const freshCurve = bondingCurve(freshMint);
    const curve = await account(freshCurve);
    if (!curve.value) continue;
    const data = Buffer.from(curve.value.data[0], "base64");
    if (
      data[48] ||
      data[81] ||
      data[82] ||
      data[124] ||
      !data.subarray(83, 115).equals(Buffer.alloc(32))
    )
      continue;
    const freshCreator = new PublicKey(data.subarray(49, 81));
    const creatorAccount = await account(freshCreator);
    if (
      !creatorAccount.value ||
      creatorAccount.value.executable ||
      creatorAccount.value.owner !== SystemProgram.programId.toBase58()
    )
      continue;
    fresh = {
      mint: freshMint,
      curve: freshCurve,
      creator: freshCreator,
      creationSignature: entry.signature,
      creationSlot: entry.slot,
    };
    await saveAccount(
      "fresh_curve",
      freshCurve,
      curve.value,
      curve.context.slot,
    );
    break;
  }
  if (fresh) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!fresh)
  throw new Error("No qualifying fresh coin found in latest creations");
const v5 = await simulate(
  "v5-fresh-fees",
  [
    curveCollectStepIx({
      payer: wallet,
      mint: fresh.mint,
      creator: fresh.creator,
    }),
    collectCreatorFeeV2Ix({ creator: fresh.creator }),
  ],
  [creatorVault(fresh.creator), fresh.creator, fresh.curve],
);
const rentMinimum = await rpc("getMinimumBalanceForRentExemption", [0]);
const report = {
  checkedAt,
  genesisHash,
  readOnly: true,
  simulationPayer: wallet.toBase58(),
  payerKeysLoaded: false,
  devBuyAmount: TOKEN_1PCT.devBuyAmount,
  devBuyQuote: quote,
  launchMint: mint.toBase58(),
  feeIn: feeIn.toBase58(),
  feeInProgram: program.toBase58(),
  v3: {
    err: v3.report.err,
    unitsConsumed: v3.report.unitsConsumed,
    bytes: v3.report.bytes,
    scope:
      "External create, buyer ATA and buy only; M4.1 power_on is unavailable",
    poststate,
  },
  v4: {
    err: v4.report.err,
    unitsConsumed: v4.report.unitsConsumed,
    bytes: v4.report.bytes,
  },
  v5: {
    err: v5.report.err,
    unitsConsumed: v5.report.unitsConsumed,
    bytes: v5.report.bytes,
    mint: fresh.mint.toBase58(),
    creator: fresh.creator.toBase58(),
    creationSignature: fresh.creationSignature,
    creationSlot: fresh.creationSlot,
    rentMinimum,
    creatorVaultPostLamports: v5.values?.[0]?.lamports,
  },
};
await writeFile(
  new URL("./simulation-verification.json", import.meta.url),
  json(report),
);
if (
  v3.report.err ||
  v4.report.err ||
  v5.report.err ||
  v5.values?.[0]?.lamports !== rentMinimum
)
  throw new Error("Mainnet simulation check failed; inspect reports");
