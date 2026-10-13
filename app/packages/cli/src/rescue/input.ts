import { parseArgs } from "node:util";
import {
  ONEPERCENT_PROGRAM_IDS,
  parseProgramCluster,
  type ProgramCluster,
} from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

export class RescueCliError extends Error {
  constructor(
    public readonly code: string,
    public readonly exitCode = 1,
  ) {
    super(code);
  }
}
const address = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
});
const index = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(0xffff_ffff));
const commands = [
  "status",
  "find",
  "take-back",
  "redeem",
  "withdraw-owed",
  "claim-final-sol",
  "claim-final-tokens",
  "close-my-cards",
  "settle",
  "refund",
  "close-vaults",
  "crank",
  "all",
] as const;
const ownerSigned: readonly string[] = [
  "take-back",
  "redeem",
  "withdraw-owed",
  "claim-final-tokens",
  "close-my-cards",
  "all",
];
export interface RescueInput {
  command: (typeof commands)[number];
  rpc: string;
  cluster: ProgramCluster;
  program?: string;
  crank?: "advance-phase" | "start-final-pull";
  wallet?: string;
  signerFile?: string;
  indices?: number[];
  pulls?: string[];
  mints?: string[];
  paying?: string;
  allOpen: boolean;
  allDue: boolean;
  all: boolean;
  json: boolean;
  dryRun: boolean;
  unsigned: boolean;
  yes: boolean;
  max: number;
}

export function parseRescueArgs(args: readonly string[]): RescueInput {
  try {
    const { values: v, positionals } = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        rpc: { type: "string" },
        cluster: { type: "string" },
        program: { type: "string" },
        keypair: { type: "string" },
        "fee-payer": { type: "string" },
        wallet: { type: "string" },
        entry: { type: "string", multiple: true },
        card: { type: "string", multiple: true },
        pull: { type: "string", multiple: true },
        mint: { type: "string", multiple: true },
        paying: { type: "string" },
        "all-open": { type: "boolean" },
        "all-due": { type: "boolean" },
        all: { type: "boolean" },
        json: { type: "boolean" },
        "dry-run": { type: "boolean" },
        unsigned: { type: "boolean" },
        yes: { type: "boolean" },
        max: { type: "string" },
      },
    });
    const command = z.enum(commands).parse(positionals[0]);
    if (
      positionals.length !== (command === "find" || command === "crank" ? 2 : 1)
    )
      throw new Error();
    const crank =
      command === "crank"
        ? z.enum(["advance-phase", "start-final-pull"]).parse(positionals[1])
        : undefined;
    const rpc = z.url().parse(v.rpc);
    const url = new URL(rpc);
    if (!["http:", "https:"].includes(url.protocol) || url.hash)
      throw new Error();
    // Mainnet is the default; its id must still come from a publication or --program.
    const cluster = parseProgramCluster(v.cluster ?? "mainnet");
    const program = v.program ? address.parse(v.program) : undefined;
    const readOnly = command === "status" || command === "find";
    const owner = ownerSigned.includes(command);
    if (v.keypair && v["fee-payer"]) throw new Error();
    if (
      (owner && v["fee-payer"]) ||
      (!owner && v.keypair) ||
      (readOnly && (v.keypair || v["fee-payer"]))
    )
      throw new Error();
    const signerFile = v.keypair ?? v["fee-payer"];
    const wallet =
      command === "find"
        ? address.parse(positionals[1])
        : v.wallet
          ? address.parse(v.wallet)
          : undefined;
    if (!readOnly && !signerFile && !((v.unsigned || v["dry-run"]) && wallet))
      throw new Error();
    const allowed: Record<string, readonly string[]> = {
      entry: ["take-back"],
      card: ["redeem"],
      pull: ["settle", "refund"],
      mint: ["close-vaults"],
      paying: ["settle"],
      "all-open": ["settle"],
      "all-due": ["refund"],
      all: ["take-back", "redeem", "close-vaults"],
    };
    for (const [flag, names] of Object.entries(allowed))
      if (v[flag as keyof typeof v] !== undefined && !names.includes(command))
        throw new Error();
    const indices = v.entry ?? v.card;
    if (
      ["take-back", "redeem"].includes(command) &&
      Number(!!indices) + Number(!!v.all) !== 1
    )
      throw new Error();
    if (
      command === "settle" &&
      Number(!!v.pull) + Number(!!v.paying) + Number(!!v["all-open"]) !== 1
    )
      throw new Error();
    if (command === "refund" && Number(!!v.pull) + Number(!!v["all-due"]) !== 1)
      throw new Error();
    if (command === "close-vaults" && Number(!!v.mint) + Number(!!v.all) !== 1)
      throw new Error();
    const pulls = v.pull?.map((value) =>
      /^\d+$/.test(value)
        ? z
            .string()
            .refine((s) => BigInt(s) <= 0xffff_ffff_ffff_ffffn)
            .parse(value)
        : address.parse(value),
    );
    const result: RescueInput = {
      command,
      rpc,
      cluster,
      program,
      crank,
      wallet,
      signerFile,
      indices: indices?.map((n) => index.parse(n)),
      pulls,
      mints: v.mint?.map((m) => address.parse(m)),
      paying: v.paying ? address.parse(v.paying) : undefined,
      allOpen: !!v["all-open"],
      allDue: !!v["all-due"],
      all: !!v.all,
      json: !!v.json,
      dryRun: !!v["dry-run"],
      unsigned: !!v.unsigned,
      yes: !!v.yes,
      max: v.max
        ? z.number().int().positive().safe().parse(Number(v.max))
        : Number.MAX_SAFE_INTEGER,
    };
    if (
      result.indices &&
      new Set(result.indices).size !== result.indices.length
    )
      throw new Error();
    if (command === "redeem" && result.indices?.some((n) => n > 0xffff))
      throw new Error();
    return result;
  } catch (error) {
    if (error instanceof RescueCliError) throw error;
    throw new RescueCliError("invalid_arguments", 4);
  }
}

const mainnetId = ONEPERCENT_PROGRAM_IDS.mainnet;
export const RESCUE_HELP = `onepct-rescue --rpc <URL> [--cluster mainnet|devnet|localnet] [--program <ID>] [--json] <command>
Read-only
  status
  find <WALLET>
Owner-signed, --keypair <FILE>
  take-back (--entry <INDEX>... | --all)
  redeem (--card <INDEX>... | --all)
  withdraw-owed
  claim-final-tokens              receive Final cards, then use redeem
  close-my-cards                 close_binder: returns the My cards account rent
  all                            Get everything back, in the safe order
Permissionless, --fee-payer <FILE>
  settle (--pull <SEQ|ADDRESS>... | --paying <WALLET> | --all-open)
  refund (--pull <SEQ|ADDRESS>... | --all-due)
  close-vaults (--mint <MINT>... | --all)
  claim-final-sol [--wallet <OWNER>]
  crank advance-phase
  crank start-final-pull
Common: --dry-run, --unsigned, --yes, --max <N>.
For --unsigned or --dry-run, --wallet <PUBLIC_KEY> can replace the signer file.
--cluster defaults to mainnet. Mainnet program id: ${mainnetId ?? "not published yet, pass --program <ID>"}.
Devnet program id: ${ONEPERCENT_PROGRAM_IDS.devnet ?? "not published"}. Localnet always needs --program.
A --program that differs from the published id is custom: check its upgrade authority first.
Final Pull claims remain available after Done, including zero shares.
RPC is mandatory. Nothing else is contacted. Key files are read only from the path given.
Exit codes: 0 done, 1 error, 2 partial, 3 RPC scan refused, 4 preconditions not met.
`;
