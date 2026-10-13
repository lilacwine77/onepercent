import "./setup.js";
import { describe, expect, it, vi } from "vitest";
import { SEASON } from "@onepercent/config";
import { COPY, descriptionCopy, MACHINE_COPY } from "../copy.js";
import { registerBotProfile } from "../bot.js";
import { createGoClient } from "../clients/go.js";
import {
  createMachineClient,
  ConfigResponse,
  MachineResponse,
} from "../clients/machine.js";
import { countdown } from "../handlers/machine.js";
import { isAddress } from "../referral.js";
import {
  ADDRESS,
  harness,
  predeployConfigFixture,
  TEST_BEARER,
} from "./harness.js";

const rows = (h: ReturnType<typeof harness>) =>
  (
    h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload
      .reply_markup as
      | {
          inline_keyboard?: {
            text: string;
            url?: string;
            callback_data?: string;
          }[][];
        }
      | undefined
  )?.inline_keyboard ?? [];
const markup = (h: ReturnType<typeof harness>) => rows(h).flat();
const seasonFixture = {
  stockUpTs: 600,
  onAirTs: 900,
  endTs: 900 + SEASON.durationSeconds,
};
const config = (
  phase: number | null,
  overrides: Record<string, unknown> = {},
) =>
  ConfigResponse.parse(
    phase === null
      ? { ...predeployConfigFixture, ...overrides }
      : {
          phase,
          paused: 0,
          flags: { FEED: true, PACKS: true },
          season: seasonFixture,
          ...overrides,
        },
  );
const machine = (overrides: Record<string, unknown> = {}) =>
  MachineResponse.parse({
    deck: { len: 61240, free: 60000 },
    coverage: { maxQty: [10, 10, 0, 2] },
    vrf: { busy: false },
    jackpot: { tokens: "0", cost: "0" },
    ...overrides,
  });

it("validates decoded address length rather than only its alphabet", () => {
  expect(isAddress(ADDRESS)).toBe(true);
  expect(isAddress("1".repeat(32))).toBe(true);
  for (const input of [
    "1".repeat(33),
    "A".repeat(32),
    "z".repeat(44),
    "0".repeat(44),
  ])
    expect(isAddress(input)).toBe(false);
});
describe("B1 sessions and commands", () => {
  it.each([
    ["/feed", "feed", undefined, undefined],
    ["/rip", "rip", undefined, undefined],
    ["/rip og", "rip", "original", 1],
    ["/rip ah 5", "rip", "after_hours", 5],
  ] as const)(
    "%s creates one id per wallet and preserves the pending code",
    async (command, action, edition, n) => {
      const h = harness({ sessions: true });
      await h.send("/start ref_creator");
      await h.send(command);
      expect(h.go.create).toHaveBeenCalledWith(
        {
          telegramUserId: 42,
          action,
          ...(edition ? { edition, n } : {}),
          ref: "creator",
        },
        3,
      );
      expect(markup(h).map((b) => b.url)).toEqual([
        `https://phantom.com/ul/browse/https%3A%2F%2Fonepercent.test%2Fgo%2F${"a".repeat(32)}?ref=https%3A%2F%2Fonepercent.test`,
        `https://solflare.com/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Fgo%2F${"b".repeat(32)}?ref=https%3A%2F%2Fonepercent.test`,
        `https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Fgo%2F${"c".repeat(32)}?ref=https%3A%2F%2Fonepercent.test`,
      ]);
      expect(rows(h).map((row) => row.length)).toEqual([1, 1, 1]);
    },
  );
  it.each(["feed_menu", "rip_menu"])(
    "%s answers the tap privately and creates no session in groups",
    async (data) => {
      const h = harness({ sessions: true });
      await h.bot.handleUpdate(h.callback(false, data));
      expect(h.calls[0]?.method).toBe("answerCallbackQuery");
      expect(h.go.create).toHaveBeenCalledOnce();
      const group = harness({ sessions: true });
      await group.bot.handleUpdate(group.callback(true, data));
      expect(group.calls).toHaveLength(1);
      expect(group.calls[0]?.payload.text).toBe(COPY.PRIVATE_ONLY);
      expect(group.go.create).not.toHaveBeenCalled();
    },
  );
  it.each(["ah 6", "og 11", "zz", "og 0", "ah 01"])(
    "refuses /rip %s before creating sessions",
    async (arg) => {
      const h = harness({ sessions: true });
      await h.send(`/rip ${arg}`);
      expect(h.texts()).toEqual([COPY.RIP_USAGE]);
      expect(h.go.create).not.toHaveBeenCalled();
    },
  );
  it("accepts OG 10 and uses cards without a referral for the B1 /me placeholder", async () => {
    const h = harness({ sessions: true });
    await h.send("/rip og 10");
    expect(h.go.create).toHaveBeenLastCalledWith(
      { telegramUserId: 42, action: "rip", edition: "original", n: 10 },
      3,
    );
    await h.send("/start ref_creator");
    await h.send("/me");
    expect(h.go.create).toHaveBeenLastCalledWith(
      { telegramUserId: 42, action: "cards" },
      3,
    );
    expect(markup(h).map((button) => button.text)).toEqual([
      COPY.BUTTON_CARDS_PHANTOM,
      COPY.BUTTON_CARDS_SOLFLARE,
      COPY.BUTTON_CARDS_BACKPACK,
    ]);
    expect(markup(h)[2]?.url).toBe(
      `https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Fgo%2F${"c".repeat(32)}?ref=https%3A%2F%2Fonepercent.test`,
    );
  });
  it.each([false, true])(
    "falls back safely, rate-limiting the warning, with secret=%s",
    async (secret) => {
      const h = harness({ secret, sessions: true });
      h.go.create.mockRejectedValue(new Error("sensitive details"));
      await h.send("/feed");
      await h.send("/rip ah 5");
      expect(
        h.logs.filter((line) => line.includes("go_fallback")),
      ).toHaveLength(1);
      expect(markup(h)[0]?.url).toContain(
        "%2Frip%3Fedition%3Dafter_hours%26n%3D5",
      );
      h.clock.advance(60_000);
      await h.send("/feed");
      expect(
        h.logs.filter((line) => line.includes("go_fallback")),
      ).toHaveLength(2);
    },
  );
  it.each(["/link", "/me"])(
    "%s gives every wallet button its own row",
    async (command) => {
      const h = harness({ sessions: true });
      await h.send(command);
      expect(rows(h).map((row) => row.length)).toEqual([1, 1, 1]);
    },
  );
  it.each([
    ["a", "b"],
    ["a", "a", "c"],
    ["a", "b", "c", "d"],
  ])("refuses an invalid session set %j", async (...ids) => {
    const h = harness({ sessions: true });
    h.go.create.mockResolvedValue(
      ids.map((id) => ({
        id: id.repeat(32),
        expiresAt: "2026-10-08T12:10:00.000Z",
      })),
    );
    await h.send("/feed");
    expect(rows(h).map((row) => row.length)).toEqual([1, 1, 1]);
    for (const button of markup(h)) {
      expect(button.url).toContain("%2Ffeed");
      expect(button.url).not.toContain("%2Fgo%2F");
    }
    expect(h.logs.filter((line) => line.includes("go_fallback"))).toHaveLength(
      1,
    );
  });
  it.each(["/feed", "/rip ah 5", "feed_menu", "rip_menu"])(
    "%s keeps replying without a referral when its store is unavailable",
    async (action) => {
      const h = harness({ sessions: true });
      vi.spyOn(h.store, "getPendingReferral").mockRejectedValue(
        new Error("store unavailable token=store-private-token"),
      );
      if (action.startsWith("/")) await h.send(action);
      else await h.bot.handleUpdate(h.callback(false, action));
      expect(h.texts()).toHaveLength(1);
      expect(rows(h).map((row) => row.length)).toEqual([1, 1, 1]);
      expect(h.go.create).not.toHaveBeenCalled();
      for (const button of markup(h)) {
        expect(button.url).not.toContain("%2Fgo%2F");
        expect(button.url).not.toContain("ref%3D");
      }
      expect(h.logs.join("\n")).not.toContain("store-private-token");
      expect(h.logs.map((line) => JSON.parse(line))).toContainEqual(
        expect.objectContaining({
          level: 40,
          msg: "go_fallback",
          cause: { code: "Error", detail: "store unavailable <redacted>" },
        }),
      );
    },
  );
  it("limits the eleventh session reply once and group replies silently", async () => {
    const h = harness({ sessions: true });
    for (let i = 0; i < 12; i++) await h.send("/feed");
    expect(h.go.create).toHaveBeenCalledTimes(10);
    expect(h.texts()).toHaveLength(11);
    const group = harness();
    for (let i = 0; i < 12; i++) await group.send("/start", true);
    expect(group.texts()).toHaveLength(10);
  });
  it("unlinks and disables alerts, while opt-out works without a link or secret", async () => {
    const h = harness();
    await h.store.setAlerts(42, "live");
    await h.send("/unlink");
    expect(h.link.unbind).toHaveBeenCalledWith(42);
    expect(await h.store.getAlerts(42)).toBe("off");
    expect(h.texts()[0]).toContain("Unlinked.");
    for (const options of [{ wallet: null }, { secret: false }]) {
      const off = harness(options);
      await off.store.setAlerts(42, "live");
      await off.send("/alerts off");
      expect(await off.store.getAlerts(42)).toBe("off");
      expect(off.texts()).toEqual([COPY.ALERTS_OFF]);
    }
    const none = harness({ wallet: null });
    await none.send("/unlink");
    expect(none.texts()).toEqual([COPY.ME_NONE]);
  });
  it("does not supply an X-ray sharer code when unlinked, linking fails or the chat is a group", async () => {
    for (const kind of ["unlinked", "failed", "group"]) {
      const h = harness({ wallet: kind === "unlinked" ? null : ADDRESS });
      if (kind === "failed")
        h.link.walletOf.mockRejectedValue(new Error("offline"));
      await h.send(`/xray ${ADDRESS}`, kind === "group");
      expect(h.xray.get).toHaveBeenCalledWith(ADDRESS, undefined);
      if (kind === "group") expect(markup(h)).toHaveLength(1);
    }
  });
  it("records kicked/left states and chat migration without messaging", async () => {
    for (const status of ["kicked", "left"] as const) {
      const h = harness();
      await h.store.setGroupHits(-100, true);
      const update = h.added();
      if (!update.my_chat_member) throw new Error("fixture");
      update.my_chat_member.new_chat_member =
        status === "kicked"
          ? {
              status,
              user: update.my_chat_member.new_chat_member.user,
              until_date: 0,
            }
          : { status, user: update.my_chat_member.new_chat_member.user };
      await h.bot.handleUpdate(update);
      expect(await h.store.getGroupHits(-100)).toBe(false);
      expect(h.calls).toEqual([]);
    }
    const h = harness();
    await h.store.setGroupHits(-100, true);
    const update = h.message("", true);
    if (!update.message) throw new Error("fixture");
    Object.assign(update.message, { migrate_to_chat_id: -200 });
    await h.bot.handleUpdate(update);
    expect(await h.store.getGroupHits(-100)).toBe(false);
    expect(await h.store.getGroupHits(-200)).toBe(true);
    expect(h.calls).toEqual([]);
  });
  it("registers descriptions and continues through individual Telegram failures", async () => {
    const h = harness();
    const warn = vi.fn();
    await registerBotProfile(h.bot, "onepercent.test", { warn });
    expect(h.calls.map((c) => c.method)).toEqual([
      "setMyCommands",
      "setMyCommands",
      "setMyDescription",
      "setMyShortDescription",
    ]);
    expect(descriptionCopy("onepercent.test").length).toBeLessThanOrEqual(512);
    expect(COPY.SHORT_DESCRIPTION.length).toBeLessThanOrEqual(120);
    const failed = harness();
    failed.bot.api.config.use(async (_prev, method) => {
      if (method === "setMyCommands") throw new Error("sensitive");
      return { ok: true, result: true } as Awaited<ReturnType<typeof _prev>>;
    });
    await registerBotProfile(failed.bot, "onepercent.test", { warn });
    expect(warn).toHaveBeenCalledWith(
      {
        method: "setMyCommands",
        cause: { code: "sensitive", detail: "sensitive" },
      },
      "bot profile unavailable",
    );
  });
});

describe("machine state matrix", () => {
  it.each([
    ["before program configuration", predeployConfigFixture],
    [
      "after an account read with missing accounts",
      {
        ...predeployConfigFixture,
        asOfSlot: 123,
        paramsHash: "a".repeat(64),
      },
    ],
  ])("renders the full S4 body %s through the real client", async (_, body) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify(body)),
    );
    vi.stubGlobal("fetch", fetch);
    const client = createMachineClient("https://api.onepercent.test");
    const h = harness();
    h.machine.config.mockImplementation(client.config);
    await h.send("/machine");
    expect(h.texts()).toEqual([
      "<b>The machine is warming up.</b>\nSend /xray and a wallet address to see what you could feed.",
    ]);
    expect(markup(h)).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://api.onepercent.test/api/config",
    );
    expect(h.machine.machine).not.toHaveBeenCalled();
    expect(h.machine.value).not.toHaveBeenCalled();
  });
  it.each([
    ["unknown phase", { phase: 99 }],
    ["string phase", { phase: "Setup" }],
    ["missing phase", { phase: undefined }],
    ["deployed phase with null chain sections", { phase: 3 }],
    ["null phase with a deployed pause bitmask", { paused: 0 }],
    ["null phase with a deployed season", { season: seasonFixture }],
  ])("does not render malformed config as Setup: %s", async (_, overrides) => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ...predeployConfigFixture, ...overrides }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const client = createMachineClient("https://api.onepercent.test");
    const h = harness();
    h.machine.config.mockImplementation(client.config);
    await h.send("/machine");
    expect(h.texts()).toEqual([MACHINE_COPY["common.networkError"]]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(h.machine.machine).not.toHaveBeenCalled();
    expect(h.machine.value).not.toHaveBeenCalled();
  });
  it.each([null, 0, 1, 2, 3, 4, 5, 6])(
    "renders phase %s without an unavailable route dependency",
    async (phase) => {
      const h = harness();
      h.machine.config.mockResolvedValue(config(phase));
      h.machine.machine.mockResolvedValue(machine());
      await h.send("/machine");
      expect(h.texts()).toHaveLength(1);
      expect(h.texts()[0]).not.toBe(MACHINE_COPY["common.networkError"]);
      expect(h.texts()[0]!.split("\n").length).toBeLessThanOrEqual(6);
      if (phase === null || phase === 0 || (phase !== null && phase >= 4))
        expect(h.machine.machine).not.toHaveBeenCalled();
    },
  );
  it("pins Setup, Stock-Up, Power-On and On Air goldens", async () => {
    const cases = [
      [
        config(0, { season: { stockUpTs: 0, onAirTs: 0, endTs: 0 } }),
        "<b>The machine is warming up.</b>\nSend /xray and a wallet address to see what you could feed.",
      ],
      [
        config(0),
        "<b>Feed opens at Stock-Up.</b>\nJan 1 00:10 UTC ✳ in 00:10:00.\nSend /xray to see what you could feed.",
      ],
      [
        config(1),
        "<b>Stock-Up ✳ Feed is open.</b>\n61,240 cards in the Deck ✳ packs open at On Air.",
      ],
      [
        config(2),
        "<b>Powered on ✳ On Air at 00:15 UTC.</b>\nIn 00:15:00 ✳ 61,240 cards in the Deck.",
      ],
      [
        config(3),
        "<b>On Air ✳ 61,240 cards in the Deck</b>\nRip up to: The Original 10 ✳ Blue Shift 10 ✳ Signature refilling ✳ After Hours 2",
      ],
    ] as const;
    for (const [value, text] of cases) {
      const h = harness();
      h.machine.config.mockResolvedValue(value);
      await h.send("/machine");
      expect(h.texts()).toEqual([text]);
    }
  });
  it.each([1, 2])(
    "phase %s only shows Feed when unpaused and enabled",
    async (phase) => {
      for (const [enabled, paused] of [
        [true, 0],
        [false, 0],
        [true, 2],
      ] as const) {
        const h = harness();
        h.machine.config.mockResolvedValue(
          config(phase, { flags: { FEED: enabled, PACKS: true }, paused }),
        );
        await h.send("/machine");
        expect(markup(h).length).toBe(enabled && !paused ? 1 : 0);
      }
    },
  );
  it("covers closed, paused, busy and hungry Rip precedence", async () => {
    const cases = [
      [
        config(3, { flags: { FEED: true, PACKS: false } }),
        machine(),
        "Packs are not open yet.",
      ],
      [
        config(3, { paused: 1 }),
        machine(),
        "Paused for now. Every exit still works.",
      ],
      [config(3), machine({ vrf: { busy: true } }), "Machine busy"],
      [config(3), machine({ deck: { len: 50, free: 53 } }), "Machine hungry"],
    ] as const;
    for (const [c, m, expected] of cases) {
      const h = harness();
      h.machine.config.mockResolvedValue(c);
      h.machine.machine.mockResolvedValue(m);
      await h.send("/machine");
      expect(h.texts()[0]).toContain(expected);
    }
  });
  it("reports executable Jackpot quotes only and omits not-yet-issued 1% fields", async () => {
    const h = harness();
    h.machine.config.mockResolvedValue(config(3));
    h.machine.machine.mockResolvedValue(
      machine({ jackpot: { tokens: "5620113000000", cost: "4000000000" } }),
    );
    await h.send("/machine");
    expect(h.texts()[0]).toContain(
      "Jackpot 5,620,113 $1PCT ✳ live in The Original, Blue Shift",
    );
    expect(h.texts()[0]).not.toContain("SOL");
    expect(h.machine.value).not.toHaveBeenCalled();
    h.machine.machine.mockResolvedValue(
      machine({
        tokenMint: ADDRESS,
        jackpot: { tokens: "5620113000000", cost: "4000000000" },
      }),
    );
    h.machine.value.mockResolvedValue({
      status: "ok",
      lamports: "49000000000",
      capped: false,
      label: "if_sold_now",
    });
    await h.send("/machine");
    expect(h.texts().at(-1)).toContain("≈49 SOL if sold now");
    h.machine.value.mockRejectedValue(new Error("quote down"));
    await h.send("/machine");
    expect(h.texts().at(-1)).not.toContain("SOL");
    h.machine.machine.mockResolvedValue(
      machine({ jackpot: { tokens: "1", cost: "0" } }),
    );
    await h.send("/machine");
    expect(h.texts().at(-1)).toContain("not live yet");
  });
  it("handles live, next and done special fields and Last Call within six lines", async () => {
    for (const mode of ["live", "next", "done"]) {
      const h = harness();
      h.machine.config.mockResolvedValue(
        config(3, { season: { stockUpTs: 600, onAirTs: 900, endTs: 3600 } }),
      );
      h.machine.machine.mockResolvedValue(
        machine({
          onePctLiveIndex: mode === "live" ? 1 : null,
          onePct: Array.from({ length: 4 }, () => ({
            state: mode === "done" ? 2 : 0,
            amount: "1",
            releaseTs: 4200,
          })),
        }),
      );
      await h.send("/machine");
      expect(h.texts()[0]).toContain(
        mode === "live"
          ? "card 2 of 4 live"
          : mode === "next"
            ? "card 1 of 4 from Jan 1 01:10 UTC"
            : "all 4 pulled",
      );
      expect(h.texts()[0]).toContain("Last Call ✳ buys close in 01:00:00");
      expect(h.texts()[0]!.split("\n").length).toBeLessThanOrEqual(6);
    }
  });
  it("starts Last Call exactly six hours before the season ends", async () => {
    const h = harness();
    h.machine.config.mockResolvedValue(config(3));
    h.clock.advance((seasonFixture.endTs - SEASON.lastCallSeconds - 1) * 1000);
    await h.send("/machine");
    expect(h.texts().at(-1)).not.toContain("Last Call");
    h.clock.advance(1000);
    await h.send("/machine");
    expect(h.texts().at(-1)).toContain("Last Call ✳ buys close in 06:00:00");
  });
  it("uses a canonical URL in groups, closes on the end boundary and maps failures", async () => {
    const h = harness({ sessions: true });
    h.machine.config.mockResolvedValue(config(3));
    await h.send("/machine", true);
    expect(markup(h)[0]?.url).toBe("https://onepercent.test/rip");
    expect(h.go.create).not.toHaveBeenCalled();
    h.clock.advance(seasonFixture.endTs * 1000);
    await h.send("/machine");
    expect(h.texts().at(-1)).toContain("Season over");
    const broken = harness();
    broken.machine.config.mockRejectedValue(new Error("sensitive"));
    await broken.send("/machine");
    expect(broken.texts()).toEqual([MACHINE_COPY["common.networkError"]]);
  });
  it.each([
    [0, "00:00:00"],
    [-1, "00:00:00"],
    [1.1, "00:00:02"],
    [93784, "1d 02:03:04"],
  ] as const)("matches M3 countdown %s", (value, expected) => {
    expect(countdown(value)).toBe(expected);
  });
});

it("validates Go responses and a distinct id for each requested wallet", async () => {
  for (const body of [
    { sessions: [] },
    {
      sessions: [
        { id: "a".repeat(32), expiresAt: "2026-10-09T12:00:00Z" },
        { id: "a".repeat(32), expiresAt: "2026-10-09T12:00:00Z" },
      ],
    },
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 201 })),
    );
    await expect(
      createGoClient("https://api.onepercent.test", TEST_BEARER).create(
        { telegramUserId: 42, action: "feed" },
        2,
      ),
    ).rejects.toThrow();
  }
});
it("caches validated public snapshots with the S4 numeric wire representation", async () => {
  let now = 0;
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          phase: 0,
          flags: { FEED: false, PACKS: false },
          paused: 0,
          season: { stockUpTs: 0, onAirTs: 0, endTs: 0 },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const client = createMachineClient("https://api.onepercent.test", () => now);
  expect((await client.config()).phase).toBe("Setup");
  await client.config();
  expect(fetch).toHaveBeenCalledOnce();
  now = 5000;
  await client.config();
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValue(new Response(JSON.stringify({ phase: 99 })));
  now = 10000;
  await expect(client.config()).rejects.toThrow();
});
it("aborts Telegram startup calls before starting another profile method", async () => {
  const { AbortController } = await import("abort-controller");
  const h = harness();
  const controller = new AbortController();
  const methods: string[] = [];
  h.bot.api.config.use(async (_previous, method, _payload, signal) => {
    methods.push(method);
    expect(signal).toBe(controller.signal);
    controller.abort();
    throw new Error("cancelled");
  });
  const warn = vi.fn();
  await registerBotProfile(
    h.bot,
    "onepercent.test",
    { warn },
    controller.signal,
  );
  expect(methods).toEqual(["setMyCommands"]);
  expect(warn).not.toHaveBeenCalled();
});
it("does not spend group reply budget on chatter or commands for another bot", async () => {
  const h = harness();
  for (let i = 0; i < 10; i++) {
    await h.send("hello", true);
    await h.send("/machine@AnotherBot", true);
  }
  const update = h.message("/machine", true);
  if (!update.message?.from) throw new Error("fixture");
  update.message.from.id = 43;
  await h.bot.handleUpdate(update);
  expect(h.texts()).toHaveLength(1);
});
