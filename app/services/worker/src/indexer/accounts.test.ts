import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BYTES,
  accountDiscriminator,
  decodeConfig,
  decodeDeckHeader,
  decodeLedger,
  decodeMachine,
  decodePull,
  ledgerAddress,
  pullAddress,
} from "./accounts.js";
function fixture(
  name: "Machine" | "Config" | "MintLedger" | "Deck" | "Pull",
  extra = 0,
) {
  const data = Buffer.alloc(ACCOUNT_BYTES[name] + extra);
  accountDiscriminator(name).copy(data);
  return data;
}
describe("M1 draft account adapter", () => {
  it("matches discriminator vectors from the draft M1 IDL", () => {
    const vectors = {
      Config: [155, 12, 170, 224, 30, 250, 204, 130],
      Deck: [192, 215, 78, 133, 216, 161, 59, 154],
      Machine: [25, 102, 22, 13, 58, 243, 138, 79],
      MintLedger: [202, 202, 190, 148, 227, 148, 76, 70],
      Pull: [65, 19, 46, 7, 253, 230, 71, 243],
    } as const;
    for (const name of Object.keys(vectors) as (keyof typeof vectors)[])
      expect([...accountDiscriminator(name)]).toEqual(vectors[name]);
  });
  it("keeps u64 and signed timestamps exact", () => {
    const data = fixture("Machine");
    data.writeBigUInt64LE((1n << 64n) - 1n, 72);
    data.writeBigInt64LE(-1n, 40);
    expect(decodeMachine(data)).toMatchObject({
      stock_sol: (1n << 64n) - 1n,
      power_on_ts: -1n,
    });
  });
  it("rejects malformed lengths, discriminators, capacities and Pull tails", () => {
    for (const [name, decode] of [
      ["Machine", decodeMachine],
      ["Config", decodeConfig],
      ["MintLedger", decodeLedger],
      ["Deck", decodeDeckHeader],
    ] as const) {
      const data = fixture(name);
      expect(() => decode(data.subarray(1))).toThrow();
      expect(() => decode(Buffer.concat([data, Buffer.from([0])]))).toThrow();
      data[0] = 0;
      expect(() => decode(data)).toThrow();
    }
    const deck = fixture("Deck");
    deck.writeUInt32LE(2, 8);
    deck.writeUInt32LE(1, 12);
    expect(() => decodeDeckHeader(deck)).toThrow("invalid_deck_capacity");
    const pull = fixture("Pull", ACCOUNT_BYTES.packRecord);
    pull[143] = 1;
    pull[144] = 2;
    expect(decodePull(pull)).toMatchObject({ qty: 1, status: "revealed" });
    expect(() => decodePull(pull.subarray(0, -1))).toThrow();
  });
  it("uses the draft M1 ledger and buyer-nonce PDA seeds", () => {
    const program = new PublicKey(new Uint8Array(32).fill(2));
    const mint = PublicKey.default;
    expect(ledgerAddress(program.toBase58(), mint.toBase58())).toBe(
      PublicKey.findProgramAddressSync(
        [Buffer.from("ledger"), mint.toBuffer()],
        program,
      )[0].toBase58(),
    );
    expect(pullAddress(program.toBase58(), mint.toBase58(), 1)).not.toBe(
      pullAddress(program.toBase58(), mint.toBase58(), 2),
    );
  });
});
