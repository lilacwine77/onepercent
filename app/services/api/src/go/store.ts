import { randomBytes } from "node:crypto";
import { CLOSED_NONCE_GRACE_MS, SESSION_TTL_SECONDS } from "../link/store.js";
import { GoInputSchema, type GoInput } from "./schema.js";
export type GoCreated = { id: string; expiresAt: string };
export type GoResult =
  { status: "open"; session: GoInput } | { status: "gone" | "missing" };
export interface GoStore {
  create(input: GoInput, count: 1 | 2 | 3, now: number): Promise<GoCreated[]>;
  redeem(id: string, now: number): Promise<GoResult>;
  purge(now: number): Promise<number>;
}
export class InMemoryGoStore implements GoStore {
  private readonly rows = new Map<
    string,
    { input: GoInput; expiresAt: number; used: boolean }
  >();
  constructor(private readonly capacity = 20_000) {}
  async create(
    input: GoInput,
    count: 1 | 2 | 3,
    now: number,
  ): Promise<GoCreated[]> {
    const parsed = GoInputSchema.parse(input);
    await this.purge(now);
    if (this.rows.size + count > this.capacity)
      throw new Error("Session capacity reached");
    return Array.from({ length: count }, () => {
      const id = randomBytes(16).toString("hex");
      const expiresAt = now + SESSION_TTL_SECONDS * 1_000;
      this.rows.set(id, { input: parsed, expiresAt, used: false });
      return { id, expiresAt: new Date(expiresAt).toISOString() };
    });
  }
  async redeem(id: string, now: number): Promise<GoResult> {
    const row = this.rows.get(id);
    if (!row || row.expiresAt + CLOSED_NONCE_GRACE_MS <= now)
      return { status: "missing" };
    if (row.used || row.expiresAt <= now) return { status: "gone" };
    row.used = true;
    return { status: "open", session: { ...row.input } };
  }
  async purge(now: number): Promise<number> {
    let removed = 0;
    for (const [id, row] of this.rows) {
      if (row.expiresAt + CLOSED_NONCE_GRACE_MS < now) {
        this.rows.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
