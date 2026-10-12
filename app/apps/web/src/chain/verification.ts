import {
  PublicKey,
  type AccountInfo,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { PROGRAM_IDS } from "@onepercent/config";
import { bytesEqual, bytesView, IDL } from "@onepercent/sdk/browser";
import { parseOnepercentLogs } from "@onepercent/sdk/events";

export const LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

/** Clock's fixed sysvar ABI, read in the same bank as the public accounts. */
export function clockTimestamp(
  account: AccountInfo<Uint8Array> | null,
): bigint {
  if (
    !account ||
    account.executable ||
    !account.owner.equals(
      new PublicKey("Sysvar1111111111111111111111111111111111111"),
    ) ||
    account.data.length !== 40
  )
    throw new Error("Invalid Clock sysvar account");
  return bytesView(account.data).getBigInt64(32, true);
}

/** Verify that this executable is actually bound to the inspected ProgramData. */
export function linkedProgramData(
  account: AccountInfo<Uint8Array> | null,
  programData: PublicKey,
): boolean {
  return !!(
    account?.executable &&
    account.owner.equals(LOADER) &&
    account.data.length === 36 &&
    bytesView(account.data).getUint32(0, true) === 2 &&
    new PublicKey(account.data.subarray(4, 36)).equals(programData)
  );
}

/** Solana UpgradeableLoaderState bincode ABI; rejects incomplete or wrong-owner data. */
export function upgradeAuthority(
  account: AccountInfo<Uint8Array>,
): PublicKey | null {
  if (
    !account.owner.equals(LOADER) ||
    account.executable ||
    account.data.length < 45 ||
    bytesView(account.data).getUint32(0, true) !== 3
  )
    throw new Error("Invalid ProgramData");
  if (account.data[12] === 0) return null;
  if (account.data[12] !== 1) throw new Error("Invalid authority option");
  return new PublicKey(account.data.subarray(13, 45));
}

/** Squads v4 Multisig prefix: sdk/multisig/src/generated/accounts/Multisig.ts. */
export function multisigGovernance(account: AccountInfo<Uint8Array>) {
  const discriminator = Uint8Array.from([224, 116, 121, 186, 68, 161, 79, 236]);
  if (
    account.executable ||
    !account.owner.equals(new PublicKey(PROGRAM_IDS.squadsV4)) ||
    account.data.length < 78 ||
    !bytesEqual(account.data.subarray(0, 8), discriminator)
  )
    throw new Error("Invalid multisig");
  return {
    threshold: bytesView(account.data).getUint16(72, true),
    timeLock: bytesView(account.data).getUint32(74, true),
    configAuthority: new PublicKey(account.data.subarray(40, 72)),
  };
}

export function multisigVault(multisig: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("multisig"),
      multisig.toBytes(),
      new TextEncoder().encode("vault"),
      Uint8Array.of(0),
    ],
    new PublicKey(PROGRAM_IDS.squadsV4),
  )[0];
}

function decodeBase58(value: string): Uint8Array {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let integer = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid base58");
    integer = integer * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (integer) {
    bytes.push(Number(integer & 255n));
    integer >>= 8n;
  }
  const leading = value.length - value.replace(/^1+/, "").length;
  const result = new Uint8Array(leading + bytes.length);
  result.set(bytes.reverse(), leading);
  return result;
}

/** Decodes only the published scoped request ABI, never guesses a missing seed. */
export function requestCallerSeed(
  tx: VersionedTransactionResponse,
  programId: string,
  pull: string,
): Uint8Array | undefined {
  if (tx.meta?.err !== null) return undefined;
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta.loadedAddresses,
  });
  const topLevelProgramIds = tx.transaction.message.compiledInstructions.map(
    (ix) => keys.get(ix.programIdIndex)!.toBase58(),
  );
  const parsed = parseOnepercentLogs({
    logs: tx.meta.logMessages ?? null,
    err: tx.meta.err,
    programId,
    topLevelProgramIds,
  });
  if (parsed.malformed || parsed.truncated) return undefined;
  const opened = parsed.events.find(
    (event) => event.name === "PullOpened" && event.data.pull === pull,
  );
  if (!opened) return undefined;
  const group = tx.meta.innerInstructions?.find(
    ({ index }) => index === opened.ixIndex,
  );
  const callback = Uint8Array.from(
    IDL.instructions.find(({ name }) => name === "consume_randomness")!
      .discriminator,
  );
  const seeds: Uint8Array[] = [];
  for (const instruction of group?.instructions ?? []) {
    if (
      keys.get(instruction.programIdIndex)?.toBase58() !==
      PROGRAM_IDS.magicblockVrf
    )
      continue;
    const bytes = decodeBase58(instruction.data);
    // ephemeral-vrf-sdk 0.17.3 RequestRandomness: discriminator, seed, callback, vectors.
    if (
      bytes.length < 76 ||
      bytes[0] !== 10 ||
      bytes.subarray(1, 8).some((byte) => byte !== 0) ||
      !new PublicKey(bytes.subarray(40, 72)).equals(new PublicKey(programId))
    )
      continue;
    const length = bytesView(bytes).getUint32(72, true);
    if (
      length !== callback.length ||
      !bytesEqual(bytes.subarray(76, 76 + length), callback)
    )
      continue;
    const metasAt = 76 + length;
    if (bytes.length < metasAt + 4) continue;
    const count = bytesView(bytes).getUint32(metasAt, true);
    const argsAt = metasAt + 4 + count * 34;
    if (bytes.length < argsAt + 4) continue;
    const metas = Array.from({ length: count }, (_, index) =>
      new PublicKey(
        bytes.subarray(metasAt + 4 + index * 34, metasAt + 4 + index * 34 + 32),
      ).toBase58(),
    );
    if (!metas.includes(pull)) continue;
    seeds.push(bytes.subarray(8, 40));
  }
  return seeds.length === 1 ? seeds[0] : undefined;
}
