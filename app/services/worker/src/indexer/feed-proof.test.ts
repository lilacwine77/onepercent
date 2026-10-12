import { createHash, sign } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { TOKEN_PROGRAMS } from "./accounts.js";
import {
  findFeedInstructionProofs,
  verifyFeedInstruction,
} from "./feed-proof.js";
import {
  encodeFeedInstructionData,
  feedProofFixture,
} from "./feed-proof.test-data.mjs";

describe("successful confirmed Feed instruction evidence", () => {
  it.each([false, true])(
    "recovers signed bags after logs and current Deck entries disappear (token2022=%s)",
    (token2022) => {
      const fixture = feedProofFixture({ count: 2, token2022 });
      const proof = verifyFeedInstruction(
        fixture.tx,
        fixture.ixIndex,
        fixture.options,
      );
      expect(proof).toMatchObject({
        depositor: fixture.owner,
        nonce: fixture.nonce,
        expiry: fixture.expiry,
        signer: fixture.signer,
        evidence: "incomplete",
        attestationIxIndex: fixture.attestationIxIndex,
        attestationSha256: createHash("sha256")
          .update(fixture.message)
          .digest("hex"),
      });
      expect(
        proof?.bags.map(({ mint, amount, vault, tokenProgram }) => ({
          mint,
          amount,
          vault,
          tokenProgram,
        })),
      ).toEqual(
        fixture.mints.map((mint, index) => ({
          mint,
          amount: fixture.amounts[index],
          vault: fixture.vaults[index],
          tokenProgram: TOKEN_PROGRAMS[token2022 ? 1 : 0],
        })),
      );
      expect(findFeedInstructionProofs(fixture.tx, fixture.options)).toEqual([
        proof,
      ]);
    },
  );

  it("always marks current Config evidence incomplete", () => {
    const { tx, options, signer, ixIndex } = feedProofFixture();
    options.intakeSigner = { address: signer, source: "current" };
    expect(verifyFeedInstruction(tx, ixIndex, options)?.evidence).toBe(
      "incomplete",
    );
  });

  it("uses the signer in the successful transaction after current Config rotation", () => {
    const { tx, options, signer, ixIndex } = feedProofFixture();
    options.intakeSigner = {
      address: new PublicKey(Buffer.alloc(32, 77)).toBase58(),
      source: "current",
    };
    expect(verifyFeedInstruction(tx, ixIndex, options)).toMatchObject({
      signer,
      evidence: "incomplete",
    });
  });

  it("ignores trailing Feed bytes exactly as Anchor does", () => {
    const { tx, options, ixIndex, feed } = feedProofFixture();
    tx.instructions[ixIndex]!.data = encodeFeedInstructionData(
      Buffer.concat([feed, Buffer.from([7, 9])]),
    );
    expect(verifyFeedInstruction(tx, ixIndex, options)?.evidence).toBe(
      "incomplete",
    );
  });

  it("ignores failed transactions even with valid signatures and instructions", () => {
    const { tx, options, ixIndex } = feedProofFixture();
    tx.err = { InstructionError: [ixIndex, "Custom"] };
    expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
    expect(findFeedInstructionProofs(tx, options)).toEqual([]);
  });

  it.each(["program", "discriminator", "count", "zero_amount"])(
    "rejects an invalid Feed %s",
    (kind) => {
      const { tx, options, ixIndex, feed } = feedProofFixture();
      if (kind === "program")
        tx.instructions[ixIndex]!.programId = TOKEN_PROGRAMS[0];
      if (kind === "discriminator") feed[0] = feed[0]! ^ 1;
      if (kind === "count") feed.writeUInt32LE(7, 8);
      if (kind === "zero_amount") feed.writeBigUInt64LE(0n, 12);
      tx.instructions[ixIndex]!.data = encodeFeedInstructionData(feed);
      expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
    },
  );

  it.each(Array.from({ length: 11 }, (_, index) => index))(
    "rejects a wrong Feed account at index %i",
    (index) => {
      const { tx, options, ixIndex } = feedProofFixture();
      tx.instructions[ixIndex]!.accounts[index] = new PublicKey(
        Buffer.alloc(32, 77),
      ).toBase58();
      expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
    },
  );

  it.each(["owner", "mint", "vault", "amount", "program", "missing"])(
    "rejects a preceding transfer with wrong %s",
    (kind) => {
      const { tx, options, ixIndex } = feedProofFixture();
      const transfer = tx.instructions[0]!;
      const other = new PublicKey(Buffer.alloc(32, 77)).toBase58();
      if (kind === "owner") transfer.accounts[3] = other;
      if (kind === "mint") transfer.accounts[1] = other;
      if (kind === "vault") transfer.accounts[2] = other;
      if (kind === "amount") {
        const data = Buffer.alloc(10);
        data[0] = 12;
        data.writeBigUInt64LE(99n, 1);
        transfer.data = encodeFeedInstructionData(data);
      }
      if (kind === "program") transfer.programId = TOKEN_PROGRAMS[1];
      if (kind === "missing") transfer.data = "";
      expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
    },
  );

  it.each(["offset", "length"])(
    "rejects Ed25519 %s outside M1 bounds",
    (kind) => {
      const { tx, options, ixIndex, attestationIxIndex, ed25519 } =
        feedProofFixture();
      if (kind === "offset") ed25519.writeUInt16LE(0, 14);
      if (kind === "length") ed25519.writeUInt16LE(65_535, 12);
      tx.instructions[attestationIxIndex]!.data =
        encodeFeedInstructionData(ed25519);
      expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
    },
  );

  it.each(["low_signature_offset", "overlap", "padding"])(
    "accepts successful Ed25519 layouts permitted by M1: %s",
    (kind) => {
      const { tx, options, ixIndex, attestationIxIndex, ed25519 } =
        feedProofFixture();
      if (kind === "low_signature_offset") ed25519.writeUInt16LE(0, 2);
      if (kind === "overlap") ed25519.writeUInt16LE(17, 6);
      if (kind === "padding") ed25519[1] = 1;
      tx.instructions[attestationIxIndex]!.data =
        encodeFeedInstructionData(ed25519);
      expect(verifyFeedInstruction(tx, ixIndex, options)?.evidence).toBe(
        "incomplete",
      );
    },
  );

  it("accepts att_ix after Feed in a successful transaction", () => {
    const { tx, options, ixIndex, attestationIxIndex, feed } =
      feedProofFixture();
    [tx.instructions[attestationIxIndex], tx.instructions[ixIndex]] = [
      tx.instructions[ixIndex]!,
      tx.instructions[attestationIxIndex]!,
    ];
    feed[feed.length - 1] = ixIndex;
    tx.instructions[attestationIxIndex]!.data = encodeFeedInstructionData(feed);
    expect(
      verifyFeedInstruction(tx, attestationIxIndex, options),
    ).toMatchObject({ attestationIxIndex: ixIndex, evidence: "incomplete" });
  });

  it.each([0, 12, 44, 76, 80, 88, 89])(
    "rejects an otherwise valid signature over a changed Feed field at %i",
    (offset) => {
      const {
        tx,
        options,
        ixIndex,
        attestationIxIndex,
        ed25519,
        message,
        privateKey,
      } = feedProofFixture();
      message[offset] = message[offset]! ^ 1;
      sign(null, message, privateKey).copy(ed25519, 16);
      message.copy(ed25519, 112);
      tx.instructions[attestationIxIndex]!.data =
        encodeFeedInstructionData(ed25519);
      expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
    },
  );

  it("requires the exact att_ix and rejects duplicate Feed instructions", () => {
    const { tx, options, ixIndex, feed } = feedProofFixture();
    feed[feed.length - 1] = ixIndex;
    tx.instructions[ixIndex]!.data = encodeFeedInstructionData(feed);
    expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
    const fixture = feedProofFixture();
    fixture.tx.instructions.push(
      structuredClone(fixture.tx.instructions[fixture.ixIndex]!),
    );
    expect(findFeedInstructionProofs(fixture.tx, fixture.options)).toEqual([]);
  });

  it("rejects duplicate mints and malformed transport data without throwing", () => {
    const { tx, options, ixIndex } = feedProofFixture({ count: 2 });
    tx.instructions[ixIndex]!.accounts.splice(
      11,
      4,
      ...tx.instructions[ixIndex]!.accounts.slice(7, 11),
    );
    expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
    tx.instructions[ixIndex]!.data = "invalid-base58!";
    expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
    tx.instructions[ixIndex]!.data = "1".repeat(2_049);
    expect(verifyFeedInstruction(tx, ixIndex, options)).toBeNull();
  });
});
