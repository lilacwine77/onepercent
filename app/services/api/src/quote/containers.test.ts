import { createHash, randomUUID } from "node:crypto";
import { createDatabase } from "@onepercent/db";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { createQuoteLogWriter } from "./adapters.js";
import type { QuoteLogRow } from "./service.js";

const enabled = process.env["SERVICES_INTEGRATION"] === "1";
const databaseUrl = process.env["TEST_DATABASE_URL"];
if (
  enabled &&
  (!databaseUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(databaseUrl).hostname,
    ))
)
  throw new Error("TEST_DATABASE_URL must target a local CI/dev container");

describe.skipIf(!enabled)("S2 quote Postgres integration", () => {
  it("stores bigint arrays exactly and keeps retries insert-only", async () => {
    const database = createDatabase({ connectionString: databaseUrl! });
    const hash = createHash("sha256").update(randomUUID()).digest("hex");
    const key = PublicKey.default.toBase58();
    const row: QuoteLogRow = {
      messageSha256: hash,
      owner: key,
      mint: key,
      cardIndices: [1, 0],
      amounts: [9_007_199_254_740_993n, 1n],
      totalAmount: 9_007_199_254_740_994n,
      quoteLamports: 100n,
      valueLamports: 100n,
      payoutLamports: 87n,
      expiry: new Date("2027-01-15T08:00:00.000Z"),
      nonce: 7,
      router: "fixture",
      requestId: "fixture",
      signer: key,
      ipHash: "a".repeat(64),
    };
    try {
      const insert = createQuoteLogWriter(database.db);
      await Promise.all([insert(row), insert(row)]);
      await insert({ ...row, router: "later-attempt" });
      const result = await database.pool.query(
        "SELECT amounts::text, total_amount::text, router FROM quote_log WHERE message_sha256 = $1",
        [hash],
      );
      expect(result.rows).toEqual([
        {
          amounts: "{9007199254740993,1}",
          total_amount: "9007199254740994",
          router: "fixture",
        },
      ]);
    } finally {
      // B1: signer logs stay append-only, including local CI rows with unique hashes.
      await database.close();
    }
  });
});
