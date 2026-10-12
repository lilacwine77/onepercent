/**
 * Local-validator acceptance drill. Starts no application service, sets every
 * pause bit, and drives the standalone onepct-rescue bundle against the
 * validator's RPC URL with disposable fixture signers.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { SEASON } from "@onepercent/config";
import {
  EXTERNAL_IDS,
  binderPda,
  configPda,
  deckPda,
  machinePda,
  ledgerPda,
  pullPda,
  userAta,
  vaultAta,
  decodeBinder,
  decodeConfig,
  decodeDeck,
  decodeMachine,
  decodeMintLedger,
  decodePull,
  encodeBinder,
  encodeConfig,
  encodeDeck,
  encodeMachine,
  encodeMintLedger,
  encodePull,
  splitPack,
} from "@onepercent/sdk";

interface AccountFile {
  pubkey: string;
  account: {
    lamports: number;
    data: [string, string];
    owner: string;
    executable: boolean;
    rentEpoch: number;
    space: number;
  };
}
interface Manifest {
  programs: { address: string; file: string }[];
  accounts: { address: string; file: string }[];
  wallets: Record<
    "buyer" | "depositor" | "intake" | "payer",
    { publicKey: string; secretKey: number[] }
  >;
  pull: string;
  baseTime: number;
}
const app = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
function launch(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, {
    cwd: app,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-200_000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const done = new Promise<number>((yes, no) => {
    child.once("error", no);
    child.once("exit", (code) => yes(code ?? 1));
  });
  void done.catch(() => {});
  return { child, done, output: () => output };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((yes) => child.once("exit", () => yes())),
    delay(5000).then(() => {
      child.kill("SIGKILL");
    }),
  ]);
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise<void>((yes, no) =>
    server.close((e) => (e ? no(e) : yes())),
  );
  return address.port;
}
function data(account: AccountFile) {
  return Buffer.from(account.account.data[0], "base64");
}
function replace(account: AccountFile, bytes: Buffer) {
  account.account.data = [bytes.toString("base64"), "base64"];
  account.account.space = bytes.length;
}
async function sumLamports(connection: Connection, addresses: PublicKey[]) {
  const rows = await connection.getMultipleAccountsInfo(addresses, "confirmed");
  return rows.reduce((sum, row) => sum + BigInt(row?.lamports ?? 0), 0n);
}

// Phase 3 runs each exit as its own command; the others run `all`.
const INDIVIDUAL_PHASE = 3;
// Phase 4 keeps a buyer's season spend unclaimed: Close My cards must wait (D18).
const FINAL_NOT_CLAIMED_PHASE = 4;
// The phase advance_phase reaches from each drilled phase with the fixture timeline.
const CRANKED_PHASE = [1, 1, 4, 4, 4, 6, 6] as const;

export async function runRescueDrill(phase: number): Promise<void> {
  assert(Number.isInteger(phase) && phase >= 0 && phase <= 6);
  const directory = await mkdtemp(join(tmpdir(), "onepercent-rescue-"));
  let validator: ReturnType<typeof launch> | undefined;
  try {
    // The drill runs the distributed artifact, not the workspace build.
    const bundler = launch(process.execPath, [
      "packages/cli/scripts/rescue-bundle.mjs",
      join(directory, "release"),
    ]);
    assert.equal(await bundler.done, 0, bundler.output());
    const release = JSON.parse(
      bundler
        .output()
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .at(-1)!,
    ) as { sha256: string };
    const cliEntry = join(directory, "release", "onepct-rescue.cjs");
    await access(cliEntry);
    const binary = process.env.SOLANA_TEST_VALIDATOR ?? "solana-test-validator";
    const version = launch(binary, ["--version"]);
    assert.equal(await version.done, 0, version.output());
    assert.match(version.output(), /\b4\.3\.0\b/);
    for (const name of ["onepercent", "mock_vrf"]) {
      const bytes = await readFile(join(app, "target/deploy", `${name}.so`));
      assert.equal(bytes.subarray(0, 6).toString("hex"), "7f454c460201");
      assert.equal(
        bytes.readUInt32LE(48),
        3,
        "Use the deployable sBPFv3 build",
      );
    }
    const fixtureDirectory = join(directory, "fixtures");
    const exporter = launch(
      process.execPath,
      [
        "scripts/program.mjs",
        "test",
        "--test",
        "export_fixtures",
        "--",
        "--nocapture",
      ],
      {
        ...process.env,
        FIXTURE_DIR: fixtureDirectory,
        FIXTURE_FLOW: "refund",
        FIXTURE_NOW: String(Math.floor(Date.now() / 1000)),
      },
    );
    assert.equal(await exporter.done, 0, exporter.output());
    const manifest = JSON.parse(
      await readFile(join(fixtureDirectory, "manifest.json"), "utf8"),
    ) as Manifest;
    const accounts = new Map<string, AccountFile>();
    for (const row of manifest.accounts) {
      accounts.set(
        row.address,
        JSON.parse(
          await readFile(join(fixtureDirectory, row.file), "utf8"),
        ) as AccountFile,
      );
    }
    const account = (address: PublicKey) => {
      const row = accounts.get(address.toBase58());
      assert(row);
      return row;
    };
    const programId = new PublicKey(
      account(new PublicKey(manifest.pull)).account.owner,
    );
    const owner = new PublicKey(manifest.wallets.buyer.publicKey);
    const binderAddress = binderPda(programId, owner)[0];
    const deckAccount = account(deckPda(programId)[0]);
    const deck = decodeDeck(data(deckAccount));
    const entry = deck.entries[0]!;
    const mint = entry.mint;
    const mintAccount = account(mint);
    const tokenProgram = new PublicKey(mintAccount.account.owner);
    const ledgerAddress = ledgerPda(programId, mint)[0];
    const vaultAddress = vaultAta(programId, mint, tokenProgram);
    const destination = userAta(owner, mint, tokenProgram);
    const unit = entry.amount;
    const tokenAmount = unit * 11n;
    const donation = 7n; // Non-economic local fixture donation; Close vault must burn it.
    const ledgerAccount = account(ledgerAddress);
    replace(
      ledgerAccount,
      encodeMintLedger({
        ...decodeMintLedger(data(ledgerAccount)),
        payer: owner,
        accounted: tokenAmount,
      }),
    );
    const vaultAccount = account(vaultAddress);
    const vaultBytes = data(vaultAccount);
    vaultBytes.writeBigUInt64LE(tokenAmount + donation, 64);
    replace(vaultAccount, vaultBytes);
    const mintBytes = data(mintAccount);
    mintBytes.writeBigUInt64LE(tokenAmount + donation, 36);
    replace(mintAccount, mintBytes);
    replace(
      deckAccount,
      encodeDeck({
        ...deck,
        len: 2,
        cap: 2,
        entries: [
          { ...entry, depositor: owner, flags: 1 },
          { ...entry, depositor: owner, flags: 2 },
        ],
      }),
    );
    const binderAccount = account(binderAddress);
    const binder = decodeBinder(data(binderAccount));
    const pendingAddress = new PublicKey(manifest.pull);
    const pendingAccount = account(pendingAddress);
    const pending = decodePull(data(pendingAccount));
    // Non-economic local fixture: owed SOL the Binder holds for its owner.
    const owed = 1_234_567n;
    // Fixture funding is intentionally surplus; no hard-coded rent rate is used.
    binderAccount.account.lamports +=
      deckAccount.account.lamports + Number(owed);
    replace(
      binderAccount,
      encodeBinder({
        ...binder,
        sol_owed: owed,
        // A buyer with season spend keeps My cards until the Final Pull claims.
        season_spend: phase >= FINAL_NOT_CLAIMED_PHASE ? pending.price : 0n,
        flags: phase > FINAL_NOT_CLAIMED_PHASE ? 3 : 0,
        fresh_in_deck: 2,
        pull_nonce: 2,
        len: 9,
        cap: 9 + binder.reserved,
        cards: Array.from({ length: 9 }, (_, kind) => ({
          mint,
          amount: unit,
          kind,
        })),
      }),
    );
    const [revealedAddress, revealedBump] = pullPda(programId, owner, 1);
    const zeroPayee = Keypair.generate().publicKey;
    const royalty = splitPack(pending.price).royalty;
    const refund = BigInt(entry.deposit);
    const referral = splitPack(pending.price).referral;
    const revealed: AccountFile = structuredClone(pendingAccount);
    revealed.pubkey = revealedAddress.toBase58();
    replace(
      revealed,
      encodePull({
        ...pending,
        seq: pending.seq + 1n,
        buyer_nonce: 1,
        bump: revealedBump,
        status: 2,
        referrer: SYSVAR_RENT_PUBKEY,
        packs: [
          {
            backing: 255,
            house_mask: 8,
            fresh_mask: 1,
            royalties: [
              owner,
              EXTERNAL_IDS.magicblockVrf,
              zeroPayee,
              owner,
            ].map((depositor) => ({ depositor, lamports: royalty, refund })),
          },
        ],
      }),
    );
    accounts.set(revealedAddress.toBase58(), revealed);
    manifest.accounts.push({
      address: revealedAddress.toBase58(),
      file: `${revealedAddress.toBase58()}.json`,
    });
    // Every pause bit and role is off; only chain time drives the phase crank.
    const now = BigInt(manifest.baseTime);
    const configAccount = account(configPda(programId)[0]);
    replace(
      configAccount,
      encodeConfig({
        ...decodeConfig(data(configAccount)),
        admin_paused: 255,
        guardian_paused: 255,
        disabled_roles: 255,
        season_set: 1,
        stock_up_ts: now - 60n,
      }),
    );
    const machineAccount = account(machinePda(programId)[0]);
    const machine = decodeMachine(data(machineAccount));
    replace(
      machineAccount,
      encodeMachine({
        ...machine,
        phase,
        next_seq: pending.seq + 2n,
        ...(phase >= 2 ? { on_air_ts: now - 120n, end_ts: now - 60n } : {}),
        ...(phase >= 5
          ? { final_ts: now - BigInt(SEASON.sealDelaySeconds) - 60n }
          : {}),
      }),
    );
    for (const [address, row] of accounts) {
      // The local genesis does not need historical rent epochs (which may exceed JSON number precision).
      row.account.rentEpoch = 0;
      await writeFile(
        join(fixtureDirectory, `${address}.json`),
        JSON.stringify(row),
      );
    }
    const keyFile = join(directory, "owner.json");
    await writeFile(keyFile, JSON.stringify(manifest.wallets.buyer.secretKey), {
      mode: 0o600,
    });
    // An unrelated wallet pays the permissionless exits and the crank.
    const feePayer = Keypair.generate();
    const feePayerFile = join(directory, "fee-payer.json");
    await writeFile(feePayerFile, JSON.stringify([...feePayer.secretKey]), {
      mode: 0o600,
    });
    const port = await freePort();
    const args = [
      "--reset",
      "--quiet",
      "--ledger",
      join(directory, "ledger"),
      "--bind-address",
      "127.0.0.1",
      "--rpc-port",
      String(port),
      "--faucet-port",
      String(await freePort()),
      "--upgradeable-program",
      programId.toBase58(),
      join(app, "target/deploy/onepercent.so"),
      manifest.wallets.payer.publicKey,
      "--bpf-program",
      EXTERNAL_IDS.magicblockVrf.toBase58(),
      join(app, "target/deploy/mock_vrf.so"),
    ];
    for (const p of manifest.programs)
      args.push(
        "--bpf-program",
        p.address,
        isAbsolute(p.file) ? p.file : join(fixtureDirectory, p.file),
      );
    for (const row of manifest.accounts)
      args.push(
        "--account",
        row.address,
        join(fixtureDirectory, `${row.address}.json`),
      );
    validator = launch(binary, args);
    const rpc = `http://127.0.0.1:${port}`;
    const connection = new Connection(rpc, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
    const started = Date.now();
    let ready = false;
    while (Date.now() - started < 60_000) {
      assert.equal(validator.child.exitCode, null, validator.output());
      try {
        if ((await connection.getSlot("confirmed")) >= 2) {
          ready = true;
          break;
        }
      } catch {
        /* Validator is starting. */
      }
      await delay(250);
    }
    assert(ready, validator.output());
    await connection.requestAirdrop(feePayer.publicKey, LAMPORTS_PER_SOL);
    while ((await connection.getBalance(feePayer.publicKey, "confirmed")) === 0)
      await delay(250);
    const balances = [
      owner,
      binderAddress,
      deckPda(programId)[0],
      pendingAddress,
      revealedAddress,
      ledgerAddress,
      vaultAddress,
      destination,
      machinePda(programId)[0],
      zeroPayee,
    ];
    const beforeLamports = await sumLamports(connection, balances);
    const machineBefore = decodeMachine(
      (await connection.getAccountInfo(machinePda(programId)[0]))!.data,
    );
    const common = [
      cliEntry,
      "--cluster",
      "localnet",
      "--program",
      programId.toBase58(),
      "--rpc",
      rpc,
      "--json",
    ];
    const cli = (args: string[]) =>
      launch(process.execPath, [...common, ...args]);
    const allArgs = ["all", "--keypair", keyFile, "--yes"];
    const individual = phase === INDIVIDUAL_PHASE;
    let partialOutput = "";
    if (phase === 0) {
      const partial = cli([...allArgs, "--max", "1"]);
      assert.equal(await partial.done, 2, partial.output());
      partialOutput = partial.output();
      assert.equal(
        await connection.getAccountInfo(pendingAddress),
        null,
        "The first limited transaction landed",
      );
      assert(
        await connection.getAccountInfo(revealedAddress),
        "Remaining exits await the next invocation",
      );
      assert.equal(
        decodeBinder((await connection.getAccountInfo(binderAddress))!.data)
          .len,
        9,
      );
    }
    const runs: { command: string; code: number }[] = [];
    let output = partialOutput;
    const commands = individual
      ? [
          ["refund", "--all-due", "--fee-payer", feePayerFile],
          ["settle", "--all-open", "--fee-payer", feePayerFile],
          ["redeem", "--all", "--keypair", keyFile],
          ["take-back", "--all", "--keypair", keyFile],
          ["withdraw-owed", "--keypair", keyFile],
          ["close-my-cards", "--keypair", keyFile],
          [
            "close-vaults",
            "--mint",
            mint.toBase58(),
            "--fee-payer",
            feePayerFile,
          ],
        ].map((args) => [...args, "--yes"])
      : [allArgs];
    for (const args of commands) {
      const run = cli(args);
      const code = await run.done;
      output += run.output();
      runs.push({ command: args[0]!, code });
      const expected = !individual && phase === FINAL_NOT_CLAIMED_PHASE ? 2 : 0;
      assert.equal(
        code,
        expected,
        `${args[0]} exited ${code}\n${run.output()}`,
      );
    }
    const records = output
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map(
        (line) =>
          JSON.parse(line) as {
            type?: string;
            action?: string;
            items?: { action: string; reason: string }[];
          },
      );
    const confirmedActions = records
      .filter((record) => record.type === "confirmed")
      .map((record) => record.action);
    const binderCloses = phase !== FINAL_NOT_CLAIMED_PHASE;
    assert.deepEqual(
      confirmedActions.filter(
        (action, index) =>
          index === 0 || action !== confirmedActions[index - 1],
      ),
      [
        "refund",
        "settle",
        "redeem",
        "take-back",
        "withdraw-owed",
        ...(binderCloses ? ["close-binder"] : []),
        "close-vault",
      ],
      "Actual transactions follow Get everything back order",
    );
    if (binderCloses)
      assert.equal(
        await connection.getAccountInfo(binderAddress),
        null,
        `My cards closed\n${output}`,
      );
    else {
      assert(
        records.some((record) =>
          record.items?.some(
            (item) =>
              item.action === "close-binder" &&
              item.reason.startsWith("FinalNotClaimed"),
          ),
        ),
        "The Final Pull precondition is reported",
      );
      const binderAfter = decodeBinder(
        (await connection.getAccountInfo(binderAddress))!.data,
      );
      assert.equal(binderAfter.len, 0, output);
      assert.equal(binderAfter.reserved, 0);
      assert.equal(binderAfter.fresh_in_deck, 0);
      assert.equal(binderAfter.sol_owed, 0n, "Owed SOL was withdrawn");
    }
    assert.equal(
      decodeDeck((await connection.getAccountInfo(deckPda(programId)[0]))!.data)
        .len,
      0,
    );
    for (const address of [
      pendingAddress,
      revealedAddress,
      ledgerAddress,
      vaultAddress,
    ])
      assert.equal(
        await connection.getAccountInfo(address),
        null,
        `${address.toBase58()} remains\n${output}`,
      );
    assert.equal(
      (await connection.getTokenAccountBalance(destination)).value.amount,
      tokenAmount.toString(),
    );
    assert.equal(
      (await connection.getTokenSupply(mint)).value.amount,
      tokenAmount.toString(),
      "Only the unaccounted donation is burned",
    );
    const machineAfter = decodeMachine(
      (await connection.getAccountInfo(machinePda(programId)[0]))!.data,
    );
    assert.equal(machineAfter.pending_pulls, 0n);
    assert.equal(machineAfter.reserved_dust, 0n);
    const creditField = phase >= 5 ? "burn_sol" : "stock_sol";
    // The executable depositor and reserved referrer redirect; D20 keeps the empty wallet writable.
    assert.equal(
      machineAfter[creditField] - machineBefore[creditField],
      royalty + refund + referral,
    );
    assert.equal(
      BigInt(await connection.getBalance(zeroPayee, "confirmed")),
      royalty + refund,
    );
    const signatures = await connection.getSignaturesForAddress(
      owner,
      {},
      "confirmed",
    );
    let fees = 0n;
    for (const { signature } of signatures) {
      const transaction = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      assert(transaction?.meta);
      assert.equal(transaction.meta.err, null);
      // Permissionless exits paid by the other wallet leave the owner's balance whole.
      if (transaction.transaction.message.staticAccountKeys[0]!.equals(owner))
        fees += BigInt(transaction.meta.fee);
    }
    assert(signatures.length > 0);
    assert.equal(
      await sumLamports(connection, balances),
      beforeLamports - fees,
      "All lamports end with their recorded owners or the documented redirect, less network fees",
    );
    // The permissionless crank, with every pause bit still set.
    const crank = cli([
      "crank",
      "advance-phase",
      "--fee-payer",
      feePayerFile,
      "--yes",
    ]);
    const crankCode = await crank.done;
    const crankedPhase = CRANKED_PHASE[phase]!;
    assert.equal(crankCode, crankedPhase === phase ? 4 : 0, crank.output());
    assert.equal(
      decodeMachine(
        (await connection.getAccountInfo(machinePda(programId)[0]))!.data,
      ).phase,
      crankedPhase,
      crank.output(),
    );
    const crankTransitions = crank
      .output()
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .filter(
        (line) => (JSON.parse(line) as { type?: string }).type === "confirmed",
      ).length;
    console.log(
      JSON.stringify({
        drill: "rescue",
        phase,
        status: "passed",
        absentServices: [
          "api",
          "indexer",
          "keeper",
          "executor",
          "postgres",
          "redis",
        ],
        pauses: "all set",
        rpc: "user-supplied local validator URL",
        cli: { artifact: "onepct-rescue.cjs", sha256: release.sha256 },
        mode: individual ? "individual commands" : "all",
        exits: [
          "refund_pull",
          "settle",
          "redeem",
          "take_back",
          "withdraw_owed",
          ...(binderCloses ? ["close_binder"] : []),
          "close_vault",
        ],
        cardKinds: 9,
        confirmedActions,
        partialResume: phase === 0,
        runs,
        owedWithdrawn: owed.toString(),
        closeBinder: binderCloses
          ? "closed"
          : "FinalNotClaimed reported (D18 precondition)",
        crank: {
          from: phase,
          to: crankedPhase,
          transitions: crankTransitions,
          exitCode: crankCode,
        },
        signatures: signatures.map((row) => row.signature),
        tokenAmount: tokenAmount.toString(),
        donationBurned: donation.toString(),
        fees: fees.toString(),
        deferred: ["claim_final_*", "start_final_pull"],
      }),
    );
  } finally {
    if (validator) await stop(validator.child);
    await rm(directory, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const phase = process.argv[2];
  for (const value of phase === undefined
    ? [0, 1, 2, 3, 4, 5, 6]
    : [Number(phase)])
    await runRescueDrill(value);
}
