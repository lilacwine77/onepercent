import { DEVNET_GENESIS_HASH } from "../packages/config/dist/genesis.js";
import { assertUninitializedUpgrade } from "./devnet-upgrade-preflight.mjs";
import { broadcastSavedTransaction } from "./devnet-broadcast.mjs";
// Disposable devnet evidence only. Never accepts a wallet, program ID or RPC URL.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { utils } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as squads from "@sqds/multisig";

export const DEVNET_GENESIS = DEVNET_GENESIS_HASH;
export const LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const meta = (pubkey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
const loaderInstruction = (tag, keys, rest = Buffer.alloc(0)) =>
  new TransactionInstruction({
    programId: LOADER,
    keys,
    data: Buffer.concat([u32(tag), rest]),
  });

export function assertDevnet(endpoint, genesis) {
  const url = new URL(endpoint);
  assert.equal(url.protocol, "https:", "HTTPS required");
  assert.ok(
    ["devnet.helius-rpc.com", "api.devnet.solana.com"].includes(url.hostname),
    "Only the two fixed devnet endpoints are allowed",
  );
  assert.equal(genesis, DEVNET_GENESIS, "Refusing a non-devnet genesis");
}

export function assertV3(bytes) {
  assert.ok(bytes.length >= 64, "Truncated ELF");
  assert.equal(bytes.subarray(0, 4).toString("hex"), "7f454c46");
  assert.equal(bytes[4], 2, "ELF64 required");
  assert.equal(bytes[5], 1, "Little endian required");
  assert.equal(bytes.readUInt32LE(48), 3, "sBPFv3 required");
}

export function decodeProgramData(account) {
  assert.ok(account?.owner.equals(LOADER), "Incorrect ProgramData owner");
  const data = account.data;
  assert.ok(data.length >= 45, "Truncated ProgramData");
  assert.equal(data.readUInt32LE(0), 3, "Incorrect ProgramData tag");
  assert.ok([0, 1].includes(data[12]), "Incorrect authority option");
  return {
    slot: Number(data.readBigUInt64LE(4)),
    authority: data[12] === 1 ? new PublicKey(data.subarray(13, 45)) : null,
    bytes: data.subarray(45),
  };
}

export function assertArtifact(actual, expected) {
  assert.ok(actual.length >= expected.length, "Truncated deployed artifact");
  assert.ok(
    actual.subarray(0, expected.length).equals(expected),
    "Artifact mismatch",
  );
  assert.ok(
    actual.subarray(expected.length).every((byte) => byte === 0),
    "Nonzero padding",
  );
}

export function assertRetryable(entry, status, blockHeight) {
  if (status?.err)
    throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
  if (status?.confirmationStatus === "finalized") return "finalized";
  if (status) return "pending";
  assert.ok(
    blockHeight <= entry.lastValidBlockHeight,
    "Saved transaction expired with unknown outcome; reconcile it before any retry",
  );
  return "resend";
}

export function assertMultisig(account, members) {
  assert.equal(account.threshold, 2);
  assert.equal(account.timeLock, 60);
  assert.ok(account.configAuthority.equals(PublicKey.default));
  assert.equal(account.members.length, 3);
  assert.deepEqual(
    account.members
      .map((member) => `${member.key}:${member.permissions.mask}`)
      .sort(),
    members.map((member) => `${member.publicKey}:7`).sort(),
  );
}

export function acquireRunLock(directory) {
  const path = join(directory, "run.lock");
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 0, "Invalid run lock");
    try {
      process.kill(pid, 0);
      throw new Error("This drill is already running");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      throw new Error(
        "Inactive run lock; verify that its process exited, then remove run.lock explicitly",
        { cause: error },
      );
    }
  }
  writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
  return () => unlinkSync(path);
}

export async function fundPayer({
  state,
  connection,
  payer,
  available,
  save,
  confirmAirdrop,
}) {
  // Resuming after account creation must not require the initial rent budget again.
  if (state.funded) return;
  const balance = await connection.getBalance(payer.publicKey, "finalized");
  console.log(
    `Devnet payer ${payer.publicKey.toBase58()}: ${balance} lamports; initial minimum 3000000000`,
  );
  if (balance < 3_000_000_000) {
    for (const receipt of state.airdrops ?? []) await confirmAirdrop(receipt);
  }
  while (
    (await connection.getBalance(payer.publicKey, "finalized")) < 3_000_000_000
  ) {
    assert.ok(
      !state.pendingAirdrop,
      "Insufficient devnet balance and uncertain faucet request; externally fund this payer to 3 SOL, then rerun with the same run-id",
    );
    assert.ok((state.airdrops?.length ?? 0) < 2, "Faucet budget exhausted");
    let receipt;
    for (const faucet of available) {
      state.pendingAirdrop = {
        endpoint: new URL(faucet.rpcEndpoint).hostname,
        requestedAt: new Date().toISOString(),
      };
      save();
      let signature;
      try {
        signature = await faucet.requestAirdrop(payer.publicKey, 2_000_000_000);
      } catch (error) {
        // A JSON-RPC rejection or HTTP429 is explicit. Other transport failures
        // leave pendingAirdrop in place for reconciliation, without a new request.
        const httpStatus = Number(
          String(error.message).match(/^(\d{3})\s/)?.[1],
        );
        if (
          typeof error.code !== "number" &&
          ![400, 401, 403, 404, 405, 422, 429].includes(httpStatus)
        )
          throw new Error("Uncertain faucet request", { cause: error });
        console.log(
          `Airdrop rejected: ${new URL(faucet.rpcEndpoint).hostname}`,
        );
        state.airdropRejections ??= [];
        state.airdropRejections.push({
          ...state.pendingAirdrop,
          code: error.code ?? httpStatus,
        });
        delete state.pendingAirdrop;
        save();
        continue;
      }
      receipt = { signature, endpoint: new URL(faucet.rpcEndpoint).hostname };
      state.airdrops ??= [];
      state.airdrops.push(receipt);
      delete state.pendingAirdrop;
      save();
      await confirmAirdrop(receipt);
      break;
    }
    assert.ok(
      receipt,
      "Devnet faucets unavailable; rerun later with the same run-id",
    );
  }
  state.funded = true;
  save();
}

export async function main(argv = process.argv.slice(2)) {
  let releaseLock;
  try {
    await run(argv, (release) => {
      releaseLock = release;
    });
  } finally {
    releaseLock?.();
  }
}

async function run(argv, setReleaseLock) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "run-id": { type: "string", default: "m01" },
      "env-file": { type: "string", default: join(appDirectory, ".env.local") },
    },
  });
  assert.match(values["run-id"], /^[a-zA-Z0-9_-]{1,64}$/);
  const artifact = readFileSync(
    join(appDirectory, "target/deploy/onepercent.so"),
  );
  assertV3(artifact);
  const env = existsSync(values["env-file"])
    ? parseEnv(readFileSync(values["env-file"], "utf8"))
    : {};
  const endpoints = [];
  if (env.HELIUS_API_KEY) {
    endpoints.push(
      `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`,
    );
  }
  endpoints.push("https://api.devnet.solana.com");
  // Disable web3's automatic 429 logging, which can contain credential-bearing URLs.
  const connections = endpoints.map(
    (endpoint) =>
      new Connection(endpoint, {
        commitment: "finalized",
        disableRetryOnRateLimit: true,
      }),
  );
  const available = [];
  for (const connection of connections) {
    try {
      assertDevnet(connection.rpcEndpoint, await connection.getGenesisHash());
      available.push(connection);
    } catch {
      console.log(
        `Devnet endpoint unavailable: ${new URL(connection.rpcEndpoint).hostname}`,
      );
    }
  }
  assert.ok(available.length, "No verified devnet RPC available");
  const connection = available[0];
  const directory = join(
    homedir(),
    ".local/share/onepercent/devnet-upgrade-drill",
    values["run-id"],
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  setReleaseLock(acquireRunLock(directory));
  const statePath = join(directory, "state.json");
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : {
        schema: 1,
        genesis: DEVNET_GENESIS,
        artifactSha256: hash(artifact),
        startedAt: new Date().toISOString(),
        keys: {},
        transactions: {},
        observations: {},
      };
  assert.equal(state.schema, 1);
  assert.equal(state.genesis, DEVNET_GENESIS);
  assert.equal(
    state.artifactSha256,
    hash(artifact),
    "Artifact changed during drill",
  );
  const save = () => {
    writeFileSync(`${statePath}.tmp`, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(`${statePath}.tmp`, statePath);
  };
  const key = (name) => {
    const path = join(directory, `${name}.keypair.json`);
    if (!existsSync(path)) {
      assert.ok(!state.keys[name], `Missing previously recorded key: ${name}`);
      writeFileSync(path, JSON.stringify([...Keypair.generate().secretKey]), {
        flag: "wx",
        mode: 0o600,
      });
    }
    chmodSync(path, 0o600);
    const signer = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
    );
    assert.equal(
      state.keys[name] ?? signer.publicKey.toBase58(),
      signer.publicKey.toBase58(),
    );
    state.keys[name] = signer.publicKey.toBase58();
    save();
    return signer;
  };
  const payer = key("payer-member-1");
  const members = [payer, key("member-2"), key("member-3")];
  const program = key("program");
  const createKey = key("multisig-create");
  const programData = PublicKey.findProgramAddressSync(
    [program.publicKey.toBuffer()],
    LOADER,
  )[0];
  const [multisigPda] = squads.getMultisigPda({
    createKey: createKey.publicKey,
  });
  const [vaultPda] = squads.getVaultPda({ multisigPda, index: 0 });
  state.addresses = {
    program: program.publicKey.toBase58(),
    programData: programData.toBase58(),
    payer: payer.publicKey.toBase58(),
    multisig: multisigPda.toBase58(),
    vault: vaultPda.toBase58(),
    members: members.map((member) => member.publicKey.toBase58()),
  };
  save();
  console.log(`Devnet drill ${values["run-id"]}: ${program.publicKey}`);

  const sign = async (instructions, signers = [payer], lookupTables = []) => {
    const latest = await connection.getLatestBlockhash();
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latest.blockhash,
        instructions,
      }).compileToV0Message(lookupTables),
    );
    transaction.sign(signers);
    return { transaction, ...latest };
  };
  const send = async (
    label,
    instructions,
    signers = [payer],
    lookupTables = [],
  ) => {
    let entry = state.transactions[label];
    if (!entry) {
      const signed = await sign(instructions, signers, lookupTables);
      entry = {
        signature: utils.bytes.bs58.encode(signed.transaction.signatures[0]),
        raw: Buffer.from(signed.transaction.serialize()).toString("base64"),
        lastValidBlockHeight: signed.lastValidBlockHeight,
      };
      state.transactions[label] = entry;
      save(); // Persist the exact signed transaction before the first broadcast.
    }
    for (let attempt = 0; attempt < 120; attempt++) {
      const status = (
        await connection.getSignatureStatuses([entry.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      const action = assertRetryable(
        entry,
        status,
        await connection.getBlockHeight(),
      );
      // Upload chunks have no irreversible effect. Let them pipeline at confirmed,
      // then wait for a finalized slot covering every write before reading bytes.
      if (
        action === "finalized" ||
        (label.includes("/write/") &&
          status?.confirmationStatus === "confirmed")
      ) {
        entry.slot = status.slot;
        entry.finalized = action === "finalized";
        save();
        return entry;
      }
      if (action === "resend") {
        await broadcastSavedTransaction(
          connection,
          entry,
          label === "direct-upgrade" || label === "upgrade/execute"
            ? () => assertUninitializedUpgrade(connection, program.publicKey)
            : undefined,
        );
      }
      await delay(1000);
    }
    throw new Error(
      `Confirmation pending for ${label}; rerun with the same run-id`,
    );
  };
  const observe = (label, value) => {
    state.observations[label] ??= value;
    save();
    console.log(`${label}: ${JSON.stringify(state.observations[label])}`);
  };
  const checkProgram = async (authority) => {
    const account = await connection.getAccountInfo(program.publicKey);
    assert.ok(account?.executable && account.owner.equals(LOADER));
    assert.equal(account.data.readUInt32LE(0), 2);
    assert.ok(new PublicKey(account.data.subarray(4, 36)).equals(programData));
    const data = decodeProgramData(
      await connection.getAccountInfo(programData),
    );
    assert.equal(
      data.authority?.toBase58() ?? null,
      authority?.toBase58() ?? null,
    );
    assertArtifact(data.bytes, artifact);
    return {
      deploymentSlot: data.slot,
      authority: data.authority?.toBase58() ?? null,
      sha256: hash(data.bytes.subarray(0, artifact.length)),
    };
  };
  if (state.completedAt) {
    await checkProgram(null);
    console.log(`Already complete: ${join(directory, "report.json")}`);
    return;
  }

  // At most two successful 2-SOL faucet requests, always for this same payer.
  // An uncertain request is never replaced by another one on restart.
  const confirmAirdrop = async (receipt) => {
    for (let poll = 0; poll < 90; poll++) {
      const status = (
        await connection.getSignatureStatuses([receipt.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      assert.ok(!status?.err, "Airdrop transaction failed");
      if (status?.confirmationStatus === "finalized") {
        receipt.slot = status.slot;
        save();
        return;
      }
      await delay(1000);
    }
    throw new Error(
      "Airdrop confirmation unknown; reconcile recorded signature before proceeding",
    );
  };
  await fundPayer({
    state,
    connection,
    payer,
    available,
    save,
    confirmAirdrop,
  });

  const buffer = async (name) => {
    const signer = key(name);
    const space = artifact.length + 37;
    await send(
      `${name}/create`,
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: signer.publicKey,
          lamports: await connection.getMinimumBalanceForRentExemption(space),
          space,
          programId: LOADER,
        }),
        loaderInstruction(0, [
          meta(signer.publicKey, true),
          meta(payer.publicKey),
        ]),
      ],
      [payer, signer],
    );
    const chunks = [];
    for (let offset = 0; offset < artifact.length; offset += 800)
      chunks.push(offset);
    let cursor = 0;
    let uploadError;
    const workers = await Promise.allSettled(
      Array.from({ length: 6 }, async () => {
        while (!uploadError && cursor < chunks.length) {
          const offset = chunks[cursor++];
          const bytes = artifact.subarray(offset, offset + 800);
          try {
            await send(`${name}/write/${offset}`, [
              loaderInstruction(
                1,
                [
                  meta(signer.publicKey, true),
                  meta(payer.publicKey, false, true),
                ],
                Buffer.concat([u32(offset), u64(bytes.length), bytes]),
              ),
            ]);
          } catch (error) {
            uploadError = error;
            throw error;
          }
        }
      }),
    );
    const failed = workers.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const writes = Object.entries(state.transactions)
      .filter(([label]) => label.startsWith(`${name}/write/`))
      .map(([, entry]) => entry);
    const lastWriteSlot = Math.max(...writes.map((entry) => entry.slot));
    while ((await connection.getSlot()) < lastWriteSlot) await delay(1000);
    const account = await connection.getAccountInfo(signer.publicKey);
    assert.ok(account?.owner.equals(LOADER));
    assert.equal(account.data.readUInt32LE(0), 1);
    assert.equal(account.data[4], 1);
    assert.ok(
      new PublicKey(account.data.subarray(5, 37)).equals(payer.publicKey),
    );
    assertArtifact(account.data.subarray(37), artifact);
    assert.ok(
      account.lamports >=
        (await connection.getMinimumBalanceForRentExemption(space)),
    );
    const statuses = (
      await connection.getSignatureStatuses(
        writes.map((entry) => entry.signature),
        { searchTransactionHistory: true },
      )
    ).value;
    for (let index = 0; index < writes.length; index++) {
      assert.equal(statuses[index]?.confirmationStatus, "finalized");
      assert.equal(statuses[index].err, null);
      writes[index].slot = statuses[index].slot;
      writes[index].finalized = true;
    }
    save();
    return signer.publicKey;
  };
  const upgrade = (bufferAddress, authority) =>
    loaderInstruction(3, [
      meta(programData, true),
      meta(program.publicKey, true),
      meta(bufferAddress, true),
      meta(payer.publicKey, true),
      meta(SYSVAR_RENT_PUBKEY),
      meta(SYSVAR_CLOCK_PUBKEY),
      meta(authority, false, true),
    ]);
  const authorityInstruction = (target, current, next = null) =>
    loaderInstruction(4, [
      meta(target, true),
      meta(current, false, true),
      ...(next ? [meta(next)] : []),
    ]);

  if (!state.observations.deployed) {
    if (!state.transactions.deploy) {
      const initial = await buffer("initial-buffer");
      await send(
        "deploy",
        [
          SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: program.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(36),
            space: 36,
            programId: LOADER,
          }),
          loaderInstruction(
            2,
            [
              meta(payer.publicKey, true, true),
              meta(programData, true),
              meta(program.publicKey, true),
              meta(initial, true),
              meta(SYSVAR_RENT_PUBKEY),
              meta(SYSVAR_CLOCK_PUBKEY),
              meta(SystemProgram.programId),
              meta(payer.publicKey, false, true),
            ],
            u64(artifact.length),
          ),
        ],
        [payer, program],
      );
    } else await send("deploy");
    observe("deployed", await checkProgram(payer.publicKey));
  }
  if (!state.observations.directUpgrade) {
    if (!state.transactions["direct-upgrade"]) {
      const direct = await buffer("direct-buffer");
      await send("direct-upgrade", [upgrade(direct, payer.publicKey)]);
    } else await send("direct-upgrade");
    const result = await checkProgram(payer.publicKey);
    assert.ok(
      result.deploymentSlot > state.observations.deployed.deploymentSlot,
    );
    observe("directUpgrade", result);
  }

  const squadsProgram = await connection.getAccountInfo(squads.PROGRAM_ID);
  assert.ok(squadsProgram?.executable && squadsProgram.owner.equals(LOADER));
  const config = await squads.accounts.ProgramConfig.fromAccountAddress(
    connection,
    squads.getProgramConfigPda({})[0],
  );
  assert.equal(
    config.multisigCreationFee.toString(),
    "0",
    "Unexpected Squads creation fee",
  );
  await send(
    "multisig-create",
    [
      squads.instructions.multisigCreateV2({
        treasury: config.treasury,
        creator: payer.publicKey,
        multisigPda,
        configAuthority: null,
        threshold: 2,
        members: members.map((member) => ({
          key: member.publicKey,
          permissions: squads.types.Permissions.all(),
        })),
        timeLock: 60,
        createKey: createKey.publicKey,
        rentCollector: null,
      }),
    ],
    [payer, createKey],
  );
  assertMultisig(
    await squads.accounts.Multisig.fromAccountAddress(connection, multisigPda),
    members,
  );
  if (!state.observations.transferred) {
    await send("authority-to-vault", [
      authorityInstruction(programData, payer.publicKey, vaultPda),
    ]);
    observe("transferred", await checkProgram(vaultPda));
  }

  const chainTime = async () => {
    const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    return Number(clock.data.readBigInt64LE(32));
  };
  const simulate = async (label, instructions, expected, lookupTables = []) => {
    const { transaction } = await sign(instructions, [payer], lookupTables);
    const result = await connection.simulateTransaction(transaction, {
      sigVerify: true,
      commitment: "finalized",
    });
    assert.ok(result.value.err, `Expected failure for ${label}`);
    assert.deepEqual(result.value.err, { InstructionError: [0, expected] });
    if (expected === "Immutable")
      assert.ok(
        result.value.logs.some((line) =>
          line.includes("Program not upgradeable"),
        ),
      );
    observe(label, {
      slot: result.context.slot,
      error: result.value.err,
      logs: result.value.logs,
    });
  };
  const governed = async (name, instruction) => {
    state.proposals ??= {};
    if (!state.proposals[name]) {
      const account = await squads.accounts.Multisig.fromAccountAddress(
        connection,
        multisigPda,
      );
      state.proposals[name] = {
        index: (BigInt(account.transactionIndex.toString()) + 1n).toString(),
      };
      save();
    }
    const record = state.proposals[name];
    const transactionIndex = BigInt(record.index);
    await send(`${name}/transaction`, [
      squads.instructions.vaultTransactionCreate({
        multisigPda,
        transactionIndex,
        creator: payer.publicKey,
        vaultIndex: 0,
        ephemeralSigners: 0,
        transactionMessage: new TransactionMessage({
          payerKey: vaultPda,
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
          instructions: [instruction],
        }),
      }),
    ]);
    await send(`${name}/proposal`, [
      squads.instructions.proposalCreate({
        multisigPda,
        transactionIndex,
        creator: payer.publicKey,
        isDraft: false,
      }),
    ]);
    for (let index = 0; index < 2; index++) {
      await send(
        `${name}/approval-${index + 1}`,
        [
          squads.instructions.proposalApprove({
            multisigPda,
            transactionIndex,
            member: members[index].publicKey,
          }),
        ],
        index === 0 ? [payer] : [payer, members[index]],
      );
    }
    const proposalPda = squads.getProposalPda({
      multisigPda,
      transactionIndex,
    })[0];
    let proposal = await squads.accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda,
    );
    if (proposal.status.__kind !== "Executed") {
      assert.equal(proposal.status.__kind, "Approved");
      assert.equal(proposal.approved.length, 2);
      record.approvedAt = Number(proposal.status.timestamp.toString());
      record.executeAfter = record.approvedAt + 60;
      save();
      const { instruction: execution, lookupTableAccounts } =
        await squads.instructions.vaultTransactionExecute({
          connection,
          multisigPda,
          transactionIndex,
          member: payer.publicKey,
        });
      if (!state.observations[`${name}/timelock`]) {
        assert.ok(
          (await chainTime()) < record.executeAfter,
          "Timelock negative probe missed; retain run and investigate",
        );
        await simulate(
          `${name}/timelock`,
          [execution],
          { Custom: 6021 },
          lookupTableAccounts,
        );
      }
      while ((await chainTime()) < record.executeAfter) {
        console.log(`${name}: waiting for chain time ${record.executeAfter}`);
        await delay(5000);
      }
      await send(`${name}/execute`, [execution], [payer], lookupTableAccounts);
      proposal = await squads.accounts.Proposal.fromAccountAddress(
        connection,
        proposalPda,
      );
    } else await send(`${name}/execute`);
    assert.equal(proposal.status.__kind, "Executed");
    record.executedAt = Number(proposal.status.timestamp.toString());
    assert.ok(record.executedAt >= record.executeAfter);
    save();
  };
  if (!state.observations.governedUpgrade) {
    let governedBuffer;
    if (!state.proposals?.upgrade) {
      governedBuffer = state.transactions["buffer-to-vault"]
        ? new PublicKey(state.keys["governed-buffer"])
        : await buffer("governed-buffer");
      await send("buffer-to-vault", [
        authorityInstruction(governedBuffer, payer.publicKey, vaultPda),
      ]);
      const account = await connection.getAccountInfo(governedBuffer);
      assert.ok(account?.owner.equals(LOADER));
      assert.equal(account.data.readUInt32LE(0), 1);
      assert.equal(account.data[4], 1);
      assert.ok(new PublicKey(account.data.subarray(5, 37)).equals(vaultPda));
      assertArtifact(account.data.subarray(37), artifact);
    } else governedBuffer = new PublicKey(state.keys["governed-buffer"]);
    await governed("upgrade", upgrade(governedBuffer, vaultPda));
    const result = await checkProgram(vaultPda);
    assert.ok(
      result.deploymentSlot > state.observations.directUpgrade.deploymentSlot,
    );
    observe("governedUpgrade", result);
  }
  if (!state.observations.sealed) {
    await governed("seal", authorityInstruction(programData, vaultPda));
    observe("sealed", await checkProgram(null));
  }
  if (!state.observations.immutableUpgrade) {
    const proof = await buffer("immutable-proof-buffer");
    await simulate(
      "immutableUpgrade",
      [upgrade(proof, payer.publicKey)],
      "Immutable",
    );
    assert.ok(
      state.observations.immutableUpgrade.logs.some((line) =>
        line.includes("Program not upgradeable"),
      ),
    );
  }
  await checkProgram(null);
  state.completedAt = new Date().toISOString();
  const { transactions, ...report } = state;
  report.transactions = Object.fromEntries(
    Object.entries(transactions).map(
      ([label, { signature, slot, finalized }]) => [
        label,
        { signature, slot, finalized },
      ],
    ),
  );
  writeFileSync(
    join(directory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  save();
  console.log(
    `PASS: devnet lifecycle complete. Public evidence: ${join(directory, "report.json")}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    // RPC exceptions may embed URLs containing an API credential. Do not print them.
    const message = String(error.message).replace(
      /https?:\/\/[^\s"'<>]+/g,
      "[RPC URL redacted]",
    );
    console.error(
      `Drill stopped: ${message}. Inspect the public journal and rerun with the same run-id. No new transaction identity is chosen for an uncertain result.`,
    );
    process.exitCode = 1;
  });
}
