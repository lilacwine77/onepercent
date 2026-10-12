import { FeatureFlags } from "../responses.js";

export const publicKey = "11111111111111111111111111111111";
export const otherKey = "So11111111111111111111111111111111111111112";
export const signature = "1".repeat(64);
export const hex = "00".repeat(32);
export const maxU64 = ((1n << 64n) - 1n).toString();
export const flags = Object.fromEntries(
  Object.keys(FeatureFlags.shape).map((name) => [name, false]),
);
export const vrf = {
  queue: null,
  occupancyBps: null,
  oldestItemAgeSeconds: null,
  busy: false,
};
export const config = {
  asOfSlot: 1,
  cluster: "devnet",
  programId: publicKey,
  flags,
  paramsHash: hex,
  phase: 0,
  roles: {
    keeper: publicKey,
    executor: publicKey,
    intakeSigner: publicKey,
    quoteSigner: publicKey,
    teamWallet: publicKey,
    teamWallets: [],
  },
  vrf: { queues: [publicKey], activeIndex: 0 },
  season: {
    snapshotSlot: "1",
    snapshotTs: 0,
    stockUpTs: 0,
    powerOnTs: 0,
    onAirTs: 0,
    endTs: 0,
    finalTs: 0,
  },
  paused: 0,
};
export const machine = {
  asOfSlot: 1,
  phase: 0,
  stock: {
    stockSol: maxU64,
    book: "0",
    target: "0",
    belowTarget: false,
    buckets: [],
  },
  coverage: { maxQty: [0, 0, 0, 0] },
  deck: { len: 0, reservedDust: "0", free: 0 },
  jackpot: { tokens: "0", cost: "0", sol: "0" },
  onePct: Array.from({ length: 4 }, () => ({ state: 0, amount: "0" })),
  sellBack: { budget: "0", paidHour: "0", floor: "0" },
  pendingPulls: "0",
  vrf,
  feedBack: { estimate: "5750000", mix: [0, 0, 0, 0] },
};
export const me = {
  asOfSlot: 1,
  binder: {
    owner: publicKey,
    referrer: publicKey,
    seasonSpend: "0",
    solOwed: maxU64,
    feedNonceBase: 0,
    sbNonce: 0,
    pullNonce: 0,
    feedNonceBits: 0,
    freshInDeck: 0,
    len: 1,
    cap: 1,
    reserved: 0,
    bump: 0,
    flags: 0,
    closable: false,
    cards: [
      {
        index: 0,
        mint: publicKey,
        amount: "1",
        value: "0",
        kind: 0,
        edition: 0,
        flags: 0,
        seqLo: 0,
      },
    ],
  },
  deck: [
    {
      asOfSlot: 1,
      deckIndex: 0,
      mint: publicKey,
      amount: "1",
      fresh: true,
      refed: false,
      deposit: "0",
    },
  ],
  pulls: {
    pending: [
      {
        seq: "0",
        pull: publicKey,
        buyer: publicKey,
        edition: 0,
        qty: 1,
        createdTs: 0,
      },
    ],
    settleable: [],
  },
  vaultDeposits: [
    {
      mint: publicKey,
      payerIsWallet: true,
      accounted: "1",
      vaultExists: true,
      state: "held",
    },
  ],
  royalties: {
    count24h: 0,
    lamports24h: "0",
    total: "0",
    settlementReceipts: { lamports24h: "0", total: "0" },
  },
};
export const verify = {
  asOfSlot: 1,
  seq: "0",
  pull: publicKey,
  buyer: publicKey,
  buyerNonce: 0,
  referrer: null,
  edition: 0,
  qty: 1,
  price: "0",
  createdTs: 0,
  revealedTs: null,
  status: "pending",
  settledMask: 0,
  randomness: null,
  revealedSlot: null,
  revealOrder: null,
  liveFlags: 0,
  holder: false,
  openedSig: signature,
  revealedSig: null,
  packs: [],
  check: null,
};
export const feed = {
  asOfSlot: 1,
  wallet: publicKey,
  signer: publicKey,
  snapshotSlot: 1,
  attestations: [
    {
      chunk: 0,
      nonce: 0,
      expiry: 1,
      bagsHash: hex,
      message: "AA==",
      signature: "AA==",
      bags: [
        {
          mint: publicKey,
          amount: maxU64,
          decimals: 0,
          tokenProgram: publicKey,
          source: publicKey,
          mergeFrom: [],
        },
      ],
    },
  ],
  refused: [
    {
      mint: otherKey,
      reason: "snapshot_not_held",
      date: "2026-10-08T00:00:00Z",
    },
  ],
};
export const quote = {
  asOfSlot: 1,
  ok: true,
  quote: {
    owner: publicKey,
    mint: publicKey,
    cards: [{ index: 0, amount: maxU64 }],
    totalAmount: maxU64,
    quoteLamports: "0",
    stockedValueLamports: "0",
    valueLamports: "0",
    payoutLamports: "0",
    expiry: 1,
    nonce: 0,
    bucketClass: "MAJOR",
    message: "AA==",
    signature: "AA==",
    signer: publicKey,
    router: "fixture",
    requestId: "fixture",
  },
};
