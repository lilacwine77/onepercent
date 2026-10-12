import { webDeployment } from "./deployment";
import { ACCOUNT_SIZES, XRAY } from "@onepercent/config";
import {
  decodeMintLedger,
  ledgerPda,
  vaultAta,
  EXTERNAL_IDS,
} from "@onepercent/sdk/browser";
import type { MeResponse } from "@onepercent/sdk/api";
import { PublicKey, type Connection } from "@solana/web3.js";
import { rpcLamports } from "./feed-chain";

export type VaultDeposit = {
  mint: PublicKey;
  lamports: bigint;
  state: "held" | "returned";
};
type DepositRpc = Pick<Connection, "getMultipleAccountsInfo">;

async function readAccounts(rpc: DepositRpc, addresses: readonly PublicKey[]) {
  const accounts: Awaited<ReturnType<DepositRpc["getMultipleAccountsInfo"]>> =
    [];
  for (
    let start = 0;
    start < addresses.length;
    start += XRAY.accountsPerBatch
  ) {
    const batch = addresses.slice(start, start + XRAY.accountsPerBatch);
    const result = await rpc.getMultipleAccountsInfo(batch, "confirmed");
    if (result.length !== batch.length)
      throw new Error("Incomplete deposit accounts");
    accounts.push(...result);
  }
  return new Map(
    addresses.map((address, index) => [address.toBase58(), accounts[index]!]),
  );
}

/** Mirror entries are discovery hints; held deposits are owned and measured on chain. */
export async function readVaultDeposits(
  rpc: DepositRpc,
  wallet: PublicKey,
  mints: readonly PublicKey[],
  me: MeResponse | null,
  previous: readonly VaultDeposit[],
) {
  const keys = new Map(mints.map((mint) => [mint.toBase58(), mint]));
  for (const entry of me?.vaultDeposits ?? [])
    if (entry.payerIsWallet) keys.set(entry.mint, new PublicKey(entry.mint));
  for (const entry of previous) keys.set(entry.mint.toBase58(), entry.mint);
  const accounts = await readAccounts(
    rpc,
    [...keys.values()].flatMap((mint) => [
      ledgerPda(webDeployment().programId, mint)[0],
      mint,
    ]),
  );
  const output = new Map<string, VaultDeposit>();
  const held: {
    mint: PublicKey;
    tokenProgram: PublicKey;
    vault: PublicKey;
    ledgerLamports: bigint;
  }[] = [];
  for (const mint of keys.values()) {
    const ledgerInfo = accounts.get(
      ledgerPda(webDeployment().programId, mint)[0].toBase58(),
    );
    const mintInfo = accounts.get(mint.toBase58());
    if (!ledgerInfo) {
      const known = previous.find((entry) => entry.mint.equals(mint));
      const closed = me?.vaultDeposits.some(
        (entry) =>
          entry.mint === mint.toBase58() &&
          entry.payerIsWallet &&
          entry.state === "returned",
      );
      // No historical rent amount in S4: never invent a returned amount.
      if (known && closed)
        output.set(mint.toBase58(), { ...known, state: "returned" });
      continue;
    }
    if (
      ledgerInfo.executable ||
      !ledgerInfo.owner.equals(webDeployment().programId) ||
      ledgerInfo.data.length !== ACCOUNT_SIZES.mintLedger
    )
      throw new Error("Invalid MintLedger");
    const ledger = decodeMintLedger(ledgerInfo.data);
    if (!ledger.mint.equals(mint)) throw new Error("Unexpected deposit mint");
    if (!ledger.payer.equals(wallet)) continue;
    if (
      !mintInfo ||
      (!mintInfo.owner.equals(EXTERNAL_IDS.splToken) &&
        !mintInfo.owner.equals(EXTERNAL_IDS.token2022))
    )
      throw new Error("Invalid vault mint");
    held.push({
      mint,
      tokenProgram: mintInfo.owner,
      vault: vaultAta(webDeployment().programId, mint, mintInfo.owner),
      ledgerLamports: rpcLamports(ledgerInfo.lamports),
    });
  }
  const vaults = await readAccounts(
    rpc,
    held.map((entry) => entry.vault),
  );
  for (const entry of held) {
    const vault = vaults.get(entry.vault.toBase58());
    if (!vault || !vault.owner.equals(entry.tokenProgram) || vault.executable)
      throw new Error("Invalid vault");
    output.set(entry.mint.toBase58(), {
      mint: entry.mint,
      lamports: entry.ledgerLamports + rpcLamports(vault.lamports),
      state: "held",
    });
  }
  return [...keys.keys()].flatMap((mint) => {
    const entry = output.get(mint);
    return entry ? [entry] : [];
  });
}
