import "../test/setup";
import { lazy, Suspense } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isChunkError, page, reloadOnce } from "./chunk-reload";
import { ErrorBoundary } from "./ErrorBoundary";

let reload: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sessionStorage.clear();
  reload = vi.spyOn(page, "reload").mockImplementation(() => undefined);
});
afterEach(() => reload.mockRestore());

const stale = new TypeError(
  "Failed to fetch dynamically imported module: https://dev.example/assets/Cards-1a2b3c.js",
);

describe("stale chunks after a deploy", () => {
  it("recognises a chunk 404 in each browser's words", () => {
    expect(isChunkError(stale)).toBe(true);
    expect(
      isChunkError(new TypeError("error loading dynamically imported module")),
    ).toBe(true);
    expect(
      isChunkError(new TypeError("Importing a module script failed.")),
    ).toBe(true);
    expect(
      isChunkError(new Error("Unable to preload CSS for /assets/x.css")),
    ).toBe(true);
    expect(isChunkError(new Error("Cannot read properties of undefined"))).toBe(
      false,
    );
    expect(isChunkError(null)).toBe(false);
  });

  it("reloads once, then lets a second failure through within 30 s", () => {
    expect(reloadOnce(1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(reloadOnce(1_010_000)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    // A later deploy, a later stale chunk: reload again.
    expect(reloadOnce(1_031_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads without sessionStorage (no guard, no loop)", () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(reloadOnce()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    get.mockRestore();
  });

  it("makes Try again a full reload when a chunk is gone, and a re-render otherwise", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Gone = lazy(() => Promise.reject(stale));
    render(
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Gone />
        </Suspense>
      </ErrorBoundary>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledOnce();

    let fail = true;
    function Flaky() {
      if (fail) throw new Error("render failed");
      return <p>Back</p>;
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    fail = false;
    fireEvent.click(
      screen.getAllByRole("button", { name: "Try again" }).at(-1)!,
    );
    expect(await screen.findByText("Back")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledOnce();
  });
});
