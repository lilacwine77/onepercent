import "../test/setup";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LaunchGateProvider,
  useLaunchGate,
  redirectBeforeLaunch,
} from "./launch-gate";
import { LaunchCountdown } from "./LaunchCountdown";

const launchAt = Date.parse("2026-10-13T17:45:00Z");
function Probe() {
  const remaining = useLaunchGate();
  return remaining ? (
    <LaunchCountdown seconds={remaining} />
  ) : (
    <button>Connect wallet</button>
  );
}
function mount() {
  return render(
    <LaunchGateProvider>
      <Probe />
    </LaunchGateProvider>,
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(launchAt - 3_661_000);
  vi.stubEnv("VITE_LAUNCH_AT", "2026-10-13T17:45:00Z");
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("launch gate", () => {
  it("counts down before opening with tabular hours, minutes and seconds", () => {
    mount();
    expect(screen.getByRole("timer")).toHaveAccessibleName(
      "01 hours, 01 minutes, 01 seconds until the Machine opens",
    );
    expect(screen.queryByRole("button")).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("timer")).toHaveAccessibleName(
      "01 hours, 01 minutes, 00 seconds until the Machine opens",
    );
  });
  it("opens at the exact instant without a remount, including fractional seconds", () => {
    vi.setSystemTime(launchAt - 1_250);
    mount();
    act(() => vi.advanceTimersByTime(1_249));
    expect(screen.getByRole("timer")).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("timer")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Connect wallet" }),
    ).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, 1, 86_400_000])(
    "starts open at or after the launch (%s ms)",
    (elapsed) => {
      vi.setSystemTime(launchAt + elapsed);
      mount();
      expect(screen.queryByRole("timer")).toBeNull();
      expect(screen.getByRole("button")).toBeVisible();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each([undefined, "", "invalid"])(
    "starts open without a usable opening time (%s)",
    (value) => {
      vi.stubEnv("VITE_LAUNCH_AT", value);
      mount();
      expect(screen.queryByRole("timer")).toBeNull();
      expect(screen.getByRole("button")).toBeVisible();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("catches up on visibility after sleep and stays open after a clock change", () => {
    mount();
    vi.setSystemTime(launchAt + 1);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.queryByRole("timer")).toBeNull();
    vi.setSystemTime(launchAt - 60_000);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("button")).toBeVisible();
  });
  it("cleans up its timer on unmount", () => {
    const view = mount();
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    "/rip",
    "/packs",
    "/feed",
    "/x",
    "/cards",
    "/me",
    "/verify/42",
    "/live",
    "/go/abc",
    "/link/abc",
  ])("redirects %s before standalone flows can mount", (path) => {
    window.history.replaceState(null, "", path);
    redirectBeforeLaunch();
    expect(window.location.pathname).toBe("/");
  });
  it.each(["/", "/docs"])("keeps %s accessible before launch", (path) => {
    window.history.replaceState(null, "", path);
    redirectBeforeLaunch();
    expect(window.location.pathname).toBe(path);
  });
  it("preserves flow routes once open", () => {
    vi.setSystemTime(launchAt);
    window.history.replaceState(null, "", "/rip?edition=original");
    redirectBeforeLaunch();
    expect(window.location.pathname + window.location.search).toBe(
      "/rip?edition=original",
    );
  });
});
