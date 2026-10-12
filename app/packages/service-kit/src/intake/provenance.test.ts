import { describe, expect, it } from "vitest";
import { PROGRAM_IDS, WSOL_MINT } from "@onepercent/config";
import {
  analyzeWalletHistory,
  createWalletHistorySnapshot,
  createProvenanceRecomputer,
  recomputeProvenance,
  TOKEN_2022_NATIVE_MINT,
  classifyInflow,
  evaluateFeedProvenance,
  EvidenceUnavailableError,
  normalizeHistoryTransaction,
  type FeedProvenanceInput,
  type IntakeTokenBalance,
  type IntakeTransaction,
  type WalletHistoryEvidence,
} from "./index.js";

const wallet = "wallet";
const sender = "sender";
const mint = "mint";
const date = "2026-10-01T00:00:00.000Z";
const snapshotDate = "2026-10-02T00:00:00.000Z";
const blockTime = Date.parse(date) / 1000;
const token = (
  amount: bigint,
  owner = wallet,
  accountIndex = 1,
  tokenMint = mint,
): IntakeTokenBalance => ({
  amount,
  owner,
  accountIndex,
  mint: tokenMint,
  account: `account-${accountIndex}`,
});
function transaction(
  patch: Partial<IntakeTransaction> = {},
): IntakeTransaction {
  return {
    signature: "first",
    slot: 10,
    transactionIndex: 0,
    blockTime,
    signers: [wallet],
    feePayer: wallet,
    fee: 5n,
    lamports: new Map([[wallet, { pre: 100n, post: 85n }]]),
    preTokenBalances: [],
    postTokenBalances: [token(10n)],
    creationCosts: new Map(),
    ...patch,
  };
}
function history(
  patch: Partial<WalletHistoryEvidence> = {},
): WalletHistoryEvidence {
  return {
    wallet,
    mint,
    snapshotSlot: 20,
    balanceAtS: 10n,
    first: { kind: "swap", sender: null, slot: 10, signature: "first", date },
    ...patch,
  };
}
function input(patch: Partial<FeedProvenanceInput> = {}): FeedProvenanceInput {
  return {
    wallet,
    mint,
    snapshotSlot: 20,
    snapshotDate,
    balanceNow: 10n,
    history: history(),
    teamWallets: [],
    consumption: [],
    liveCard: null,
    ...patch,
  };
}
function hop(patch: Partial<FeedProvenanceInput> = {}): FeedProvenanceInput {
  return input({
    history: history({
      balanceAtS: 0n,
      first: {
        kind: "transfer",
        sender,
        slot: 30,
        signature: "transfer",
        date,
      },
    }),
    senderHistory: history({ wallet: sender }),
    ...patch,
  });
}

describe("intake transaction classification", () => {
  it("requires net aggregate inflow across all wallet-owned token accounts", () => {
    expect(
      classifyInflow(
        transaction({
          preTokenBalances: [token(10n, wallet, 2)],
          postTokenBalances: [token(10n)],
        }),
        wallet,
        mint,
      ),
    ).toBeNull();
    expect(classifyInflow(transaction(), wallet, mint)?.kind).toBe("swap");
  });

  it("requires the recipient signature even when another token fell", () => {
    const tx = transaction({
      signers: [sender],
      preTokenBalances: [token(10n, wallet, 2, "other")],
      postTokenBalances: [token(10n), token(1n, wallet, 2, "other")],
    });
    expect(classifyInflow(tx, wallet, mint)?.kind).toBe("airdrop");
    expect(
      classifyInflow({ ...tx, signers: [wallet] }, wallet, mint)?.kind,
    ).toBe("swap");
  });

  it("aggregates other token accounts instead of treating an internal transfer as spend", () => {
    expect(
      classifyInflow(
        transaction({
          lamports: new Map([[wallet, { pre: 100n, post: 95n }]]),
          preTokenBalances: [token(10n, wallet, 2, "other")],
          postTokenBalances: [token(10n), token(10n, wallet, 3, "other")],
        }),
        wallet,
        mint,
      )?.kind,
    ).toBe("airdrop");
  });

  it("subtracts only the fee this wallet paid, with strict greater-than", () => {
    const tx = transaction({
      lamports: new Map([[wallet, { pre: 100n, post: 95n }]]),
    });
    expect(classifyInflow(tx, wallet, mint)?.kind).toBe("airdrop");
    expect(
      classifyInflow({ ...tx, feePayer: sender }, wallet, mint)?.kind,
    ).toBe("swap");
    expect(
      classifyInflow(
        { ...tx, lamports: new Map([[wallet, { pre: 100n, post: 94n }]]) },
        wallet,
        mint,
      )?.kind,
    ).toBe("swap");
  });

  it("never treats fee plus exact rent as a purchase", () => {
    const tx = transaction({
      creationCosts: new Map([[wallet, { rent: 10n, unresolvedFunding: 0n }]]),
    });
    expect(classifyInflow(tx, wallet, mint)?.kind).toBe("airdrop");
    expect(
      classifyInflow(
        {
          ...tx,
          creationCosts: new Map([
            [wallet, { rent: 9n, unresolvedFunding: 0n }],
          ]),
        },
        wallet,
        mint,
      )?.kind,
    ).toBe("swap");
  });

  it("fails closed when unresolved rent could explain the lamport decrease", () => {
    const tx = transaction({
      creationCosts: new Map([[wallet, { rent: 0n, unresolvedFunding: 10n }]]),
    });
    expect(() => classifyInflow(tx, wallet, mint)).toThrow(
      EvidenceUnavailableError,
    );
    expect(
      classifyInflow(
        { ...tx, lamports: new Map([[wallet, { pre: 100n, post: 84n }]]) },
        wallet,
        mint,
      )?.kind,
    ).toBe("swap");
    expect(
      classifyInflow(
        { ...tx, lamports: new Map([[wallet, { pre: 100n, post: 95n }]]) },
        wallet,
        mint,
      )?.kind,
    ).toBe("airdrop");
  });

  it("selects the largest falling account; ties use the lowest account index", () => {
    const tx = transaction({
      signers: [sender],
      preTokenBalances: [token(10n, "second", 3), token(10n, sender, 2)],
      postTokenBalances: [token(10n)],
    });
    expect(classifyInflow(tx, wallet, mint)?.sender).toBe(sender);
    expect(
      classifyInflow(
        {
          ...tx,
          preTokenBalances: [token(11n, "second", 3), token(10n, sender, 2)],
        },
        wallet,
        mint,
      )?.sender,
    ).toBe("second");
  });
});

describe("complete account history reconstruction", () => {
  const analyze = (transactions: IntakeTransaction[], snapshotSlot = 20) =>
    analyzeWalletHistory({
      wallet,
      mint,
      snapshotSlot,
      transactions,
      complete: true,
    });

  it("keeps untouched accounts and snapshot balances while processing later transfers", () => {
    const result = analyze([
      transaction({
        signature: "later",
        slot: 30,
        preTokenBalances: [token(10n)],
        postTokenBalances: [token(5n)],
      }),
      transaction(),
      transaction({
        signature: "second",
        slot: 15,
        postTokenBalances: [token(7n, wallet, 2)],
      }),
    ]);
    expect(result.balanceAtS).toBe(17n);
    expect(result.first?.signature).toBe("first");
    expect(analyze([transaction()], 9).balanceAtS).toBe(0n);
    expect(analyze([]).first).toBeNull();
  });

  it("accepts a snapshot-slot transaction and closed token account balances", () => {
    expect(analyze([transaction()], 10).balanceAtS).toBe(10n);
    expect(
      analyze([
        transaction(),
        transaction({
          signature: "close",
          slot: 20,
          preTokenBalances: [token(10n)],
          postTokenBalances: [],
        }),
      ]).balanceAtS,
    ).toBe(0n);
  });

  it("rejects missing pages, history gaps, duplicate signatures, or ambiguous order", () => {
    expect(() =>
      analyzeWalletHistory({
        wallet,
        mint,
        snapshotSlot: 20,
        transactions: [],
        complete: false,
      }),
    ).toThrow(EvidenceUnavailableError);
    expect(() =>
      analyze([transaction({ preTokenBalances: [token(5n)] })]),
    ).toThrow(EvidenceUnavailableError);
    expect(() => analyze([transaction(), transaction()])).toThrow(
      EvidenceUnavailableError,
    );
    expect(() =>
      analyze([
        transaction({ transactionIndex: null }),
        transaction({
          signature: "second",
          transactionIndex: 1,
          preTokenBalances: [token(10n)],
          postTokenBalances: [token(20n)],
        }),
      ]),
    ).toThrow(EvidenceUnavailableError);
  });

  it("uses transactionIndex to resolve same-slot order", () => {
    const result = analyze([
      transaction({
        signature: "second",
        transactionIndex: 1,
        preTokenBalances: [token(10n)],
        postTokenBalances: [token(20n)],
      }),
      transaction(),
    ]);
    expect(result.balanceAtS).toBe(20n);
    expect(result.first?.signature).toBe("first");
  });

  it("replays only the uncached live tail from an immutable account snapshot", () => {
    const snapshot = createWalletHistorySnapshot({
      wallet,
      mint,
      snapshotSlot: 20,
      complete: true,
      transactions: [
        transaction(),
        transaction({
          signature: "split",
          slot: 15,
          postTokenBalances: [token(7n, wallet, 2)],
        }),
      ],
    });
    const before = structuredClone(snapshot);
    const result = analyzeWalletHistory({
      wallet,
      mint,
      snapshotSlot: 20,
      complete: true,
      snapshot,
      transactions: [
        transaction({
          signature: "sale",
          slot: 30,
          preTokenBalances: [token(10n)],
          postTokenBalances: [],
        }),
      ],
    });
    expect(result.balanceAtS).toBe(17n);
    expect(result.first?.signature).toBe("first");
    expect(snapshot).toEqual(before);
    expect(() =>
      analyzeWalletHistory({
        wallet,
        mint,
        snapshotSlot: 21,
        complete: true,
        snapshot,
        transactions: [],
      }),
    ).toThrow(EvidenceUnavailableError);
    expect(() =>
      createWalletHistorySnapshot({
        wallet,
        mint,
        snapshotSlot: 9,
        complete: true,
        transactions: [transaction()],
      }),
    ).toThrow(EvidenceUnavailableError);
    expect(() =>
      analyzeWalletHistory({
        wallet,
        mint,
        snapshotSlot: 20,
        complete: true,
        snapshot,
        transactions: [transaction()],
      }),
    ).toThrow(EvidenceUnavailableError);
  });
});

describe("S1 landed Feed provenance fallback", () => {
  const landed = {
    depositor: wallet,
    mint,
    amount: "10",
    slot: 30n,
    signature: "landed",
  };
  const evidence = () => ({
    ...input(),
    beforeFeed: { slot: landed.slot, signature: landed.signature },
  });
  it("uses the same self and hop rules through S1's exact callback signature", async () => {
    const callback = createProvenanceRecomputer(async () => evidence());
    await expect(callback(landed)).resolves.toEqual({
      path: "self",
      via: null,
    });
    await expect(
      recomputeProvenance(landed, async () => ({
        ...hop(),
        beforeFeed: evidence().beforeFeed,
      })),
    ).resolves.toEqual({ path: "hop", via: sender });
  });
  it("leaves missing, post-Feed, mismatched, or refused evidence unknown", async () => {
    for (const result of [
      null,
      { ...evidence(), balanceNow: 0n },
      { ...evidence(), beforeFeed: { slot: 31n, signature: "other" } },
      { ...evidence(), teamWallets: [wallet] },
    ])
      await expect(
        recomputeProvenance(landed, async () => result),
      ).resolves.toBeNull();
    await expect(
      recomputeProvenance(landed, async () => {
        throw new EvidenceUnavailableError();
      }),
    ).resolves.toBeNull();
  });
});

describe("S1-S5 pure provenance rules", () => {
  it("permits self and a single transfer after the snapshot", () => {
    expect(evaluateFeedProvenance(input())).toEqual({
      eligible: true,
      path: "self",
      via: null,
      holder: wallet,
    });
    expect(evaluateFeedProvenance(hop())).toEqual({
      eligible: true,
      path: "hop",
      via: sender,
      holder: sender,
    });
  });

  it.each([
    ["zero_balance", { balanceNow: 0n }],
    ["team_wallet", { teamWallets: [wallet] }],
    ["live_card", { liveCard: { date } }],
    ["not_bought", { history: history({ first: null }) }],
    [
      "not_bought",
      {
        history: history({
          first: {
            kind: "airdrop" as const,
            sender: null,
            slot: 10,
            signature: "first",
            date,
          },
        }),
      },
    ],
    ["snapshot_not_held", { history: history({ balanceAtS: 0n }) }],
    [
      "snapshot_not_held",
      {
        history: history({
          first: {
            kind: "swap" as const,
            sender: null,
            slot: 21,
            signature: "first",
            date,
          },
        }),
      },
    ],
    [
      "passed_on",
      { consumption: [{ holder: wallet, mint, usedBy: sender, date }] },
    ],
  ])("refuses %s with stable reason", (reason, patch) => {
    expect(evaluateFeedProvenance(input(patch))).toMatchObject({
      eligible: false,
      reason,
    });
  });

  it("uses the deciding transaction date or the snapshot date", () => {
    expect(
      evaluateFeedProvenance(input({ history: history({ balanceAtS: 0n }) })),
    ).toMatchObject({ date: snapshotDate });
    expect(
      evaluateFeedProvenance(
        input({
          consumption: [{ holder: wallet, mint, usedBy: sender, date }],
        }),
      ),
    ).toMatchObject({ date });
    expect(evaluateFeedProvenance(input({ liveCard: { date } }))).toMatchObject(
      { date },
    );
  });

  it.each([
    { teamWallets: [sender] },
    { senderHistory: history({ wallet: sender, balanceAtS: 0n }) },
    { senderHistory: history({ wallet: sender, first: null }) },
    {
      senderHistory: history({
        wallet: sender,
        first: {
          kind: "transfer" as const,
          sender: "third",
          slot: 5,
          signature: "prior",
          date,
        },
      }),
    },
    {
      senderHistory: history({
        wallet: sender,
        first: {
          kind: "swap" as const,
          sender: null,
          slot: 21,
          signature: "prior",
          date,
        },
      }),
    },
  ])("refuses an ineligible one-hop sender", (patch) => {
    expect(evaluateFeedProvenance(hop(patch))).toMatchObject({
      eligible: false,
      reason: "hop_sender_ineligible",
    });
  });

  it("blocks other consumers and permits re-feed after take-back for the same wallet", () => {
    const request = hop({
      consumption: [{ holder: sender, mint, usedBy: "third", date }],
    });
    expect(evaluateFeedProvenance(request)).toEqual({
      eligible: false,
      reason: "hop_used",
      date,
    });
    request.consumption = [{ holder: sender, mint, usedBy: wallet, date }];
    const original = structuredClone(request);
    for (let i = 0; i < 10; i++)
      expect(evaluateFeedProvenance(request).eligible).toBe(true);
    expect(request).toEqual(original);
    expect(
      evaluateFeedProvenance(
        input({
          consumption: [{ holder: wallet, mint, usedBy: wallet, date }],
        }),
      ).eligible,
    ).toBe(true);
  });

  it("never confuses another mint or holder with this consumption", () => {
    expect(
      evaluateFeedProvenance(
        input({
          consumption: [
            { holder: wallet, mint: "other", usedBy: sender, date },
            { holder: sender, mint, usedBy: sender, date },
          ],
        }),
      ).eligible,
    ).toBe(true);
  });

  it("fails closed on missing or mismatched evidence", () => {
    expect(() =>
      evaluateFeedProvenance(hop({ senderHistory: undefined })),
    ).toThrow(EvidenceUnavailableError);
    expect(() =>
      evaluateFeedProvenance(
        hop({ senderHistory: history({ wallet: "third" }) }),
      ),
    ).toThrow(EvidenceUnavailableError);
    expect(() =>
      evaluateFeedProvenance(input({ history: history({ snapshotSlot: 19 }) })),
    ).toThrow(EvidenceUnavailableError);
    expect(() =>
      evaluateFeedProvenance(input({ history: history({ mint: "other" }) })),
    ).toThrow(EvidenceUnavailableError);
  });
});

function rawTransaction() {
  return {
    slot: 10,
    blockTime,
    transactionIndex: 0,
    transaction: {
      signatures: ["synthetic"],
      message: {
        accountKeys: [
          { pubkey: wallet, signer: true },
          { pubkey: "token-account", signer: false },
          { pubkey: "11111111111111111111111111111111", signer: false },
        ],
        instructions: [] as unknown[],
      },
    },
    meta: {
      err: null as unknown,
      fee: 5,
      preBalances: [100, 0, 0],
      postBalances: [85, 10, 0],
      preTokenBalances: [],
      postTokenBalances: [
        {
          accountIndex: 1,
          owner: wallet,
          mint,
          uiTokenAmount: { amount: "10" },
        },
      ],
      innerInstructions: [] as unknown[],
    },
  };
}

describe("full Helius history normalization", () => {
  it.each([
    [PROGRAM_IDS.splToken, WSOL_MINT],
    [PROGRAM_IDS.token2022, TOKEN_2022_NATIVE_MINT],
  ])(
    "treats a native account created and closed back to its wallet as rent-neutral",
    (programId, nativeMint) => {
      const raw = rawTransaction();
      raw.transaction.message.accountKeys.push({
        pubkey: "temporary-native",
        signer: false,
      });
      raw.meta.preBalances.push(0);
      raw.meta.postBalances.push(0);
      const creation = {
        programId: "11111111111111111111111111111111",
        parsed: {
          type: "createAccount",
          info: {
            source: wallet,
            newAccount: "temporary-native",
            lamports: 20,
            space: 165,
          },
        },
      };
      const initialize = {
        programId,
        parsed: {
          type: "initializeAccount3",
          info: {
            account: "temporary-native",
            owner: wallet,
            mint: nativeMint,
          },
        },
      };
      const close = {
        programId,
        parsed: {
          type: "closeAccount",
          info: {
            account: "temporary-native",
            destination: wallet,
            owner: wallet,
          },
        },
      };
      raw.meta.innerInstructions = [
        { instructions: [creation, initialize, close] },
      ];
      expect(
        classifyInflow(normalizeHistoryTransaction(raw)!, wallet, mint)?.kind,
      ).toBe("swap");
      raw.meta.postBalances[0] = 95;
      expect(
        classifyInflow(normalizeHistoryTransaction(raw)!, wallet, mint)?.kind,
      ).toBe("airdrop");
      raw.meta.postBalances[0] = 85;
      close.parsed.info.destination = sender;
      expect(() =>
        classifyInflow(normalizeHistoryTransaction(raw)!, wallet, mint),
      ).toThrow(EvidenceUnavailableError);
      close.parsed.info.destination = wallet;
      raw.meta.postBalances[3] = 1;
      expect(() =>
        classifyInflow(normalizeHistoryTransaction(raw)!, wallet, mint),
      ).toThrow(EvidenceUnavailableError);
    },
  );
  it("normalizes raw full evidence without lossy numeric token conversion", () => {
    const raw = rawTransaction();
    raw.meta.postTokenBalances[0]!.uiTokenAmount.amount =
      "18446744073709551615";
    const tx = normalizeHistoryTransaction(raw)!;
    expect(tx.postTokenBalances[0]!.amount).toBe(18446744073709551615n);
    expect(tx.signers).toEqual([wallet]);
  });

  it("includes inner account creation funding and permits proven exact rent", () => {
    const raw = rawTransaction();
    raw.meta.innerInstructions = [
      {
        index: 0,
        instructions: [
          {
            programId: "11111111111111111111111111111111",
            parsed: {
              type: "createAccount",
              info: {
                source: wallet,
                newAccount: "token-account",
                space: 165,
                lamports: 10,
              },
            },
          },
        ],
      },
    ];
    const tx = normalizeHistoryTransaction(raw)!;
    expect(tx.creationCosts.get(wallet)).toEqual({
      rent: 0n,
      unresolvedFunding: 10n,
    });
    expect(() => classifyInflow(tx, wallet, mint)).toThrow(
      EvidenceUnavailableError,
    );
    const exact = normalizeHistoryTransaction(raw, {
      rentForCreatedAccount: () => 10n,
    })!;
    expect(classifyInflow(exact, wallet, mint)?.kind).toBe("airdrop");
    expect(() =>
      normalizeHistoryTransaction(raw, { rentForCreatedAccount: () => 11n }),
    ).toThrow(EvidenceUnavailableError);
  });

  it("drops failed transactions and rejects malformed or partial evidence", () => {
    expect(
      normalizeHistoryTransaction({
        ...rawTransaction(),
        meta: {
          ...rawTransaction().meta,
          err: { InstructionError: [0, "failure"] },
        },
      }),
    ).toBeNull();
    for (const invalid of [
      { ...rawTransaction(), meta: null },
      {
        ...rawTransaction(),
        meta: { ...rawTransaction().meta, innerInstructions: null },
      },
      {
        ...rawTransaction(),
        meta: { ...rawTransaction().meta, fee: Number.MAX_SAFE_INTEGER + 1 },
      },
      {
        ...rawTransaction(),
        meta: { ...rawTransaction().meta, preBalances: [100] },
      },
      {
        ...rawTransaction(),
        meta: {
          ...rawTransaction().meta,
          postTokenBalances: [
            { accountIndex: 1, mint, uiTokenAmount: { amount: "10" } },
          ],
        },
      },
    ])
      expect(() => normalizeHistoryTransaction(invalid)).toThrow(
        EvidenceUnavailableError,
      );
  });

  it.each([undefined, null])(
    "ignores failed rows without success-only metadata",
    (metadata) => {
      expect(
        normalizeHistoryTransaction({
          slot: 10,
          transaction: { signatures: ["failed"] },
          meta: {
            err: { InstructionError: [0, "failure"] },
            preTokenBalances: metadata,
            postTokenBalances: metadata,
            innerInstructions: metadata,
          },
        }),
      ).toBeNull();
      expect(() =>
        normalizeHistoryTransaction({
          ...rawTransaction(),
          meta: {
            ...rawTransaction().meta,
            err: null,
            preTokenBalances: metadata,
            postTokenBalances: metadata,
            innerInstructions: metadata,
          },
        }),
      ).toThrow(EvidenceUnavailableError);
    },
  );

  it("requires explicit failure evidence and a valid signature and slot before dropping a row", () => {
    for (const raw of [
      { slot: 10, transaction: { signatures: ["failed"] }, meta: {} },
      { slot: 10, transaction: { signatures: [] }, meta: { err: "failure" } },
      {
        slot: -1,
        transaction: { signatures: ["failed"] },
        meta: { err: "failure" },
      },
      { slot: 10, transaction: { signatures: ["failed"] }, meta: null },
    ])
      expect(() => normalizeHistoryTransaction(raw)).toThrow(
        EvidenceUnavailableError,
      );
  });

  it.each([
    [PROGRAM_IDS.splToken, "initializeAccount"],
    [PROGRAM_IDS.splToken, "initializeAccount2"],
    [PROGRAM_IDS.token2022, "initializeAccount3"],
  ])(
    "recovers closed temporary account ownership from trusted token initialization",
    (programId, type) => {
      const raw = rawTransaction();
      raw.transaction.message.accountKeys.push({
        pubkey: "temporary-wsol",
        signer: false,
      });
      raw.meta.preBalances.push(0);
      raw.meta.postBalances.push(0);
      raw.meta.innerInstructions = [
        {
          instructions: [
            {
              programId: "11111111111111111111111111111111",
              parsed: {
                type: "createAccount",
                info: {
                  source: wallet,
                  newAccount: "temporary-wsol",
                  space: 165,
                  lamports: 20,
                },
              },
            },
            {
              programId,
              parsed: {
                type,
                info: { account: "temporary-wsol", owner: wallet },
              },
            },
            {
              programId,
              parsed: {
                type: "closeAccount",
                info: {
                  account: "temporary-wsol",
                  owner: wallet,
                  destination: wallet,
                },
              },
            },
          ],
        },
      ];
      expect(() =>
        classifyInflow(normalizeHistoryTransaction(raw)!, wallet, mint),
      ).toThrow(EvidenceUnavailableError);
      const tx = normalizeHistoryTransaction(raw, {
        rentForCreatedAccount: (creation) => {
          expect(creation.tokenOwner).toBe(wallet);
          return 3n;
        },
      })!;
      expect(classifyInflow(tx, wallet, mint)?.kind).toBe("swap");
      raw.meta.innerInstructions = [
        {
          instructions: [
            {
              programId: "11111111111111111111111111111111",
              parsed: {
                type: "createAccount",
                info: {
                  source: wallet,
                  newAccount: "temporary-wsol",
                  space: 165,
                  lamports: 20,
                },
              },
            },
            {
              programId: "untrusted-program",
              parsed: {
                type,
                info: { account: "temporary-wsol", owner: wallet },
              },
            },
          ],
        },
      ];
      expect(() =>
        classifyInflow(
          normalizeHistoryTransaction(raw, {
            rentForCreatedAccount: () => 3n,
          })!,
          wallet,
          mint,
        ),
      ).toThrow(EvidenceUnavailableError);
    },
  );

  it("refuses inconsistent initialization ownership rather than inferring rent attribution", () => {
    const raw = rawTransaction();
    raw.meta.innerInstructions = [
      {
        instructions: [
          {
            programId: PROGRAM_IDS.splToken,
            parsed: {
              type: "initializeAccount3",
              info: { account: "token-account", owner: "other-owner" },
            },
          },
        ],
      },
    ];
    expect(() => normalizeHistoryTransaction(raw)).toThrow(
      EvidenceUnavailableError,
    );
  });

  it("rejects unparsed System instructions rather than guessing created-account rent", () => {
    const raw = rawTransaction();
    raw.transaction.message.instructions = [
      { programId: "11111111111111111111111111111111", data: "unknown" },
    ];
    expect(() => normalizeHistoryTransaction(raw)).toThrow(
      EvidenceUnavailableError,
    );
  });

  it("accounts for inner rent funding of a prefunded allocated account", () => {
    const raw = rawTransaction();
    raw.meta.innerInstructions = [
      {
        instructions: [
          {
            programId: "11111111111111111111111111111111",
            parsed: {
              type: "transfer",
              info: {
                source: wallet,
                destination: "token-account",
                lamports: 10,
              },
            },
          },
          {
            programId: "11111111111111111111111111111111",
            parsed: {
              type: "allocate",
              info: { account: "token-account", space: 165 },
            },
          },
          {
            programId: "11111111111111111111111111111111",
            parsed: {
              type: "assign",
              info: { account: "token-account", owner: "token-program" },
            },
          },
        ],
      },
    ];
    expect(() =>
      classifyInflow(normalizeHistoryTransaction(raw)!, wallet, mint),
    ).toThrow(EvidenceUnavailableError);
  });

  it("resolves loaded addresses for raw account keys and signer header", () => {
    const raw = rawTransaction();
    const full = {
      ...raw,
      transaction: {
        ...raw.transaction,
        message: {
          ...raw.transaction.message,
          accountKeys: [wallet],
          header: { numRequiredSignatures: 1 },
        },
      },
      meta: {
        ...raw.meta,
        loadedAddresses: {
          writable: ["token-account"],
          readonly: ["11111111111111111111111111111111"],
        },
      },
    };
    expect(
      normalizeHistoryTransaction(full)!.postTokenBalances[0]!.account,
    ).toBe("token-account");
    expect(normalizeHistoryTransaction(full)!.signers).toEqual([wallet]);
    expect(() =>
      normalizeHistoryTransaction({
        ...full,
        transaction: {
          ...full.transaction,
          message: { ...full.transaction.message, header: undefined },
        },
      }),
    ).toThrow(EvidenceUnavailableError);
  });

  it("does not subtract sponsored creation rent from the recipient's spending", () => {
    const raw = rawTransaction();
    raw.transaction.message.accountKeys.push({ pubkey: sender, signer: true });
    raw.meta.preBalances.push(100);
    raw.meta.postBalances.push(90);
    raw.meta.innerInstructions = [
      {
        instructions: [
          {
            programId: "11111111111111111111111111111111",
            parsed: {
              type: "createAccount",
              info: {
                source: sender,
                newAccount: "token-account",
                space: 165,
                lamports: 10,
              },
            },
          },
        ],
      },
    ];
    expect(
      classifyInflow(normalizeHistoryTransaction(raw)!, wallet, mint)?.kind,
    ).toBe("swap");
  });

  it("rejects new System creation instruction types until explicitly decoded", () => {
    const raw = rawTransaction();
    raw.transaction.message.instructions = [
      {
        programId: "11111111111111111111111111111111",
        parsed: { type: "unsupportedCreation", info: {} },
      },
    ];
    expect(() => normalizeHistoryTransaction(raw)).toThrow(
      EvidenceUnavailableError,
    );
  });
});
