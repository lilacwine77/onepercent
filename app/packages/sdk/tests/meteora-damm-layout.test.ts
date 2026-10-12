import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  DAMM_CLAIM_LAYOUT,
  decodeDammClaimPool,
  decodeDammClaimPosition,
} from "../src/meteora/launch.js";

type Type = string | { array: [Type, number] } | { defined: { name: string } };
const idl = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/meteora/damm-v2.json", import.meta.url),
    "utf8",
  ),
) as {
  accounts: { name: string; discriminator: number[] }[];
  types: { name: string; type: { fields: { name: string; type: Type }[] } }[];
};
const definition = (name: string) =>
  idl.types.find((entry) => entry.name === name)!.type.fields;
function size(type: Type): number {
  if (typeof type === "string") {
    const width = (
      { u8: 1, u16: 2, u32: 4, u64: 8, u128: 16, pubkey: 32 } as Record<
        string,
        number
      >
    )[type];
    if (width === undefined) throw new Error(`Unsupported type ${type}`);
    return width;
  }
  if ("array" in type) return size(type.array[0]) * type.array[1];
  return definition(type.defined.name).reduce(
    (total, field) => total + size(field.type),
    0,
  );
}
const offset = (name: string, field: string) => {
  let at = 8;
  for (const entry of definition(name)) {
    if (entry.name === field) return at;
    at += size(entry.type);
  }
  throw new Error(`Missing field ${field}`);
};
describe("pinned DAMM claim layouts", () => {
  it("checks every Rust and SDK field against the upstream IDL", () => {
    const rust = readFileSync(
      new URL(
        "../../../programs/onepercent/src/instructions/claim_launch_fees.rs",
        import.meta.url,
      ),
      "utf8",
    );
    for (const [name, prefix, layout, fields] of [
      [
        "Pool",
        "DAMM_POOL",
        DAMM_CLAIM_LAYOUT.pool,
        [
          ["baseMint", "token_a_mint", "BASE_MINT"],
          ["quoteMint", "token_b_mint", "QUOTE_MINT"],
          ["baseVault", "token_a_vault", "BASE_VAULT"],
          ["quoteVault", "token_b_vault", "QUOTE_VAULT"],
        ],
      ],
      [
        "Position",
        "DAMM_POSITION",
        DAMM_CLAIM_LAYOUT.position,
        [
          ["pool", "pool", "POOL"],
          ["nftMint", "nft_mint", "NFT_MINT"],
        ],
      ],
    ] as const) {
      expect(layout.minLength).toBe(8 + size({ defined: { name } }));
      expect(layout.discriminator).toEqual(
        idl.accounts.find((entry) => entry.name === name)!.discriminator,
      );
      expect(rust).toContain(
        `pub const ${prefix}_MIN_LEN: usize = ${layout.minLength};`,
      );
      expect(rust).toContain(
        `pub const ${prefix}_DISCRIMINATOR: [u8; 8] = [${layout.discriminator.join(", ")}];`,
      );
      for (const [sdk, field, rustField] of fields) {
        const actual = (layout as unknown as Record<string, number>)[sdk];
        expect(actual).toBe(offset(name, field));
        expect(rust).toContain(
          `pub const ${prefix}_${rustField}_OFFSET: usize = ${actual};`,
        );
      }
    }
  });
  it("decodes mint/vault identities and rejects wrong types or truncated accounts", () => {
    const key = new PublicKey(new Uint8Array(32).fill(7));
    const pool = new Uint8Array(DAMM_CLAIM_LAYOUT.pool.minLength);
    pool.set(DAMM_CLAIM_LAYOUT.pool.discriminator);
    pool.set(key.toBytes(), DAMM_CLAIM_LAYOUT.pool.baseMint);
    expect(decodeDammClaimPool(pool).baseMint).toEqual(key);
    const position = new Uint8Array(DAMM_CLAIM_LAYOUT.position.minLength);
    position.set(DAMM_CLAIM_LAYOUT.position.discriminator);
    position.set(key.toBytes(), DAMM_CLAIM_LAYOUT.position.pool);
    expect(decodeDammClaimPosition(position).pool).toEqual(key);
    expect(() => decodeDammClaimPool(pool.slice(0, -1))).toThrow();
    expect(() => decodeDammClaimPosition(pool)).toThrow();
    pool[0] = pool[0]! ^ 1;
    expect(() => decodeDammClaimPool(pool)).toThrow();
  });
});
