import { DEVNET_GENESIS_HASH } from "../packages/config/dist/genesis.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import { PAUSE_BITS } from "../packages/config/dist/index.js";
import {
  configPda,
  machinePda,
  decodeConfig,
  decodeMachine,
  guardianInstruction,
  advancePhaseInstruction,
} from "../packages/sdk/dist/index.js";

const DEVNET_GENESIS = DEVNET_GENESIS_HASH;
const discriminator = createHash("sha256")
  .update("account:Pull")
  .digest()
  .subarray(0, 8);
const options = (minContextSlot) => ({
  commitment: "finalized",
  minContextSlot,
});
function assertSlot(result, minContextSlot) {
  assert(
    Number.isSafeInteger(result.context.slot) &&
      result.context.slot >= minContextSlot,
    "RPC returned a stale finalized slot",
  );
}
function finalizedSlot(receipt) {
  assert(
    receipt?.finalized === true &&
      Number.isSafeInteger(receipt.slot) &&
      receipt.slot >= 0,
    "Transaction must be finalized before migration proceeds",
  );
  return receipt.slot;
}
async function assertDevnet(connection) {
  assert.equal(
    await connection.getGenesisHash(),
    DEVNET_GENESIS,
    "Devnet only",
  );
}
async function account(connection, programId, address, decode, minContextSlot) {
  const result = await connection.getAccountInfoAndContext(
    address,
    options(minContextSlot),
  );
  assertSlot(result, minContextSlot);
  assert(
    result.value?.owner.equals(programId),
    "Missing or invalid program account",
  );
  return { slot: result.context.slot, value: decode(result.value.data) };
}
async function pausedConfig(connection, programId, minContextSlot) {
  const result = await account(
    connection,
    programId,
    configPda(programId)[0],
    decodeConfig,
    minContextSlot,
  );
  assert(
    result.value.guardian_paused & PAUSE_BITS.rip,
    "Rip guardian pause must be finalized before inventory",
  );
  return result;
}
async function inventory(connection, programId, minContextSlot) {
  const result = await connection.getProgramAccounts(programId, {
    ...options(minContextSlot),
    withContext: true,
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: discriminator.toString("base64"),
          encoding: "base64",
        },
      },
    ],
  });
  assertSlot(result, minContextSlot);
  for (const {
    pubkey,
    account: { owner, data: d },
  } of result.value) {
    assert(
      owner.equals(programId) &&
        d.length >= 176 &&
        d.subarray(0, 8).equals(discriminator),
      "Invalid Pull account",
    );
    const qty = d[143],
      status = d[144],
      mask = d.readUInt16LE(140);
    assert(
      qty > 0 &&
        qty <= 10 &&
        d.length === 176 + 200 * qty &&
        (status === 1 || status === 2) &&
        mask <= (1 << qty) - 1,
      "Invalid Pull state",
    );
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("pull"), d.subarray(16, 48), d.subarray(136, 140)],
      programId,
    );
    assert(pubkey.equals(expected), "Noncanonical Pull");
  }
  return {
    slot: result.context.slot,
    pulls: result.value.map(({ pubkey }) => pubkey.toBase58()),
  };
}
function assertEmpty(result) {
  assert.equal(
    result.pulls.length,
    0,
    `Pulls still exist; wait for reveal/settlement or timeout refund: ${result.pulls.join(", ")}`,
  );
  return { slot: result.slot, pullsChecked: 0 };
}

/** Strictly empty, including Pending and partially/fully settled accounts. */
export async function assertNoUnsettledPulls(
  connection,
  programId,
  minContextSlot = 0,
) {
  await assertDevnet(connection);
  const config = await pausedConfig(connection, programId, minContextSlot);
  const result = await inventory(connection, programId, config.slot);
  await pausedConfig(connection, programId, result.slot);
  return assertEmpty(result);
}

/** The disposable loader drill has no initialized Config/Machine to pause. */
export async function assertUninitializedUpgrade(connection, programId) {
  await assertDevnet(connection);
  const accounts = await connection.getMultipleAccountsInfoAndContext(
    [configPda(programId)[0], machinePda(programId)[0]],
    options(0),
  );
  assertSlot(accounts, 0);
  assert(
    accounts.value.length === 2 &&
      accounts.value.every((value) => value === null),
    "Disposable drill must remain uninitialized",
  );
  return assertEmpty(
    await inventory(connection, programId, accounts.context.slot),
  );
}

/** State is persisted under the artifact hash, independently of the loader slot.
 * send must finalize its transaction and run beforeBroadcast on every broadcast.
 * Failure leaves Rip paused. No callback or exit is paused by this operation. */
export function p3UpgradeGuard({
  connection,
  programId,
  payer,
  send,
  state,
  save,
  poll = () => delay(2000),
  drainAttempts = 150,
}) {
  const check = (slot = state.pauseSlot ?? 0) =>
    assertNoUnsettledPulls(connection, programId, slot);
  const pauseIx = (paused) =>
    guardianInstruction(programId, {
      signer: payer.publicKey,
      action: { setPause: { bits: PAUSE_BITS.rip, paused } },
    });
  return {
    beforeBroadcast: () => check(),
    async prepare() {
      await assertDevnet(connection);
      if (state.completed || state.activated) return;
      const current = await account(
        connection,
        programId,
        configPda(programId)[0],
        decodeConfig,
        state.pauseSlot ?? 0,
      );
      if (state.wasPaused === undefined) {
        state.wasPaused = Boolean(
          current.value.guardian_paused & PAUSE_BITS.rip,
        );
        save();
      }
      // A saved finalized pause is not evidence that the bit is still set.
      const receipt = await send("pause-rip", [pauseIx(true)]);
      const paused = await pausedConfig(
        connection,
        programId,
        Math.max(current.slot, finalizedSlot(receipt)),
      );
      state.pauseSlot = paused.slot;
      save();
      for (let attempt = 0; attempt < drainAttempts; attempt++) {
        const config = await pausedConfig(
          connection,
          programId,
          state.pauseSlot,
        );
        const result = await inventory(connection, programId, config.slot);
        if (result.pulls.length === 0) {
          await check(result.slot);
          return;
        }
        if (attempt + 1 === drainAttempts) assertEmpty(result);
        await poll();
      }
      throw new Error("Invalid drain attempt budget");
    },
    async activate(upgradeSlot) {
      if (state.completed) return;
      if (!state.activated) {
        const beforeBroadcast = () =>
          check(Math.max(upgradeSlot, state.pauseSlot ?? 0));
        await beforeBroadcast();
        const receipt = await send(
          "activate-p3",
          [advancePhaseInstruction(programId)],
          [payer],
          { beforeBroadcast },
        );
        const machine = await account(
          connection,
          programId,
          machinePda(programId)[0],
          decodeMachine,
          Math.max(upgradeSlot, finalizedSlot(receipt)),
        );
        assert(
          machine.value.last_reveal_ts > 0n,
          "P3 reveal timestamp is not initialized",
        );
        assert.equal(
          machine.value.pending_pulls,
          0n,
          "Pending Pull counter is not empty",
        );
        assert.equal(
          machine.value.unsettled_reveals,
          0n,
          "Unsettled reveal counter is not empty",
        );
        await check(machine.slot);
        state.activated = {
          slot: machine.slot,
          lastRevealTs: machine.value.last_reveal_ts.toString(),
        };
        save();
      }
      if (!state.wasPaused) {
        // A resumed process reconciles this same signature before any rebroadcast.
        await send("resume-rip", [pauseIx(false)], [payer], {
          beforeBroadcast: () => check(state.activated.slot),
        });
      }
      state.completed = true;
      save();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(
    JSON.stringify(
      await assertNoUnsettledPulls(
        new Connection("https://api.devnet.solana.com", "finalized"),
        new PublicKey("DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr"),
      ),
    ),
  );
}
