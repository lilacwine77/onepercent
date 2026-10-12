import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
// Metaplex MetadataV1 Borsh prefix, through primarySaleHappened/isMutable.
export async function verifyImmutableMetadata(rpc, mint) {
  const program = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), program.toBuffer(), mint.toBuffer()],
    program,
  );
  const account = await rpc.getAccountInfo(address, "finalized");
  assert(account && account.owner.equals(program));
  const data = account.data;
  assert.equal(data[0], 4);
  assert(new PublicKey(data.subarray(33, 65)).equals(mint));
  let cursor = 65;
  const strings = [];
  for (let i = 0; i < 3; i++) {
    const length = data.readUInt32LE(cursor);
    cursor += 4;
    assert(cursor + length <= data.length);
    strings.push(
      data
        .subarray(cursor, cursor + length)
        .toString()
        .replace(/\0+$/, ""),
    );
    cursor += length;
  }
  cursor += 2;
  const creators = data[cursor++];
  assert(creators === 0 || creators === 1);
  if (creators) {
    const count = data.readUInt32LE(cursor);
    cursor += 4 + 34 * count;
  }
  cursor++;
  assert.equal(data[cursor], 0, "Metaplex metadata must be immutable");
  return {
    address: address.toBase58(),
    name: strings[0],
    symbol: strings[1],
    uri: strings[2],
    isMutable: false,
    mutableOffset: cursor,
  };
}
