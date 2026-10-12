import { describe, expect, it } from "vitest";
import mainnet from "./fixtures/mainnet-beta.json" with { type: "json" };
import devnet from "./fixtures/devnet.json" with { type: "json" };
import { decodeVrfQueue, VrfQueueDecodeError } from "./index.js";

const dataFor = (fixture: typeof mainnet | typeof devnet): Buffer =>
  Buffer.from(fixture.response.result.value.data[0]!, "base64");

describe("MagicBlock 0.17.3-compatible queue reader", () => {
  it("decodes the recorded mainnet shared queue without stale removed items", () => {
    expect(mainnet.source.sdkVersion).toBe("0.17.3");
    expect(mainnet.response.result.value.owner).toBe(
      "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
    );
    expect(decodeVrfQueue(dataFor(mainnet))).toEqual({
      capacityBytes: 29_976,
      usedBytes: 0,
      items: 0,
      oldestItemSlot: null,
      oldestItemTs: null,
    });
  });

  it("checks all 52 recorded devnet entries and leaves time unresolved", () => {
    expect(decodeVrfQueue(dataFor(devnet))).toEqual({
      capacityBytes: 9_476,
      usedBytes: 9_340,
      items: 52,
      oldestItemSlot: 468_400_336n,
      oldestItemTs: null,
    });
  });

  it("accepts an explicitly resolved chain block time, never a modulo guess", () => {
    const oldestItemTs = devnet.oldestBlockTime.response.result;
    expect(devnet.oldestBlockTime.slot).toBe("468400336");
    expect(decodeVrfQueue(dataFor(devnet), { oldestItemTs }).oldestItemTs).toBe(
      oldestItemTs,
    );
    expect(
      decodeVrfQueue(dataFor(mainnet), { oldestItemTs }).oldestItemTs,
    ).toBe(null);
  });

  it("excludes removed entries when selecting the oldest slot", () => {
    const bytes = dataFor(devnet);
    bytes.writeUInt32LE(51, 8);
    bytes[24 + 91] = 0;
    const result = decodeVrfQueue(bytes);
    expect(result.items).toBe(51);
    expect(result.oldestItemSlot).toBe(468_400_566n);
    expect(result.usedBytes).toBe(9_340);
  });

  it("accepts a newly allocated zero-cursor queue", () => {
    const bytes = dataFor(mainnet);
    bytes.writeUInt32LE(0, 12);
    expect(decodeVrfQueue(bytes).usedBytes).toBe(0);
  });

  it("respects sliced typed-array byte offsets", () => {
    const source = dataFor(devnet);
    const padded = new Uint8Array(source.length + 3);
    padded.set(source, 3);
    expect(decodeVrfQueue(padded.subarray(3))).toEqual(decodeVrfQueue(source));
  });

  it.each([
    ["discriminator", 0, 4],
    ["cursor", 12, 0xff],
    ["count", 8, 0xff],
    ["used", 24 + 91, 2],
    ["priority", 24 + 90, 2],
    ["identity", 24 + 92, 2],
    ["offset", 24 + 72, 0],
    ["meta length", 24 + 86, 0xff],
  ])("rejects malformed %s", (_name, offset, value) => {
    const bytes = dataFor(devnet);
    bytes[offset] = value;
    expect(() => decodeVrfQueue(bytes)).toThrow(VrfQueueDecodeError);
  });

  it("rejects truncation and invalid resolved block time", () => {
    expect(() => decodeVrfQueue(dataFor(devnet).subarray(0, 500))).toThrow();
    expect(() => decodeVrfQueue(new Uint8Array(20))).toThrow();
    expect(() =>
      decodeVrfQueue(dataFor(devnet), { oldestItemTs: NaN }),
    ).toThrow();
  });
});
