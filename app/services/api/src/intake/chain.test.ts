import { createHash } from "node:crypto";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_IDS, PUMP_LAYOUTS } from "@onepercent/config";
import type { MintSafety } from "@onepercent/market";
import { describe, expect, it, vi } from "vitest";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@onepercent/service-kit/intake";
import { createFeedChainReader, decodeFeedState } from "./chain.js";
import layout from "./fixtures/m1-feed-layouts.json" with { type: "json" };

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const programId = new PublicKey("DoNH1Cxvv9umyWV9i77LEK4CoqTotDxPRzPxPBzjMJpe");
const wallet = key(1);
const mint = key(9).toBase58();
const now = 1_800_000_000;
const slot = 200;
const system = SystemProgram.programId.toBase58();
const tokenProgram: string = PROGRAM_IDS.splToken;
const canonical = PublicKey.findProgramAddressSync(
  [
    wallet.toBuffer(),
    new PublicKey(tokenProgram).toBuffer(),
    new PublicKey(mint).toBuffer(),
  ],
  new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
)[0].toBase58();
const raw = (
  data: Buffer,
  owner = programId.toBase58(),
  executable = false,
) => ({
  owner,
  executable,
  data: [data.toString("base64"), "base64"] as [string, "base64"],
});
const tagged = (name: string, size: number) => {
  const data = Buffer.alloc(size);
  createHash("sha256").update(`account:${name}`).digest().copy(data, 0, 0, 8);
  return data;
};
const bump = (name: string) =>
  PublicKey.findProgramAddressSync(
    name === "binder"
      ? [Buffer.from(name), wallet.toBuffer()]
      : [Buffer.from(name)],
    programId,
  )[1];

// The sizes and offsets are an unmodified subset of M1 layouts.json.
function stateFixture() {
  const config = tagged("Config", layout.Config.size);
  const cf = layout.Config.fields;
  config[cf.version] = 1;
  config[cf.bump] = bump("config");
  config[cf.season_set] = 1;
  config.writeBigUInt64LE(100n, cf.snapshot_slot);
  config.writeBigInt64LE(BigInt(now - 100), cf.snapshot_ts);
  key(8).toBuffer().copy(config, cf.team_wallet);
  for (let i = 0; i < 8; i++)
    key(20 + i)
      .toBuffer()
      .copy(config, cf.team_wallets + 32 * i);
  key(7).toBuffer().copy(config, cf.token_mint);
  const machine = tagged("Machine", layout.Machine.size);
  machine[layout.Machine.fields.version] = 1;
  machine[layout.Machine.fields.bump] = bump("machine");
  machine[layout.Machine.fields.phase] = 3;
  machine.writeBigInt64LE(BigInt(now + 100), layout.Machine.fields.end_ts);
  const binder = tagged("Binder", layout.Binder.size + 3 * layout.Card.size);
  const bf = layout.Binder.fields;
  wallet.toBuffer().copy(binder, bf.owner);
  binder[bf.bump] = bump("binder");
  binder.writeUInt16LE(3, bf.cap);
  binder.writeUInt16LE(1, bf.len);
  binder.writeUInt16LE(1, bf.reserved);
  binder.writeUInt32LE(513, bf.feed_nonce_base);
  binder.writeUInt16LE(0b1011, bf.feed_nonce_bits);
  binder.writeUInt16LE(2, bf.fresh_in_deck);
  const values = () => [
    raw(config),
    raw(machine),
    raw(binder),
    raw(Buffer.alloc(0), system),
  ];
  const decode = (overrides = values()) =>
    decodeFeedState({ programId, wallet, slot, values: overrides, now });
  return { config, machine, binder, values, decode };
}

function tokenAccount(address: string, amount = "42") {
  return {
    pubkey: address,
    account: {
      owner: tokenProgram,
      executable: false,
      data: {
        parsed: {
          type: "account",
          info: {
            mint,
            owner: wallet.toBase58(),
            state: "initialized",
            tokenAmount: { amount, decimals: 6 },
          },
        },
      },
    },
  };
}
function bagFixture() {
  const safety: MintSafety = {
    ownerProgram: tokenProgram,
    decimals: 6,
    mintAuthorityDisabled: true,
    freezeAuthorityDisabled: true,
    extensions: [],
    safe: true,
    slot,
  };
  const getMintSafety = vi.fn(async () => safety);
  const curve = {
    context: { slot },
    value: raw(
      Buffer.from(PUMP_LAYOUTS.bondingCurveDiscriminatorHex, "hex"),
      PROGRAM_IDS.pumpFun,
    ),
  };
  const tokens = { context: { slot }, value: [tokenAccount(canonical)] };
  const request = vi.fn<
    (method: string, params: unknown[]) => Promise<unknown>
  >(async (method) => (method === "getAccountInfo" ? curve : tokens));
  const reader = createFeedChainReader(
    {
      request: async (method, params, schema) =>
        schema.parse(await request(method, params)),
    },
    programId,
    { getMintSafety },
  );
  return { safety, getMintSafety, curve, tokens, request, reader };
}

describe("confirmed M1 Feed state reader", () => {
  it("decodes the draft account layouts and reads all four accounts at confirmed", async () => {
    const fixture = stateFixture();
    const request = vi.fn<
      (method: string, params: unknown[]) => Promise<unknown>
    >(async () => ({ context: { slot }, value: fixture.values() }));
    const reader = createFeedChainReader(
      {
        request: async (method, params, schema) =>
          schema.parse(await request(method, params)),
      },
      programId,
      { getMintSafety: vi.fn() },
    );
    await expect(reader.state(wallet.toBase58(), now)).resolves.toMatchObject({
      slot,
      snapshotSlot: 100,
      snapshotDate: new Date((now - 100) * 1000).toISOString(),
      tokenMint: key(7).toBase58(),
      feedOpen: true,
      base: 513,
      bits: 0b1011,
      freshInDeck: 2,
      teamWallets: [
        key(8),
        ...Array.from({ length: 8 }, (_, i) => key(20 + i)),
      ].map((item) => item.toBase58()),
    });
    const [method, params] = request.mock.calls[0]!;
    expect(method).toBe("getMultipleAccounts");
    expect(params[1]).toEqual({ commitment: "confirmed", encoding: "base64" });
    expect(params[0]).toEqual([
      PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        programId,
      )[0].toBase58(),
      PublicKey.findProgramAddressSync(
        [Buffer.from("machine")],
        programId,
      )[0].toBase58(),
      PublicKey.findProgramAddressSync(
        [Buffer.from("binder"), wallet.toBuffer()],
        programId,
      )[0].toBase58(),
      wallet.toBase58(),
    ]);
  });

  it("starts nonce and fresh counters at zero for absent or prefunded empty Binders", () => {
    const fixture = stateFixture();
    for (const binder of [null, raw(Buffer.alloc(0), system)]) {
      const values: Parameters<typeof decodeFeedState>[0]["values"] =
        fixture.values();
      values[2] = binder;
      expect(
        decodeFeedState({ programId, wallet, slot, values, now }),
      ).toMatchObject({ base: 0, bits: 0, freshInDeck: 0 });
    }
  });

  it.each([0, 1, 2, 3])("refuses an invalid owner for account %i", (index) => {
    const fixture = stateFixture();
    const values = fixture.values();
    values[index]!.owner = key(90).toBase58();
    expect(() => fixture.decode(values)).toThrow("chain_unavailable");
  });

  it.each(["config", "machine", "binder"] as const)(
    "refuses invalid %s discriminator, version or bump",
    (name) => {
      let fixture = stateFixture();
      fixture[name][0] = fixture[name][0]! ^ 0xff;
      expect(() => fixture.decode()).toThrow("chain_unavailable");
      fixture = stateFixture();
      const offset =
        name === "config"
          ? layout.Config.fields.bump
          : name === "machine"
            ? layout.Machine.fields.bump
            : layout.Binder.fields.bump;
      fixture[name][offset] = fixture[name][offset]! ^ 1;
      expect(() => fixture.decode()).toThrow("chain_unavailable");
      if (name !== "binder") {
        fixture = stateFixture();
        fixture[name][
          name === "config"
            ? layout.Config.fields.version
            : layout.Machine.fields.version
        ] = 2;
        expect(() => fixture.decode()).toThrow("chain_unavailable");
      }
    },
  );

  it("refuses a Binder for another wallet or invalid card capacity", () => {
    let fixture = stateFixture();
    key(99).toBuffer().copy(fixture.binder, layout.Binder.fields.owner);
    expect(() => fixture.decode()).toThrow("chain_unavailable");
    fixture = stateFixture();
    fixture.binder.writeUInt16LE(4, layout.Binder.fields.reserved);
    expect(() => fixture.decode()).toThrow("chain_unavailable");
    fixture = stateFixture();
    fixture.binder.writeUInt16LE(4, layout.Binder.fields.cap);
    expect(() => fixture.decode()).toThrow("chain_unavailable");
  });

  it("refuses nonempty System-owned Binders and future snapshot slots", () => {
    const fixture = stateFixture();
    const values = fixture.values();
    values[2] = raw(Buffer.from([0]), system);
    expect(() => fixture.decode(values)).toThrow("chain_unavailable");
    fixture.config.writeBigUInt64LE(
      BigInt(slot + 1),
      layout.Config.fields.snapshot_slot,
    );
    expect(() => fixture.decode()).toThrow("chain_unavailable");
  });

  it("maps an out-of-range snapshot date to an unavailable chain result", () => {
    const fixture = stateFixture();
    fixture.config.writeBigInt64LE(
      9_000_000_000_000_000n,
      layout.Config.fields.snapshot_ts,
    );
    expect(() => fixture.decode()).toThrow("chain_unavailable");
  });

  it("mirrors season, phase, both Feed pause bits and the exact end time", () => {
    const fixture = stateFixture();
    for (const phase of [0, 4, 5, 255]) {
      fixture.machine[layout.Machine.fields.phase] = phase;
      expect(fixture.decode().feedOpen).toBe(false);
    }
    for (const phase of [1, 2, 3]) {
      fixture.machine[layout.Machine.fields.phase] = phase;
      expect(fixture.decode().feedOpen).toBe(true);
    }
    for (const offset of [
      layout.Config.fields.admin_paused,
      layout.Config.fields.guardian_paused,
    ]) {
      fixture.config[offset] = 2;
      expect(fixture.decode().feedOpen).toBe(false);
      fixture.config[offset] = 1;
      expect(fixture.decode().feedOpen).toBe(true);
      fixture.config[offset] = 0;
    }
    fixture.machine.writeBigInt64LE(BigInt(now), layout.Machine.fields.end_ts);
    expect(fixture.decode().feedOpen).toBe(false);
    fixture.machine.writeBigInt64LE(0n, layout.Machine.fields.end_ts);
    expect(fixture.decode().feedOpen).toBe(true);
    fixture.config[layout.Config.fields.season_set] = 0;
    expect(fixture.decode().feedOpen).toBe(false);
  });
});

describe("whole-bag confirmed token account reads", () => {
  it("sums canonical and split accounts exactly and returns sorted merge sources", async () => {
    const fixture = bagFixture();
    fixture.tokens.value = [
      tokenAccount(key(12).toBase58(), "9007199254740993"),
      tokenAccount(canonical, "7"),
      tokenAccount(key(11).toBase58(), "0"),
    ];
    await expect(
      fixture.reader.bag(wallet.toBase58(), mint, slot),
    ).resolves.toEqual({
      ok: true,
      slot,
      bag: {
        mint,
        amount: 9_007_199_254_741_000n,
        decimals: 6,
        tokenProgram,
        source: canonical,
        mergeFrom: [key(11).toBase58(), key(12).toBase58()].sort(),
      },
    });
    for (const [, params] of fixture.request.mock.calls) {
      expect(params.at(-1)).toMatchObject({
        commitment: "confirmed",
        minContextSlot: slot,
      });
    }
  });

  it("returns zero when no token account exists", async () => {
    const fixture = bagFixture();
    fixture.tokens.value = [];
    await expect(
      fixture.reader.bag(wallet.toBase58(), mint, slot),
    ).resolves.toMatchObject({
      ok: true,
      slot,
      bag: { amount: 0n, source: canonical, mergeFrom: [] },
    });
  });

  it("refuses unsafe mints before reading a curve or token accounts", async () => {
    const fixture = bagFixture();
    fixture.safety.safe = false;
    await expect(
      fixture.reader.bag(wallet.toBase58(), mint, slot),
    ).resolves.toEqual({ ok: false, slot, reason: "not_supported" });
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it("does not classify stale safety or stale balances as an eligible bag", async () => {
    let fixture = bagFixture();
    fixture.safety.slot = slot - 1;
    await expect(
      fixture.reader.bag(wallet.toBase58(), mint, slot),
    ).rejects.toThrow("chain_unavailable");
    fixture = bagFixture();
    fixture.tokens.context.slot = slot - 1;
    await expect(
      fixture.reader.bag(wallet.toBase58(), mint, slot),
    ).rejects.toThrow("chain_unavailable");
  });

  it.each(["owner", "discriminator", "executable"])(
    "refuses non-pump origin with invalid %s",
    async (field) => {
      const fixture = bagFixture();
      if (field === "owner") fixture.curve.value.owner = system;
      if (field === "discriminator")
        fixture.curve.value.data[0] = Buffer.alloc(8).toString("base64");
      if (field === "executable") fixture.curve.value.executable = true;
      await expect(
        fixture.reader.bag(wallet.toBase58(), mint, slot),
      ).resolves.toEqual({ ok: false, slot, reason: "not_pump_fun" });
    },
  );

  it.each([
    "owner",
    "mint",
    "program",
    "decimals",
    "executable",
    "duplicate",
    "overflow",
  ])("fails closed for inconsistent account %s", async (field) => {
    const fixture = bagFixture();
    const account = fixture.tokens.value[0]!;
    if (field === "owner")
      account.account.data.parsed.info.owner = key(4).toBase58();
    if (field === "mint")
      account.account.data.parsed.info.mint = key(4).toBase58();
    if (field === "program") account.account.owner = system;
    if (field === "decimals")
      account.account.data.parsed.info.tokenAmount.decimals++;
    if (field === "executable") account.account.executable = true;
    if (field === "duplicate") fixture.tokens.value.push(account);
    if (field === "overflow")
      fixture.tokens.value = [
        tokenAccount(canonical, ((1n << 64n) - 1n).toString()),
        tokenAccount(key(4).toBase58()),
      ];
    await expect(
      fixture.reader.bag(wallet.toBase58(), mint, slot),
    ).rejects.toThrow("chain_unavailable");
  });

  it("refuses a stale curve response even when later token balances are recent", async () => {
    const fixture = bagFixture();
    fixture.curve.context.slot = slot - 1;
    await expect(
      fixture.reader.bag(wallet.toBase58(), mint, slot),
    ).rejects.toThrow("chain_unavailable");
  });
});
