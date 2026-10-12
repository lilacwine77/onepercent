import { Buffer } from "buffer";
import {
  ACCOUNT_SIZES,
  COVERAGE,
  PACK_EDITIONS,
  RESCUE,
  SERVICES,
} from "@onepercent/config";
import {
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type {
  AccountInfo,
  Connection,
  GetProgramAccountsFilter,
} from "@solana/web3.js";
import { utils } from "../anchor.js";
import { discriminator, integer, u32 } from "../bytes.js";
import { EXTERNAL_IDS, RESERVED_KEYS, SEEDS, SIZES } from "../constants.js";
import {
  configLayout,
  decodeBinder,
  decodePull,
  deckEntryLayout,
  deckHeaderLayout,
  machineLayout,
  mintLedgerLayout,
} from "../layouts.js";
import type { DeckEntry, MintLedger } from "../layouts.js";
import { readClock, rpcCall } from "./clock.js";

export { rpcCall } from "./clock.js";

export type RescueRpc = Pick<
  Connection,
  | "getAccountInfoAndContext"
  | "getMultipleAccountsInfoAndContext"
  | "getProgramAccounts"
>;

export class RpcScanRefusedError extends Error {
  readonly code = "rpc_scan_refused";
  constructor() {
    super(
      "The supplied RPC refused or could not complete a program scan; direct account exits remain available.",
    );
    this.name = "RpcScanRefusedError";
  }
}

export function rescuePda(
  programId: PublicKey,
  seed: string,
  args: readonly Uint8Array[] = [],
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...args],
    programId,
  );
}

function checkAccount(
  info: AccountInfo<Buffer> | null,
  programId: PublicKey,
  size?: number,
): AccountInfo<Buffer> {
  if (
    !info ||
    info.executable ||
    !info.owner.equals(programId) ||
    (size !== undefined && info.data.length !== size)
  )
    throw new Error("Invalid rescue account owner or layout");
  return info;
}

/** Closed or not-yet-created PDAs can receive unsolicited System lamports. */
function absentAccount(info: AccountInfo<Buffer> | null): boolean {
  return (
    info === null ||
    (!info.executable &&
      info.owner.equals(SystemProgram.programId) &&
      info.data.length === 0)
  );
}

function lamports(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid RPC lamport balance");
  return BigInt(value);
}

async function readPda(
  rpc: RescueRpc,
  programId: PublicKey,
  seed: string,
  size: number,
) {
  const [address, bump] = rescuePda(programId, seed);
  const result = await rpcCall(() =>
    rpc.getAccountInfoAndContext(address, { commitment: "confirmed" }),
  );
  return {
    address,
    bump,
    slot: result.context.slot,
    info: checkAccount(result.value, programId, size),
  };
}

export async function readMachine(rpc: RescueRpc, programId: PublicKey) {
  const result = await readPda(rpc, programId, SEEDS.machine, SIZES.machine);
  const decoded = machineLayout.decode(result.info.data);
  if (
    decoded.bump !== result.bump ||
    decoded.version !== 1 ||
    decoded.phase > 6
  )
    throw new Error("Invalid Machine header");
  return { address: result.address, slot: result.slot, ...decoded };
}

const UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export async function readConfig(rpc: RescueRpc, programId: PublicKey) {
  const read = await readPda(rpc, programId, SEEDS.config, SIZES.config);
  const config = configLayout.decode(read.info.data);
  if (
    config.bump !== read.bump ||
    config.version !== 1 ||
    config.active_queue >= config.vrf_queues.length
  )
    throw new Error("Invalid Config header");
  return { address: read.address, slot: read.slot, config };
}

export async function readCore(rpc: RescueRpc, programId: PublicKey) {
  const [configRead, machine, clock, programRead] = await Promise.all([
    readConfig(rpc, programId),
    readMachine(rpc, programId),
    readClock(rpc),
    rpcCall(() =>
      rpc.getAccountInfoAndContext(programId, { commitment: "confirmed" }),
    ),
  ]);
  const config = configRead.config;
  const program = programRead.value;
  if (
    !program ||
    !program.executable ||
    !program.owner.equals(UPGRADEABLE_LOADER) ||
    program.data.length !== 36 ||
    program.data.readUInt32LE(0) !== 2
  )
    throw new Error("The selected account is not an upgradeable program");
  const programData = new PublicKey(program.data.subarray(4, 36));
  const [expectedProgramData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    UPGRADEABLE_LOADER,
  );
  if (!programData.equals(expectedProgramData))
    throw new Error("Invalid program data address");
  const dataRead = await rpcCall(() =>
    rpc.getAccountInfoAndContext(programData, {
      commitment: "confirmed",
      minContextSlot: programRead.context.slot,
      dataSlice: { offset: 0, length: 45 },
    }),
  );
  const data = checkAccount(dataRead.value, UPGRADEABLE_LOADER, 45).data;
  if (data.readUInt32LE(0) !== 3 || (data[12] !== 0 && data[12] !== 1))
    throw new Error("Invalid program data header");
  const slots = {
    config: configRead.slot,
    machine: machine.slot,
    clock: clock.slot,
    program: programRead.context.slot,
    programData: dataRead.context.slot,
  };
  return {
    slot: Math.max(...Object.values(slots)),
    slots,
    config,
    machine,
    clock,
    programData,
    deployedSlot: data.readBigUInt64LE(4),
    upgradeAuthority:
      data[12] === 1 ? new PublicKey(data.subarray(13, 45)) : null,
  };
}

export type RescueDeckEntry = DeckEntry & { deckIndex: number; slot: number };

export async function findDeckEntries(
  rpc: RescueRpc,
  programId: PublicKey,
  wallet: PublicKey,
): Promise<RescueDeckEntry[]> {
  const [address, bump] = rescuePda(programId, SEEDS.deck);
  const headerRead = await rpcCall(() =>
    rpc.getAccountInfoAndContext(address, {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: ACCOUNT_SIZES.deckHeader },
    }),
  );
  const headerData = checkAccount(
    headerRead.value,
    programId,
    ACCOUNT_SIZES.deckHeader,
  ).data;
  const header = deckHeaderLayout.decode(headerData);
  if (
    header.bump !== bump ||
    header.version !== 1 ||
    header.len > header.cap ||
    header.cap > COVERAGE.deckMax
  )
    throw new Error("Invalid Deck header");
  const perChunk = Math.floor(
    SERVICES.indexer.deckChunkBytes / ACCOUNT_SIZES.deckEntry,
  );
  const entries: RescueDeckEntry[] = [];
  let highestSlot = headerRead.context.slot;
  for (
    let first = 0;
    first < header.len;
    first += perChunk * RESCUE.scanConcurrency
  ) {
    const chunks = Array.from(
      {
        length: Math.min(
          RESCUE.scanConcurrency,
          Math.ceil((header.len - first) / perChunk),
        ),
      },
      (_, i) => ({
        start: first + i * perChunk,
        count: Math.min(perChunk, header.len - first - i * perChunk),
      }),
    );
    const results = await Promise.all(
      chunks.map(async ({ start, count }) => {
        const result = await rpcCall(() =>
          rpc.getAccountInfoAndContext(address, {
            commitment: "confirmed",
            minContextSlot: headerRead.context.slot,
            dataSlice: {
              offset:
                ACCOUNT_SIZES.deckHeader + start * ACCOUNT_SIZES.deckEntry,
              length: count * ACCOUNT_SIZES.deckEntry,
            },
          }),
        );
        const info = checkAccount(
          result.value,
          programId,
          count * ACCOUNT_SIZES.deckEntry,
        );
        return { start, count, slot: result.context.slot, data: info.data };
      }),
    );
    for (const result of results) {
      highestSlot = Math.max(highestSlot, result.slot);
      for (let i = 0; i < result.count; i++) {
        const entry = deckEntryLayout.read(
          result.data,
          i * ACCOUNT_SIZES.deckEntry,
        );
        if (entry.amount === 0n || (entry.flags & ~3) !== 0)
          throw new Error("Invalid live Deck entry");
        if (entry.depositor.equals(wallet))
          entries.push({
            ...entry,
            deckIndex: result.start + i,
            slot: result.slot,
          });
      }
    }
  }
  const finalRead = await rpcCall(() =>
    rpc.getAccountInfoAndContext(address, {
      commitment: "confirmed",
      minContextSlot: highestSlot,
      dataSlice: { offset: 0, length: ACCOUNT_SIZES.deckHeader },
    }),
  );
  if (
    !checkAccount(
      finalRead.value,
      programId,
      ACCOUNT_SIZES.deckHeader,
    ).data.equals(headerData)
  )
    throw new Error("Deck changed during discovery; run the action again");
  return entries;
}

export type RescueBinder = ReturnType<typeof decodeBinder> & {
  address: PublicKey;
  slot: number;
  /** The account's balance and size, for the owed-SOL and rent checks. */
  accountLamports: bigint;
  dataLength: number;
};

export async function readBinder(
  rpc: RescueRpc,
  programId: PublicKey,
  wallet: PublicKey,
): Promise<RescueBinder | null> {
  const [address, bump] = rescuePda(programId, SEEDS.binder, [
    wallet.toBuffer(),
  ]);
  const result = await rpcCall(() =>
    rpc.getAccountInfoAndContext(address, { commitment: "confirmed" }),
  );
  if (absentAccount(result.value)) return null;
  const info = checkAccount(result.value, programId);
  const decoded = decodeBinder(info.data);
  if (!decoded.owner.equals(wallet) || decoded.bump !== bump)
    throw new Error("Invalid Binder owner or PDA bump");
  return {
    address,
    slot: result.context.slot,
    accountLamports: lamports(info.lamports),
    dataLength: info.data.length,
    ...decoded,
  };
}

export type RescuePull = ReturnType<typeof decodePull> & {
  address: PublicKey;
  slot: number;
};

function pullRow(
  programId: PublicKey,
  address: PublicKey,
  info: AccountInfo<Buffer>,
  slot: number,
): RescuePull {
  const decoded = decodePull(checkAccount(info, programId).data);
  const [expected, bump] = rescuePda(programId, SEEDS.pull, [
    decoded.buyer.toBuffer(),
    u32(decoded.buyer_nonce),
  ]);
  if (
    !expected.equals(address) ||
    decoded.bump !== bump ||
    decoded.version !== 1 ||
    !PACK_EDITIONS[decoded.edition] ||
    decoded.qty < 1 ||
    decoded.qty > (PACK_EDITIONS[decoded.edition]?.maxPerRip ?? 0) ||
    (decoded.status !== 1 && decoded.status !== 2) ||
    decoded.settled_mask >= 1 << decoded.qty
  )
    throw new Error("Invalid Pull header or PDA");
  return { address, slot, ...decoded };
}

export async function readPull(
  rpc: RescueRpc,
  programId: PublicKey,
  address: PublicKey,
): Promise<RescuePull | null> {
  const result = await rpcCall(() =>
    rpc.getAccountInfoAndContext(address, { commitment: "confirmed" }),
  );
  return absentAccount(result.value)
    ? null
    : pullRow(programId, address, result.value!, result.context.slot);
}

export async function findOwnPulls(
  rpc: RescueRpc,
  programId: PublicKey,
  wallet: PublicKey,
  pullNonce: number,
): Promise<RescuePull[]> {
  integer(pullNonce, 0xffffffff, "Pull nonce");
  const rows: RescuePull[] = [];
  for (let start = 0; start < pullNonce; start += 100) {
    const addresses = Array.from(
      { length: Math.min(100, pullNonce - start) },
      (_, i) =>
        rescuePda(programId, SEEDS.pull, [
          wallet.toBuffer(),
          u32(start + i),
        ])[0],
    );
    const result = await rpcCall(() =>
      rpc.getMultipleAccountsInfoAndContext(addresses, {
        commitment: "confirmed",
      }),
    );
    if (result.value.length !== addresses.length)
      throw new Error("Incomplete RPC batch");
    result.value.forEach((info, i) => {
      if (absentAccount(info)) return;
      const row = pullRow(programId, addresses[i]!, info!, result.context.slot);
      if (!row.buyer.equals(wallet) || row.buyer_nonce !== start + i)
        throw new Error("Unexpected Pull owner or nonce");
      rows.push(row);
    });
  }
  return rows;
}

function memcmp(offset: number, bytes: Uint8Array): GetProgramAccountsFilter {
  return { memcmp: { offset, bytes: utils.bytes.bs58.encode(bytes) } };
}

async function scan(
  rpc: RescueRpc,
  programId: PublicKey,
  filters: GetProgramAccountsFilter[],
) {
  try {
    return await rpcCall(() =>
      rpc.getProgramAccounts(programId, {
        commitment: "confirmed",
        withContext: true,
        filters,
      }),
    );
  } catch {
    throw new RpcScanRefusedError();
  }
}

export async function findOpenPulls(
  rpc: RescueRpc,
  programId: PublicKey,
  status: 1 | 2,
): Promise<RescuePull[]> {
  if (status !== 1 && status !== 2)
    throw new Error("Invalid Pull status filter");
  const result = await scan(rpc, programId, [
    memcmp(0, discriminator("account", "Pull")),
    memcmp(144, Uint8Array.of(status)),
  ]);
  return result.value.map(({ pubkey, account }) => {
    const row = pullRow(programId, pubkey, account, result.context.slot);
    if (row.status !== status)
      throw new Error("RPC returned a Pull outside the status filter");
    return row;
  });
}

export async function findPullsPaying(
  rpc: RescueRpc,
  programId: PublicKey,
  wallet: PublicKey,
): Promise<RescuePull[]> {
  return (await findOpenPulls(rpc, programId, 2)).filter((pull) =>
    pull.packs.some(
      (pack, index) =>
        (pull.settled_mask & (1 << index)) === 0 &&
        (pull.referrer.equals(wallet) ||
          pack.royalties.some(
            (royalty, k) =>
              (pack.house_mask & (1 << k)) === 0 &&
              royalty.depositor.equals(wallet),
          )),
    ),
  );
}

export interface RescuePayee {
  address: PublicKey;
  slot: number;
  owner: PublicKey;
  executable: boolean;
  lamports: bigint;
  exists: boolean;
  dataLength: number;
}

async function readMany(rpc: RescueRpc, addresses: readonly PublicKey[]) {
  const rows: {
    address: PublicKey;
    slot: number;
    info: AccountInfo<Buffer> | null;
  }[] = [];
  for (let start = 0; start < addresses.length; start += 100) {
    const batch = addresses.slice(start, start + 100);
    const result = await rpcCall(() =>
      rpc.getMultipleAccountsInfoAndContext(batch, { commitment: "confirmed" }),
    );
    if (result.value.length !== batch.length)
      throw new Error("Incomplete RPC batch");
    batch.forEach((address, index) =>
      rows.push({
        address,
        slot: result.context.slot,
        info: result.value[index] ?? null,
      }),
    );
  }
  return rows;
}

export async function readPayees(
  rpc: RescueRpc,
  keys: readonly PublicKey[],
): Promise<RescuePayee[]> {
  return (await readMany(rpc, keys)).map(({ address, slot, info }) => ({
    address,
    slot,
    owner: info?.owner ?? SystemProgram.programId,
    executable: info?.executable ?? false,
    lamports: lamports(info?.lamports ?? 0),
    exists: info !== null,
    dataLength: info?.data.length ?? 0,
  }));
}

export interface RescueMint {
  address: PublicKey;
  slot: number;
  tokenProgram: PublicKey;
  decimals: number;
}

export async function readMints(
  rpc: RescueRpc,
  mints: readonly PublicKey[],
): Promise<RescueMint[]> {
  return (await readMany(rpc, mints)).map(({ address, slot, info }) => {
    if (
      !info ||
      info.executable ||
      (!info.owner.equals(EXTERNAL_IDS.splToken) &&
        !info.owner.equals(EXTERNAL_IDS.token2022))
    )
      throw new Error("Invalid mint owner");
    const mint = unpackMint(address, info, info.owner);
    if (!mint.isInitialized) throw new Error("Mint is not initialized");
    return { address, slot, tokenProgram: info.owner, decimals: mint.decimals };
  });
}

export type RescueVaultDeposit = MintLedger & {
  address: PublicKey;
  slot: number;
  ledgerLamports: bigint;
  slots: {
    ledger: number;
    machine: number;
    mint: number;
    vault: number;
    payer: number;
  };
  mintInfo: RescueMint;
  vault: PublicKey;
  vaultExists: boolean;
  vaultLamports: bigint;
  vaultAmount: bigint;
  bucketHeld: boolean;
  payerInfo: RescuePayee;
  closable: boolean;
};

async function vaultRows(
  rpc: RescueRpc,
  programId: PublicKey,
  filters: GetProgramAccountsFilter[],
  wallet?: PublicKey,
): Promise<RescueVaultDeposit[]> {
  const result = await scan(rpc, programId, [
    memcmp(0, discriminator("account", "MintLedger")),
    { dataSize: ACCOUNT_SIZES.mintLedger },
    ...filters,
  ]);
  return decodeVaultRows(rpc, programId, result, wallet);
}

async function decodeVaultRows(
  rpc: RescueRpc,
  programId: PublicKey,
  result: {
    context: { slot: number };
    value: readonly { pubkey: PublicKey; account: AccountInfo<Buffer> }[];
  },
  wallet?: PublicKey,
): Promise<RescueVaultDeposit[]> {
  if (result.value.length === 0) return [];
  const ledgers = result.value.map(({ pubkey, account }) => {
    const ledger = mintLedgerLayout.decode(
      checkAccount(account, programId, ACCOUNT_SIZES.mintLedger).data,
    );
    if (
      !rescuePda(programId, SEEDS.ledger, [ledger.mint.toBuffer()])[0].equals(
        pubkey,
      ) ||
      (wallet && !ledger.payer.equals(wallet))
    )
      throw new Error("Invalid MintLedger PDA or payer");
    return {
      ...ledger,
      address: pubkey,
      slot: result.context.slot,
      ledgerLamports: lamports(account.lamports),
    };
  });
  const [machine, mints, payees] = await Promise.all([
    readMachine(rpc, programId),
    readMints(
      rpc,
      ledgers.map((ledger) => ledger.mint),
    ),
    readPayees(
      rpc,
      ledgers.map((ledger) => ledger.payer),
    ),
  ]);
  const [vaultAuthority] = rescuePda(programId, SEEDS.vaultAuth);
  const vaults = mints.map((mint) =>
    getAssociatedTokenAddressSync(
      mint.address,
      vaultAuthority,
      true,
      mint.tokenProgram,
    ),
  );
  const accounts = await readMany(rpc, vaults);
  return ledgers.map((ledger, index) => {
    const mintInfo = mints[index]!;
    const payerInfo = payees[index]!;
    const vaultRead = accounts[index]!;
    const vault = vaults[index]!;
    const token = vaultRead.info
      ? unpackAccount(
          vault,
          checkAccount(vaultRead.info, mintInfo.tokenProgram),
          mintInfo.tokenProgram,
        )
      : null;
    if (
      token &&
      (!token.mint.equals(ledger.mint) ||
        !token.owner.equals(vaultAuthority) ||
        !token.isInitialized)
    )
      throw new Error("Invalid vault token account");
    const bucketHeld = machine.buckets.some(
      (bucket) => bucket.class !== 0 && bucket.mint.equals(ledger.mint),
    );
    const payerCreditable =
      payerInfo.owner.equals(SystemProgram.programId) &&
      !payerInfo.executable &&
      !RESERVED_KEYS.has(payerInfo.address.toBase58());
    return {
      ...ledger,
      slot: Math.max(
        ledger.slot,
        mintInfo.slot,
        payerInfo.slot,
        vaultRead.slot,
        machine.slot,
      ),
      slots: {
        ledger: ledger.slot,
        machine: machine.slot,
        mint: mintInfo.slot,
        vault: vaultRead.slot,
        payer: payerInfo.slot,
      },
      mintInfo,
      payerInfo,
      vault,
      vaultExists: token !== null,
      vaultLamports: lamports(vaultRead.info?.lamports ?? 0),
      vaultAmount: token?.amount ?? 0n,
      bucketHeld,
      closable:
        ledger.accounted === 0n &&
        token !== null &&
        !bucketHeld &&
        payerCreditable,
    };
  });
}

export async function findClosableVaults(
  rpc: RescueRpc,
  programId: PublicKey,
): Promise<RescueVaultDeposit[]> {
  return (
    await vaultRows(rpc, programId, [memcmp(72, new Uint8Array(8))])
  ).filter((row) => row.closable);
}

export async function findMyVaultDeposits(
  rpc: RescueRpc,
  programId: PublicKey,
  wallet: PublicKey,
): Promise<RescueVaultDeposit[]> {
  return vaultRows(rpc, programId, [memcmp(40, wallet.toBytes())], wallet);
}

/** An explicit mint needs no program-account scan, including on restricted RPCs. */
export async function readVaultDeposit(
  rpc: RescueRpc,
  programId: PublicKey,
  mint: PublicKey,
): Promise<RescueVaultDeposit | null> {
  const [address] = rescuePda(programId, SEEDS.ledger, [mint.toBuffer()]);
  const result = await rpcCall(() =>
    rpc.getAccountInfoAndContext(address, { commitment: "confirmed" }),
  );
  if (absentAccount(result.value)) return null;
  const rows = await decodeVaultRows(rpc, programId, {
    context: result.context,
    value: [{ pubkey: address, account: result.value! }],
  });
  return rows[0] ?? null;
}
