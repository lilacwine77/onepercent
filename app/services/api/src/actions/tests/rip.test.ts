import "./setup.js";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  BLINKS,
  BLINKS_OPS,
  COVERAGE,
  PACK_EDITIONS,
  PAUSE_BITS,
  TX_LIMITS,
  WEB,
} from "@onepercent/config";
import { binderHeaderLayout, EXTERNAL_IDS } from "@onepercent/sdk";
import { ConfigResponse, MachineResponse } from "@onepercent/sdk/api";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { config, machine } from "../../public/__fixtures__/responses.js";
import { InMemoryLinkRateLimiter } from "../../link/ratelimit.js";
import { registerActions } from "../index.js";
import { defaultDeps } from "../../link/index.js";
import {
  createRipService,
  type RipDependencies,
  type RipSnapshot,
} from "../rip.js";
import { RIP_COPY } from "../rip-copy.js";
import { ActionGetResponseSchema, TransactionResponseSchema } from "../spec.js";
import { validateRipTransaction } from "../rip-transaction.js";

const PROGRAM_ID = new PublicKey(new Uint8Array(32).fill(42));
const account = new PublicKey(new Uint8Array(32).fill(8));
const referrer = new PublicKey(new Uint8Array(32).fill(9));
const queue = new PublicKey(new Uint8Array(32).fill(10));
const blockhash = new PublicKey(new Uint8Array(32).fill(11)).toBase58();
const now = 1_800_000_000;
function fixture(): RipSnapshot {
  return {
    config: ConfigResponse.parse({
      ...config,
      programId: PROGRAM_ID.toBase58(),
      phase: 3,
      flags: { ...config.flags, PACKS: true, BLINKS_RIP: true },
      season: { ...config.season, endTs: now + 1_000 },
      vrf: { queues: [queue.toBase58()], activeIndex: 0 },
    }),
    machine: MachineResponse.parse({
      ...machine,
      phase: 3,
      deck: { len: 100, reservedDust: "0", free: 100 },
      coverage: { maxQty: [10, 10, 10, 5] },
    }),
    nowTs: now,
    asOfMs: now * 1_000,
  };
}
function harness(snapshot = fixture()) {
  let time = now * 1_000;
  let binder: Buffer | null = null;
  let error: unknown = null;
  let logs: string[] = [];
  let priorities = [30, 10, WEB.priorityFeeCapMicroLamports + 1];
  const read = vi.fn(async () => snapshot);
  const request = vi.fn(
    async <T>(
      method: string,
      _params: unknown[],
      schema: z.ZodType<T>,
    ): Promise<T> => {
      const values: Record<string, unknown> = {
        getAccountInfo: {
          context: { slot: 1 },
          value:
            binder === null
              ? null
              : {
                  owner: PROGRAM_ID.toBase58(),
                  executable: false,
                  data: [binder.toString("base64"), "base64"],
                },
        },
        getLatestBlockhash: {
          context: { slot: 1 },
          value: { blockhash, lastValidBlockHeight: 100 },
        },
        getRecentPrioritizationFees: priorities.map((prioritizationFee) => ({
          slot: 1,
          prioritizationFee,
        })),
        simulateTransaction: {
          context: { slot: 1 },
          value: { err: error, logs },
        },
      };
      if (!(method in values)) throw new Error("unexpected_rpc");
      return schema.parse(values[method]);
    },
  );
  const onResult = vi.fn();
  const ipLimiter = new InMemoryLinkRateLimiter(() => time);
  const log = vi.fn();
  const deps: RipDependencies = {
    webOrigin: "https://onepercent.test",
    publicApiOrigin: "https://api.onepercent.test",
    cluster: "devnet",
    snapshot: read,
    rpc: {
      async request<T>(
        method: string,
        params: unknown[],
        schema: z.ZodType<T>,
      ): Promise<T> {
        return schema.parse(await request(method, params, schema));
      },
    },
    limiter: new InMemoryLinkRateLimiter(() => time),
    clientIp: () => "127.0.0.1",
    clock: () => time,
    onResult,
  };
  const service = createRipService(deps);
  const app = new Hono();
  registerActions(app, {
    ...defaultDeps({ WEB_ORIGIN: deps.webOrigin }),
    rip: deps,
    cluster: deps.cluster,
    clock: deps.clock,
    linkRateLimiter: ipLimiter,
    logger: { info: log },
  });
  return {
    app,
    deps,
    service,
    snapshot,
    read,
    request,
    onResult,
    ipLimiter,
    log,
    advance: (ms: number) => {
      time += ms;
      snapshot.asOfMs = time;
    },
    binder: (value: Parameters<typeof binderHeaderLayout.encode>[0]) => {
      binder = binderHeaderLayout.encode({ owner: account, ...value });
    },
    simulate: (err: unknown, output: string[] = []) => {
      error = err;
      logs = output;
    },
    fees: (value: number[]) => {
      priorities = value;
    },
    post: (
      path = "/api/actions/rip/original?n=1&lf=0",
      body: unknown = { account: account.toBase58() },
    ) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}
async function decode(response: Response) {
  expect(response.status).toBe(200);
  const body = TransactionResponseSchema.parse(await response.json());
  return Transaction.from(Buffer.from(body.transaction, "base64"));
}
const buy = (tx: Transaction) =>
  tx.instructions.find((ix) => ix.programId.equals(PROGRAM_ID))!;

describe("Rip GET R2.01–03 and R2.16", () => {
  it.each([
    [
      "off",
      (s: RipSnapshot) => {
        s.config.flags.BLINKS_RIP = false;
      },
    ],
    [
      "off",
      (s: RipSnapshot) => {
        s.config.flags.PACKS = false;
      },
    ],
    [
      "beforeOnAir",
      (s: RipSnapshot) => {
        s.config.phase = null;
        s.machine = null;
      },
    ],
    [
      "beforeOnAir",
      (s: RipSnapshot) => {
        s.config.phase = 2;
      },
    ],
    [
      "seasonOver",
      (s: RipSnapshot) => {
        s.config.phase = 4;
      },
    ],
    [
      "seasonOver",
      (s: RipSnapshot) => {
        s.config.season!.endTs = now;
      },
    ],
    [
      "paused",
      (s: RipSnapshot) => {
        s.config.paused = PAUSE_BITS.rip;
      },
    ],
    [
      "busy",
      (s: RipSnapshot) => {
        s.machine!.vrf.busy = true;
      },
    ],
    [
      "hungry",
      (s: RipSnapshot) => {
        s.machine!.deck.free = COVERAGE.dustBuffer + 3;
      },
    ],
    [
      "refilling",
      (s: RipSnapshot) => {
        s.machine!.coverage.maxQty[0] = 0;
      },
    ],
  ] as const)("shows disabled %s", async (state, change) => {
    const h = harness();
    change(h.snapshot);
    expect(h.service.state(h.snapshot, 0)).toBe(state);
    const response = await h.app.request("/api/actions/rip/original");
    expect(response.status).toBe(200);
    const parsed = ActionGetResponseSchema.parse(await response.json());
    expect(parsed.disabled).toBe(true);
    expect(parsed.links).toBeUndefined();
    expect(parsed.error?.message).toBeTruthy();
  });
  it("offers covered quantities, absolute image, whole copy and zero M1 live flags", async () => {
    const h = harness();
    h.snapshot.machine!.coverage.maxQty[0] = 1;
    for (const edition of PACK_EDITIONS) {
      const body = ActionGetResponseSchema.parse(
        await (
          await h.app.request(`/api/actions/rip/${edition.id}?ref=alice_1`)
        ).json(),
      );
      expect(body.title.length).toBeLessThanOrEqual(40);
      expect(body.description.length).toBeLessThanOrEqual(140);
      expect(body.icon).toMatch(
        /^https:\/\/api\.onepercent\.test\/api\/og\/blink\/rip\//,
      );
      expect(body.links?.actions).toHaveLength(edition.index === 0 ? 1 : 2);
      for (const action of body.links!.actions) {
        expect(action.label).toMatch(/^Rip /);
        expect(action.label.split(/\s+/).length).toBeLessThanOrEqual(5);
        expect(action.href).toContain("lf=0&ref=alice_1");
      }
      expect(body.description).not.toMatch(/Jackpot|The 1% card/);
    }
  });
  it("generic GET offers each covered edition, query edition resolves, generic POST always refuses", async () => {
    const h = harness();
    h.snapshot.machine!.coverage.maxQty[1] = 0;
    const generic = ActionGetResponseSchema.parse(
      await (await h.app.request("/api/actions/rip")).json(),
    );
    expect(generic.links!.actions).toHaveLength(3);
    expect(
      generic.links!.actions.every((button) =>
        button.href.includes("?n=1&lf=0"),
      ),
    ).toBe(true);
    expect(
      (await (await h.app.request("/api/actions/rip?edition=original")).json())
        .title,
    ).toBe("The Original ✳ 0.1 SOL");
    expect((await h.post("/api/actions/rip?edition=original&n=1")).status).toBe(
      400,
    );
    h.snapshot.machine!.coverage.maxQty = [0, 0, 0, 0];
    h.advance(60_000);
    const disabled = ActionGetResponseSchema.parse(
      await (await h.app.request("/api/actions/rip")).json(),
    );
    expect(disabled.disabled).toBe(true);
    expect(disabled.error!.message).toContain("The Original opens");
  });
  it("coalesces GETs, bounds freshness from original cache insertion, and rereads after expiry", async () => {
    const h = harness();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => h.app.request("/api/actions/rip")),
    );
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(results[0]!.headers.get("Cache-Control")).toBe("public, max-age=60");
    h.advance(59_000);
    const cached = await h.app.request("/api/actions/rip");
    expect(cached.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(cached.headers.get("Age")).toBe("59");
    h.advance(1_000);
    await h.app.request("/api/actions/rip");
    expect(h.read).toHaveBeenCalledTimes(2);
    await h.app.request("/api/actions/rip?ref=alice_1");
    expect(h.read).toHaveBeenCalledTimes(3);
  });
});

describe("Rip POST R2.04–15 and C2 transaction custody", () => {
  it.each([
    "n=0",
    "n=2",
    "n=10",
    "n=-1",
    "n=1.0",
    "n=1&lf=-1",
    "n=1&lf=256",
    "n=1&lf=no",
    "n=1&lf=1.5",
    "lf=0",
  ])("rejects %s", async (query) =>
    expect(
      (await harness().post(`/api/actions/rip/original?${query}`)).status,
    ).toBe(400),
  );
  it.each([{}, { account: "not_an_address" }])(
    "validates only the account body %j",
    async (body) =>
      expect((await harness().post(undefined, body)).status).toBe(400),
  );
  it.each([
    { type: "transaction" },
    { data: {} },
    { amount: 1 },
    {
      data: { account: referrer.toBase58(), n: "5", ref: referrer.toBase58() },
    },
  ])(
    "ignores extra body parameters and preserves transaction bytes %j",
    async (extra) => {
      const h = harness();
      const original = TransactionResponseSchema.parse(
        await (await h.post()).json(),
      );
      const response = await h.post(undefined, {
        account: account.toBase58(),
        ...extra,
      });
      expect(response.status).toBe(200);
      expect(
        TransactionResponseSchema.parse(await response.json()).transaction,
      ).toBe(original.transaction);
    },
  );
  it.each(["message", "post", "external-link", "unknown", null, 1])(
    "rejects non-transaction type %j",
    async (type) => {
      const h = harness();
      const response = await h.post(undefined, {
        account: account.toBase58(),
        type,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message: RIP_COPY.badRequest });
      expect(h.request).not.toHaveBeenCalled();
    },
  );
  it("rejects unknown edition", async () =>
    expect((await harness().post("/api/actions/rip/missing?n=1")).status).toBe(
      404,
    ));
  it.each([
    [
      403,
      (s: RipSnapshot) => {
        s.config.flags.PACKS = false;
      },
    ],
    [
      403,
      (s: RipSnapshot) => {
        s.config.phase = 2;
      },
    ],
    [
      403,
      (s: RipSnapshot) => {
        s.config.season!.endTs = now;
      },
    ],
    [
      403,
      (s: RipSnapshot) => {
        s.config.paused = PAUSE_BITS.rip;
      },
    ],
    [
      422,
      (s: RipSnapshot) => {
        s.machine!.vrf.busy = true;
      },
    ],
    [
      422,
      (s: RipSnapshot) => {
        s.machine!.deck.free = COVERAGE.dustBuffer + 19;
      },
    ],
    [
      422,
      (s: RipSnapshot) => {
        s.machine!.coverage.maxQty[0] = 4;
      },
    ],
  ] as const)("rechecks gates and refuses with %i", async (status, change) => {
    const h = harness();
    change(h.snapshot);
    const response = await h.post("/api/actions/rip/original?n=5");
    expect(response.status).toBe(status);
    expect(h.request).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each([1, 5])(
    "builds exactly one unsigned SDK purchase for qty %i with fresh nonce, active queue and displayed flags",
    async (qty) => {
      const h = harness();
      h.binder({ pull_nonce: 17 });
      const response = await h.post(
        `/api/actions/rip/after_hours?n=${qty}&lf=7`,
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const tx = await decode(response);
      const ix = buy(tx);
      expect(ix.data[8]).toBe(3);
      expect(ix.data[9]).toBe(qty);
      expect(ix.data.readUInt32LE(10)).toBe(17);
      expect(ix.data[14]).toBe(7);
      expect(ix.data[15]).toBe(0);
      expect(ix.data[16]).toBe(0);
      expect(ix.keys[6]!.pubkey.equals(queue)).toBe(true);
      expect(tx.instructions.map((ix) => ix.programId.toBase58())).toEqual([
        ComputeBudgetProgram.programId.toBase58(),
        ComputeBudgetProgram.programId.toBase58(),
        PROGRAM_ID.toBase58(),
      ]);
      expect(tx.signatures).toHaveLength(1);
      expect(tx.signatures[0]!.signature).toBeNull();
      expect(tx.feePayer!.equals(account)).toBe(true);
      expect(tx.compileMessage().header.numRequiredSignatures).toBe(1);
      expect(
        validateRipTransaction(PROGRAM_ID, tx, account, qty).length,
      ).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
      const simulation = h.request.mock.calls.find(
        ([method]) => method === "simulateTransaction",
      )!;
      expect(simulation[1][1]).toEqual({
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      });
    },
  );
  it("uses p50 priority capped from config", async () => {
    const h = harness();
    h.fees([
      WEB.priorityFeeCapMicroLamports + 1,
      WEB.priorityFeeCapMicroLamports + 2,
    ]);
    const tx = await decode(await h.post());
    expect(tx.instructions[1]!.data.readBigUInt64LE(1)).toBe(
      BigInt(WEB.priorityFeeCapMicroLamports),
    );
  });
  it.each([
    "missing",
    "unspent",
    "bound",
    "spent",
    "self",
    "alias",
    "malformed",
    "absent",
    "zero",
  ])("binds referral only for eligible %s", async (kind) => {
    const h = harness();
    if (["unspent", "bound", "spent"].includes(kind))
      h.binder({
        referrer: kind === "bound" ? referrer : PublicKey.default,
        season_spend: kind === "spent" ? 1n : 0n,
      });
    const ref =
      kind === "self"
        ? account.toBase58()
        : kind === "alias"
          ? "alice_1"
          : kind === "malformed"
            ? "broken value"
            : kind === "zero"
              ? PublicKey.default.toBase58()
              : referrer.toBase58();
    const tx = await decode(
      await h.post(
        `/api/actions/rip/original?n=1${kind === "absent" ? "" : `&ref=${encodeURIComponent(ref)}`}`,
      ),
    );
    const ix = buy(tx);
    const expected = ["missing", "unspent"].includes(kind);
    expect(ix.data.readUInt32LE(10)).toBe(0);
    expect(ix.data[14]).toBe(0);
    expect(ix.data[15]).toBe(expected ? 1 : 0);
    if (expected)
      expect(new PublicKey(ix.data.subarray(16, 48)).equals(referrer)).toBe(
        true,
      );
    expect(ix.data.at(-1)).toBe(0);
  });
  it.each([
    ["LiveFlagsChanged", RIP_COPY.machineChanged],
    ["MachineHungry", RIP_COPY.hungry],
    ["Refilling", "The Original opens"],
    ["vrf", RIP_COPY.busy],
    ["lamports", RIP_COPY.simulation()],
    ["unknown", RIP_COPY.simulation()],
  ])(
    "maps simulation failure %s without a transaction",
    async (kind, expected) => {
      const h = harness();
      const logs =
        kind === "vrf"
          ? [
              `Program ${EXTERNAL_IDS.magicblockVrf.toBase58()} failed: custom program error: 0x1`,
              `Program ${PROGRAM_ID.toBase58()} failed: custom program error: 0x1`,
            ]
          : kind === "lamports"
            ? ["Transfer: insufficient lamports 1, need 10"]
            : [`Program log: AnchorError. Error Code: ${kind}.`];
      h.simulate({ InstructionError: [2, { Custom: 1 }] }, logs);
      const response = await h.post();
      expect(response.status).toBe(422);
      expect((await response.json()).message).toContain(expected);
    },
  );
  it("enforces both rate windows and retry metadata", async () => {
    const h = harness();
    for (let i = 0; i < BLINKS_OPS.ripPostPerMinutePerAccount; i++)
      expect((await h.post()).status).toBe(200);
    const limited = await h.post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    const byIp = harness();
    byIp.snapshot.config.flags.PACKS = false;
    for (let i = 1; i <= BLINKS_OPS.postPerMinutePerIp; i++)
      expect(
        (
          await byIp.post(undefined, {
            account: new PublicKey(new Uint8Array(32).fill(i)).toBase58(),
          })
        ).status,
      ).toBe(403);
    const blocked = await byIp.post(undefined, {
      account: new PublicKey(new Uint8Array(32).fill(200)).toBase58(),
    });
    expect(blocked.status).toBe(429);
  });
  it("charges account before IP and does not charge IP when account is limited", async () => {
    const h = harness();
    const order: string[] = [];
    const accountConsume = h.deps.limiter.consume.bind(h.deps.limiter);
    const ipConsume = h.ipLimiter.consume.bind(h.ipLimiter);
    vi.spyOn(h.deps.limiter, "consume").mockImplementation((key, rule) => {
      order.push("account");
      return accountConsume(key, rule);
    });
    vi.spyOn(h.ipLimiter, "consume").mockImplementation((key, rule) => {
      order.push("ip");
      return ipConsume(key, rule);
    });
    for (let i = 0; i < BLINKS_OPS.ripPostPerMinutePerAccount; i++)
      await h.post();
    expect(order).toEqual(
      Array.from({ length: BLINKS_OPS.ripPostPerMinutePerAccount }, () => [
        "account",
        "ip",
      ]).flat(),
    );
    order.length = 0;
    expect((await h.post()).status).toBe(429);
    expect(order).toEqual(["account"]);
    expect(JSON.parse(h.log.mock.calls.at(-1)![0]).outcome).toBe(
      "account_limit",
    );
  });
  it("logs fixed reasons for snapshot, transaction and account limiter failures", async () => {
    const snapshot = harness();
    snapshot.read.mockRejectedValueOnce(new Error("private snapshot details"));
    expect((await snapshot.post()).status).toBe(503);
    expect(snapshot.onResult).toHaveBeenLastCalledWith(
      "rip-edition",
      "snapshot_unavailable",
      0,
    );
    const transaction = harness();
    transaction.request.mockRejectedValueOnce(new Error("private RPC details"));
    expect((await transaction.post()).status).toBe(503);
    expect(transaction.onResult).toHaveBeenLastCalledWith(
      "rip-edition",
      "transaction_unavailable",
      0,
    );
    const limit = harness();
    vi.spyOn(limit.deps.limiter, "consume").mockImplementation(() => {
      throw new Error("private backend details");
    });
    expect((await limit.post()).status).toBe(503);
    expect(JSON.parse(limit.log.mock.calls.at(-1)![0]).outcome).toBe(
      "account_limit_unavailable",
    );
    expect(
      JSON.stringify([
        snapshot.log.mock.calls,
        transaction.log.mock.calls,
        limit.log.mock.calls,
      ]),
    ).not.toMatch(/private|details/);
  });
  it("shares B1's POST IP quota across X-ray and Rip, including rejected requests", async () => {
    const h = harness();
    for (let i = 0; i < BLINKS_OPS.postPerMinutePerIp - 1; i++)
      expect(
        (
          await h.app.request("/api/actions/xray", {
            method: "POST",
            body: "{}",
          })
        ).status,
      ).toBe(403);
    expect((await h.post()).status).toBe(200);
    const limited = await h.post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it("POST always gets a fresh snapshot despite a prior GET cache", async () => {
    const h = harness();
    await h.app.request("/api/actions/rip/original");
    h.snapshot.config.paused = PAUSE_BITS.rip;
    expect((await h.post()).status).toBe(403);
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.read).toHaveBeenLastCalledWith({ fresh: true });
  });
  it("retains cluster headers and no transaction on RPC failure", async () => {
    const h = harness();
    h.request.mockRejectedValueOnce(new Error("private provider detail"));
    const failed = await h.post();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private provider");
    for (const method of ["GET", "OPTIONS"]) {
      const response = await h.app.request("/api/actions/rip", { method });
      expect(response.headers.get("X-Blockchain-Ids")).toBe(
        "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      );
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });
  it("pins the supported Blink quantity set", () =>
    expect(BLINKS.ripQuantities).toEqual([1, 5]));
});
