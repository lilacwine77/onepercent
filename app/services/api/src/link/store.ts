import { randomBytes } from "node:crypto";
import { BOT, BOT_OPS } from "@onepercent/config";

export const SESSION_TTL_SECONDS = BOT.sessionTtlSeconds;
export const MAX_LIVE_NONCES = 10_000;
export const MAX_NONCE_ENTRIES = 20_000;
export const CLOSED_NONCE_GRACE_MS = BOT_OPS.closedIdGraceSeconds * 1_000;
export const MAX_WALLET_BINDINGS = 10_000;
export type Clock = () => number;
export interface LinkSession {
  nonce: string;
  telegramUserId: number;
  botUsername: string;
  issuedAt: string;
  expiresAt: string;
}
export type NonceResult =
  { status: "open"; session: LinkSession } | { status: "missing" | "gone" };
export interface WalletBinding {
  wallet: string;
  linkedAt: string;
}
export interface LinkStore {
  createNonce(
    telegramUserId: number,
    botUsername: string,
  ): Promise<LinkSession>;
  peekNonce(nonce: string): Promise<NonceResult>;
  takeNonce(nonce: string): Promise<NonceResult>;
  bind(telegramUserId: number, wallet: string): Promise<void>;
  walletOf(telegramUserId: number): Promise<WalletBinding | null>;
  telegramOf(wallet: string): Promise<number | null>;
  unbind(telegramUserId: number): Promise<boolean>;
  purge(now: number): Promise<number>;
}

export class InMemoryLinkStore implements LinkStore {
  private readonly open = new Map<string, LinkSession>();
  private readonly openByUser = new Map<number, string>();
  private lastCleanup = -Infinity;
  // Opaque closed identifiers remain 410 through the original expiry plus grace.
  private readonly closed = new Map<string, number>();
  private readonly users = new Map<number, WalletBinding>();
  private readonly wallets = new Map<string, number>();
  constructor(
    private readonly clock: Clock = Date.now,
    private readonly capacity = {
      liveNonces: MAX_LIVE_NONCES,
      nonceEntries: MAX_NONCE_ENTRIES,
      bindings: MAX_WALLET_BINDINGS,
    },
  ) {}

  private cleanup(now: number): void {
    if (now - this.lastCleanup < 1_000) return;
    this.lastCleanup = now;
    for (const [nonce, session] of this.open)
      if (Date.parse(session.expiresAt) <= now) this.close(nonce, now);
    for (const [nonce, expiresAt] of this.closed)
      if (expiresAt <= now) this.closed.delete(nonce);
  }

  async createNonce(
    telegramUserId: number,
    botUsername: string,
  ): Promise<LinkSession> {
    const now = this.clock();
    this.cleanup(now);
    const earlier = this.openByUser.get(telegramUserId);
    // Reserve the new record before invalidating any existing session.
    if (
      (this.open.size >= this.capacity.liveNonces && !earlier) ||
      this.open.size + this.closed.size >= this.capacity.nonceEntries
    )
      throw new Error("Link capacity reached");
    if (earlier) this.close(earlier, now);
    const expiresAt = now + SESSION_TTL_SECONDS * 1_000;
    const session: LinkSession = {
      nonce: randomBytes(16).toString("hex"),
      telegramUserId,
      botUsername,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
    this.open.set(session.nonce, session);
    this.openByUser.set(telegramUserId, session.nonce);
    return { ...session };
  }

  async peekNonce(nonce: string): Promise<NonceResult> {
    return this.peek(nonce);
  }
  async takeNonce(nonce: string): Promise<NonceResult> {
    // No await between lookup and removal: concurrent requests cannot both take it.
    const result = this.peek(nonce);
    if (result.status === "open") this.close(nonce, this.clock());
    return result;
  }
  private peek(nonce: string): NonceResult {
    const now = this.clock();
    this.cleanup(now);
    const session = this.open.get(nonce);
    if (!session) {
      if ((this.closed.get(nonce) ?? Infinity) <= now)
        this.closed.delete(nonce);
      return { status: this.closed.has(nonce) ? "gone" : "missing" };
    }
    if (Date.parse(session.expiresAt) <= now) {
      this.close(nonce, now);
      return { status: this.closed.has(nonce) ? "gone" : "missing" };
    }
    return { status: "open", session: { ...session } };
  }
  private close(nonce: string, now: number): void {
    const session = this.open.get(nonce);
    if (!session) return;
    this.openByUser.delete(session.telegramUserId);
    this.open.delete(nonce);
    const retentionUntil =
      Date.parse(session.expiresAt) + CLOSED_NONCE_GRACE_MS;
    if (retentionUntil > now) this.closed.set(nonce, retentionUntil);
  }
  async bind(telegramUserId: number, wallet: string): Promise<void> {
    const oldWallet = this.users.get(telegramUserId)?.wallet;
    const oldUser = this.wallets.get(wallet);
    if (
      !oldWallet &&
      oldUser === undefined &&
      this.users.size >= this.capacity.bindings
    )
      throw new Error("Link binding capacity reached");
    if (oldWallet) this.wallets.delete(oldWallet);
    if (oldUser !== undefined) this.users.delete(oldUser);
    this.users.set(telegramUserId, {
      wallet,
      linkedAt: new Date(this.clock()).toISOString(),
    });
    this.wallets.set(wallet, telegramUserId);
  }
  async walletOf(telegramUserId: number): Promise<WalletBinding | null> {
    const value = this.users.get(telegramUserId);
    return value ? { ...value } : null;
  }
  async purge(now: number): Promise<number> {
    const before = this.open.size + this.closed.size;
    this.lastCleanup = -Infinity;
    this.cleanup(now);
    return before - this.open.size - this.closed.size;
  }
  async unbind(telegramUserId: number): Promise<boolean> {
    const wallet = this.users.get(telegramUserId)?.wallet;
    if (!wallet) return false;
    this.users.delete(telegramUserId);
    this.wallets.delete(wallet);
    return true;
  }
  async telegramOf(wallet: string): Promise<number | null> {
    return this.wallets.get(wallet) ?? null;
  }
}
