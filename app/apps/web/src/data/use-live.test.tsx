import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WEB } from "@onepercent/config/web";
import { LiveStream, type SseHandlers } from "./stream";
import { useLive } from "./use-live";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("fetch", () => {
    throw new Error("Unmocked network in unit test");
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("subscribes only when enabled, rerenders on staleness and shares one connection", async () => {
  let handlers!: SseHandlers;
  const close = vi.fn();
  const connect = vi.fn((value: SseHandlers) => {
    handlers = value;
    return { close };
  });
  const stream = new LiveStream(undefined, { connect });
  const one = renderHook(({ enabled }) => useLive(enabled, stream), {
    initialProps: { enabled: false },
  });
  expect(connect).not.toHaveBeenCalled();
  expect(one.result.current.onAir).toBe(false);
  one.rerender({ enabled: true });
  const two = renderHook(() => useLive(true, stream));
  expect(connect).toHaveBeenCalledTimes(1);
  act(() => handlers.onEvent("ping", "", "{}"));
  expect(one.result.current.onAir).toBe(true);
  expect(two.result.current.lastEvent).toBeNull();
  const event = { event: "feed", id: "1-0-0", data: { seq: "1" } };
  act(() => handlers.onEvent("feed", event.id, JSON.stringify(event)));
  expect(two.result.current.lastEvent).toEqual(event);
  await act(() => vi.advanceTimersByTimeAsync(WEB.liveStaleAfterMs - 1));
  act(() => handlers.onEvent("ping", "", JSON.stringify({ ts: 0 })));
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(one.result.current.onAir).toBe(true);
  expect(two.result.current.lastEvent).toEqual(event);
  await act(() => vi.advanceTimersByTimeAsync(WEB.liveStaleAfterMs));
  expect(one.result.current.onAir).toBe(false);
  one.rerender({ enabled: false });
  expect(close).not.toHaveBeenCalled();
  expect(one.result.current.mode).toBe("stopped");
  two.unmount();
  expect(close).toHaveBeenCalledTimes(1);
});
