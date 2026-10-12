import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as sdk from "../packages/sdk/dist/index.js";
import { rpc, payer, pid, pub, journal } from "./devnet-session.mjs";

const read = (name) =>
  JSON.parse(readFileSync(`reports/devnet/${name}.json`, "utf8"));
const prior = JSON.parse(
  readFileSync("fixtures/devnet/provisioning.json", "utf8"),
);
const deployment = read("deployment");
const lut = read("protocol-lut");
const pumps = read("pump-fixtures");
const wallets = read("feed-wallets");
const optional = (name) =>
  existsSync(`reports/devnet/${name}.json`) ? read(name) : null;
const addresses = {
  ...prior.addresses,
  programData: deployment.programData,
  deck: sdk.deckPda(pid)[0].toBase58(),
  protocolLut: lut.address,
  ...(optional("launch-lut")
    ? { launchLut: read("launch-lut").lookupTable }
    : {}),
};
const accountNames = Object.keys(addresses);
const accounts = await rpc.getMultipleAccountsInfoAndContext(
  accountNames.map((k) => pub(addresses[k])),
);
const observations = Object.fromEntries(
  accountNames.map((k, i) => {
    const account = accounts.value[i];
    return [
      k,
      {
        address: addresses[k],
        exists: Boolean(account),
        lamports: account?.lamports ?? 0,
        owner: account?.owner.toBase58() ?? null,
        bytes: account?.data.length ?? 0,
        executable: account?.executable ?? false,
      },
    ];
  }),
);
const config = await sdk.fetchConfig(pid, rpc, "finalized");
const machine = await sdk.fetchMachine(pid, rpc, "finalized");
assert(config && machine);
assert.equal(config.keeper.toBase58(), prior.roles.keeper);
assert.equal(config.executor.toBase58(), prior.roles.executor);
assert.equal(config.admin_paused, 0);
assert.equal(config.guardian_paused, 0);
const deck = sdk.decodeDeck(accounts.value[accountNames.indexOf("deck")].data);
assert(deck.entries.length <= 54);
const table = (await rpc.getAddressLookupTable(pub(lut.address))).value;
assert(table && !table.state.authority && table.state.addresses.length === 106);
const balancesToRead = [
  { role: "payer", address: payer.publicKey.toBase58() },
  ...wallets.map((w, i) => ({ role: `feed-wallet-${i}`, address: w.address })),
  ...["keeper", "executor", "lutAuthority"].map((role) => ({
    role,
    address: prior.roles[role],
  })),
  ...prior.roles.guardians.map((address, i) => ({
    role: `guardian-${i + 1}`,
    address,
  })),
  { role: "launch", address: addresses.wallet },
  ...(optional("rip") ? [{ role: "rip", address: read("rip").wallet }] : []),
];
const balanceAccounts = await rpc.getMultipleAccountsInfoAndContext(
  balancesToRead.map((w) => pub(w.address)),
);
const balances = balancesToRead.map((w, i) => ({
  ...w,
  lamports: balanceAccounts.value[i]?.lamports ?? 0,
}));
const initialLamports = 25_099_990_000;
const payerRemainingLamports = balances[0].lamports;
const otherWalletsLamports = balances
  .slice(1)
  .reduce((sum, w) => sum + w.lamports, 0);
const keyTransactions = Object.fromEntries(
  Object.entries(journal)
    .filter(
      ([label]) => !label.includes("upload/") && !label.startsWith("expired/"),
    )
    .map(([label, entry]) => [
      label,
      {
        signature: entry.signature,
        slot: entry.slot,
        finalized: entry.finalized,
        microLamports: entry.microLamports,
      },
    ]),
);
const report = {
  status:
    optional("rip")?.status === "PASS"
      ? "devnet-smoke-pass"
      : "powered-on-smoke-pending",
  cluster: "devnet",
  observedAt: new Date().toISOString(),
  slot: accounts.context.slot,
  balanceSlot: balanceAccounts.context.slot,
  genesis: await rpc.getGenesisHash(),
  deployment,
  addresses,
  roles: prior.roles,
  observations,
  season: {
    snapshotSlot: String(config.snapshot_slot),
    snapshotTs: String(config.snapshot_ts),
    stockUpTs: String(config.stock_up_ts),
    phase: machine.phase,
    powerOnTs: String(machine.power_on_ts),
    stockSol: String(machine.stock_sol),
    pendingPulls: String(machine.pending_pulls),
    adminPaused: config.admin_paused,
    guardianPaused: config.guardian_paused,
    disabledRoles: config.disabled_roles,
    queue: config.vrf_queues[0].toBase58(),
  },
  protocolLut: {
    address: lut.address,
    frozen: true,
    entries: table.state.addresses.length,
  },
  pumpFixtures: pumps,
  smoke: {
    feed: {
      initialCards: 54,
      remainingCards: deck.entries.length,
      wallets: wallets.length,
      signatures: read("feed").signatures,
    },
    pumpCreatorFeesToFeeInLamports: pumps.reduce(
      (sum, p) => sum + Number(p.feeReceivedLamports),
      0,
    ),
    collectCreatorFees: optional("fees"),
    launch: optional("launch-send"),
    launchReport: optional("launch-report"),
    ripVrfSettleRedeem: optional("rip"),
    claimLaunchFeesCurve: optional("fees"),
    majorFixture: optional("stock-fixture"),
    exitProof: optional("exit-proof"),
    migrationLocal: optional("meteora-season-v1"),
  },
  budget: {
    initialLamports,
    payerRemainingLamports,
    payerOutflowLamports: initialLamports - payerRemainingLamports,
    otherWalletsLamports,
    netOutOfWalletsLamports:
      initialLamports - payerRemainingLamports - otherWalletsLamports,
    note: "Outflow includes account rent and funding test wallets; it is not all network fees.",
    balances,
  },
  transactions: keyTransactions,
  historicalPreflight: prior.historicalPreflight ?? prior.preflight,
};
const json = JSON.stringify(report, null, 2);
writeFileSync("reports/devnet/current.json", json);
writeFileSync("fixtures/devnet/provisioning.json", json);
console.log(
  JSON.stringify({
    slot: report.slot,
    season: report.season,
    smoke: { ...report.smoke, feed: { cards: 54, wallets: 18 } },
    budget: { ...report.budget, balances: undefined },
  }),
);
