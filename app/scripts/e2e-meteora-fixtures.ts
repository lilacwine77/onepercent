import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Idl } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { WSOL_MINT } from "../packages/config/src/index.js";
import {
  BN,
  BorshInstructionCoder,
  BorshAccountsCoder,
} from "../packages/sdk/src/anchor.js";
import { EXTERNAL_IDS } from "../packages/sdk/src/constants.js";

const fixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "fixtures/meteora",
);
const idlHashes = {
  dbc: "beedc8c869bc04865c26349a72a3ba9c773e61f48be2d33093c591a015fe82fd",
  "damm-v2": "ccbe93966accca0693790fd3a35b06ed4ca3758cd4d8675c31df92703b9a974d",
} as const;
type Venue = keyof typeof idlHashes;
type Addresses = Record<string, PublicKey | null>;
type Values = Record<string, unknown>;
const quoteMint = new PublicKey(WSOL_MINT);
const metadataProgram = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);
const pda = (program: PublicKey, seed: string, keys: PublicKey[] = []) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...keys.map((key) => key.toBuffer())],
    program,
  )[0];
function poolPda(program: PublicKey, config: PublicKey, mint: PublicKey) {
  const ordered = [mint, quoteMint].sort((a, b) =>
    Buffer.compare(b.toBuffer(), a.toBuffer()),
  );
  return pda(program, "pool", [config, ...ordered]);
}
function anchorValues(value: unknown): unknown {
  if (typeof value === "bigint") return new BN(value.toString());
  if (Array.isArray(value)) return value.map(anchorValues);
  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof PublicKey ||
    value instanceof BN ||
    value instanceof Uint8Array
  )
    return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, anchorValues(item)]),
  );
}

export async function meteoraFixturePrograms() {
  const programs = JSON.parse(
    await readFile(join(fixtureDirectory, "programs.json"), "utf8"),
  ) as {
    programs: { programId: string; file: string; sha256: string }[];
  };
  const profile = process.env.ONEPERCENT_METEORA_FIXTURE_PROFILE;
  if (profile) {
    assert.equal(profile, "devnet-observed-v1");
    const audit = JSON.parse(
      await readFile(
        join(fixtureDirectory, "../devnet/meteora-pin-audit.json"),
        "utf8",
      ),
    ) as {
      programs: {
        cluster: string;
        name: string;
        programId: string;
        sha256: string;
      }[];
    };
    for (const program of programs.programs) {
      const observed = audit.programs.find(
        (row) =>
          row.cluster === "devnet" && row.programId === program.programId,
      );
      if (!observed) continue;
      program.file = `../../reports/devnet/meteora-pin-audit/devnet-${observed.name}.so`;
      program.sha256 = observed.sha256;
    }
  }
  return programs;
}

/** Load only hash-verified captures. These files never contain test signers. */
export async function meteoraValidatorFixtures(directory: string) {
  const programs = await meteoraFixturePrograms();
  for (const program of programs.programs) {
    const bytes = await readFile(join(fixtureDirectory, program.file));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      program.sha256,
      `Meteora fixture hash differs: ${program.file}`,
    );
  }
  const accounts = JSON.parse(
    await readFile(join(fixtureDirectory, "accounts.json"), "utf8"),
  ) as {
    address: string;
    file: string;
    metadataFile: string;
    dataSha256: string;
  }[];
  for (const fixture of accounts) {
    const bytes = await readFile(join(fixtureDirectory, fixture.file));
    const metadata = JSON.parse(
      await readFile(join(fixtureDirectory, fixture.metadataFile), "utf8"),
    ) as { address: string; account: Record<string, unknown> };
    assert.equal(metadata.address, fixture.address);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      fixture.dataSha256,
    );
    await writeFile(
      join(directory, `${fixture.address}.json`),
      JSON.stringify({
        pubkey: fixture.address,
        account: {
          ...metadata.account,
          rentEpoch: 0,
          data: [bytes.toString("base64"), "base64"],
        },
      }),
      { mode: 0o600 },
    );
  }
  return {
    programs: programs.programs.map((program) => ({
      address: program.programId,
      file: join(fixtureDirectory, program.file),
    })),
    accounts: accounts.map((account) => ({
      address: account.address,
      file: join(directory, `${account.address}.json`),
    })),
  };
}

/**
 * Real-program local-validator setup. Exact curve inputs are supplied by the
 * approved config fixture, never inferred from approximate market caps.
 */
export async function meteoraLocalVenue(
  connection: Connection,
  config: PublicKey,
  dammConfig: PublicKey,
  mint: PublicKey,
  payer: PublicKey,
  feeIn: PublicKey,
) {
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(connection.rpcEndpoint).hostname,
    ),
    "Meteora fixture setup is restricted to a local validator",
  );
  const dbc = EXTERNAL_IDS.meteoraDbc;
  const damm = EXTERNAL_IDS.meteoraDammV2;
  const programs = { dbc, "damm-v2": damm };
  const interfaces = await Promise.all(
    (Object.keys(idlHashes) as Venue[]).map(async (venue) => {
      const bytes = await readFile(join(fixtureDirectory, `${venue}.json`));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        idlHashes[venue],
      );
      const idl = JSON.parse(bytes.toString()) as Idl;
      assert.equal(idl.address, programs[venue].toBase58());
      return [
        venue,
        {
          idl,
          coder: new BorshInstructionCoder(idl),
          accounts: new BorshAccountsCoder(idl),
        },
      ] as const;
    }),
  );
  const interfacesByVenue = Object.fromEntries(interfaces) as Record<
    Venue,
    (typeof interfaces)[number][1]
  >;
  function instruction(
    venue: Venue,
    name: string,
    values: Values,
    addresses: Addresses,
  ) {
    const { idl, coder } = interfacesByVenue[venue];
    const programId = programs[venue];
    const entry = idl.instructions.find((item) => item.name === name);
    assert(entry, `Missing pinned Meteora instruction ${name}`);
    return new TransactionInstruction({
      programId,
      data: coder.encode(name, anchorValues(values)),
      keys: entry.accounts.map((account) => {
        assert(!("accounts" in account));
        const explicit = addresses[account.name];
        const pubkey =
          explicit ??
          (account.address ? new PublicKey(account.address) : undefined) ??
          (account.optional ? programId : undefined);
        assert(pubkey, `Missing Meteora account ${account.name}`);
        const absent = explicit === null && account.optional;
        return {
          pubkey,
          isSigner: absent ? false : (account.signer ?? false),
          isWritable: absent ? false : (account.writable ?? false),
        };
      }),
    });
  }
  const launchPool = poolPda(dbc, config, mint);
  const migratedPool = poolPda(damm, dammConfig, mint);
  const baseVault = pda(dbc, "token_vault", [mint, launchPool]);
  const quoteVault = pda(dbc, "token_vault", [quoteMint, launchPool]);
  const migratedBaseVault = pda(damm, "token_vault", [mint, migratedPool]);
  const migratedQuoteVault = pda(damm, "token_vault", [
    quoteMint,
    migratedPool,
  ]);
  const common: Addresses = {
    config,
    payer,
    base_mint: mint,
    quote_mint: quoteMint,
    pool: launchPool,
    pool_authority: pda(dbc, "pool_authority"),
    base_vault: baseVault,
    quote_vault: quoteVault,
    token_base_program: EXTERNAL_IDS.splToken,
    token_quote_program: EXTERNAL_IDS.splToken,
    system_program: SystemProgram.programId,
    event_authority: pda(dbc, "__event_authority"),
    program: dbc,
  };
  return {
    async state(
      venue: Venue,
      name: string,
      address: PublicKey,
    ): Promise<Values> {
      const account = await connection.getAccountInfo(address, "confirmed");
      assert(account);
      assert(account.owner.equals(programs[venue]));
      return interfacesByVenue[venue].accounts.decode(
        name,
        account.data,
      ) as Values;
    },
    launchAuthority: pda(dbc, "pool_authority"),
    launchPool,
    migratedPool,
    baseVault,
    quoteVault,
    migratedBaseVault,
    migratedQuoteVault,
    createConfig(parameters: Values) {
      return instruction(
        "dbc",
        "create_config",
        { config_parameters: parameters },
        {
          ...common,
          fee_claimer: feeIn,
          leftover_receiver: feeIn,
        },
      );
    },
    initializePool(metadata: { name: string; symbol: string; uri: string }) {
      return instruction(
        "dbc",
        "initialize_virtual_pool_with_spl_token",
        { params: metadata },
        {
          ...common,
          creator: payer,
          mint_metadata: pda(metadataProgram, "metadata", [
            metadataProgram,
            mint,
          ]),
          metadata_program: metadataProgram,
          token_program: EXTERNAL_IDS.splToken,
        },
      );
    },
    swap(
      venue: Venue,
      input: PublicKey,
      output: PublicKey,
      amount: bigint,
      limit: bigint,
      mode: 0 | 1 | 2,
    ) {
      const params = { amount_0: amount, amount_1: limit, swap_mode: mode };
      const addresses = {
        ...common,
        input_token_account: input,
        output_token_account: output,
        referral_token_account: null,
      };
      return venue === "dbc"
        ? instruction(venue, "swap2", { params }, addresses)
        : instruction(
            venue,
            "swap2",
            { _params: params },
            {
              ...addresses,
              pool: migratedPool,
              pool_authority: pda(damm, "pool_authority"),
              token_a_mint: mint,
              token_b_mint: quoteMint,
              token_a_vault: migratedBaseVault,
              token_b_vault: migratedQuoteVault,
              token_a_program: EXTERNAL_IDS.splToken,
              token_b_program: EXTERNAL_IDS.splToken,
              event_authority: pda(damm, "__event_authority"),
              program: damm,
            },
          );
    },
    migration() {
      const positionMint = Keypair.generate();
      const position = pda(damm, "position", [positionMint.publicKey]);
      const positionNftAccount = pda(damm, "position_nft_account", [
        positionMint.publicKey,
      ]);
      const ix = instruction(
        "dbc",
        "migration_damm_v2",
        {},
        {
          ...common,
          virtual_pool: launchPool,
          migration_metadata: pda(dbc, "damm_v2", [launchPool]),
          pool: migratedPool,
          first_position_nft_mint: positionMint.publicKey,
          first_position_nft_account: positionNftAccount,
          first_position: position,
          second_position_nft_mint: null,
          second_position_nft_account: null,
          second_position: null,
          damm_pool_authority: pda(damm, "pool_authority"),
          amm_program: damm,
          token_a_vault: migratedBaseVault,
          token_b_vault: migratedQuoteVault,
          token_2022_program: EXTERNAL_IDS.token2022,
          damm_event_authority: pda(damm, "__event_authority"),
        },
      );
      // DBC's migration ABI appends the chosen DAMM config after fixed accounts.
      ix.keys.push({ pubkey: dammConfig, isSigner: false, isWritable: false });
      return { instruction: ix, positionMint, position, positionNftAccount };
    },
  };
}
