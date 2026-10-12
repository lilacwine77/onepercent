import { CARD_KINDS, PACK_EDITIONS, UI } from "@onepercent/config";
import { shortTv } from "@onepercent/copy";
import { decodeStreamEvent } from "@onepercent/sdk/api";

export interface TvEvent {
  id: string;
  kind: "pull" | "feed" | "system";
  tier?: (typeof CARD_KINDS)[number];
  edition?: (typeof PACK_EDITIONS)[number]["id"];
  who: string;
  ticker?: string;
  lamports?: bigint;
  sig: string;
  slot: number;
  ts: number | null;
  announce: boolean;
}

/** Called only with S1's confirmed stream envelope; no wall clock or synthetic entry. */
export function tvEvent(
  input: unknown,
  metadata: { ticker?: string; blockTime?: number; buyer?: string } = {},
): TvEvent | null {
  const event = decodeStreamEvent(input);
  const data = event.data;
  const base = {
    id: event.id,
    sig: data.signature,
    slot: data.asOfSlot,
    ts: metadata.blockTime ?? null,
  };
  const ticker = metadata.ticker
    ?.toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, UI.tickerMaxChars);
  if (data.name === "BagFed" || data.name === "CardFedBack")
    return {
      ...base,
      kind: "feed",
      who: shortTv(data.name === "BagFed" ? data.depositor : data.owner),
      announce: false,
      ...(ticker ? { ticker } : {}),
    };
  if (data.name === "PackRevealed") {
    const tier = CARD_KINDS[data.tier];
    const edition = PACK_EDITIONS[data.edition];
    if (!tier || tier === "spotlight" || !edition || !metadata.buyer)
      return null;
    return {
      ...base,
      kind: "pull",
      tier,
      edition: edition.id,
      who: shortTv(metadata.buyer),
      lamports: BigInt(data.hit_value),
      announce: !["dust", "silver", "blue"].includes(tier),
      ...(ticker ? { ticker } : {}),
    };
  }
  if (data.name === "PhaseAdvanced")
    return { ...base, kind: "system", who: "", announce: false };
  return null;
}

/** A reveal's buyer comes from its own successful callback, including on reconnect. */
export function tvEvents(inputs: readonly unknown[]): TvEvent[] {
  const events = inputs.map((input) => decodeStreamEvent(input));
  const buyers = new Map(
    events.flatMap(({ data }) =>
      data.name === "PullRevealed"
        ? [[`${data.signature}:${data.seq}`, data.buyer] as const]
        : [],
    ),
  );
  const seen = new Set<string>();
  return events.flatMap((event) => {
    if (seen.has(event.id)) return [];
    seen.add(event.id);
    const buyer =
      event.data.name === "PackRevealed"
        ? buyers.get(`${event.data.signature}:${event.data.seq}`)
        : undefined;
    const entry = tvEvent(event, buyer ? { buyer } : {});
    return entry ? [entry] : [];
  });
}
