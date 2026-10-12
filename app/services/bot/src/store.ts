import type { ReferralCode } from "./referral.js";
import { MEMORY_ENTRY_LIMIT } from "./memory.js";
export type AlertMode = "off" | "live" | "daily";
export interface BotStore {
  recordStart(userId: number, chatId: number): Promise<void>;
  hasStarted(chatId: number): Promise<boolean>;
  setPendingReferral(userId: number, code: ReferralCode): Promise<boolean>;
  getPendingReferral(userId: number): Promise<ReferralCode | null>;
  setAlerts(userId: number, mode: AlertMode): Promise<void>;
  getAlerts(userId: number): Promise<AlertMode>;
  setGroupHits(chatId: number, on: boolean): Promise<void>;
  getGroupHits(chatId: number): Promise<boolean>;
  markBlocked(chatId: number): Promise<void>;
  migrateChat(from: number, to: number): Promise<void>;
}
// No message content is retained.
export class InMemoryBotStore implements BotStore {
  private readonly started = new Map<number, number>();
  private readonly referrals = new Map<number, ReferralCode>();
  private readonly alerts = new Map<number, AlertMode>();
  private readonly hits = new Map<number, boolean>();
  constructor(private readonly maxEntries = MEMORY_ENTRY_LIMIT) {}
  private reserve<K, V>(map: Map<K, V>, key: K): void {
    if (!map.has(key) && map.size >= this.maxEntries)
      throw new Error("Bot storage capacity reached");
  }
  async recordStart(userId: number, chatId: number): Promise<void> {
    this.reserve(this.started, chatId);
    this.started.set(chatId, userId);
  }
  async hasStarted(chatId: number): Promise<boolean> {
    return this.started.has(chatId);
  }
  async setPendingReferral(
    userId: number,
    code: ReferralCode,
  ): Promise<boolean> {
    if (this.referrals.has(userId)) return false;
    this.reserve(this.referrals, userId);
    this.referrals.set(userId, code);
    return true;
  }
  async getPendingReferral(userId: number): Promise<ReferralCode | null> {
    return this.referrals.get(userId) ?? null;
  }
  async setAlerts(userId: number, mode: AlertMode): Promise<void> {
    if (mode === "off") {
      this.alerts.delete(userId);
      return;
    }
    this.reserve(this.alerts, userId);
    this.alerts.set(userId, mode);
  }
  async getAlerts(userId: number): Promise<AlertMode> {
    return this.alerts.get(userId) ?? "off";
  }
  async setGroupHits(chatId: number, on: boolean): Promise<void> {
    if (!on) {
      this.hits.delete(chatId);
      return;
    }
    this.reserve(this.hits, chatId);
    this.hits.set(chatId, on);
  }
  async getGroupHits(chatId: number): Promise<boolean> {
    return this.hits.get(chatId) ?? false;
  }
  async migrateChat(from: number, to: number): Promise<void> {
    if (from === to) return;
    if (this.hits.has(from)) {
      this.reserve(this.hits, to);
      this.hits.set(to, this.hits.get(from)!);
      this.hits.delete(from);
    }
  }
  async markBlocked(chatId: number): Promise<void> {
    this.alerts.delete(this.started.get(chatId) ?? chatId);
    this.started.delete(chatId);
    this.hits.delete(chatId);
  }
}
