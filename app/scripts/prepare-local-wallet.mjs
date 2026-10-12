import { mkdir, open } from "node:fs/promises";
import { Keypair } from "@solana/web3.js";

const directory = new URL("../.anchor/", import.meta.url);
await mkdir(directory, { recursive: true });
try {
  const file = await open(
    new URL("localnet-wallet.json", directory),
    "wx",
    0o600,
  );
  try {
    await file.writeFile(
      JSON.stringify(Array.from(Keypair.generate().secretKey)),
    );
  } finally {
    await file.close();
  }
  console.log("Created an ignored wallet for the local validator.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
