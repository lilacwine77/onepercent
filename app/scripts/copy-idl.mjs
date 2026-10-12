import { PROGRAM_IDS } from "./anchor-cluster.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { writeEventIdl } from "./event-idl.mjs";

const appDirectory = new URL("../", import.meta.url);
const destination = new URL("packages/sdk/src/idl/", appDirectory);
await mkdir(destination, { recursive: true });
const generated = await readFile(
  new URL("target/idl/onepercent.json", appDirectory),
  "utf8",
);
const originalAddress = JSON.parse(generated).address;
if (
  typeof originalAddress !== "string" ||
  !Object.values(PROGRAM_IDS).includes(originalAddress)
)
  throw new Error("Unknown generated IDL deployment identity");
// Canonical SDK artifacts describe localnet; runtime builders use ClusterDeployment.
const canonical = (text) =>
  text.replaceAll(originalAddress, PROGRAM_IDS.localnet);
const idl = JSON.parse(canonical(generated));
await writeFile(new URL("onepercent.json", destination), canonical(generated));
await writeFile(
  new URL("onepercent.ts", destination),
  canonical(
    await readFile(new URL("target/types/onepercent.ts", appDirectory), "utf8"),
  ),
);
await writeEventIdl(idl, appDirectory);
console.log("Updated canonical localnet SDK IDL, types and events.");

const constants = Object.fromEntries(
  (idl.constants ?? []).map(({ name, value, type }) => [
    name,
    type === "pubkey" ? value : JSON.parse(value),
  ]),
);
const vectors = new URL("fixtures/vectors/", appDirectory);
await mkdir(vectors, { recursive: true });
await writeFile(
  new URL("idl_constants.json", vectors),
  `${JSON.stringify(constants, null, 2)}\n`,
);
