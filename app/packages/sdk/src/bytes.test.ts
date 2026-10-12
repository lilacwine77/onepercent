import { describe, expect, it } from "vitest";
import { bytesEqual, bytesFromBase64, bytesToHex, bytesView } from "./bytes.js";

describe("portable byte readers", () => {
  it("keeps slice offsets and signed little-endian integer values", () => {
    const storage = new Uint8Array(12).fill(255);
    const bytes = storage.subarray(2, 10);
    bytesView(bytes).setBigInt64(0, -(1n << 63n), true);
    expect(bytesView(bytes).getBigInt64(0, true)).toBe(-(1n << 63n));
    expect(bytesView(bytes).getBigUint64(0, true)).toBe(1n << 63n);
    expect(bytesToHex(bytes)).toBe("0000000000000080");
    expect(storage[1]).toBe(255);
    expect(storage[10]).toBe(255);
  });

  it("preserves strict canonical base64 and byte equality", () => {
    expect(bytesFromBase64("AP+A")).toEqual(Uint8Array.of(0, 255, 128));
    for (const invalid of ["AB==", "AAA", "AA==\n", "!bad"])
      expect(() => bytesFromBase64(invalid)).toThrow();
    expect(bytesEqual(Uint8Array.of(0, 255), Uint8Array.of(0, 255))).toBe(true);
    expect(bytesEqual(Uint8Array.of(0), Uint8Array.of(0, 0))).toBe(false);
    expect(bytesEqual(Uint8Array.of(0, 1), Uint8Array.of(0, 2))).toBe(false);
  });
});
