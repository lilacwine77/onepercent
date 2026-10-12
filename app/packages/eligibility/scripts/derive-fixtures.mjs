/** Deterministic local derivation; no network and no real wallet scan. */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";
import { classifyWallet } from "../src/classify.ts";
import { PROGRAM_IDS, WSOL_MINT } from "../src/params.ts";
const root = new URL("../fixtures/", import.meta.url);
const load = async (path) =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));
const save = async (path, value) =>
  writeFile(new URL(path, root), JSON.stringify(value, null, 2) + "\n");
const key = (label) =>
  new PublicKey(
    createHash("sha256").update(`xray-synthetic:${label}`).digest(),
  ).toBase58();
const raw = (v) => ({
  address: v.address,
  owner: v.owner,
  lamports: BigInt(v.lamports),
  data: Buffer.from(v.dataBase64, "base64"),
});
const fart = await load("mainnet/fartcoin.json"),
  cat = await load("mainnet/catcraft.json");
async function variant(name, sourceName, change, mutate) {
  const source = await load(sourceName),
    copy = { ...source, source: "synthetic", derivedFrom: sourceName, change };
  const bytes = Buffer.from(copy.dataBase64, "base64");
  copy.dataBase64 = (mutate(bytes, copy) ?? bytes).toString("base64");
  delete copy.slot;
  delete copy.recordedAt;
  await save(`synthetic/${name}.json`, copy);
}
await variant(
  "mint-authority",
  "mainnet/fartcoin.json",
  "Set mint authority to a synthetic address.",
  (b) => {
    b.writeUInt32LE(1, 0);
    new PublicKey(key("authority")).toBuffer().copy(b, 4);
  },
);
await variant(
  "freeze-authority",
  "mainnet/fartcoin.json",
  "Set freeze authority to a synthetic address.",
  (b) => {
    b.writeUInt32LE(1, 46);
    new PublicKey(key("authority")).toBuffer().copy(b, 50);
  },
);
await variant(
  "decimals-10",
  "mainnet/fartcoin.json",
  "Set decimals to 10.",
  (b) => {
    b[44] = 10;
  },
);
await variant(
  "wrong-curve-owner",
  "mainnet/fartcoin-curve.json",
  "Replace owner with system program.",
  (_, v) => {
    v.owner = PublicKey.default.toBase58();
  },
);
await variant(
  "wrong-discriminator",
  "mainnet/fartcoin-curve.json",
  "Flip first discriminator byte.",
  (b) => {
    b[0] ^= 1;
  },
);
await variant(
  "wrong-pda",
  "mainnet/fartcoin-curve.json",
  "Place bytes at CATCRAFT curve PDA.",
  (_, v) => {
    v.address = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), new PublicKey(cat.address).toBuffer()],
      new PublicKey(PROGRAM_IDS.pumpFun),
    )[0].toBase58();
  },
);
for (const length of [8, 81, 166, 300])
  await variant(
    `curve-length-${length}`,
    "mainnet/fartcoin-curve.json",
    `Resize curve to ${length} bytes, retaining discriminator.`,
    (b) => {
      const v = Buffer.alloc(length);
      b.copy(v);
      return v;
    },
  );
await variant(
  "odd-tlv-tail",
  "mainnet/catcraft.json",
  "Append one nonzero TLV byte.",
  (b) => Buffer.concat([b, Buffer.from([1])]),
);
await variant(
  "token2022-spl-owner",
  "mainnet/catcraft.json",
  "Replace owning program with SPL.",
  (_, v) => {
    v.owner = PROGRAM_IDS.splToken;
  },
);
await variant(
  "frozen-account",
  "mainnet/empty-spl-account.json",
  "Set account state to Frozen.",
  (b) => {
    b[108] = 2;
  },
);
await variant(
  "foreign-close-authority",
  "mainnet/empty-spl-account.json",
  "Set foreign synthetic close authority.",
  (b) => {
    b.writeUInt32LE(1, 129);
    new PublicKey(key("foreign-close")).toBuffer().copy(b, 133);
  },
);
await variant(
  "non-sol-quote",
  "mainnet/incomplete-curve.json",
  "Replace quote mint with USDC.",
  (b) => {
    new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
      .toBuffer()
      .copy(b, 83);
  },
);
const mainnet = {};
for (const name of await readdir(new URL("mainnet/", root)))
  mainnet[name] = await load(`mainnet/${name}`);
function tokenAccount(owner, mint, index, amount, rent) {
  const size = mint.owner === PROGRAM_IDS.splToken ? 165 : 170,
    data = Buffer.alloc(size);
  AccountLayout.encode(
    {
      mint: new PublicKey(mint.address),
      owner: new PublicKey(owner),
      amount: BigInt(amount),
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: mint.address === WSOL_MINT ? 1 : 0,
      isNative: mint.address === WSOL_MINT ? BigInt(rent) : 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  if (size > 165) {
    data[165] = 2;
    data.writeUInt16LE(7, 166);
    data.writeUInt16LE(0, 168);
  }
  return {
    address: key(`${owner}:account:${index}`),
    owner: mint.owner,
    lamports: String(rent),
    dataBase64: data.toString("base64"),
    source: "synthetic",
    derivedFrom:
      mint.owner === PROGRAM_IDS.splToken
        ? "mainnet/empty-spl-account.json"
        : "mainnet/immutable-owner-account.json",
    change:
      "AccountLayout encoding over recorded mint; synthetic owner, address and balance. Rent uses recorded examples.",
  };
}
const slot = Math.max(...Object.values(mainnet).map((v) => v.slot));
for (const name of ["trencher", "clean", "mixed"]) {
  const owner = key(name),
    selection =
      name === "clean"
        ? []
        : name === "mixed"
          ? ["bonk", "usdc", "transfer-hook", "permanent-delegate"]
          : [
              "fartcoin",
              "catcraft",
              "no-suffix",
              "incomplete",
              "pump-extra-1",
              "pump-extra-2",
              "pump-extra-3",
              "pump-extra-4",
              "pump-extra-5",
              "pump-extra-6",
              "pump-extra-7",
              "pnut",
              "bonk",
              "usdc",
              "transfer-hook",
              "permanent-delegate",
            ];
  const w = {
    name,
    owner,
    source: "synthetic",
    note: `Owner = PublicKey(SHA256("xray-synthetic:${name}")). Token accounts use AccountLayout; this is not a real wallet scan.`,
    slot,
    slotS: slot - 1000,
    solUsd: 100,
    tokenAccounts: [],
    mints: {},
    curves: {},
    prices: {},
    exitCaps: {},
    exitCapsSource:
      "synthetic: fee-adjusted X2 getExitCap seam inputs; no live reserve claim",
    snapshot: {},
    metadata: {},
    expected: {},
  };
  for (const [i, mintName] of selection.entries()) {
    const mint = mainnet[mintName + ".json"];
    w.mints[mint.address] = `mainnet/${mintName}.json`;
    if (mainnet[mintName + "-curve.json"])
      w.curves[mint.address] = `mainnet/${mintName}-curve.json`;
    const decimals = Buffer.from(mint.dataBase64, "base64")[44];
    w.tokenAccounts.push(
      tokenAccount(
        owner,
        mint,
        i,
        1000n * 10n ** BigInt(decimals),
        mint.owner === PROGRAM_IDS.splToken ? 2039280 : 1513840,
      ),
    );
    const priceIndex = [
      "fartcoin",
      "catcraft",
      "no-suffix",
      "incomplete",
      "pump-extra-1",
      "pump-extra-2",
      "pump-extra-3",
      "pump-extra-4",
      "pump-extra-5",
      "pump-extra-6",
      "pump-extra-7",
      "pnut",
      "bonk",
      "usdc",
      "transfer-hook",
      "permanent-delegate",
    ].indexOf(mintName);
    if (priceIndex % 3 !== 1)
      w.prices[mint.address] = {
        usdPrice: priceIndex % 2 === 0 ? 0.001 : 0.000001,
        blockId: slot - 5,
        ageSlots: 5,
      };
    w.exitCaps[mint.address] = "1000000000";
    w.snapshot[mint.address] = {
      balanceAtS: i === 2 || i === 4 ? "0" : i === 3 || i === 5 ? null : "1000",
    };
    w.metadata[mint.address] = {
      symbol: mintName.toUpperCase().replaceAll("-", "").slice(0, 16),
      name: mintName,
      image: "https://example.com/coin.png",
    };
  }
  if (name === "trencher")
    for (const [i, rent] of [
      2039280, 1488440, 1513840, 2039280, 1488440, 1513840,
    ].entries())
      w.tokenAccounts.push(
        tokenAccount(
          owner,
          i === 5 ? mainnet["wsol.json"] : i % 2 === 0 ? fart : cat,
          100 + i,
          0n,
          rent,
        ),
      );
  const result = classifyWallet({
    owner,
    tokenAccounts: w.tokenAccounts.map(raw),
    mints: new Map(
      await Promise.all(
        Object.entries(w.mints).map(async ([m, p]) => [m, raw(await load(p))]),
      ),
    ),
    curves: new Map(
      await Promise.all(
        Object.entries(w.curves).map(async ([m, p]) => [m, raw(await load(p))]),
      ),
    ),
    prices: w.prices,
    solUsd: w.solUsd,
    exitCaps: new Map(
      Object.entries(w.exitCaps).map(([mint, value]) => [mint, BigInt(value)]),
    ),
    slotS: w.slotS,
    snapshot: new Map(
      Object.entries(w.snapshot).map(([m, e]) => [
        m,
        { balanceAtS: e.balanceAtS === null ? null : BigInt(e.balanceAtS) },
      ]),
    ),
  });
  const count = (b) => result.bags.filter((v) => v.buckets.includes(b)).length;
  w.expected = {
    counts: {
      bags: count("feedable") + count("not_feedable_season"),
      feedable: result.bags.filter(
        (v) =>
          v.buckets.includes("feedable") && v.reason !== "snapshot_at_feed",
      ).length,
      checkAtFeed: result.bags.filter((v) => v.reason === "snapshot_at_feed")
        .length,
      notFeedable: count("not_feedable_season"),
      sellable: count("sell"),
      empty: result.empties.length,
      notInSet: count("not_in_set"),
    },
    mints: Object.fromEntries(
      result.bags.map((v) => [
        v.mint,
        { buckets: v.buckets, ...(v.reason ? { reason: v.reason } : {}) },
      ]),
    ),
  };
  await save(`wallets/${name}.json`, w);
  console.log(name, owner, JSON.stringify(w.expected.counts));
}
