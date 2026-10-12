import { webDeployment } from "./deployment";
import { ACCOUNT_SIZES, COVERAGE } from "@onepercent/config";
import {
  binderPda,
  configPda,
  deckPda,
  machinePda,
  decodeBinder,
  decodeConfig,
  decodeMachine,
  deckHeaderLayout,
} from "@onepercent/sdk/browser";
import { readClock } from "@onepercent/sdk/rescue";
import {
  SystemProgram,
  type AccountInfo,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";

function checked(
  info: AccountInfo<Uint8Array> | null,
  programId = webDeployment().programId,
) {
  if (!info || info.executable || !info.owner.equals(programId))
    throw new Error("Invalid program account");
  return info;
}

export async function readMachine(
  rpc: Connection,
  programId = webDeployment().programId,
) {
  const [configRead, machineRead, deckRead] = await Promise.all([
    rpc.getAccountInfoAndContext(configPda(programId)[0], "confirmed"),
    rpc.getAccountInfoAndContext(machinePda(programId)[0], "confirmed"),
    rpc.getAccountInfoAndContext(deckPda(programId)[0], {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: ACCOUNT_SIZES.deckHeader },
    }),
  ]);
  const config = decodeConfig(checked(configRead.value, programId).data);
  const machine = decodeMachine(checked(machineRead.value, programId).data);
  const deck = deckHeaderLayout.decode(checked(deckRead.value, programId).data);
  if (
    config.bump !== configPda(programId)[1] ||
    machine.bump !== machinePda(programId)[1] ||
    deck.bump !== deckPda(programId)[1] ||
    config.version !== 1 ||
    machine.version !== 1 ||
    deck.version !== 1 ||
    config.active_queue >= config.vrf_queues.length ||
    deck.len > deck.cap ||
    deck.cap > COVERAGE.deckMax
  )
    throw new Error("Invalid machine header");
  const slot = Math.max(
    configRead.context.slot,
    machineRead.context.slot,
    deckRead.context.slot,
  );
  const clock = await readClock(rpc, slot);
  return {
    config,
    machine,
    deck,
    nowTs: clock.unixTimestamp,
    slot: clock.slot,
  };
}

export async function readBinderAccount(rpc: Connection, wallet: PublicKey) {
  const [address, bump] = binderPda(webDeployment().programId, wallet);
  const result = await rpc.getAccountInfoAndContext(address, "confirmed");
  if (
    !result.value ||
    (!result.value.executable &&
      result.value.owner.equals(SystemProgram.programId) &&
      result.value.data.length === 0)
  )
    return null;
  const info = checked(result.value);
  const binder = decodeBinder(info.data);
  if (!binder.owner.equals(wallet) || binder.bump !== bump)
    throw new Error("Invalid Binder owner or header");
  if (!Number.isSafeInteger(info.lamports) || info.lamports < 0)
    throw new Error("Invalid account lamports");
  return {
    binder,
    lamports: BigInt(info.lamports),
    dataLength: info.data.length,
  };
}

export async function readBinder(rpc: Connection, wallet: PublicKey) {
  return (await readBinderAccount(rpc, wallet))?.binder ?? null;
}
