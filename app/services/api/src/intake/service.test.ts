import { describe, expect, it, vi } from "vitest";
import { createPublicKey, verify } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { RoleGuard, RoleKey } from "@onepercent/service-kit";
import { EvidenceUnavailableError } from "@onepercent/service-kit/intake";
import { createIntakeService } from "./service.js";
import { loadIntakeParams } from "../internal/params.js";
import {
  intakeFixture,
  ipHash,
  key,
  mint,
  now,
  wallet,
} from "./test-fixtures.js";

describe("FEED signer", () => {
  it("anchors history to the observed bag slot and refuses absent acquisition evidence", async () => {
    const f = intakeFixture();
    const read = f.options.readBag,
      history = vi.fn(f.options.history);
    f.options.readBag = async (...args) => ({
      ...(await read(...args)),
      slot: args[2] + 2,
    });
    f.options.history = async (...args) => ({
      ...(await history(...args)),
      first: null,
    });
    const result = await createIntakeService(f.options).handle(
      f.request,
      ipHash,
    );
    expect(history.mock.calls[0]?.[3]).toBe(f.state.slot + 2);
    expect(result.refused[0]?.reason).toBe("evidence_unavailable");
    expect(f.signed).toHaveLength(0);
  });
  it("refuses only an ambiguous bag and signs eligible siblings with the final live slot", async () => {
    const f = intakeFixture();
    const other = key(12).toBase58();
    const history = f.options.history;
    f.options.history = async (...args) => {
      if (args[1] === mint) throw new EvidenceUnavailableError();
      return history(...args);
    };
    const read = f.options.readBag;
    f.options.readBag = async (...args) => ({
      ...(await read(...args)),
      slot: args[2] + 1,
    });
    const result = await createIntakeService(f.options).handle(
      { wallet, chunks: [[{ mint }, { mint: other }]] },
      ipHash,
    );
    expect(result.refused).toEqual([
      { mint, reason: "evidence_unavailable", date: null },
    ]);
    expect(result.attestations[0]?.bags.map((bag) => bag.mint)).toEqual([
      other,
    ]);
    expect(result.asOfSlot).toBe(f.state.slot + 3);
    expect(f.rows).toHaveLength(1);
  });

  it("reports COPY refusal codes and a live slot for an unsafe mint", async () => {
    const f = intakeFixture();
    f.options.readBag = async (_wallet, _mint, minContextSlot) => ({
      ok: false,
      slot: minContextSlot + 1,
      reason: "not_supported",
    });
    const result = await createIntakeService(f.options).handle(
      f.request,
      ipHash,
    );
    expect(result).toMatchObject({
      asOfSlot: f.state.slot + 2,
      refused: [{ mint, reason: "not_supported" }],
    });
    expect(f.signed).toHaveLength(0);
  });

  it("bounds history concurrency while preserving request order", async () => {
    const f = intakeFixture();
    const mints = [
      mint,
      ...[12, 13, 14, 15, 16].map((byte) => key(byte).toBase58()),
    ];
    const history = f.options.history;
    const releases: (() => void)[] = [];
    let active = 0,
      maximum = 0;
    f.options.history = async (...args) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return history(...args);
    };
    const pending = createIntakeService(f.options).handle(
      {
        wallet,
        chunks: [mints.slice(0, 2), mints.slice(2, 4), mints.slice(4)].map(
          (chunk) => chunk.map((mint) => ({ mint })),
        ),
      },
      ipHash,
    );
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    const result = await pending;
    expect(maximum).toBe(4);
    expect(
      result.attestations.flatMap((entry) => entry.bags.map((bag) => bag.mint)),
    ).toEqual(mints);
  });

  it("stops at the request deadline even if an upstream promise ignores cancellation", async () => {
    const f = intakeFixture();
    const started = new Promise<void>((resolve) => {
      f.options.history = async () => {
        resolve();
        return new Promise(() => undefined);
      };
    });
    const controller = new AbortController();
    const pending = createIntakeService(f.options).handle(
      f.request,
      ipHash,
      controller.signal,
    );
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      reason: "evidence_unavailable",
      asOfSlot: f.state.slot,
    });
    expect(f.rows).toHaveLength(0);
    expect(f.signed).toHaveLength(0);
  });
  it("produces a bound Ed25519 FEED signature through the real role guard", async () => {
    const f = intakeFixture();
    const signer = new RoleKey(Keypair.generate());
    const guard = new RoleGuard({
      role: "intake-signer",
      publicKey: signer.publicKey,
      recheckSeconds: 60,
      readConfig: async () => ({
        disabledRoles: 0,
        addresses: {
          keeper: signer.publicKey,
          executor: signer.publicKey,
          "intake-signer": signer.publicKey,
          "quote-signer": signer.publicKey,
        },
      }),
    });
    signer.bind(guard);
    await guard.refresh();
    f.options.signer = signer;
    f.options.guard = guard;
    try {
      const result = await createIntakeService(f.options).handle(
        f.request,
        ipHash,
      );
      const a = result.attestations[0]!;
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          signer.publicKey.toBuffer(),
        ]),
        format: "der",
        type: "spki",
      });
      const message = Buffer.from(a.message, "base64"),
        signature = Buffer.from(a.signature, "base64");
      expect(verify(null, message, publicKey, signature)).toBe(true);
      message[message.length - 1] = message[message.length - 1]! ^ 1;
      expect(verify(null, message, publicKey, signature)).toBe(false);
    } finally {
      signer.destroy();
    }
  });
  it("does no history work for a partial bag and stops before signing on cancellation", async () => {
    const f = intakeFixture();
    const history = vi.fn(f.options.history);
    f.options.history = history;
    const service = createIntakeService(f.options);
    await service.handle(
      { wallet, chunks: [[{ mint, amount: "999" }]] },
      ipHash,
    );
    expect(history).not.toHaveBeenCalled();
    const abort = new AbortController();
    const original = f.options.history;
    f.options.history = async (...args) => {
      const evidence = await original(...args);
      abort.abort();
      return evidence;
    };
    await expect(
      service.handle(f.request, ipHash, abort.signal),
    ).rejects.toThrow("evidence_unavailable");
    expect(f.signed).toHaveLength(0);
    expect(f.rows).toHaveLength(0);
  });
  it("reads whole bags, returns split sources, hashes chain amounts, logs before signing", async () => {
    const f = intakeFixture();
    f.options.readBag = async () => ({
      ok: true,
      slot: f.state.slot,
      bag: {
        mint,
        amount: 9007199254741001n,
        decimals: 6,
        tokenProgram: key(9).toBase58(),
        source: key(6).toBase58(),
        mergeFrom: [key(7).toBase58()],
      },
    });
    f.options.signer.signMessage = () => {
      expect(f.rows).toHaveLength(1);
      return Buffer.alloc(64, 2);
    };
    const response = await createIntakeService(f.options).handle(
      f.request,
      ipHash,
    );
    expect(response.attestations[0]).toMatchObject({
      nonce: 4,
      expiry: now + 110,
      bags: [{ amount: "9007199254741001", mergeFrom: [key(7).toBase58()] }],
    });
    expect(
      Buffer.from(response.attestations[0]!.message, "base64"),
    ).toHaveLength(121);
    expect(f.rows[0]?.bags[0]?.path).toBe("self");
  });
  it("refuses partial amounts without a log or signature", async () => {
    const f = intakeFixture();
    const response = await createIntakeService(f.options).handle(
      { wallet, chunks: [[{ mint, amount: "999" }]] },
      ipHash,
    );
    expect(response.refused).toEqual([
      { mint, reason: "not_whole_bag", date: null },
    ]);
    expect(f.signed).toHaveLength(0);
    expect(f.rows).toHaveLength(0);
  });
  it("never consumes provenance on repeated requests; live reads change only after a landed Feed", async () => {
    const f = intakeFixture();
    const live = vi.fn(f.options.live);
    f.options.live = live;
    const service = createIntakeService(f.options);
    for (let i = 0; i < 3; i++)
      expect(
        (await service.handle(f.request, ipHash)).attestations,
      ).toHaveLength(1);
    expect(live).toHaveBeenCalledTimes(3);
    f.options.live = async () => ({
      consumption: [],
      liveCard: { date: null },
    });
    expect((await service.handle(f.request, ipHash)).refused[0]?.reason).toBe(
      "live_card",
    );
    expect(f.signed).toHaveLength(3);
  });
  it("uses chain time with the host 30 seconds ahead", async () => {
    const f = intakeFixture();
    const clock = vi.spyOn(Date, "now").mockReturnValue((now + 30) * 1000);
    try {
      expect(
        (await createIntakeService(f.options).handle(f.request, ipHash))
          .attestations[0]?.expiry,
      ).toBe(now + 110);
    } finally {
      clock.mockRestore();
    }
  });
  it("rechecks fresh cap, preserves original chunks and skips used nonce bits", async () => {
    const f = intakeFixture();
    f.state.freshInDeck = 23;
    const other = key(10).toBase58(),
      third = key(11).toBase58();
    const result = await createIntakeService(f.options).handle(
      { wallet, chunks: [[{ mint }], [{ mint: other }, { mint: third }]] },
      ipHash,
    );
    expect(result.attestations.map((a) => [a.chunk, a.nonce])).toEqual([
      [0, 4],
      [1, 6],
    ]);
    expect(result.refused[0]).toMatchObject({
      mint: third,
      reason: "fresh_cap",
    });
  });
  it.each(["feed_closed", "team_wallet", "mint_forbidden", "zero_balance"])(
    "refuses %s",
    async (reason) => {
      const f = intakeFixture();
      if (reason === "feed_closed") f.state.feedOpen = false;
      if (reason === "team_wallet") f.state.teamWallets = [wallet];
      if (reason === "mint_forbidden") f.state.tokenMint = mint;
      if (reason === "zero_balance") {
        const read = f.options.readBag;
        f.options.readBag = async (...args) => {
          const bag = await read(...args);
          if (bag.ok) bag.bag.amount = 0n;
          return bag;
        };
      }
      expect(
        (await createIntakeService(f.options).handle(f.request, ipHash))
          .refused[0]?.reason,
      ).toBe(reason);
      expect(f.signed).toHaveLength(0);
    },
  );
  it("aborts before signing when log persistence fails", async () => {
    const f = intakeFixture();
    f.options.appendLogs = async () => {
      throw new Error("database credentials must not escape");
    };
    await expect(
      createIntakeService(f.options).handle(f.request, ipHash),
    ).rejects.toMatchObject({
      status: 503,
      reason: "attestation_log_unavailable",
    });
    expect(f.signed).toHaveLength(0);
  });
  it.each(["indexer_lag", "evidence_unavailable", "role_disabled"])(
    "fails closed for %s",
    async (reason) => {
      const f = intakeFixture();
      if (reason === "indexer_lag")
        f.options.indexerTime = async () => now - 31;
      if (reason === "evidence_unavailable")
        f.options.history = async () => {
          throw new Error("upstream secret");
        };
      if (reason === "role_disabled")
        f.options.guard.assertAuthorized = () => {
          throw new Error(reason);
        };
      await expect(
        createIntakeService(f.options).handle(f.request, ipHash),
      ).rejects.toThrow(reason);
      expect(f.signed).toHaveLength(0);
    },
  );
  it("rejects unknown fields, duplicate mints, oversized and empty chunks", async () => {
    const f = intakeFixture();
    const service = createIntakeService(f.options);
    for (const request of [
      { ...f.request, nonce: 4 },
      { wallet, chunks: [[{ mint }], [{ mint }]] },
      { wallet, chunks: [[]] },
      {
        wallet,
        chunks: [
          [{ mint }, { mint: key(7).toBase58() }, { mint: key(8).toBase58() }],
        ],
      },
    ])
      await expect(service.handle(request, ipHash)).rejects.toMatchObject({
        status: 400,
      });
    expect(f.signed).toHaveLength(0);
  });
  it("requires merged config with no invented defaults", () => {
    expect(() => loadIntakeParams({})).toThrow("params_unavailable");
  });
});
