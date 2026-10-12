import { readFileSync } from "node:fs";
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_1PCT } from "@onepercent/config";
import { BorshInstructionCoder, BN } from "../anchor.js";
import type { Idl } from "@anchor-lang/core";
import { describe, expect, it } from "vitest";
import {
  buyV3Ix,
  collectCoinCreatorFeeIx,
  collectCreatorFeeV2Ix,
  createV2Ix,
  curveCollectStepIx,
  poolCollectStepIx,
  transferCreatorFeesToPumpIx,
} from "./ix.js";
import { canonicalPool, curveFeeConfig, pumpGlobal } from "./pdas.js";
import { PUMP_FEE_CONFIG, PUMP_GLOBAL } from "./ids.js";
import {
  decodeBondingCurve,
  decodeFeeConfig,
  decodeGlobal,
  decodePool,
} from "./layouts.js";
import { devBuyQuote, devBuyQuoteDetails } from "./quote.js";

const file = (path: string) =>
  new URL(`../../../../fixtures/${path}`, import.meta.url);
const fixture = (name: string) =>
  readFileSync(file(`mainnet/pump/${name}.bin`));
const pumpIdl = JSON.parse(
  readFileSync(file("pump/idl/pump.json"), "utf8"),
) as Idl;
const ammIdl = JSON.parse(
  readFileSync(file("pump/idl/pump_amm.json"), "utf8"),
) as Idl;
const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const wallet = key(1),
  mint = key(2),
  creator = key(3),
  payer = key(4),
  recipient = key(5);
const metadata = {
  name: "Launch rehearsal",
  symbol: "TEST",
  uri: `https://example.com/${"x".repeat(60)}`,
};
const global = decodeGlobal(fixture("global")),
  fees = decodeFeeConfig(fixture("curve_fee_config"));
const quote = devBuyQuote(global, fees);
const instructions = {
  createV2: createV2Ix({
    ...metadata,
    wallet,
    mint,
    creator,
    creatorFeeBps: 0n,
  }),
  buyV3: buyV3Ix({
    wallet,
    mint,
    amount: TOKEN_1PCT.devBuyAmount,
    maxSolCost: quote,
    buybackFeeRecipient: recipient,
  }),
  curveCollectStep: curveCollectStepIx({ payer, mint, creator }),
  collectCreatorFeeV2: collectCreatorFeeV2Ix({ creator }),
  poolCollectStep: poolCollectStepIx({
    payer,
    creator,
    pool: key(6),
    poolQuoteTokenAccount: key(7),
  }),
  transferCreatorFeesToPump: transferCreatorFeesToPumpIx({ creator }),
  collectCoinCreatorFee: collectCoinCreatorFeeIx({ creator }),
};
const vector = {
  source: "pump-public-docs 2293f9a6 and M4 brief section 6.1 SWITCH",
  inputs: {
    wallet: wallet.toBase58(),
    mint: mint.toBase58(),
    creator: creator.toBase58(),
    payer: payer.toBase58(),
    recipient: recipient.toBase58(),
    ...metadata,
  },
  quote: {
    tokens: TOKEN_1PCT.devBuyAmount.toString(),
    maxSolCost: quote.toString(),
  },
  instructions: Object.fromEntries(
    Object.entries(instructions).map(([name, instruction]) => [
      name,
      {
        programId: instruction.programId.toBase58(),
        dataHex: instruction.data.toString("hex"),
        accounts: instruction.keys.map((meta) => ({
          address: meta.pubkey.toBase58(),
          signer: meta.isSigner,
          writable: meta.isWritable,
        })),
      },
    ]),
  ),
};

describe("pump instruction bytes and account metas", () => {
  it("matches the committed pump instruction vectors", () => {
    const recorded = JSON.parse(
      readFileSync(file("vectors/pump_ix.json"), "utf8"),
    );
    // The historical file also contains the superseded M4 pump launch adapter.
    // D29's power_on vector belongs to Meteora; preserve these external vectors.
    delete recorded.instructions.powerOn;
    expect(vector).toEqual(recorded);
  });
  it("matches every external discriminator, account privilege and fixed IDL address", () => {
    for (const [name, instruction] of Object.entries(instructions)) {
      const idl = [
        "poolCollectStep",
        "transferCreatorFeesToPump",
        "collectCoinCreatorFee",
      ].includes(name)
        ? ammIdl
        : pumpIdl;
      const spec = idl.instructions.find((candidate) =>
        Buffer.from(candidate.discriminator).equals(
          instruction.data.subarray(0, 8),
        ),
      )!;
      expect(spec).toBeDefined();
      expect(instruction.keys).toHaveLength(spec.accounts.length);
      const namedKeys = new Map(
        spec.accounts.map((account, index) => [
          account.name,
          instruction.keys[index]!.pubkey,
        ]),
      );
      const inputAddresses: Record<string, PublicKey> = {
        mint,
        base_mint: mint,
        user: wallet,
        payer,
        creator,
        coin_creator: creator,
        buyback_fee_recipient: recipient,
      };
      const resolveSeed = (seed: {
        kind: string;
        value?: number[];
        path?: string;
      }): Buffer => {
        if (seed.kind === "const" && seed.value) return Buffer.from(seed.value);
        if (seed.kind === "account" && seed.path && namedKeys.has(seed.path))
          return namedKeys.get(seed.path)!.toBuffer();
        throw new Error(
          "Unsupported IDL seed in the pinned launch instructions",
        );
      };
      spec.accounts.forEach((account, index) => {
        if ("accounts" in account)
          throw new Error("Unexpected nested IDL accounts");
        const meta = instruction.keys[index]!;
        expect(
          { isSigner: meta.isSigner, isWritable: meta.isWritable },
          `${name} ${account.name}`,
        ).toEqual({
          isSigner: account.signer ?? false,
          isWritable: account.writable ?? false,
        });
        if (account.address)
          expect(meta.pubkey.toBase58()).toBe(account.address);
        if (inputAddresses[account.name])
          expect(meta.pubkey.equals(inputAddresses[account.name]!)).toBe(true);
        if (account.pda) {
          const program = account.pda.program
            ? new PublicKey(resolveSeed(account.pda.program))
            : instruction.programId;
          const expected = PublicKey.findProgramAddressSync(
            account.pda.seeds.map(resolveSeed),
            program,
          )[0];
          expect(
            meta.pubkey.equals(expected),
            `${name} ${account.name} seed order`,
          ).toBe(true);
        }
      });
    }
  });
  it("encodes explicit false/zero creation arguments with the pinned IDL coder", () => {
    const coder = new BorshInstructionCoder(pumpIdl);
    expect(instructions.createV2.data).toEqual(
      coder.encode("create_v2", {
        ...metadata,
        creator,
        is_mayhem_mode: false,
        is_cashback_enabled: [false],
        creator_fee_bps: [new BN(0)],
        is_holder_reward: [false],
      }),
    );
    const encodedBuy = coder.encode("buy_v3", {
      amount: new BN(TOKEN_1PCT.devBuyAmount.toString()),
      max_sol_cost: new BN(quote.toString()),
      partial_fill: [false],
    });
    expect(instructions.buyV3.data).toEqual(
      encodedBuy.subarray(0, encodedBuy.length - 1),
    );
  });
  it.each([0n, 200n, 301n])(
    "encodes the explicit creator fee argument %s without changing other flags",
    (creatorFeeBps) => {
      const coder = new BorshInstructionCoder(pumpIdl);
      expect(
        createV2Ix({ ...metadata, wallet, mint, creator, creatorFeeBps }).data,
      ).toEqual(
        coder.encode("create_v2", {
          ...metadata,
          creator,
          is_mayhem_mode: false,
          is_cashback_enabled: [false],
          creator_fee_bps: [new BN(creatorFeeBps.toString())],
          is_holder_reward: [false],
        }),
      );
    },
  );
  it("rejects overlong UTF-8 metadata, invalid URI schemes and nonpositive buys", () => {
    expect(() =>
      createV2Ix({
        ...metadata,
        wallet,
        mint,
        creator,
        creatorFeeBps: 0n,
        name: "é".repeat(17),
      }),
    ).toThrow();
    expect(() =>
      createV2Ix({
        ...metadata,
        wallet,
        mint,
        creator,
        creatorFeeBps: 0n,
        uri: "http://example.com",
      }),
    ).toThrow();
    expect(() =>
      buyV3Ix({
        wallet,
        mint,
        amount: 0n,
        maxSolCost: quote,
        buybackFeeRecipient: recipient,
      }),
    ).toThrow();
  });
});

describe("live-account fixture layouts and exact reverse quote", () => {
  it("derives the pinned addresses and migrated canonical pool", () => {
    expect(pumpGlobal().equals(PUMP_GLOBAL)).toBe(true);
    expect(curveFeeConfig().equals(PUMP_FEE_CONFIG)).toBe(true);
    expect(
      canonicalPool(
        new PublicKey("ADPN2aqzY5RhkBC7bNQWFhTFFEYKY4drHUQG887Cpump"),
      ).toBase58(),
    ).toBe("7mQDGteiaD4Tkupg9hStyPQNeSTNTRaUEhh1zJ1awp8x");
  });
  it("decodes Global, fee config and the 151-byte migrated curve", () => {
    expect(global.createV2Enabled).toBe(true);
    expect(global.initialVirtualTokenReserves).toBe(1073000000000000n);
    expect(global.initialVirtualSolReserves).toBe(30000000000n);
    expect(global.buybackFeeRecipients).toHaveLength(8);
    const curve = decodeBondingCurve(fixture("graduated_curve")),
      pool = decodePool(fixture("graduated_pool"));
    expect(curve.complete).toBe(true);
    expect(curve.creator.equals(pool.coinCreator)).toBe(true);
    expect(curve.postCompleteBaseOut).toBe(0n);
    expect(pool.quoteTokenAccount.equals(PublicKey.default)).toBe(false);
  });
  it("computes the exact 40M price, selects fee tiers and rejects invalid reserves", () => {
    expect(devBuyQuoteDetails(global, fees)).toMatchObject({
      netLamports: 1161665055n,
      maxSolCost: 1176185869n,
      protocolFeeBps: 95n,
      creatorFeeBps: 30n,
    });
    const tiers = [
      {
        marketCapLamportsThreshold: 0n,
        fees: { lpFeeBps: 0n, protocolFeeBps: 1n, creatorFeeBps: 2n },
      },
      {
        marketCapLamportsThreshold: 1n,
        fees: { lpFeeBps: 0n, protocolFeeBps: 3n, creatorFeeBps: 4n },
      },
    ];
    expect(
      devBuyQuoteDetails(global, { ...fees, feeTiers: tiers }).protocolFeeBps,
    ).toBe(3n);
    expect(() => devBuyQuote(global, { ...fees, feeTiers: [] })).toThrow();
    expect(() =>
      devBuyQuote(global, { ...fees, feeTiers: [...tiers].reverse() }),
    ).toThrow();
    expect(() =>
      devBuyQuote({ ...global, initialVirtualTokenReserves: 1n }, fees),
    ).toThrow();
    expect(() => devBuyQuote(global, fees, 0n)).toThrow();
  });
  it("rejects malformed discriminators, boolean flags, truncated fields and fee vectors", () => {
    const curve = fixture("graduated_curve");
    expect(() => decodeBondingCurve(Buffer.alloc(81))).toThrow();
    expect(() => decodeBondingCurve(curve.subarray(0, 70))).toThrow();
    const bad = Buffer.from(curve);
    bad[81] = 2;
    expect(() => decodeBondingCurve(bad)).toThrow();
    const old = curve.subarray(0, 81);
    expect(decodeBondingCurve(old).isHolderReward).toBe(false);
    const config = fixture("curve_fee_config");
    config.writeUInt32LE(0xffffffff, 65);
    expect(() => decodeFeeConfig(config)).toThrow();
  });
});
