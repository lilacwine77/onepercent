import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS, type RawAccount } from "@onepercent/eligibility";
import { token2022Metadata } from "./mint-metadata.js";

const address = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
function text(value: string): Buffer {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}
function metadata(): Buffer {
  return Buffer.concat([
    Buffer.alloc(32),
    new PublicKey(address).toBuffer(),
    text("Jeton été"),
    text("ÉTÉ"),
    text("https://example.test/metadata.json"),
    Buffer.from([1, 0, 0, 0]),
    text("tag"),
    text("value"),
  ]);
}
function account(body = metadata()): RawAccount {
  const base = Buffer.alloc(166);
  base[44] = 6;
  base[45] = 1;
  base[165] = 1;
  const header = Buffer.alloc(4);
  header.writeUInt16LE(19);
  header.writeUInt16LE(body.length, 2);
  return {
    address,
    owner: PROGRAM_IDS.token2022,
    lamports: 1n,
    data: Buffer.concat([base, header, body]),
  };
}

describe("inline Token-2022 metadata", () => {
  it("reads the associated mint's UTF-8 name, symbol and JSON URI without a network source", () => {
    expect(token2022Metadata(account())).toEqual({
      name: "Jeton été",
      symbol: "ÉTÉ",
      uri: "https://example.test/metadata.json",
    });
  });
  it("ignores wrong owners, uninitialized mints and metadata for another mint", () => {
    expect(token2022Metadata(null)).toBeUndefined();
    expect(
      token2022Metadata({ ...account(), owner: PROGRAM_IDS.splToken }),
    ).toBeUndefined();
    const uninitialized = account();
    uninitialized.data[45] = 0;
    expect(token2022Metadata(uninitialized)).toBeUndefined();
    const mismatched = metadata();
    mismatched[32] = mismatched[32]! ^ 1;
    expect(token2022Metadata(account(mismatched))).toBeUndefined();
  });
  it("ignores truncated TLV, invalid string lengths, invalid UTF-8 and incomplete extra fields", () => {
    const truncated = account();
    truncated.data = truncated.data.subarray(0, truncated.data.length - 1);
    const length = metadata();
    length.writeUInt32LE(0xffff_ffff, 64);
    const invalidUtf8 = metadata();
    invalidUtf8[68] = 0xff;
    for (const raw of [
      truncated,
      account(length),
      account(invalidUtf8),
      account(metadata().subarray(0, -1)),
    ])
      expect(token2022Metadata(raw)).toBeUndefined();
  });
  it("ignores ambiguous duplicate inline metadata extensions", () => {
    const raw = account();
    raw.data = Buffer.concat([raw.data, raw.data.subarray(166)]);
    expect(token2022Metadata(raw)).toBeUndefined();
  });
});
