import "../../test/setup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrameBudget, watchFrameBudget } from "./frame-budget";

afterEach(() => vi.restoreAllMocks());

describe("machine frame budget", () => {
  it("keeps smooth rendering and tolerates two isolated slow frames", () => {
    const budget = new FrameBudget(0);
    for (let now = 16; now <= 4_000; now += 16)
      expect(budget.sample(now)).toBe(false);
    expect(budget.sample(4_200)).toBe(false);
    expect(budget.sample(4_400)).toBe(false);
    for (let now = 4_416; now <= 6_800; now += 16)
      expect(budget.sample(now)).toBe(false);
    expect(budget.sample(7_000)).toBe(false);
  });
  it("falls back on the third frame over 150 ms within two seconds", () => {
    const budget = new FrameBudget(0);
    expect(budget.sample(160)).toBe(false);
    expect(budget.sample(320)).toBe(false);
    expect(budget.sample(480)).toBe(true);
  });
  it("also detects a one-second startup stall and later warm-up stalls", () => {
    expect(new FrameBudget(0).sample(1_000)).toBe(true);
    const budget = new FrameBudget(0);
    for (let now = 10; now <= 5_000; now += 10) budget.sample(now);
    expect(budget.sample(5_160)).toBe(false);
    expect(budget.sample(5_320)).toBe(false);
    expect(budget.sample(5_480)).toBe(true);
  });
  it("does not count hidden time or pre-hide slow frames", () => {
    const budget = new FrameBudget(0);
    budget.sample(160);
    budget.sample(320);
    expect(budget.sample(10_000, false)).toBe(false);
    expect(budget.sample(10_160)).toBe(false);
  });
  it("stops scheduling frames after fallback or unmount", () => {
    let callback: FrameRequestCallback = () => {};
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => {
        callback = cb;
        return 1;
      });
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const fallback = vi.fn();
    vi.spyOn(performance, "now").mockReturnValue(0);
    const stop = watchFrameBudget(fallback);
    callback(160);
    callback(320);
    callback(480);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(raf).toHaveBeenCalledTimes(3);
    callback(640);
    expect(fallback).toHaveBeenCalledTimes(1);
    stop();
    expect(cancel).toHaveBeenCalled();
    const stopNext = watchFrameBudget(fallback);
    stopNext();
    callback(1_500);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
