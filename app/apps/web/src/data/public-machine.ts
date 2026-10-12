import { webDeployment } from "./deployment";
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  type Connection,
} from "@solana/web3.js";
import { configPda, machinePda } from "@onepercent/sdk/browser";

import { configLayout, machineLayout } from "@onepercent/sdk/layouts";
import { MachineResponse } from "@onepercent/sdk/api";
import { HighlightsResponse } from "@onepercent/web-api";
import { api } from "./api";
import {
  LOADER,
  clockTimestamp,
  linkedProgramData,
} from "../chain/verification";
import { trustModel } from "../adapters/trust";

/** One confirmed context for account-derived public figures and the chain clock. */
export async function loadPublicMachine(rpc: Connection) {
  const read = await rpc.getMultipleAccountsInfoAndContext(
    [
      configPda(webDeployment().programId)[0],
      machinePda(webDeployment().programId)[0],
      SYSVAR_CLOCK_PUBKEY,
    ],
    "confirmed",
  );
  const [configAccount, machineAccount, clockAccount] = read.value;
  if (
    !configAccount ||
    !machineAccount ||
    configAccount.executable ||
    machineAccount.executable ||
    !configAccount.owner.equals(webDeployment().programId) ||
    !machineAccount.owner.equals(webDeployment().programId)
  )
    throw new Error("Machine accounts unavailable");
  const config = configLayout.decode(configAccount.data);
  const machine = machineLayout.decode(machineAccount.data);
  if (
    config.version !== 1 ||
    machine.version !== 1 ||
    config.bump !== configPda(webDeployment().programId)[1] ||
    machine.bump !== machinePda(webDeployment().programId)[1]
  )
    throw new Error("Invalid machine header");
  return {
    config,
    machine,
    nowSeconds: clockTimestamp(clockAccount ?? null),
    asOfSlot: read.context.slot,
  };
}

export const loadLiveTiles = (signal?: AbortSignal) =>
  api("/api/machine", MachineResponse, { signal });
export const loadHighlights = (
  window: "today" | "season",
  signal?: AbortSignal,
) => api(`/api/highlights?window=${window}`, HighlightsResponse, { signal });

export async function loadTrust(rpc: Connection, adminMultisig: string | null) {
  const programData = PublicKey.findProgramAddressSync(
    [webDeployment().programId.toBuffer()],
    LOADER,
  )[0];
  const accounts = await rpc.getMultipleAccountsInfo(
    [
      webDeployment().programId,
      programData,
      ...(adminMultisig ? [new PublicKey(adminMultisig)] : []),
    ],
    "confirmed",
  );
  if (!linkedProgramData(accounts[0] ?? null, programData)) return null;
  return trustModel({
    programData: accounts[1] ?? null,
    adminMultisig,
    multisig: accounts[2] ?? null,
  });
}
