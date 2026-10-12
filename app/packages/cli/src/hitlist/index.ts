import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { HIT_LIST, SERVICES, SOLANA_GENESIS_HASHES } from "@onepercent/config";
import { createDatabase } from "@onepercent/db";
import {
  adminListMintInstruction,
  configPda,
  decodeConfig,
  EXTERNAL_IDS,
  vaultAta,
  vaultAuthPda,
} from "@onepercent/sdk";
import {
  buildLadder,
  createChainRpc,
  createExitCapClient,
  createHoldersClient,
  createHttpClient,
  createJupiterLimiter,
  createJupiterSwapClient,
  createJupiterTokensClient,
  createListingEvidenceGatherer,
  createMintSafetyClient,
  createPythHermesClient,
  createValueClient,
  deriveCanonicalPool,
  evaluateMajor,
  evaluateTrending,
  listingReportSchema,
  loadMarketEnv,
} from "@onepercent/market";
import type { ListingReport } from "@onepercent/market";
import type { ExtensionContext, PreparedExtension } from "../extensions.js";

export function listingOracle(mint: string, kind: "major" | "trending") {
  if (kind === "trending") return new PublicKey(deriveCanonicalPool(mint));
  const major = HIT_LIST.launchMajors.find((m) => m.mint === mint);
  if (!major) throw new Error("major_feed_not_configured");
  return new PublicKey(Buffer.from(major.pythFeedId, "hex"));
}
export function validateReport(
  report: ListingReport,
  mint: string,
  kind: "major" | "trending",
  now: number,
) {
  listingReportSchema.parse(report);
  if (
    report.mint !== mint ||
    report.class !== kind.toUpperCase() ||
    !report.pass ||
    !report.criteria.length ||
    report.criteria.some((c) => !c.pass) ||
    !report.criteria.some((c) => c.id === "never_listed" && c.pass) ||
    report.checkedAt > now ||
    now - report.checkedAt > SERVICES.stock.hitlistReportMaxAgeSeconds * 1000 ||
    report.info.capLamports === null ||
    BigInt(report.info.capLamports) <= 0n
  )
    throw new Error("hitlist_report_refused");
  return BigInt(report.info.capLamports);
}
export function listingClients(rpcUrl: string, source = process.env) {
  const env = { ...loadMarketEnv(source), solanaRpcUrl: rpcUrl };
  const opts = { fetch, env };
  const http = createHttpClient({
    ...opts,
    provider: "jupiter",
    limiter: createJupiterLimiter({ env }),
  });
  const swap = createJupiterSwapClient({ ...opts, http });
  const rpc = createChainRpc(opts),
    exitCaps = createExitCapClient({ ...opts, rpc });
  const value = createValueClient({
    quoteSell: swap.quoteSell,
    getExitCap: exitCaps.getExitCap,
  });
  const gatherer = createListingEvidenceGatherer({
    swap,
    tokens: createJupiterTokensClient({ ...opts, http }),
    pyth: createPythHermesClient(opts),
    mintSafety: createMintSafetyClient({ ...opts, rpc }),
    exitCaps,
    holders: createHoldersClient({ ...opts, rpc }),
    buildLadder: (mint, amount) => buildLadder(mint, amount, value.valueNow),
  });
  return {
    swap,
    async check(mint: string, kind: "major" | "trending") {
      const oracle = listingOracle(mint, kind);
      const report =
        kind === "major"
          ? evaluateMajor(
              await gatherer.gatherMajorEvidence(
                mint,
                oracle.toBuffer().toString("hex"),
              ),
              Date.now(),
            )
          : evaluateTrending(
              await gatherer.gatherTrendingEvidence(mint),
              Date.now(),
            );
      return { report, oracle };
    },
  };
}
export async function saveReport(
  pool: ReturnType<typeof createDatabase>["pool"],
  report: ListingReport,
  oracle: PublicKey,
  slot: number,
  directory = "reports/hitlist",
) {
  const folder = join(
    directory,
    new Date(report.checkedAt).toISOString().slice(0, 10),
  );
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, `${new PublicKey(report.mint).toBase58()}.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
  await pool.query(
    "INSERT INTO hitlist_reports(mint,class,passed,slot,cap_lamports,oracle,report) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      report.mint,
      report.class.toLowerCase(),
      report.pass,
      String(slot),
      report.info.capLamports,
      oracle.toBase58(),
      JSON.stringify(report),
    ],
  );
}
export async function prepare(
  context: ExtensionContext,
): Promise<PreparedExtension> {
  const [command, mintText, flag, classText, ...extra] = context.args;
  const kind = z.enum(["major", "trending"]).parse(classText);
  if (
    !["check", "recheck", "add"].includes(command ?? "") ||
    flag !== "--class" ||
    extra.length
  )
    throw new Error("hitlist_arguments");
  const mint = new PublicKey(mintText!);
  const database = createDatabase({
    connectionString: z.string().min(1).parse(process.env.DATABASE_URL),
  });
  try {
    if (command !== "add") {
      const url = z
        .string()
        .url()
        .parse(process.env.SOLANA_RPC_URL ?? process.env.RPC_URL);
      const genesis = await new Connection(url).getGenesisHash();
      if (genesis !== SOLANA_GENESIS_HASHES[context.cluster])
        throw new Error("hitlist_cluster_mismatch");
      const clients = listingClients(url);
      const { report, oracle } = await clients.check(mint.toBase58(), kind);
      await saveReport(
        database.pool,
        report,
        oracle,
        await context.rpc.getSlot("confirmed"),
      );
      if (command === "recheck")
        await database.pool.query(
          "UPDATE buckets SET failing=$1 WHERE mint=$2 AND class=$3",
          [!report.pass, mint.toBase58(), kind],
        );
      return {
        kind: "report",
        ok: report.pass,
        report: {
          ...report,
          announcement:
            kind === "trending"
              ? `Announce at least ${HIT_LIST.trendingNoticeSeconds} seconds before the first buy.`
              : null,
        },
      };
    }
    const rows = await database.pool.query(
      "SELECT report FROM hitlist_reports WHERE mint=$1 AND class=$2 ORDER BY created_at DESC LIMIT 1",
      [mint.toBase58(), kind],
    );
    const report = listingReportSchema.parse(rows.rows[0]?.report);
    const cap = validateReport(report, mint.toBase58(), kind, Date.now());
    const oracle = listingOracle(mint.toBase58(), kind);
    const info = await context.rpc.getAccountInfo(mint, "confirmed");
    if (
      !info ||
      ![EXTERNAL_IDS.splToken, EXTERNAL_IDS.token2022].some((p) =>
        p.equals(info.owner),
      )
    )
      throw new Error("mint_unavailable");
    const configInfo = await context.rpc.getAccountInfo(
      configPda(context.programId)[0],
      "confirmed",
    );
    if (
      !configInfo ||
      !configInfo.owner.equals(context.programId) ||
      decodeConfig(configInfo.data).token_mint.equals(mint)
    )
      throw new Error("mint_forbidden");
    const expected = {
      class: kind === "major" ? 1 : 2,
      cap: cap.toString(),
      oracle: oracle.toBase58(),
    };
    if (kind === "trending")
      console.error(
        `TRENDING: publish the addition at least ${HIT_LIST.trendingNoticeSeconds} seconds before its first buy.`,
      );
    return {
      kind: "transaction",
      async build(admin) {
        validateReport(report, mint.toBase58(), kind, Date.now());
        const vault = vaultAta(context.programId, mint, info.owner);
        const ata = new TransactionInstruction({
          programId: new PublicKey(
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
          ),
          data: Buffer.from([1]),
          keys: [
            admin,
            vault,
            vaultAuthPda(context.programId)[0],
            mint,
            SystemProgram.programId,
            info.owner,
          ].map((pubkey, i) => ({
            pubkey,
            isSigner: i === 0,
            isWritable: i < 2,
          })),
        });
        return {
          instructions: [
            ata,
            adminListMintInstruction(context.programId, {
              admin,
              mint,
              tokenProgram: info.owner,
              class: expected.class,
              cap,
              oracle,
            }),
          ],
        };
      },
      verifyIntent(decoded, args) {
        return (
          JSON.stringify(args) === JSON.stringify(context.args) &&
          decoded.length === 2 &&
          decoded[0]?.instruction === "create_idempotent" &&
          z.record(z.string(), z.unknown()).parse(decoded[0].args).mint ===
            mint.toBase58() &&
          decoded[1]?.instruction === "admin_list_mint" &&
          Object.entries(expected).every(
            ([k, v]) =>
              String(
                z.record(z.string(), z.unknown()).parse(decoded[1]!.args)[k],
              ) === String(v),
          )
        );
      },
    };
  } finally {
    await database.close();
  }
}
