import { SERVICES, STOCK, BPS_DENOMINATOR } from "@onepercent/config";
import {
  EXTERNAL_IDS,
  PYTH_PRICE_UPDATE_V2_DISCRIMINATOR,
} from "@onepercent/sdk";
import type { ExecAccountReading } from "@onepercent/sdk/server";
export function freshSponsored(
  account: ExecAccountReading,
  feed: Uint8Array,
  now: bigint,
): boolean {
  const data = Buffer.from(account.data);
  if (
    !account.owner.equals(EXTERNAL_IDS.pythReceiver) ||
    data.length < 133 ||
    !data
      .subarray(0, 8)
      .equals(Buffer.from(PYTH_PRICE_UPDATE_V2_DISCRIMINATOR)) ||
    data[40] !== 1 ||
    !data.subarray(41, 73).equals(Buffer.from(feed))
  )
    return false;
  const time = data.readBigInt64LE(93),
    price = data.readBigInt64LE(73),
    conf = data.readBigUInt64LE(81),
    exponent = data.readInt32LE(89);
  return (
    time <= now &&
    now - time <= BigInt(SERVICES.stock.pythSkipAgeSeconds) &&
    price > 0n &&
    exponent >= -18 &&
    exponent <= 0 &&
    conf * BigInt(BPS_DENOMINATOR) <= price * BigInt(STOCK.pythMaxConfBps)
  );
}
/** A missing observation keeps the previous condition until fresh evidence clears it. */
export class PersistentConditions {
  readonly first = new Map<string, bigint>();
  observe(name: string, bad: boolean | null, now: bigint): boolean {
    if (bad === false) {
      this.first.delete(name);
      return false;
    }
    if (bad === true && !this.first.has(name)) this.first.set(name, now);
    const start = this.first.get(name);
    return (
      start !== undefined &&
      now - start >= BigInt(SERVICES.monitor.stockConditionAlertSeconds)
    );
  }
}
