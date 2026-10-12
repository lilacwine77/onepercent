import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:https", () => ({ request: network.request }));
import { downloadLogo } from "./logo.js";
afterEach(() => vi.clearAllMocks());
function response(
  statusCode: number,
  headers: Record<string, string>,
  bytes: Uint8Array,
) {
  const incoming = Object.assign(new EventEmitter(), {
    statusCode,
    headers,
    destroy: vi.fn(),
  });
  network.request.mockImplementation(
    (
      _url: URL,
      _options: RequestOptions,
      callback: (value: typeof incoming) => void,
    ) =>
      Object.assign(new EventEmitter(), {
        end: () => {
          callback(incoming);
          if (statusCode === 200) {
            incoming.emit("data", Buffer.from(bytes));
            incoming.emit("end");
          }
        },
      }),
  );
  return incoming;
}
describe("native logo transport", () => {
  it("blocks all network requests when DNS resolves to any private address", async () => {
    network.lookup.mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      downloadLogo(new URL("https://ipfs.io/a"), new AbortController().signal),
    ).rejects.toThrow("Logo address refused");
    expect(network.request).not.toHaveBeenCalled();
  });
  it("never follows a redirect even when its initial host is allowed", async () => {
    network.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    const incoming = response(
      302,
      { location: "http://169.254.169.254/metadata" },
      new Uint8Array(),
    );
    await expect(
      downloadLogo(new URL("https://ipfs.io/a"), new AbortController().signal),
    ).rejects.toThrow("Logo response refused");
    expect(network.request).toHaveBeenCalledTimes(1);
    expect(incoming.destroy).toHaveBeenCalledTimes(1);
  });
  it("pins every public IPv4 and IPv6 candidate for automatic connection fallback", async () => {
    const addresses = [
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700::1111", family: 6 },
      { address: "1.0.0.1", family: 4 },
    ];
    network.lookup.mockResolvedValue(addresses);
    response(200, {}, new Uint8Array([1, 2, 3]));
    expect(
      await downloadLogo(
        new URL("https://ipfs.io/a"),
        new AbortController().signal,
      ),
    ).toEqual(Buffer.from([1, 2, 3]));
    const options = network.request.mock.calls[0]?.[1] as RequestOptions;
    expect(options).toMatchObject({ autoSelectFamily: true });
    expect(options.lookup).toBeTypeOf("function");
    const lookup = options.lookup as (
      hostname: string,
      options: { all?: boolean },
      callback: (...args: unknown[]) => void,
    ) => void;
    const callback = vi.fn();
    lookup("ipfs.io", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, addresses);
    lookup("ipfs.io", {}, callback);
    expect(callback).toHaveBeenLastCalledWith(null, "1.1.1.1", 4);
    expect(network.lookup).toHaveBeenCalledTimes(1);
  });
});
