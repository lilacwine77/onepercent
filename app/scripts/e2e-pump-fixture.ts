import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Idl } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  BN,
  BorshInstructionCoder,
  BorshAccountsCoder,
} from "../packages/sdk/src/anchor.js";
import { EXTERNAL_IDS } from "../packages/sdk/src/constants.js";

// Source interface is pinned, fetched into ignored target/, and checked before use.
// https://github.com/pump-fun/pump-public-docs/tree/2293f9a66c654e9fe82dc5e8f4618538f24bb35f
const commit = "2293f9a66c654e9fe82dc5e8f4618538f24bb35f";
const idlHash =
  "6a19bad7758fb822cee79a91575e51a7bd60391c670200408676643e00a79a6d";
const sourceUrl = `https://raw.githubusercontent.com/pump-fun/pump-public-docs/${commit}/idl/pump.json`;
const mayhem = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
const fees = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const pda = (
  seed: string,
  keys: PublicKey[] = [],
  owner = EXTERNAL_IDS.pumpFun,
) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...keys.map((k) => k.toBuffer())],
    owner,
  )[0];
const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), EXTERNAL_IDS.token2022.toBuffer(), mint.toBuffer()],
    EXTERNAL_IDS.associatedToken,
  )[0];
export type FixtureSender = (
  stage: string,
  instructions: TransactionInstruction[],
  signers?: Keypair[],
) => Promise<string>;
interface FixtureReport {
  sourceUrl: string;
  idlHash: string;
  mint: string;
  creator: string;
  createSignature?: string;
  buySignature?: string;
  collectSignature?: string;
  extensions?: number[];
  amount?: string;
  feeReceivedLamports?: string;
  curveBytes?: number;
  pumpSwapExecutable?: boolean;
}
export async function preparePumpFixture(
  connection: Connection,
  directory: string,
  user: PublicKey,
  program: PublicKey,
  existingMintPath?: string,
  purchase: { amount: bigint; maxSolCost: bigint } = {
    amount: 1_000_000_000_000n,
    maxSolCost: 2_000_000n,
  },
) {
  const response = await fetch(sourceUrl);
  assert(
    response.ok,
    `Official pump interface fetch failed: ${response.status}`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), idlHash);
  await writeFile(join(directory, "pump-interface.json"), bytes, {
    mode: 0o600,
  });
  const idl = JSON.parse(bytes.toString()) as Idl;
  assert.equal(idl.address, EXTERNAL_IDS.pumpFun.toBase58());
  const coder = new BorshInstructionCoder(idl);
  const accounts = new BorshAccountsCoder(idl);
  const mintPath = existingMintPath ?? join(directory, "mint-keypair.json");
  let mint: Keypair;
  try {
    mint = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await readFile(mintPath, "utf8")) as number[]),
    );
  } catch (error) {
    if (existingMintPath || (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw error;
    mint = Keypair.generate();
    await writeFile(mintPath, JSON.stringify([...mint.secretKey]), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const creator = pda("fee_in", [], program);
  const curve = pda("bonding-curve", [mint.publicKey]);
  const creatorVault = pda("creator-vault", [creator]);
  const global = pda("global");
  const globalInfo = await connection.getAccountInfo(global, "confirmed");
  assert(globalInfo && globalInfo.owner.equals(EXTERNAL_IDS.pumpFun));
  const globalState = accounts.decode("Global", globalInfo.data) as {
    create_v2_enabled: boolean;
    fee_recipient: PublicKey;
    buyback_fee_recipients: PublicKey[];
  };
  assert(globalState.create_v2_enabled, "Devnet create_v2 is not enabled");
  const reportPath = join(directory, "s1-report.json");
  let report: FixtureReport;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8")) as FixtureReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    report = {
      sourceUrl,
      idlHash,
      mint: mint.publicKey.toBase58(),
      creator: creator.toBase58(),
    };
  }
  assert.equal(report.mint, mint.publicKey.toBase58());
  assert.equal(report.creator, creator.toBase58());
  const save = () =>
    writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
  const instruction = (
    name: string,
    values: Record<string, unknown>,
    addresses: Record<string, PublicKey>,
  ) => {
    const entry = idl.instructions.find((item) => item.name === name);
    assert(entry);
    return new TransactionInstruction({
      programId: EXTERNAL_IDS.pumpFun,
      data: coder.encode(name, values),
      keys: entry.accounts.map((item) => {
        assert("name" in item && !("accounts" in item));
        const pubkey =
          addresses[item.name] ??
          (item.address ? new PublicKey(item.address) : undefined);
        assert(pubkey, `Missing pump account ${item.name}`);
        return {
          pubkey,
          isWritable: item.writable ?? false,
          isSigner: item.signer ?? false,
        };
      }),
    });
  };
  const common = {
    global,
    mint: mint.publicKey,
    bonding_curve: curve,
    associated_bonding_curve: ata(curve, mint.publicKey),
    user,
    token_program: EXTERNAL_IDS.token2022,
    event_authority: pda("__event_authority"),
    program: EXTERNAL_IDS.pumpFun,
  };
  return {
    mint: mint.publicKey,
    reportPath,
    async ensure(send: FixtureSender) {
      if (!(await connection.getAccountInfo(mint.publicKey, "confirmed"))) {
        const create = instruction(
          "create_v2",
          {
            name: "Copper Test",
            symbol: "CPRT",
            uri: "https://example.com/copper-test.json",
            creator,
            is_mayhem_mode: false,
            is_cashback_enabled: [false],
            creator_fee_bps: [new BN(0)],
            is_holder_reward: [false],
          },
          {
            ...common,
            mint_authority: pda("mint-authority"),
            global_params: pda("global-params", [], mayhem),
            sol_vault: pda("sol-vault", [], mayhem),
            mayhem_state: pda("mayhem-state", [mint.publicKey], mayhem),
            mayhem_token_vault: ata(
              pda("sol-vault", [], mayhem),
              mint.publicKey,
            ),
          },
        );
        report.createSignature = await send("s1-create", [create], [mint]);
        await save();
      }
      const mintInfo = await connection.getAccountInfo(
        mint.publicKey,
        "confirmed",
      );
      assert(mintInfo && mintInfo.owner.equals(EXTERNAL_IDS.token2022));
      assert.equal(
        mintInfo.data.readUInt32LE(0),
        0,
        "S1 mint authority must be absent",
      );
      assert.equal(
        mintInfo.data.readUInt32LE(46),
        0,
        "S1 freeze authority must be absent",
      );
      assert.equal(mintInfo.data[165], 1, "Expected extended Mint account");
      const extensions: number[] = [];
      for (let offset = 166; offset + 4 <= mintInfo.data.length;) {
        const type = mintInfo.data.readUInt16LE(offset),
          length = mintInfo.data.readUInt16LE(offset + 2);
        if (type === 0 && length === 0) break;
        assert(offset + 4 + length <= mintInfo.data.length);
        extensions.push(type);
        offset += 4 + length;
      }
      assert.deepEqual(
        [...extensions].sort((a, b) => a - b),
        [18, 19],
        "S1 only permits MetadataPointer and TokenMetadata",
      );
      report.extensions = extensions;
      const curveInfo = await connection.getAccountInfo(curve, "confirmed");
      assert(curveInfo && curveInfo.owner.equals(EXTERNAL_IDS.pumpFun));
      const decoded = accounts.decode("BondingCurve", curveInfo.data) as {
        creator: PublicKey;
        is_mayhem_mode: boolean;
        is_cashback_coin: boolean;
        is_holder_reward: boolean;
        quote_mint: PublicKey;
      };
      assert(decoded.creator.equals(creator));
      assert.equal(decoded.is_mayhem_mode, false);
      assert.equal(decoded.is_cashback_coin, false);
      assert.equal(decoded.is_holder_reward, false);
      assert(
        decoded.quote_mint.equals(PublicKey.default),
        "Fixture must be SOL-quoted",
      );
      report.curveBytes = curveInfo.data.length;
      report.pumpSwapExecutable = Boolean(
        (await connection.getAccountInfo(EXTERNAL_IDS.pumpSwap))?.executable,
      );
      const userAta = ata(user, mint.publicKey);
      const tokenInfo = await connection.getAccountInfo(userAta, "confirmed");
      if (!tokenInfo || tokenInfo.data.readBigUInt64LE(64) === 0n) {
        assert(
          !report.buySignature,
          "Previously purchased fixture is missing; inspect before repeating",
        );
        const createAta = new TransactionInstruction({
          programId: EXTERNAL_IDS.associatedToken,
          data: Buffer.from([1]),
          keys: [
            { pubkey: user, isWritable: true, isSigner: true },
            { pubkey: userAta, isWritable: true, isSigner: false },
            { pubkey: user, isWritable: false, isSigner: false },
            { pubkey: mint.publicKey, isWritable: false, isSigner: false },
            {
              pubkey: SystemProgram.programId,
              isWritable: false,
              isSigner: false,
            },
            {
              pubkey: EXTERNAL_IDS.token2022,
              isWritable: false,
              isSigner: false,
            },
          ],
        });
        const buy = instruction(
          "buy",
          {
            amount: new BN(purchase.amount.toString()),
            max_sol_cost: new BN(purchase.maxSolCost.toString()),
            track_volume: [false],
            partial_fill: [false],
          },
          {
            ...common,
            fee_recipient: globalState.fee_recipient,
            associated_user: userAta,
            creator_vault: creatorVault,
            global_volume_accumulator: pda("global_volume_accumulator"),
            user_volume_accumulator: pda("user_volume_accumulator", [user]),
            fee_config: pda("fee_config", [EXTERNAL_IDS.pumpFun], fees),
          },
        );
        // Current official SDK appends these to the legacy-compatible buy interface.
        const buyback = globalState.buyback_fee_recipients.find(
          (key) => !key.equals(PublicKey.default),
        );
        assert(buyback);
        buy.keys.push(
          {
            pubkey: pda("bonding-curve-v2", [mint.publicKey]),
            isSigner: false,
            isWritable: false,
          },
          { pubkey: buyback, isSigner: false, isWritable: true },
        );
        report.buySignature = await send("s1-buy", [createAta, buy]);
        await save();
      }
      report.amount = (
        await connection.getTokenAccountBalance(userAta, "confirmed")
      ).value.amount;
      assert(BigInt(report.amount) > 0n);
      if (!report.collectSignature) {
        assert(
          (await connection.getBalance(creator, "confirmed")) >=
            (await connection.getMinimumBalanceForRentExemption(0)),
        );
        const collect = instruction(
          "collect_creator_fee",
          {},
          {
            creator,
            creator_vault: creatorVault,
            event_authority: pda("__event_authority"),
            program: EXTERNAL_IDS.pumpFun,
          },
        );
        report.collectSignature = await send("s1-collect", [collect]);
        await save();
      }
      const receipt = await connection.getTransaction(report.collectSignature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      assert(receipt?.meta && !receipt.meta.err);
      const keys = receipt.transaction.message.getAccountKeys();
      let creatorIndex = -1;
      for (let i = 0; i < keys.length; i++)
        if (keys.get(i)?.equals(creator)) creatorIndex = i;
      assert(creatorIndex >= 0);
      report.feeReceivedLamports = String(
        BigInt(receipt.meta.postBalances[creatorIndex]!) -
          BigInt(receipt.meta.preBalances[creatorIndex]!),
      );
      await save();
      assert(BigInt(report.feeReceivedLamports ?? "0") > 0n);
      await save();
    },
  };
}
