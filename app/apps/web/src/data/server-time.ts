import { z } from "zod";
import { WEB } from "@onepercent/config/web";
import { api } from "./api";
const reply = z.object({ result: z.number().int().nonnegative() });
export class ServerTime {
  private offset: number | null = null;
  constructor(private readonly now = Date.now) {}
  async refresh(signal?: AbortSignal) {
    const rpc = (method: string, params: unknown[]) =>
      api("/api/rpc", reply, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal,
      });
    try {
      const slot = await rpc("getSlot", [{ commitment: "confirmed" }]);
      const time = await rpc("getBlockTime", [slot.result]);
      this.offset = time.result * WEB.millisecondsPerSecond - this.now();
    } catch {
      this.offset = null;
    }
  }
  nowMs() {
    return this.offset === null ? null : this.now() + this.offset;
  }
}
export const serverTime = new ServerTime();
