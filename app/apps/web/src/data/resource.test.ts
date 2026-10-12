import "../test/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEB } from "@onepercent/config/web";
import { Resource, resource } from "./resource";
import { flagEnabled } from "./flags";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("resource cache and polling", () => {
  const stops: (() => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("deduplicates requests and keeps the last value during a failed revalidation", async () => {
    const first = deferred<string>();
    const load = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error("Offline"));
    const value = new Resource<string>(load);
    const pending = value.refresh();
    expect(value.refresh()).toBe(pending);
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve("cached");
    await pending;
    expect(value.snapshot()).toEqual({ data: "cached", loading: false });
    await value.refresh();
    expect(value.snapshot()).toMatchObject({
      data: "cached",
      loading: false,
      error: expect.any(Error),
    });
  });
  it("aborts invalidated reads, discards late data and preserves new in-flight dedupe", async () => {
    const old = deferred<string>();
    const current = deferred<string>();
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? old.promise : current.promise;
    });
    const value = new Resource<string>(load);
    const oldFlight = value.refresh();
    value.invalidate();
    expect(signals[0]?.aborted).toBe(true);
    const currentFlight = value.refresh();
    old.resolve("stale");
    await oldFlight;
    expect(value.snapshot().data).toBeUndefined();
    expect(value.refresh()).toBe(currentFlight);
    expect(load).toHaveBeenCalledTimes(2);
    current.resolve("fresh");
    await currentFlight;
    expect(value.snapshot().data).toBe("fresh");
  });
  it("uses visible and hidden intervals, refreshes on return and stops unused polls", async () => {
    const load = vi.fn(async () => "value");
    const value = new Resource(load);
    const stop = value.subscribe(vi.fn());
    stops.push(stop);
    await value.refresh();
    await vi.advanceTimersByTimeAsync(WEB.machinePollMs);
    expect(load).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(WEB.machinePollHiddenMs - 1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await value.refresh();
    expect(load).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(WEB.machinePollHiddenMs);
    expect(load).toHaveBeenCalledTimes(4);
  });
  it("shares one resource for the same URL", () => {
    const load = vi.fn(async () => "value");
    expect(resource("/test/cache-identity", load)).toBe(
      resource("/test/cache-identity", load),
    );
  });
});

it("flags fail closed when config is missing, invalid or stale after an error", () => {
  expect(flagEnabled({}, "XRAY")).toBe(false);
  expect(
    flagEnabled(
      { data: { flags: { XRAY: true } }, error: new Error("Offline") },
      "XRAY",
    ),
  ).toBe(false);
  expect(flagEnabled({ data: { flags: { XRAY: false } } }, "XRAY")).toBe(false);
  expect(flagEnabled({ data: { flags: { XRAY: true } } }, "XRAY")).toBe(true);
});
