import "./setup.js";
import { describe, expect, it, vi } from "vitest";
import { createNotificationSender, type HitEvent } from "../notify/sender.js";
import { hitTemplate, royaltyTemplate } from "../notify/templates.js";
import { InMemoryBotStore } from "../store.js";
import { ADDRESS, FakeClock } from "./harness.js";

export const ROYALTY = {
  wallet: ADDRESS,
  ticker: "WIFHAT",
  lamports: 5_000_000n,
};
export const HITS: HitEvent[] = [
  {
    tier: "holo",
    buyer: ADDRESS,
    edition: "after_hours",
    stockedLamports: 4_000_000_000n,
  },
  {
    tier: "black",
    buyer: ADDRESS,
    edition: "blue_shift",
    stockedLamports: 3_750_000_000n,
  },
  {
    tier: "jackpot",
    buyer: ADDRESS,
    edition: "signature",
    onePctAmount: 123_450_000n,
  },
  { tier: "onePct", buyer: ADDRESS, edition: "after_hours" },
];
function sender() {
  const store = new InMemoryBotStore();
  const clock = new FakeClock();
  const sends: { chat: number; at: number }[] = [];
  const api = {
    sendMessage: vi.fn(async (chat: number) => {
      sends.push({ chat, at: clock.now() });
    }),
  };
  const service = createNotificationSender({
    api,
    store,
    clock,
    webUrl: "https://onepercent.test",
  });
  return { service, api, store, clock, sends };
}
async function optIn(h: ReturnType<typeof sender>, chat: number) {
  await h.store.recordStart(chat, chat);
  await h.store.setAlerts(chat, "live");
}
describe("notification sender", () => {
  it("pins every template with config amounts and multipliers", () => {
    expect(royaltyTemplate(ROYALTY).text).toBe(
      "<b>+0.005 SOL.</b> Your $WIFHAT card was pulled.\nPaid to 7xKp…d2Qa.",
    );
    expect(
      HITS.map((event) => hitTemplate(event, "https://onepercent.test").text),
    ).toEqual([
      "<b>Holo Foil 4×</b> ✳ 7xK…Qa ripped an After Hours ✳ stocked at 4 SOL",
      "<b>Black Foil 15×</b> ✳ 7xK…Qa ripped a Blue Shift ✳ stocked at 3.75 SOL",
      "<b>Jackpot</b> ✳ 7xK…Qa pulled 123.45 $1PCT from a Signature pack",
      "✨ <b>The 1%.</b> 7xK…Qa pulled 10000000 $1PCT from an After Hours pack.",
    ]);
    expect(
      hitTemplate(HITS[0]!, "https://onepercent.test").reply_markup
        ?.inline_keyboard[0]?.[0],
    ).toEqual({
      text: "Rip the same pack",
      url: "https://onepercent.test/rip?edition=after_hours",
    });
  });
  it("keeps the original edition's article for Holo and Jackpot", () => {
    expect(
      hitTemplate(
        {
          tier: "holo",
          buyer: ADDRESS,
          edition: "original",
          stockedLamports: 400_000_000n,
        },
        "https://onepercent.test",
      ).text,
    ).toBe(
      "<b>Holo Foil 4×</b> ✳ 7xK…Qa ripped The Original ✳ stocked at 0.4 SOL",
    );
    expect(
      hitTemplate(
        {
          tier: "jackpot",
          buyer: ADDRESS,
          edition: "original",
          onePctAmount: 123_450_000n,
        },
        "https://onepercent.test",
      ).text,
    ).toBe(
      "<b>Jackpot</b> ✳ 7xK…Qa pulled 123.45 $1PCT from The Original pack",
    );
    expect(
      hitTemplate(
        { tier: "onePct", buyer: ADDRESS, edition: "original" },
        "https://onepercent.test",
      ).text,
    ).toBe(
      "✨ <b>The 1%.</b> 7xK…Qa pulled 10000000 $1PCT from The Original pack.",
    );
  });
  it("does not contact an unstarted or opted-out private chat", async () => {
    const h = sender();
    expect(await h.service.royalty(42, ROYALTY)).toBe("not_started");
    expect(await h.service.hit(42, HITS[0]!)).toBe("not_started");
    await h.store.recordStart(42, 42);
    expect(await h.service.royalty(42, ROYALTY)).toBe("opted_out");
    expect(h.api.sendMessage).not.toHaveBeenCalled();
    await h.store.setAlerts(42, "live");
    expect(await h.service.royalty(42, ROYALTY)).toBe("sent");
  });
  it("requires group opt-in and a tier at least Holo", async () => {
    const h = sender();
    expect(await h.service.hit(-100, HITS[0]!)).toBe("opted_out");
    await h.store.setGroupHits(-100, true);
    expect(
      await h.service.hit(-100, {
        ...HITS[0],
        tier: "blue",
      } as unknown as HitEvent),
    ).toBe("below_min_tier");
    expect(await h.service.royalty(-100, ROYALTY)).toBe("opted_out");
    expect(h.api.sendMessage).not.toHaveBeenCalled();
    expect(await h.service.hit(-100, HITS[0]!)).toBe("sent");
  });
  it("marks 403 blocked and disables later sends", async () => {
    const h = sender();
    await optIn(h, 42);
    const mark = vi.spyOn(h.store, "markBlocked");
    h.api.sendMessage.mockRejectedValueOnce({ error_code: 403 });
    expect(await h.service.royalty(42, ROYALTY)).toBe("blocked");
    expect(mark).toHaveBeenCalledWith(42);
    expect(await h.store.hasStarted(42)).toBe(false);
    expect(await h.store.getAlerts(42)).toBe("off");
    expect(await h.service.royalty(42, ROYALTY)).toBe("not_started");
    expect(h.api.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("honours one retry_after and stops after a second 429", async () => {
    const h = sender();
    await optIn(h, 42);
    h.api.sendMessage.mockRejectedValueOnce({
      error_code: 429,
      parameters: { retry_after: 3 },
    });
    expect(await h.service.royalty(42, ROYALTY)).toBe("sent");
    expect(h.clock.now()).toBe(3000);
    const fail = sender();
    await optIn(fail, 42);
    fail.api.sendMessage.mockRejectedValue({
      error_code: 429,
      parameters: { retry_after: 2 },
    });
    expect(await fail.service.royalty(42, ROYALTY)).toBe("failed");
    expect(fail.api.sendMessage).toHaveBeenCalledTimes(2);
    expect(fail.clock.now()).toBe(2000);
  });
  it("limits parallel sends to 25 per rolling second", async () => {
    const h = sender();
    for (let chat = 1; chat <= 60; chat++) await optIn(h, chat);
    const deliveries = await Promise.all(
      Array.from({ length: 60 }, (_, i) => h.service.royalty(i + 1, ROYALTY)),
    );
    expect(deliveries.every((value) => value === "sent")).toBe(true);
    for (const send of h.sends)
      expect(
        h.sends.filter(
          (other) => other.at > send.at - 1000 && other.at <= send.at,
        ),
      ).toHaveLength(send.at < 2000 ? 25 : 10);
    expect(h.sends[25]?.at).toBe(1000);
    expect(h.sends[50]?.at).toBe(2000);
  });
  it("leaves a second between a chat's messages and caps groups at 20 per minute", async () => {
    const h = sender();
    await optIn(h, 42);
    await Promise.all(
      Array.from({ length: 3 }, () => h.service.royalty(42, ROYALTY)),
    );
    expect(h.sends.map((send) => send.at)).toEqual([0, 1000, 2000]);
    const group = sender();
    await group.store.setGroupHits(-100, true);
    await Promise.all(
      Array.from({ length: 21 }, () => group.service.hit(-100, HITS[0]!)),
    );
    expect(group.sends[19]?.at).toBe(19_000);
    expect(group.sends[20]?.at).toBe(60_000);
  });
  it("honours an opt-out while a send is waiting for its slot", async () => {
    const h = sender();
    await optIn(h, 42);
    await h.service.royalty(42, ROYALTY);
    h.clock.sleep = async (ms) => {
      h.clock.advance(ms);
      await h.store.setAlerts(42, "off");
    };
    expect(await h.service.royalty(42, ROYALTY)).toBe("opted_out");
    expect(h.api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
