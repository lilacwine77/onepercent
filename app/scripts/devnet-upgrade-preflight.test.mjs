import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import { PAUSE_BITS } from "../packages/config/dist/index.js";
import {
  configLayout,
  configPda,
  machineLayout,
  machinePda,
} from "../packages/sdk/dist/index.js";
import {
  assertNoUnsettledPulls,
  assertUninitializedUpgrade,
  p3UpgradeGuard,
} from "./devnet-upgrade-preflight.mjs";

const program = new PublicKey("DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr");
const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const discriminator = createHash("sha256")
  .update("account:Pull")
  .digest()
  .subarray(0, 8);
function pull(status, mask, buyer = 1) {
  const data = Buffer.alloc(576);
  discriminator.copy(data);
  data.fill(buyer, 16, 48);
  data[143] = 2;
  data[144] = status;
  data.writeUInt16LE(mask, 140);
  const [pubkey] = PublicKey.findProgramAddressSync(
    [Buffer.from("pull"), data.subarray(16, 48), data.subarray(136, 140)],
    program,
  );
  return { pubkey, account: { owner: program, data } };
}
function fixture({ rows = [], guardianPaused = PAUSE_BITS.rip } = {}) {
  const f = {
    rows,
    slot: 123,
    guardianPaused,
    adminPaused: PAUSE_BITS.sellBack,
    initialized: true,
    machine: { last_reveal_ts: 0n },
    reads: [],
  };
  const result = (kind, options, value) => {
    assert.equal(options.commitment, "finalized");
    assert(Number.isSafeInteger(options.minContextSlot));
    const slot = f.slot++;
    f.reads.push({ kind, slot, minContextSlot: options.minContextSlot });
    return { context: { slot }, value };
  };
  const config = () => ({
    owner: program,
    data: configLayout.encode({
      guardian_paused: f.guardianPaused,
      admin_paused: f.adminPaused,
    }),
  });
  const machine = () => ({
    owner: program,
    data: machineLayout.encode(f.machine),
  });
  f.rpc = {
    getGenesisHash: async () => genesis,
    async getAccountInfoAndContext(address, options) {
      const isConfig = address.equals(configPda(program)[0]);
      assert(isConfig || address.equals(machinePda(program)[0]));
      return result(
        isConfig ? "config" : "machine",
        options,
        f.initialized ? (isConfig ? config() : machine()) : null,
      );
    },
    async getMultipleAccountsInfoAndContext(addresses, options) {
      assert.deepEqual(addresses, [
        configPda(program)[0],
        machinePda(program)[0],
      ]);
      return result(
        "config-and-machine",
        options,
        f.initialized ? [config(), machine()] : [null, null],
      );
    },
    async getProgramAccounts(id, options) {
      assert(id.equals(program));
      assert.equal(options.withContext, true);
      assert.deepEqual(options.filters, [
        {
          memcmp: {
            offset: 0,
            bytes: discriminator.toString("base64"),
            encoding: "base64",
          },
        },
      ]);
      return result("pulls", options, f.rows);
    },
  };
  return f;
}

test("inventory rejects Pending, revealed, partial and fully settled Pull accounts", async () => {
  for (const [status, mask] of [
    [1, 0],
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
  ]) {
    const row = pull(status, mask),
      f = fixture({ rows: [row] });
    await assert.rejects(
      assertNoUnsettledPulls(f.rpc, program),
      (error) =>
        error.message.includes("Pulls still exist") &&
        error.message.includes(row.pubkey.toBase58()),
    );
  }
  const f = fixture();
  assert.deepEqual(await assertNoUnsettledPulls(f.rpc, program), {
    slot: 124,
    pullsChecked: 0,
  });
});
test("inventory chains finalized slots after the pause and rechecks the pause afterwards", async () => {
  const f = fixture();
  await assertNoUnsettledPulls(f.rpc, program, 120);
  assert.deepEqual(f.reads, [
    { kind: "config", slot: 123, minContextSlot: 120 },
    { kind: "pulls", slot: 124, minContextSlot: 123 },
    { kind: "config", slot: 125, minContextSlot: 124 },
  ]);
});
test("an admin pause cannot replace a finalized guardian Rip pause", async () => {
  const f = fixture({ guardianPaused: PAUSE_BITS.feed });
  f.adminPaused |= PAUSE_BITS.rip;
  await assert.rejects(
    assertNoUnsettledPulls(f.rpc, program),
    /Rip guardian pause/,
  );
  assert.equal(
    f.reads.some(({ kind }) => kind === "pulls"),
    false,
  );
});
test("a pause removed during inventory cannot authorize an upgrade", async () => {
  const f = fixture(),
    original = f.rpc.getProgramAccounts;
  f.rpc.getProgramAccounts = async (...args) => {
    const result = await original(...args);
    f.guardianPaused &= ~PAUSE_BITS.rip;
    return result;
  };
  await assert.rejects(
    assertNoUnsettledPulls(f.rpc, program),
    /Rip guardian pause/,
  );
});
test("non-devnet and stale or malformed finalized RPC contexts fail closed", async () => {
  const foreign = fixture();
  foreign.rpc.getGenesisHash = async () => "different genesis";
  await assert.rejects(
    assertNoUnsettledPulls(foreign.rpc, program),
    /Devnet only/,
  );
  assert.equal(foreign.reads.length, 0);
  for (const method of ["getAccountInfoAndContext", "getProgramAccounts"]) {
    for (const slot of [1, 122, 123.5, "123", Number.MAX_SAFE_INTEGER + 1]) {
      const f = fixture(),
        original = f.rpc[method];
      f.rpc[method] = async (...args) => ({
        ...(await original(...args)),
        context: { slot },
      });
      await assert.rejects(
        assertNoUnsettledPulls(f.rpc, program, 123),
        /stale finalized slot/,
      );
    }
    const f = fixture();
    f.rpc[method] = async () => {
      throw Error("RPC unavailable");
    };
    await assert.rejects(
      assertNoUnsettledPulls(f.rpc, program),
      /RPC unavailable/,
    );
  }
});
test("missing, foreign-owned and malformed Config accounts fail closed", async () => {
  for (const value of [
    null,
    { owner: PublicKey.default, data: configLayout.encode() },
    { owner: program, data: Buffer.alloc(configLayout.size) },
    { owner: program, data: configLayout.encode().subarray(0, 100) },
  ]) {
    const f = fixture();
    f.rpc.getAccountInfoAndContext = async () => ({
      context: { slot: 123 },
      value,
    });
    await assert.rejects(assertNoUnsettledPulls(f.rpc, program));
    assert.equal(f.reads.length, 0);
  }
});
test("foreign, malformed or noncanonical Pulls fail closed", async () => {
  const mutations = [
    (row) => (row.account.owner = PublicKey.default),
    (row) => (row.account.data = row.account.data.subarray(0, 175)),
    (row) => (row.account.data = row.account.data.subarray(0, 575)),
    (row) => (row.account.data[0] ^= 1),
    (row) => (row.account.data[143] = 0),
    (row) => (row.account.data[143] = 11),
    (row) => (row.account.data[144] = 9),
    (row) => row.account.data.writeUInt16LE(4, 140),
    (row) => (row.pubkey = PublicKey.default),
  ];
  for (const mutate of mutations) {
    const row = pull(2, 0);
    mutate(row);
    await assert.rejects(
      assertNoUnsettledPulls(fixture({ rows: [row] }).rpc, program),
      /Invalid Pull|Noncanonical Pull/,
    );
  }
});
test("the disposable drill requires absent Config, Machine and Pull accounts", async () => {
  for (const value of [
    [{}, null],
    [null, {}],
    [],
    [null],
    [null, null, null],
  ]) {
    const f = fixture();
    f.rpc.getMultipleAccountsInfoAndContext = async () => ({
      context: { slot: 123 },
      value,
    });
    await assert.rejects(
      assertUninitializedUpgrade(f.rpc, program),
      /must remain uninitialized/,
    );
  }
  const f = fixture({ rows: [pull(1, 0)] });
  f.initialized = false;
  await assert.rejects(
    assertUninitializedUpgrade(f.rpc, program),
    /Pulls still exist/,
  );
  f.rows = [];
  await assertUninitializedUpgrade(f.rpc, program);
  assert.deepEqual(f.reads.slice(-2), [
    { kind: "config-and-machine", slot: 125, minContextSlot: 0 },
    { kind: "pulls", slot: 126, minContextSlot: 125 },
  ]);
});

function controller(options = {}) {
  const f = fixture({ guardianPaused: PAUSE_BITS.feed, ...options });
  f.state = options.state ?? {};
  f.events = [];
  f.broadcastChecks = [];
  f.journal = new Map();
  f.poll = f.afterSend = f.beforeSend = async () => {};
  f.guard = p3UpgradeGuard({
    connection: f.rpc,
    programId: program,
    payer: { publicKey: PublicKey.default },
    state: f.state,
    drainAttempts: options.drainAttempts ?? 3,
    save: () => f.events.push("save"),
    poll: async () => {
      f.events.push("wait");
      await f.poll();
    },
    async send(label, instructions, signers, sendOptions = {}) {
      if (f.journal.has(label)) {
        f.events.push(`reconcile:${label}`);
        return f.journal.get(label);
      }
      await f.beforeSend(label);
      if (sendOptions.beforeBroadcast) {
        await sendOptions.beforeBroadcast();
        f.broadcastChecks.push(label);
      }
      f.events.push(label);
      assert.equal(instructions.length, 1);
      if (label === "pause-rip" || label === "resume-rip") {
        assert.equal(instructions[0].data[8], 0); // Guardian SetPause variant.
        assert.equal(instructions[0].data[9], PAUSE_BITS.rip);
        assert.equal(instructions[0].data[10], Number(label === "pause-rip"));
        f.guardianPaused =
          label === "pause-rip"
            ? f.guardianPaused | PAUSE_BITS.rip
            : f.guardianPaused & ~PAUSE_BITS.rip;
      } else {
        assert.equal(label, "activate-p3");
        f.machine.last_reveal_ts = 1_000n;
      }
      const receipt = { slot: f.slot++, finalized: true };
      f.journal.set(label, receipt);
      await f.afterSend(label);
      return receipt;
    },
  });
  f.upgrade = async () => {
    await f.guard.beforeBroadcast();
    f.events.push("upgrade");
    return f.slot++;
  };
  return f;
}
const transactions = (f) =>
  f.events.filter((event) =>
    ["pause-rip", "upgrade", "activate-p3", "resume-rip"].includes(event),
  );

test("the enforced flow pauses, drains, upgrades, activates and resumes Rip only", async () => {
  const f = controller({ rows: [pull(1, 0)] });
  let polls = 0;
  f.poll = async () => {
    f.rows = ++polls === 1 ? [pull(2, 1)] : [];
  };
  await f.guard.prepare();
  assert(f.guardianPaused & PAUSE_BITS.rip);
  const upgradeSlot = await f.upgrade();
  await f.guard.activate(upgradeSlot);
  assert.deepEqual(transactions(f), [
    "pause-rip",
    "upgrade",
    "activate-p3",
    "resume-rip",
  ]);
  assert.equal(polls, 2);
  assert.equal(f.state.wasPaused, false);
  assert.equal(f.state.completed, true);
  assert.equal(f.state.activated.lastRevealTs, "1000");
  assert.equal(f.guardianPaused, PAUSE_BITS.feed);
  assert.equal(f.adminPaused, PAUSE_BITS.sellBack);
  assert.deepEqual(f.broadcastChecks, ["activate-p3", "resume-rip"]);
  assert(f.reads.every((read) => read.slot >= read.minContextSlot));
  assert(f.reads[1].minContextSlot >= f.journal.get("pause-rip").slot);
  const activationRead = f.reads.find(({ kind }) => kind === "machine");
  assert(activationRead.minContextSlot >= f.journal.get("activate-p3").slot);
});
test("mixed legacy A / new revelation B stops before upgrade and activation", async () => {
  const legacyPending = pull(1, 0, 1),
    legacyRevealed = pull(2, 0, 1),
    newRevealed = pull(2, 0, 2);
  const f = controller({ rows: [legacyPending] });
  let polls = 0;
  f.poll = async () => {
    f.rows = ++polls === 1 ? [legacyRevealed] : [legacyRevealed, newRevealed];
  };
  await assert.rejects(
    (async () => {
      await f.guard.prepare();
      await f.guard.activate(await f.upgrade());
    })(),
    /Pulls still exist/,
  );
  assert.deepEqual(transactions(f), ["pause-rip"]);
  assert(f.guardianPaused & PAUSE_BITS.rip);
  assert.equal(f.state.activated, undefined);
  // Settling A cannot authorize admission while B exists, regardless of counters.
  f.rows = [newRevealed];
  f.machine.unsettled_reveals = 0n;
  await assert.rejects(f.guard.beforeBroadcast(), /Pulls still exist/);
});
test("pause and activation require finalized receipts with valid slots", async () => {
  for (const label of ["pause-rip", "activate-p3"]) {
    for (const change of [{ finalized: false }, { slot: -1 }, { slot: NaN }]) {
      const f = controller();
      f.afterSend = async (sent) => {
        if (sent === label) Object.assign(f.journal.get(sent), change);
      };
      if (label === "pause-rip") {
        await assert.rejects(
          f.guard.prepare(),
          /Transaction must be finalized/,
        );
        assert.equal(
          f.reads.some(({ kind }) => kind === "pulls"),
          false,
        );
      } else {
        await f.guard.prepare();
        const upgradeSlot = await f.upgrade();
        await assert.rejects(
          f.guard.activate(upgradeSlot),
          /Transaction must be finalized/,
        );
      }
      assert(f.guardianPaused & PAUSE_BITS.rip);
      assert.equal(f.events.includes("resume-rip"), false);
      assert.equal(f.state.activated, undefined);
    }
  }
});
test("a finalized receipt cannot admit an earlier Config or Machine snapshot", async () => {
  for (const label of ["pause-rip", "activate-p3"]) {
    const f = controller();
    f.afterSend = async (sent) => {
      if (sent === label) f.journal.get(sent).slot = f.slot + 10;
    };
    if (label === "pause-rip") {
      await assert.rejects(f.guard.prepare(), /stale finalized slot/);
    } else {
      await f.guard.prepare();
      const upgradeSlot = await f.upgrade();
      await assert.rejects(
        f.guard.activate(upgradeSlot),
        /stale finalized slot/,
      );
    }
    assert(f.guardianPaused & PAUSE_BITS.rip);
    assert.equal(f.events.includes("resume-rip"), false);
  }
});
test("drain timeout or RPC failure leaves Rip paused without upgrade", async () => {
  for (const mode of ["timeout", "rpc"]) {
    const f = controller({ rows: [pull(1, 0)], drainAttempts: 1 });
    if (mode === "rpc")
      f.rpc.getProgramAccounts = async () => {
        throw Error("RPC unavailable");
      };
    await assert.rejects(
      f.guard.prepare(),
      /Pulls still exist|RPC unavailable/,
    );
    assert.deepEqual(transactions(f), ["pause-rip"]);
    assert(f.guardianPaused & PAUSE_BITS.rip);
  }
});
test("an upgrade retry rechecks both pause and empty Pull inventory", async () => {
  const f = controller();
  await f.guard.prepare();
  await f.guard.beforeBroadcast();
  f.rows = [pull(1, 0)];
  await assert.rejects(f.upgrade(), /Pulls still exist/);
  f.rows = [];
  f.guardianPaused &= ~PAUSE_BITS.rip;
  await assert.rejects(f.upgrade(), /Rip guardian pause/);
  assert.deepEqual(transactions(f), ["pause-rip"]);
});
test("activation rejects a Pull after upgrade and rechecks immediately before broadcast", async () => {
  for (const stage of ["after-upgrade", "before-broadcast"]) {
    const f = controller();
    await f.guard.prepare();
    const upgradeSlot = await f.upgrade();
    if (stage === "after-upgrade") f.rows = [pull(2, 0)];
    else
      f.beforeSend = async (label) => {
        if (label === "activate-p3") f.rows = [pull(1, 0)];
      };
    await assert.rejects(f.guard.activate(upgradeSlot), /Pulls still exist/);
    assert.deepEqual(transactions(f), ["pause-rip", "upgrade"]);
    assert(f.guardianPaused & PAUSE_BITS.rip);
    assert.equal(f.state.activated, undefined);
  }
});
test("failed activation or inconsistent counters cannot resume Rip", async () => {
  for (const field of [
    "send",
    "last_reveal_ts",
    "pending_pulls",
    "unsettled_reveals",
  ]) {
    const f = controller();
    await f.guard.prepare();
    const upgradeSlot = await f.upgrade();
    f.beforeSend = async (label) => {
      if (label === "activate-p3" && field === "send")
        throw Error("Activation failed");
    };
    f.afterSend = async (label) => {
      if (label === "activate-p3" && field !== "send")
        f.machine[field] = field === "last_reveal_ts" ? 0n : 1n;
    };
    await assert.rejects(f.guard.activate(upgradeSlot));
    assert.equal(f.events.includes("resume-rip"), false);
    assert(f.guardianPaused & PAUSE_BITS.rip);
    assert.equal(f.state.activated, undefined);
  }
});
test("a Pull after activation blocks resume; a restarted activation checks again", async () => {
  const f = controller();
  await f.guard.prepare();
  const upgradeSlot = await f.upgrade();
  f.afterSend = async (label) => {
    if (label === "activate-p3") f.rows = [pull(2, 1)];
  };
  await assert.rejects(f.guard.activate(upgradeSlot), /Pulls still exist/);
  assert.equal(f.events.includes("resume-rip"), false);
  assert.equal(f.state.activated, undefined);
  assert(f.guardianPaused & PAUSE_BITS.rip);
  await assert.rejects(f.guard.activate(upgradeSlot), /Pulls still exist/);
  f.rows = [];
  await f.guard.activate(upgradeSlot);
  assert(f.events.includes("reconcile:activate-p3"));
  assert.equal(
    transactions(f).filter((name) => name === "activate-p3").length,
    1,
  );
  assert.equal(f.state.completed, true);
});
test("a preexisting Rip pause and unrelated pause bits are preserved", async () => {
  const f = controller({
    guardianPaused: PAUSE_BITS.rip | PAUSE_BITS.stockBuy,
  });
  await f.guard.prepare();
  await f.guard.activate(await f.upgrade());
  assert.equal(f.state.wasPaused, true);
  assert.equal(f.guardianPaused, PAUSE_BITS.rip | PAUSE_BITS.stockBuy);
  assert.equal(f.adminPaused, PAUSE_BITS.sellBack);
  assert.equal(f.events.includes("resume-rip"), false);
  assert.equal(f.state.completed, true);
});
test("a finalized pause journal cannot bypass a later removed pause", async () => {
  const f = controller();
  await f.guard.prepare();
  f.guardianPaused &= ~PAUSE_BITS.rip;
  await assert.rejects(f.guard.prepare(), /Rip guardian pause/);
  assert(f.events.includes("reconcile:pause-rip"));
  assert.equal(f.events.includes("upgrade"), false);
});
test("resume retries retain activated state but recheck admission on each broadcast", async () => {
  const f = controller();
  await f.guard.prepare();
  const upgradeSlot = await f.upgrade();
  f.beforeSend = async (label) => {
    if (label === "resume-rip") throw Error("Resume unavailable");
  };
  await assert.rejects(f.guard.activate(upgradeSlot), /Resume unavailable/);
  assert(f.state.activated);
  assert.equal(f.state.completed, undefined);
  f.beforeSend = async () => {};
  f.rows = [pull(2, 0)];
  await f.guard.prepare();
  await assert.rejects(f.guard.activate(upgradeSlot), /Pulls still exist/);
  assert(f.guardianPaused & PAUSE_BITS.rip);
  f.rows = [];
  await f.guard.activate(upgradeSlot);
  assert.equal(f.state.completed, true);
  assert.equal(
    transactions(f).filter((name) => name === "activate-p3").length,
    1,
  );
  const completedEvents = [...f.events];
  await f.guard.prepare();
  await f.guard.activate(upgradeSlot);
  assert.deepEqual(f.events, completedEvents);
});
