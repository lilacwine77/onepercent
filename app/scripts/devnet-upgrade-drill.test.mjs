import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  assertArtifact,
  acquireRunLock,
  assertDevnet,
  assertMultisig,
  assertRetryable,
  assertV3,
  decodeProgramData,
  fundPayer,
  DEVNET_GENESIS,
  LOADER,
} from "./devnet-upgrade-drill.mjs";

const publicAddress = (byte) => new PublicKey(Buffer.alloc(32, byte));
const members = [1, 2, 3].map((byte) => ({ publicKey: publicAddress(byte) }));

describe("external devnet funding and resume", () => {
  function setup(state, balances) {
    const calls = [];
    return {
      calls,
      options: {
        state,
        payer: members[0],
        connection: {
          getBalance: async (payer, commitment) => {
            assert.ok(payer.equals(members[0].publicKey));
            assert.equal(commitment, "finalized");
            calls.push("balance");
            assert.ok(balances.length, "Unexpected balance read");
            return balances.shift();
          },
        },
        available: [
          { requestAirdrop: () => assert.fail("Unexpected faucet request") },
        ],
        save: () => calls.push("save"),
        confirmAirdrop: () => assert.fail("Unexpected receipt reconciliation"),
      },
    };
  }

  test("external funding bypasses unavailable old receipts and retains uncertain requests", async () => {
    const pendingAirdrop = { endpoint: "devnet.helius-rpc.com" };
    const state = { pendingAirdrop, airdrops: [{ signature: "old-receipt" }] };
    const { options, calls } = setup(state, [3_000_000_000, 3_000_000_000]);
    await fundPayer(options);
    assert.equal(state.funded, true);
    assert.equal(state.pendingAirdrop, pendingAirdrop);
    assert.deepEqual(calls, ["balance", "balance", "save"]);
  });

  test("insufficient external funding stops before a duplicate uncertain faucet request", async () => {
    const state = { pendingAirdrop: { endpoint: "devnet.helius-rpc.com" } };
    const { options, calls } = setup(state, [2_999_999_999, 2_999_999_999]);
    await assert.rejects(
      fundPayer(options),
      /externally fund this payer to 3 SOL/,
    );
    assert.equal(state.funded, undefined);
    assert.deepEqual(calls, ["balance", "balance"]);
  });

  test("a funded journal resumes without requiring rent already spent on accounts", async () => {
    const { options, calls } = setup({ funded: true }, []);
    await fundPayer(options);
    assert.deepEqual(calls, []);
  });

  test("an insufficient balance reconciles a saved credit before any new faucet request", async () => {
    const receipt = { signature: "saved-receipt" };
    const state = { airdrops: [receipt] };
    const { options, calls } = setup(state, [1_000_000_000, 3_000_000_000]);
    options.confirmAirdrop = async (saved) => {
      assert.equal(saved, receipt);
      calls.push("confirm");
    };
    await fundPayer(options);
    assert.equal(state.funded, true);
    assert.deepEqual(calls, ["balance", "confirm", "balance", "save"]);
  });
});

test("a run cannot be opened twice while its signing process is alive", () => {
  const directory = mkdtempSync(join(tmpdir(), "onepercent-drill-lock-"));
  try {
    const release = acquireRunLock(directory);
    assert.throws(() => acquireRunLock(directory), /already running/);
    release();
    acquireRunLock(directory)();
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("an unreadable owner identity cannot silently unlock a run", () => {
  const directory = mkdtempSync(join(tmpdir(), "onepercent-drill-lock-"));
  try {
    writeFileSync(join(directory, "run.lock"), "invalid");
    assert.throws(() => acquireRunLock(directory), /Invalid run lock/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("a stale lock is retained to prevent concurrent recovery from deleting a new lock", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "onepercent-drill-lock-"));
  const path = join(directory, "run.lock");
  try {
    writeFileSync(path, "1234");
    context.mock.method(process, "kill", () => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });
    assert.throws(
      () => acquireRunLock(directory),
      /remove run.lock explicitly/,
    );
    assert.equal(readFileSync(path, "utf8"), "1234");
  } finally {
    rmSync(directory, { recursive: true });
  }
});

function elfV3() {
  const bytes = Buffer.alloc(64);
  Buffer.from("7f454c4602010100", "hex").copy(bytes);
  bytes.writeUInt32LE(3, 48);
  return bytes;
}

function programData(authority = members[0].publicKey) {
  const header = Buffer.alloc(45);
  header.writeUInt32LE(3);
  header.writeBigUInt64LE(454626912n, 4);
  header[12] = authority ? 1 : 0;
  authority?.toBuffer().copy(header, 13);
  return { owner: LOADER, data: Buffer.concat([header, elfV3()]) };
}

function multisig() {
  return {
    threshold: 2,
    timeLock: 60,
    configAuthority: PublicKey.default,
    members: members.map((member) => ({
      key: member.publicKey,
      permissions: { mask: 7 },
    })),
  };
}

describe("devnet-only boundary", () => {
  test("accepts either approved HTTPS endpoint only with devnet genesis", () => {
    for (const endpoint of [
      "https://api.devnet.solana.com",
      "https://devnet.helius-rpc.com/?api-key=fixture",
    ]) {
      assert.doesNotThrow(() => assertDevnet(endpoint, DEVNET_GENESIS));
    }
  });

  test("rejects a mainnet genesis even when the endpoint says devnet", () => {
    assert.throws(() =>
      assertDevnet(
        "https://api.devnet.solana.com",
        "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      ),
    );
  });

  test("rejects insecure, mainnet and lookalike endpoints", () => {
    for (const endpoint of [
      "http://api.devnet.solana.com",
      "https://api.mainnet-beta.solana.com",
      "https://api.devnet.solana.com.example.invalid",
      "https://api.devnet.solana.com@example.invalid",
    ]) {
      assert.throws(() => assertDevnet(endpoint, DEVNET_GENESIS), endpoint);
    }
  });
});

describe("deploy artifact boundary", () => {
  test("accepts an ELF64 little-endian v3 header", () => {
    assert.doesNotThrow(() => assertV3(elfV3()));
  });

  test("rejects legacy format, incomplete and non-ELF artifacts", () => {
    const legacy = elfV3();
    legacy.writeUInt32LE(0, 48);
    for (const bytes of [legacy, elfV3().subarray(0, 63), Buffer.alloc(64)]) {
      assert.throws(() => assertV3(bytes));
    }
  });

  test("rejects incompatible ELF class and byte order", () => {
    const elf32 = elfV3();
    elf32[4] = 1;
    const bigEndian = elfV3();
    bigEndian[5] = 2;
    assert.throws(() => assertV3(elf32));
    assert.throws(() => assertV3(bigEndian));
  });

  test("accepts exact deployed bytes with optional zero allocation padding", () => {
    const artifact = elfV3();
    assert.doesNotThrow(() => assertArtifact(artifact, artifact));
    assert.doesNotThrow(() =>
      assertArtifact(Buffer.concat([artifact, Buffer.alloc(32)]), artifact),
    );
  });

  test("rejects changed, truncated or appended executable content", () => {
    const artifact = elfV3();
    const changed = Buffer.from(artifact);
    changed[63] = 1;
    const maliciousPadding = Buffer.concat([artifact, Buffer.alloc(32)]);
    maliciousPadding[maliciousPadding.length - 1] = 1;
    for (const deployed of [
      changed,
      artifact.subarray(0, -1),
      maliciousPadding,
      Buffer.concat([artifact, elfV3()]),
    ]) {
      assert.throws(() => assertArtifact(deployed, artifact));
    }
  });
});

describe("ProgramData authority evidence", () => {
  test("reads the deployment slot, authority and artifact without losing bytes", () => {
    const decoded = decodeProgramData(programData());
    assert.equal(decoded.slot, 454626912);
    assert.ok(decoded.authority.equals(members[0].publicKey));
    assert.deepEqual(decoded.bytes, elfV3());
  });

  test("recognizes removed authority from its option tag", () => {
    const sealed = programData();
    sealed.data[12] = 0;
    const decoded = decodeProgramData(sealed);
    assert.equal(decoded.authority, null);
    assert.deepEqual(decoded.bytes, elfV3());
  });

  test("rejects absent, foreign-owned and non-ProgramData accounts", () => {
    const programAccount = programData();
    programAccount.data.writeUInt32LE(2);
    for (const account of [
      null,
      { ...programData(), owner: SystemProgram.programId },
      programAccount,
    ]) {
      assert.throws(() => decodeProgramData(account));
    }
  });

  test("rejects incomplete authority metadata and invalid option tags", () => {
    const incomplete = programData();
    incomplete.data = incomplete.data.subarray(0, 44);
    const invalidOption = programData();
    invalidOption.data[12] = 2;
    assert.throws(() => decodeProgramData(incomplete));
    assert.throws(() => decodeProgramData(invalidOption));
  });
});

describe("saved transaction outcome reconciliation", () => {
  const saved = Object.freeze({ lastValidBlockHeight: 100 });

  test("permits rebroadcast only while an unknown transaction remains valid", () => {
    assert.equal(assertRetryable(saved, null, 99), "resend");
    assert.equal(assertRetryable(saved, null, 100), "resend");
  });

  test("refuses an expired unknown transaction instead of choosing a new identity", () => {
    assert.throws(() => assertRetryable(saved, null, 101), /unknown outcome/);
    assert.throws(
      () => assertRetryable(saved, undefined, 101),
      /unknown outcome/,
    );
  });

  test("waits for observed transactions after expiry and accepts finalized success", () => {
    for (const confirmationStatus of ["processed", "confirmed"]) {
      assert.equal(
        assertRetryable(saved, { confirmationStatus, err: null }, 101),
        "pending",
      );
    }
    assert.equal(
      assertRetryable(
        saved,
        { confirmationStatus: "finalized", err: null },
        101,
      ),
      "finalized",
    );
  });

  test("treats execution failure as failure at every confirmation stage", () => {
    for (const confirmationStatus of ["processed", "confirmed", "finalized"]) {
      assert.throws(
        () =>
          assertRetryable(
            saved,
            {
              confirmationStatus,
              err: { InstructionError: [0, { Custom: 6021 }] },
            },
            101,
          ),
        /Transaction failed/,
      );
    }
  });
});

describe("multisig authority transfer prerequisites", () => {
  test("accepts the intended 2-of-3 members, full permissions and 60-second delay", () => {
    const account = multisig();
    account.members.reverse();
    assert.doesNotThrow(() => assertMultisig(account, members));
  });

  test("rejects a single-signer threshold, shorter delay or external config authority", () => {
    for (const change of [
      { threshold: 1 },
      { timeLock: 0 },
      { timeLock: 59 },
      { configAuthority: publicAddress(4) },
    ]) {
      assert.throws(() =>
        assertMultisig({ ...multisig(), ...change }, members),
      );
    }
  });

  test("rejects replacement, duplicate or additional members", () => {
    const replaced = multisig();
    replaced.members[2].key = publicAddress(4);
    const duplicated = multisig();
    duplicated.members[2].key = members[0].publicKey;
    const additional = multisig();
    additional.members.push({
      key: publicAddress(4),
      permissions: { mask: 7 },
    });
    for (const account of [replaced, duplicated, additional]) {
      assert.throws(() => assertMultisig(account, members));
    }
  });

  test("rejects missing or unexpected permission bits before authority transfer", () => {
    for (const mask of [3, 255]) {
      const account = multisig();
      account.members[1].permissions.mask = mask;
      assert.throws(() => assertMultisig(account, members));
    }
  });
});
