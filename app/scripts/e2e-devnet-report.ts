import { DEVNET_GENESIS_HASH } from "../packages/config/src/genesis.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { EXTERNAL_IDS, SEEDS } from "../packages/sdk/src/constants.js";

const runId = process.argv[2];
assert(
  runId && /^[a-zA-Z0-9_-]{1,80}$/.test(runId),
  "Usage: e2e-devnet-report.ts run-id",
);
const app = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = join(app, "target/devnet-m1", runId);
const state = JSON.parse(
  await readFile(join(directory, "state.json"), "utf8"),
) as {
  payer: string;
  programId: string;
  fundingSignature: string;
  fundingAmount: string;
  transactions: Record<string, string>;
  artifactHash?: string;
  deployComplete?: boolean;
  feedComplete?: boolean;
};
const fixture = JSON.parse(
  await readFile(join(directory, "s1-report.json"), "utf8"),
) as {
  sourceUrl: string;
  idlHash: string;
  mint: string;
  creator: string;
  extensions: number[];
  curveBytes: number;
  amount: string;
  feeReceivedLamports: string;
  pumpSwapExecutable: boolean;
};
const funding = JSON.parse(
  await readFile(join(directory, "funding-transaction.json"), "utf8"),
) as { raw: string };
const source = Transaction.from(Buffer.from(funding.raw, "base64")).feePayer!;
const connection = new Connection(
  process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com",
  "confirmed",
);
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const transactions = [];
for (const [stage, signature] of Object.entries({
  funding: state.fundingSignature,
  ...state.transactions,
})) {
  await delay(1100);
  const receipt = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  assert(
    receipt?.meta && !receipt.meta.err,
    `Missing successful receipt for ${stage}`,
  );
  const keys = receipt.transaction.message.getAccountKeys();
  const change = (address: PublicKey) => {
    for (let i = 0; i < keys.length; i++)
      if (keys.get(i)?.equals(address))
        return String(
          BigInt(receipt.meta!.postBalances[i]!) -
            BigInt(receipt.meta!.preBalances[i]!),
        );
    return "0";
  };
  transactions.push({
    stage,
    signature,
    slot: receipt.slot,
    feeLamports: String(receipt.meta.fee),
    unitsConsumed: receipt.meta.computeUnitsConsumed,
    disposableDeltaLamports: change(new PublicKey(state.payer)),
    sourceDeltaLamports: change(source),
    creatorDeltaLamports: change(new PublicKey(fixture.creator)),
  });
}
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const program = new PublicKey(state.programId),
  mint = new PublicKey(fixture.mint);
const programPda = (seed: string, ...parts: PublicKey[]) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...parts.map((part) => part.toBuffer())],
    program,
  )[0];
const addresses = {
  source,
  disposable: new PublicKey(state.payer),
  program,
  programData: PublicKey.findProgramAddressSync(
    [program.toBuffer()],
    loader,
  )[0],
  mint,
  creator: new PublicKey(fixture.creator),
  curve: PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    EXTERNAL_IDS.pumpFun,
  )[0],
  creatorVault: PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), new PublicKey(fixture.creator).toBuffer()],
    EXTERNAL_IDS.pumpFun,
  )[0],
};
const tokenAta = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), EXTERNAL_IDS.token2022.toBuffer(), mint.toBuffer()],
    EXTERNAL_IDS.associatedToken,
  )[0];
const trackedAddresses: Record<string, PublicKey> = {
  ...addresses,
  userTokenAccount: tokenAta(new PublicKey(state.payer)),
  curveTokenAccount: tokenAta(addresses.curve),
  userVolume: PublicKey.findProgramAddressSync(
    [
      Buffer.from("user_volume_accumulator"),
      new PublicKey(state.payer).toBuffer(),
    ],
    EXTERNAL_IDS.pumpFun,
  )[0],
  curveV2: PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve-v2"), mint.toBuffer()],
    EXTERNAL_IDS.pumpFun,
  )[0],
  config: programPda(SEEDS.config),
  machine: programPda(SEEDS.machine),
  deck: programPda(SEEDS.deck),
  binder: programPda(SEEDS.binder, addresses.disposable),
  mintLedger: programPda(SEEDS.ledger, mint),
  tokenVault: tokenAta(programPda(SEEDS.vaultAuth)),
};
try {
  // Only the generated buffer's public address enters the report.
  const buffer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        await readFile(join(directory, "buffer-keypair.json"), "utf8"),
      ) as number[],
    ),
  );
  trackedAddresses.deploymentBuffer = buffer.publicKey;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const rentCache = new Map<number, number>();
interface PublicAccount {
  minimumRentLamports: string;
  address: string;
  exists: boolean;
  lamports: string;
  dataBytes: number;
  owner: string | null;
  executable: boolean;
}
const accounts: Record<string, PublicAccount> = {};
let deployedElfSha256: string | null = null;
for (const [name, address] of Object.entries(trackedAddresses)) {
  await delay(300);
  const info = await connection.getAccountInfo(address, "confirmed");
  const bytes = info?.data.length ?? 0;
  if (name === "programData" && info) {
    deployedElfSha256 = createHash("sha256")
      .update(info.data.subarray(45))
      .digest("hex");
    assert.equal(deployedElfSha256, state.artifactHash);
  }
  if (info && !rentCache.has(bytes))
    rentCache.set(
      bytes,
      await connection.getMinimumBalanceForRentExemption(bytes, "confirmed"),
    );
  accounts[name] = {
    minimumRentLamports: info ? String(rentCache.get(bytes)) : "0",
    address: address.toBase58(),
    exists: Boolean(info),
    lamports: String(info?.lamports ?? 0),
    dataBytes: info?.data.length ?? 0,
    owner: info?.owner.toBase58() ?? null,
    executable: info?.executable ?? false,
  };
}
const fundingLamports = BigInt(state.fundingAmount);
const currentDisposableLamports = BigInt(accounts.disposable!.lamports);
const netDisposableDebit = fundingLamports - currentDisposableLamports;
const journalDelta = transactions
  .filter((tx) => tx.stage !== "funding")
  .reduce((total, tx) => total + BigInt(tx.disposableDeltaLamports), 0n);
const deploymentDebit = netDisposableDebit + journalDelta;
const deploymentRetained = [
  "program",
  "programData",
  "deploymentBuffer",
].reduce((total, name) => total + BigInt(accounts[name]?.lamports ?? "0"), 0n);
assert(deploymentDebit >= deploymentRetained);
const deploymentFees = deploymentDebit - deploymentRetained;
const totalTrackedRent = Object.entries(accounts)
  .filter(([name]) => name !== "source" && name !== "disposable")
  .reduce(
    (total, [, account]) => total + BigInt(account.minimumRentLamports),
    0n,
  );
const returnedTokenAmount = (
  await connection.getTokenAccountBalance(
    trackedAddresses.userTokenAccount!,
    "confirmed",
  )
).value.amount;
if (state.feedComplete) assert.equal(returnedTokenAmount, fixture.amount);
const s1Transactions = transactions.filter((tx) => tx.stage.startsWith("s1-"));
const s1WalletDebit = -s1Transactions.reduce(
  (total, tx) => total + BigInt(tx.disposableDeltaLamports),
  0n,
);
const s1NetworkFees = s1Transactions.reduce(
  (total, tx) => total + BigInt(tx.feeLamports),
  0n,
);
const s1Rent = [
  "mint",
  "creator",
  "curve",
  "creatorVault",
  "userTokenAccount",
  "curveTokenAccount",
  "userVolume",
].reduce(
  (total, name) =>
    total +
    BigInt(
      (accounts[name] as { minimumRentLamports: string }).minimumRentLamports,
    ),
  0n,
);
let buildProof: Record<string, string | number> | null = null;
try {
  const raw = JSON.parse(
    await readFile(join(directory, "build-proof.json"), "utf8"),
  ) as Record<string, unknown>;
  buildProof = {};
  for (const key of [
    "sourceSha256",
    "artifactSha256",
    "canonicalParamsSha256",
    "isolatedParamsSha256",
  ]) {
    const value = raw[key];
    assert(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
    buildProof[key] = value;
  }
  for (const key of ["canonicalProgramId", "isolatedProgramId"]) {
    assert(typeof raw[key] === "string");
    buildProof[key] = new PublicKey(raw[key]).toBase58();
  }
  assert.equal(raw.sbpfFlags, 3);
  buildProof.sbpfFlags = 3;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
// Explicit allow-list: no runtime keypair, signed bytes, RPC URL, or secret path enters this report.
const report = {
  cluster: "devnet",
  recordedAt: new Date().toISOString(),
  runId,
  fundingLamports: state.fundingAmount,
  accounting: {
    sourceBalanceLamports: accounts.source!.lamports,
    disposableBalanceLamports: currentDisposableLamports.toString(),
    netDisposableDebitLamports: netDisposableDebit.toString(),
    trackedRentStillFundedLamports: totalTrackedRent.toString(),
    deployment: {
      method:
        "Funding minus current disposable balance, less journaled S1/application debits; retained loader accounts are separated from fees",
      netDisposableDebitLamports: deploymentDebit.toString(),
      retainedAccountLamports: deploymentRetained.toString(),
      networkFeesByBalanceReconciliationLamports: deploymentFees.toString(),
      bufferRemainingLamports: accounts.deploymentBuffer?.lamports ?? "0",
    },
    machineAboveRentLamports: (
      BigInt(accounts.machine!.lamports) -
      BigInt(accounts.machine!.minimumRentLamports)
    ).toString(),
  },
  s1Costs: {
    disposableDebitLamports: s1WalletDebit.toString(),
    networkFeeLamports: s1NetworkFees.toString(),
    rentFundedLamports: s1Rent.toString(),
    curvePurchaseIncludingProtocolAndCreatorFeesLamports: (
      s1WalletDebit -
      s1NetworkFees -
      s1Rent
    ).toString(),
  },
  programDeployed: state.deployComplete ?? false,
  feedAndTakeBackPassed: state.feedComplete ?? false,
  artifactSha256: state.artifactHash ?? null,
  deployedElfSha256,
  returnedTokenAmount,
  buildProof,
  fixture: {
    sourceUrl: fixture.sourceUrl,
    idlSha256: fixture.idlHash,
    mint: fixture.mint,
    creator: fixture.creator,
    extensions: fixture.extensions,
    curveBytes: fixture.curveBytes,
    tokenAmount: fixture.amount,
    creatorFeeReceivedLamports: fixture.feeReceivedLamports,
    pumpSwapExecutable: fixture.pumpSwapExecutable,
    mintAuthority: null,
    freezeAuthority: null,
    quote: "SOL",
    mayhem: false,
    cashback: false,
    holderMode: false,
  },
  transactions,
  accounts,
};
const destination = join(app, "fixtures/reports/devnet.json");
await writeFile(destination, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    report: destination,
    programDeployed: report.programDeployed,
    feedAndTakeBackPassed: report.feedAndTakeBackPassed,
    accounts,
  }),
);
