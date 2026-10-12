import { PROGRAM_ID } from "./program-id.js";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import * as pda from "../src/pda.js";
import { EXTERNAL_IDS } from "../src/constants.js";
import { vectors } from "./vectors.js";
interface Sample {
  name: string;
  args: (string | number)[];
  address: string;
  bump?: number;
}
const key = (value: string | number | undefined) =>
  new PublicKey(String(value));
function derive(v: Sample): PublicKey | [PublicKey, number] {
  switch (v.name) {
    case "config":
    case "configPda":
      return pda.configPda(PROGRAM_ID);
    case "machine":
    case "machinePda":
      return pda.machinePda(PROGRAM_ID);
    case "deck":
    case "deckPda":
      return pda.deckPda(PROGRAM_ID);
    case "vault_auth":
    case "vaultAuthPda":
      return pda.vaultAuthPda(PROGRAM_ID);
    case "fee_in":
    case "feeInPda":
      return pda.feeInPda(PROGRAM_ID);
    case "program_identity":
    case "programIdentityPda":
      return pda.programIdentityPda(PROGRAM_ID);
    case "binder":
    case "binderPda":
      return pda.binderPda(PROGRAM_ID, key(v.args[0]));
    case "pull":
    case "pullPda":
      return pda.pullPda(PROGRAM_ID, key(v.args[0]), Number(v.args[1]));
    case "ledger":
    case "ledgerPda":
      return pda.ledgerPda(PROGRAM_ID, key(v.args[0]));
    case "vault":
    case "vaultAta":
      return pda.vaultAta(PROGRAM_ID, key(v.args[0]), key(v.args[1]));
    case "userAta":
      return pda.userAta(key(v.args[0]), key(v.args[1]), key(v.args[2]));
    case "dbcPoolPda":
      return pda.dbcPoolPda(key(v.args[0]), key(v.args[1]));
    case "bonding_curve":
    case "bondingCurvePda":
      return pda.bondingCurvePda(key(v.args[0]));
    case "scoped_vrf_identity":
    case "scopedVrfIdentity":
      return pda.scopedVrfIdentity(PROGRAM_ID);
    default:
      throw new Error(`Unhandled PDA vector ${v.name}`);
  }
}
describe("PDA parity", () => {
  it("matches Rust addresses and bumps for every seed family", () => {
    const samples = vectors<Sample[]>("pdas");
    expect(samples.length).toBeGreaterThanOrEqual(12);
    for (const v of samples) {
      const actual = derive(v);
      expect((Array.isArray(actual) ? actual[0] : actual).toBase58()).toBe(
        v.address,
      );
      if (Array.isArray(actual) && v.bump !== undefined)
        expect(actual[1]).toBe(v.bump);
    }
  });
  it("uses buyer nonce little-endian, independent of the machine sequence", () => {
    const buyer = new PublicKey(new Uint8Array(32).fill(1));
    const [address, bump] = pda.pullPda(PROGRAM_ID, buyer, 0x04030201);
    expect(
      address.equals(
        PublicKey.createProgramAddressSync(
          [
            Buffer.from("pull"),
            buyer.toBuffer(),
            Buffer.from([1, 2, 3, 4]),
            Buffer.from([bump]),
          ],
          PROGRAM_ID,
        ),
      ),
    ).toBe(true);
    expect(() => pda.pullPda(PROGRAM_ID, buyer, 2 ** 32)).toThrow();
  });
  it("separates SPL and Token-2022 vaults", () => {
    const mint = new PublicKey(new Uint8Array(32).fill(2));
    expect(
      pda
        .vaultAta(PROGRAM_ID, mint, EXTERNAL_IDS.splToken)
        .equals(pda.vaultAta(PROGRAM_ID, mint, EXTERNAL_IDS.token2022)),
    ).toBe(false);
  });
});
