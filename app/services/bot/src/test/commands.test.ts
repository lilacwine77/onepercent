import "./setup.js";
import { describe, expect, it } from "vitest";
import { ALLOWED_UPDATES, registerCommandMenus } from "../bot.js";
import { COPY, feedCopy } from "../copy.js";
import { XrayError } from "../clients/xray.js";
import { ADDRESS, fixture, harness, NONCE } from "./harness.js";

const golden = `<b>X-ray: 7xKp…d2Qa</b>
37 bags ✳ 16 feedable ✳ 12 to check at Feed ✳ 12 have a bid ≈0.79 SOL est.
104 empty accounts ≈0.21 SOL rent back
Worst: $WIFHAT −99.6% from ATH
Certified Bagholder
You sign everything in your own wallet. No keys, ever.`;
function buttons(h: ReturnType<typeof harness>) {
  return (
    h.calls.filter((call) => call.method === "sendMessage").at(-1)?.payload
      .reply_markup as {
      inline_keyboard: {
        text: string;
        url?: string;
        callback_data?: string;
      }[][];
    }
  ).inline_keyboard.flat();
}
describe("bot commands through handleUpdate", () => {
  it("starts privately, keeps the first valid referral, ignores group and invalid payloads", async () => {
    const h = harness();
    await h.send(`/start ref_${ADDRESS}`);
    await h.send("/start ref_another");
    expect(await h.store.getPendingReferral(42)).toBe(ADDRESS);
    expect(await h.store.hasStarted(42)).toBe(true);
    const invalid = harness();
    await invalid.send("/start ref_bad!");
    expect(await invalid.store.getPendingReferral(42)).toBeNull();
    const group = harness();
    await group.send(`/start ref_${ADDRESS}`, true);
    expect(group.texts()).toEqual([COPY.START_GROUP]);
    expect(await group.store.getPendingReferral(42)).toBeNull();
    expect(await group.store.hasStarted(-100)).toBe(false);
  });
  it("pins the corrected X-ray golden and landscape preview", async () => {
    const h = harness();
    await h.send(`/xray ${ADDRESS}`);
    expect(h.texts()).toEqual([golden]);
    expect(h.calls[0]?.method).toBe("sendChatAction");
    expect(h.calls.at(-1)?.payload.link_preview_options).toEqual({
      url: fixture.share.landscapeUrl,
      prefer_large_media: true,
      show_above_text: false,
    });
    expect(buttons(h)).toHaveLength(2);
    expect(buttons(h)[0]).toEqual({
      text: COPY.BUTTON_FEED_MENU,
      callback_data: "feed_menu",
    });
    expect(buttons(h).at(-1)?.url).toBe(fixture.share.xIntentUrl);
  });
  it("passes .sns unchanged, refuses .sol and renders the resolved address", async () => {
    const h = harness();
    await h.send("Alice.SOL");
    expect(h.xray.get).not.toHaveBeenCalled();
    expect(h.texts()).toEqual([COPY.XRAY_USAGE]);
    await h.send("  Alice.SNS  ");
    expect(h.xray.get).toHaveBeenLastCalledWith("Alice.SNS", ADDRESS);
    expect(h.texts().at(-1)).toContain("<b>X-ray: 7xKp…d2Qa</b>");
    await h.send(ADDRESS);
    expect(h.xray.get).toHaveBeenLastCalledWith(ADDRESS, ADDRESS);
    await h.send("hello");
    expect(h.texts().at(-1)).toBe(COPY.UNKNOWN);
  });
  it("drops zero segments, uses singular and omits null Worst", async () => {
    const h = harness();
    h.xray.get.mockResolvedValue({
      ...fixture,
      counts: {
        ...fixture.counts,
        bags: 1,
        feedable: 0,
        checkAtFeed: 1,
        sellable: 1,
        empty: 1,
      },
      worst: null,
    });
    await h.send(`/xray ${ADDRESS}`);
    expect(h.texts()[0]).toContain(
      "1 bag ✳ 1 to check at Feed ✳ 1 has a bid ≈0.79 SOL est.",
    );
    expect(h.texts()[0]).toContain("1 empty account ≈0.21 SOL rent back");
    expect(h.texts()[0]).not.toContain("Worst");
    expect(h.texts()[0]).not.toContain("0 feedable");
    expect(buttons(h)).toHaveLength(2);
  });
  it("renders clean wallets and no Feed buttons when no bag can be checked", async () => {
    const h = harness();
    h.xray.get.mockResolvedValue({
      ...fixture,
      counts: {
        ...fixture.counts,
        bags: 0,
        feedable: 0,
        checkAtFeed: 0,
        sellable: 0,
        empty: 0,
      },
    });
    await h.send(`/xray ${ADDRESS}`);
    expect(h.texts()).toEqual([
      "<b>X-ray: 7xKp…d2Qa</b>\nThat wallet’s clean. Nothing to X-ray. Mint condition.",
    ]);
    expect(buttons(h)).toHaveLength(1);
  });
  it("rejects unsupported chains and invalid input without scanning", async () => {
    const h = harness();
    await h.send("/xray 0xabcdef");
    await h.send("/xray nope");
    await h.send("/xray");
    expect(h.texts()).toEqual([
      COPY.SOLANA_ONLY,
      COPY.XRAY_USAGE,
      COPY.XRAY_USAGE,
    ]);
    expect(h.xray.get).not.toHaveBeenCalled();
  });
  it.each(["usage", "busy", "schema"] as const)(
    "maps %s client errors without leaking details",
    async (kind) => {
      const h = harness();
      h.xray.get.mockRejectedValue(new XrayError(kind));
      await h.send(`/xray ${ADDRESS}`);
      expect(h.texts()).toEqual([
        kind === "usage" ? COPY.XRAY_USAGE : COPY.XRAY_BUSY,
      ]);
      expect(h.logs.join("").includes("xray_schema_mismatch")).toBe(
        kind === "schema",
      );
    },
  );
  it("sanitizes hostile symbols and escapes metadata", async () => {
    const h = harness();
    h.xray.get.mockResolvedValue({
      ...fixture,
      worst: { ...fixture.worst!, symbol: '<a href="x">' },
      card: { ...fixture.card, title: "<b>unsafe</b>\nline" },
    });
    await h.send(`/xray ${ADDRESS}`);
    expect(h.texts()[0]).toContain("Worst: $AHREFX");
    expect(h.texts()[0]).toContain("&lt;b&gt;unsafe&lt;/b&gt; line");
    expect(h.texts()[0]).not.toContain('<a href="x">');
  });
  it("pins wallet links for feed, edition/count and link sessions", async () => {
    const h = harness();
    await h.send("/start ref_creator");
    await h.send("/feed");
    expect(h.texts().at(-1)).toBe(feedCopy());
    expect(buttons(h).map((b) => b.url)).toEqual([
      "https://phantom.com/ul/browse/https%3A%2F%2Fonepercent.test%2Ffeed%3Fref%3Dcreator?ref=https%3A%2F%2Fonepercent.test",
      "https://solflare.com/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Ffeed%3Fref%3Dcreator?ref=https%3A%2F%2Fonepercent.test",
      "https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Ffeed%3Fref%3Dcreator?ref=https%3A%2F%2Fonepercent.test",
    ]);
    await h.send("/rip ah 5");
    expect(h.texts().at(-1)).toBe(
      "<b>After Hours ✳ 1 SOL</b>\nRip 5 packs in your wallet. The page shows the odds before you sign.\nYou sign everything in your own wallet. No keys, ever.",
    );
    expect(buttons(h).map((b) => b.url)).toEqual([
      "https://phantom.com/ul/browse/https%3A%2F%2Fonepercent.test%2Frip%3Fedition%3Dafter_hours%26n%3D5%26ref%3Dcreator?ref=https%3A%2F%2Fonepercent.test",
      "https://solflare.com/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Frip%3Fedition%3Dafter_hours%26n%3D5%26ref%3Dcreator?ref=https%3A%2F%2Fonepercent.test",
      "https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Frip%3Fedition%3Dafter_hours%26n%3D5%26ref%3Dcreator?ref=https%3A%2F%2Fonepercent.test",
    ]);
    await h.send("/link");
    expect(h.link.createNonce).toHaveBeenCalledWith(42, "OnepercentTestBot");
    expect(buttons(h).map((b) => b.url)).toEqual([
      `https://phantom.com/ul/browse/https%3A%2F%2Fonepercent.test%2Flink%2F${NONCE}?ref=https%3A%2F%2Fonepercent.test`,
      `https://solflare.com/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Flink%2F${NONCE}?ref=https%3A%2F%2Fonepercent.test`,
      `https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Flink%2F${NONCE}?ref=https%3A%2F%2Fonepercent.test`,
    ]);
  });
  it("keeps group X-rays to Share and never adds a private Feed menu", async () => {
    const h = harness();
    await h.send("/start ref_creator");
    await h.send(`/xray ${ADDRESS}`, true);
    expect(buttons(h)).toEqual([
      { text: COPY.BUTTON_SHARE, url: fixture.share.xIntentUrl },
    ]);
    expect(h.xray.get).toHaveBeenLastCalledWith(ADDRESS, undefined);
  });
  it("opens three Feed wallet buttons only after a private X-ray menu tap", async () => {
    const h = harness();
    await h.send("/start ref_creator");
    await h.bot.handleUpdate(h.callback(false, "feed_menu"));
    expect(h.calls.at(-2)?.method).toBe("answerCallbackQuery");
    expect(h.texts().at(-1)).toBe(feedCopy());
    expect(buttons(h).map((button) => button.text)).toEqual([
      COPY.BUTTON_FEED_PHANTOM,
      COPY.BUTTON_FEED_SOLFLARE,
      COPY.BUTTON_FEED_BACKPACK,
    ]);
    expect(buttons(h).at(-1)?.url).toBe(
      "https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.test%2Ffeed%3Fref%3Dcreator?ref=https%3A%2F%2Fonepercent.test",
    );
    const group = harness();
    await group.bot.handleUpdate(group.callback(true, "feed_menu"));
    expect(group.calls.map((call) => call.method)).toEqual([
      "answerCallbackQuery",
    ]);
  });
  it.each(["zz", "ah 0", "ah 11", "ah 1.0", "ah 01", "ah 1 more"])(
    "rejects invalid rip arguments %s",
    async (args) => {
      const h = harness();
      await h.send(`/rip ${args}`);
      expect(h.texts()).toEqual([COPY.RIP_USAGE]);
    },
  );
  it.each(["/feed", "/rip", "/link", "/me", "/alerts on"])(
    "keeps %s private and creates no group nonce",
    async (command) => {
      const h = harness();
      await h.send(command, true);
      expect(h.texts()).toEqual([COPY.PRIVATE_ONLY]);
      expect(h.link.createNonce).not.toHaveBeenCalled();
      expect(h.link.walletOf).not.toHaveBeenCalled();
    },
  );
  it("links, reports wallet and toggles explicitly requested alerts", async () => {
    const h = harness();
    await h.send("/me");
    expect(h.texts()[0]).toContain("<b>Linked: 7xKp…d2Qa</b>");
    await h.send("/alerts on");
    expect(await h.store.getAlerts(42)).toBe("live");
    await h.send("/alerts");
    expect(h.texts().at(-1)).toContain("<b>Alerts on.</b>");
    await h.send("/alerts off");
    expect(await h.store.getAlerts(42)).toBe("off");
    const none = harness({ wallet: null });
    await none.send("/me");
    await none.send("/alerts on");
    expect(none.texts()).toEqual([COPY.ME_NONE, COPY.ALERTS_NEED_LINK]);
    const off = harness({ secret: false });
    await off.send("/link");
    await off.send("/me");
    expect(off.texts()).toEqual([COPY.LINK_OFF, COPY.LINK_OFF]);
  });
  it("requires group admin authorization, including anonymous admins", async () => {
    const h = harness();
    await h.send("/hits on", true);
    expect(h.texts()).toEqual([COPY.HITS_NOT_ADMIN]);
    expect(await h.store.getGroupHits(-100)).toBe(false);
    const admin = harness({ admin: true });
    await admin.send("/hits on", true);
    expect(await admin.store.getGroupHits(-100)).toBe(true);
    await admin.send("/hits off", true);
    expect(await admin.store.getGroupHits(-100)).toBe(false);
    const anon = harness();
    await anon.send("/hits on", true, true);
    expect(await anon.store.getGroupHits(-100)).toBe(true);
    expect(anon.calls.some((call) => call.method === "getChatMember")).toBe(
      false,
    );
    await anon.send("/hits on");
    expect(anon.texts().at(-1)).toBe(COPY.HITS_PRIVATE);
  });
  it("accepts an anonymous group admin even when Telegram omits from", async () => {
    const h = harness();
    const update = h.message("/hits on", true, true);
    if ("message" in update && update.message)
      delete (update.message as { from?: unknown }).from;
    await h.bot.handleUpdate(update);
    expect(await h.store.getGroupHits(-100)).toBe(true);
    expect(h.calls.some((call) => call.method === "getChatMember")).toBe(false);
  });
  it("answers help callbacks and sends nothing on being added to a group", async () => {
    const h = harness();
    await h.bot.handleUpdate(h.added());
    expect(h.calls).toEqual([]);
    await h.bot.handleUpdate(h.callback());
    expect(h.calls.map((call) => call.method)).toEqual([
      "answerCallbackQuery",
      "sendMessage",
    ]);
    expect(h.texts()).toEqual([COPY.XRAY_USAGE]);
  });
  it("sends one refusal for the seventh X-ray and stays silent on the eighth", async () => {
    const h = harness();
    for (let n = 0; n < 8; n++) await h.send(`/xray ${ADDRESS}`);
    expect(h.xray.get).toHaveBeenCalledTimes(6);
    expect(h.texts()).toHaveLength(7);
    expect(h.texts().at(-1)).toBe("One at a time. Try again in 60 s.");
    h.clock.advance(60_000);
    await h.send(ADDRESS);
    expect(h.xray.get).toHaveBeenCalledTimes(7);
  });
  it("rate-limits link creation and callback bursts with a single answer", async () => {
    const h = harness();
    for (let n = 0; n < 5; n++) await h.send("/link");
    expect(h.link.createNonce).toHaveBeenCalledTimes(3);
    expect(h.texts().at(-1)).toBe("One at a time. Try again in 600 s.");
    const callbacks = harness();
    for (let n = 0; n < 22; n++)
      await callbacks.bot.handleUpdate(callbacks.callback());
    expect(
      callbacks.calls.filter((call) => call.method === "answerCallbackQuery"),
    ).toHaveLength(21);
    expect(callbacks.calls.at(-1)?.payload.text).toBe(
      "One at a time. Try again in 60 s.",
    );
  });
  it("registers only the approved command menus and update types", async () => {
    const h = harness();
    await registerCommandMenus(h.bot);
    expect(h.calls.map((call) => call.payload.scope)).toEqual([
      { type: "all_private_chats" },
      { type: "all_group_chats" },
    ]);
    expect(
      (h.calls[0]?.payload.commands as { command: string }[]).map(
        (entry) => entry.command,
      ),
    ).toEqual([
      "start",
      "xray",
      "machine",
      "feed",
      "rip",
      "link",
      "me",
      "alerts",
      "unlink",
    ]);
    expect(
      (h.calls[1]?.payload.commands as { command: string }[]).map(
        (entry) => entry.command,
      ),
    ).toEqual(["xray", "machine", "hits"]);
    expect(ALLOWED_UPDATES).toEqual([
      "message",
      "callback_query",
      "my_chat_member",
    ]);
  });
});
