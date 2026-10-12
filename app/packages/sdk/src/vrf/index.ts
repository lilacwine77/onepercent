/** Layout verified against recorded mainnet/devnet accounts; see fixtures. */
const DISCRIMINATOR_BYTES = 8;
const ITEMS_START = 16;
const ITEM_BYTES = 96;
const META_BYTES = 33;
const MAX_METAS = 25;
const MAX_ARGS = 512;
const align8 = (value: number): number => Math.ceil(value / 8) * 8;

export interface VrfQueue {
  capacityBytes: number;
  /** Allocated byte range, including internal holes, conservative for fullness. */
  usedBytes: number;
  items: number;
  oldestItemTs: number | null;
  /** Resolve with getBlockTime; u16 creation stamps wrap and can be absent. */
  oldestItemSlot: bigint | null;
}

export interface VrfQueueOptions {
  /** Chain getBlockTime result for the decoded oldestItemSlot, when available. */
  oldestItemTs?: number | null;
}

export class VrfQueueDecodeError extends Error {
  constructor(reason: string) {
    super(`Invalid VRF queue: ${reason}`);
    this.name = "VrfQueueDecodeError";
  }
}

function requireLayout(condition: boolean, reason: string): void {
  if (!condition) throw new VrfQueueDecodeError(reason);
}

/**
 * MagicBlock Queue/QueueItem wire layout, compatible with SDK 0.17.3.
 * Account ownership must be checked by the RPC caller. The program source is
 * pinned in fixtures because the SDK itself only publishes request types.
 * Absolute timestamps require getBlockTime: the queue stores a slot and a
 * four-second u16 creation stamp, with zero padding in older active requests.
 */
export function decodeVrfQueue(
  data: Uint8Array,
  options: VrfQueueOptions = {},
): VrfQueue {
  requireLayout(
    data.length >= DISCRIMINATOR_BYTES + ITEMS_START,
    "short header",
  );
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  requireLayout(view.getBigUint64(0, true) === 3n, "discriminator");
  const bodyBytes = data.length - DISCRIMINATOR_BYTES;
  const items = view.getUint32(DISCRIMINATOR_BYTES, true);
  const storedCursor = view.getUint32(DISCRIMINATOR_BYTES + 4, true);
  const cursor = storedCursor === 0 ? ITEMS_START : storedCursor;
  requireLayout(cursor >= ITEMS_START && cursor <= bodyBytes, "cursor bounds");
  requireLayout(view.getUint8(DISCRIMINATOR_BYTES + 9) <= 1, "paused flag");
  requireLayout(
    items <= Math.floor((cursor - ITEMS_START) / ITEM_BYTES),
    "item count bounds",
  );

  let position = ITEMS_START;
  let counted = 0;
  let oldestItemSlot: bigint | null = null;
  while (position < cursor) {
    requireLayout(position + ITEM_BYTES <= cursor, "truncated item");
    const start = DISCRIMINATOR_BYTES + position;
    const discriminatorOffset = view.getUint32(start + 72, true);
    const metasOffset = view.getUint32(start + 76, true);
    const argsOffset = view.getUint32(start + 80, true);
    const discriminatorLength = view.getUint16(start + 84, true);
    const metasLength = view.getUint16(start + 86, true);
    const argsLength = view.getUint16(start + 88, true);
    const used = view.getUint8(start + 91);
    requireLayout(used <= 1, "used flag");
    requireLayout(view.getUint8(start + 90) <= 1, "priority flag");
    requireLayout(view.getUint8(start + 92) <= 1, "identity mode");
    requireLayout(
      metasLength <= MAX_METAS && argsLength <= MAX_ARGS,
      "item size",
    );
    requireLayout(
      discriminatorOffset === position + ITEM_BYTES &&
        metasOffset === discriminatorOffset + discriminatorLength &&
        argsOffset === metasOffset + metasLength * META_BYTES,
      "item offsets",
    );
    const end = argsOffset + argsLength;
    requireLayout(end <= cursor && end <= bodyBytes, "item payload bounds");
    if (used === 1) {
      counted++;
      const slot = view.getBigUint64(start, true);
      if (oldestItemSlot === null || slot < oldestItemSlot)
        oldestItemSlot = slot;
    }
    position = align8(end);
    // An append may leave cursor before alignment; removals retain aligned ends.
    requireLayout(position <= align8(cursor), "next item bounds");
  }
  requireLayout(counted === items, "active count mismatch");
  const timestamp = options.oldestItemTs ?? null;
  requireLayout(
    timestamp === null || (Number.isSafeInteger(timestamp) && timestamp >= 0),
    "block time",
  );
  return {
    capacityBytes: bodyBytes - ITEMS_START,
    usedBytes: cursor - ITEMS_START,
    items,
    oldestItemTs: oldestItemSlot === null ? null : timestamp,
    oldestItemSlot,
  };
}
