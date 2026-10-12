import "../../test/setup";
import { act, Suspense } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RipResult } from "./module/types";

const stage = vi.hoisted(() => ({
  fallback: null as null | (() => void),
  destroy: vi.fn(),
  stopBudget: vi.fn(),
  setResult: vi.fn(),
  play: vi.fn(),
  callbacks: new Map<string, (...args: unknown[]) => void>(),
  resolve: null as null | (() => void),
}));
vi.mock("../../app/decode-image", () => {
  const ready = Promise.resolve();
  return { decodeImage: () => ready };
});
vi.mock("./frame-budget", () => ({
  watchFrameBudget: (fallback: () => void) => {
    stage.fallback = fallback;
    return stage.stopBudget;
  },
}));
vi.mock("./sound", () => ({ playCue: vi.fn(), unlockAudio: vi.fn() }));
vi.mock("./module/ui-motion", () => ({
  pressable: () => () => {},
  pulse: vi.fn(),
}));
vi.mock("./module/index", () => ({
  ripAssets: () => ({}),
  mountRip: () => ({
    on: (name: string, callback: (...args: unknown[]) => void) => {
      stage.callbacks.set(name, callback);
      return () => stage.callbacks.delete(name);
    },
    destroy: stage.destroy,
    setInsets: vi.fn(),
    setReducedMotion: vi.fn(),
    setRevealMode: vi.fn(),
    setTurbo: vi.fn(),
    enableMotion: vi.fn(),
    reset: vi.fn(),
    fail: vi.fn(),
    setActionState: vi.fn(),
    animateSellBack: vi.fn(async () => {}),
    animateAction: vi.fn(async () => {}),
    play: (...args: unknown[]) => {
      stage.play(...args);
      return new Promise<void>((resolve) => {
        stage.resolve = resolve;
      });
    },
    setResult: (result: RipResult) => {
      stage.setResult(result);
      queueMicrotask(() => {
        stage.callbacks.get("beat")?.("end");
        stage.resolve?.();
      });
    },
  }),
}));
import RipView, { type RipViewProps } from "./RipView";
import { WEB } from "@onepercent/config/web";
import { t } from "@onepercent/copy";
import { useLocation } from "../../routes/router";
import { replaceRipSelection } from "../../bridge/rip-selection";
import { ripPreview } from "../../adapters/rip-preview";
import { short } from "@onepercent/copy";

const result = (symbol: string): RipResult => ({
  dust: [],
  hit: {
    tier: "silver",
    symbol,
    amountUi: "10",
    logoUrl: "",
    valueSolUi: null,
  },
});
const props = () => ({
  edition: "original" as const,
  quantity: 1,
  balanceUi: "2.00",
  soundOn: false,
  reducedMotion: true,
  maxQty: () => 10,
  gate: () => ({ open: true, reason: null }),
  onPrepare: vi.fn(async () => ({
    lines: [{ label: "0.10 SOL" }],
    total: "0.10 SOL",
  })),
  onRip: vi.fn(async () => ({
    pullId: "verified-pull",
    result: result("ONE"),
    results: [result("ONE"), result("TWO")],
  })),
  onAction: vi.fn(async () => ({})),
  onMyCards: vi.fn(),
  onShare: vi.fn(),
  onVerify: vi.fn(),
  onEdition: vi.fn(),
  onQty: vi.fn(),
});
const mount = async (input: RipViewProps) => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={null}>
        <RipView {...input} />
      </Suspense>,
    );
  });
  return view;
};
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  stage.callbacks.clear();
});

describe("Rip quantity, disclosure and ordered reveal", () => {
  it("switches to the existing poster and keeps disclosure controls usable", async () => {
    const input = props();
    const view = await mount(input);
    act(() => stage.fallback?.());
    expect(stage.destroy).toHaveBeenCalledTimes(1);
    expect(stage.stopBudget).toHaveBeenCalled();
    expect(
      view.container.querySelector(".rip-stage .rip-sk picture"),
    ).not.toBeNull();
    expect(view.container.querySelector(".rip-sk-dock")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Rip 1/ }));
    await screen.findByRole("dialog");
    expect(input.onPrepare).toHaveBeenCalledTimes(1);
    expect(input.onRip).not.toHaveBeenCalled();
  });

  it("delivers an in-flight Pull after the scene exceeds its budget", async () => {
    const input = props();
    let resolve!: (value: Awaited<ReturnType<typeof input.onRip>>) => void;
    input.onRip.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await mount({ ...input, onPrepare: undefined });
    fireEvent.click(screen.getByRole("button", { name: /Rip 1/ }));
    act(() => stage.fallback?.());
    await act(async () =>
      resolve({
        pullId: "verified-pull",
        result: result("ONE"),
        results: [result("ONE")],
      }),
    );
    expect(screen.getByText("ONE")).toBeVisible();
    expect(stage.setResult).not.toHaveBeenCalled();
    expect(stage.play).toHaveBeenCalledTimes(1);
  });

  it("stabilizes a live quantity URL update from ten packs to five", async () => {
    history.replaceState(
      null,
      "",
      "/rip?edition=original&n=10&ref=first_alias#kept",
    );
    const input = props();
    let renders = 0;
    const maxQty = () => {
      if (++renders > 20) throw new Error("Rip render budget exceeded");
      return 10;
    };
    function Shell() {
      const href = useLocation();
      return (
        <main data-location={href}>
          <Suspense fallback={null}>
            <RipView
              {...input}
              quantity={10}
              maxQty={maxQty}
              onQty={(qty) => {
                replaceRipSelection("original", qty);
              }}
            />
          </Suspense>
        </main>
      );
    }
    await act(async () => {
      render(<Shell />);
    });
    expect(screen.getByRole("radio", { name: "×10" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    renders = 0;
    fireEvent.click(screen.getByRole("radio", { name: "×5" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "×5" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(renders).toBeLessThanOrEqual(4);
    expect(location.search).toContain("ref=first_alias");
    expect(location.hash).toBe("#kept");
    expect(input.onPrepare).not.toHaveBeenCalled();
    expect(input.onRip).not.toHaveBeenCalled();
    expect(document.querySelector("main")).toHaveAttribute(
      "data-location",
      location.href,
    );
  });
  it("times out preparation, ignores late completion and permits a fresh retry", async () => {
    let finish!: (value: { lines: { label: string }[]; total: string }) => void;
    let signal: AbortSignal | undefined;
    const input = {
      ...props(),
      onPrepare: vi.fn((_edition, _quantity, currentSignal?: AbortSignal) => {
        signal = currentSignal;
        return new Promise<{ lines: { label: string }[]; total: string }>(
          (resolve) => {
            finish = resolve;
          },
        );
      }),
    };
    await mount(input);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: /Rip 1/ }));
    expect(screen.getByRole("button", { name: /Loading/ })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
    });
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("common.networkError"),
    );
    expect(screen.getByRole("button", { name: /Try again/ })).toBeEnabled();
    await act(async () => {
      finish({ lines: [], total: "stale" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    input.onPrepare.mockResolvedValueOnce({
      lines: [{ label: "fresh" }],
      total: "fresh",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(input.onRip).not.toHaveBeenCalled();
  });
  it.each(["", "   "])(
    "replaces an empty error formatter (%j) with COPY and a retry",
    async (message) => {
      const input = { ...props(), failureMessage: () => message };
      input.onPrepare.mockRejectedValueOnce(new Error("Fixture failure"));
      await mount(input);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Rip 1/ }));
      });
      expect(screen.getByRole("alert")).toHaveTextContent(t("errors.generic"));
      expect(screen.getByRole("button", { name: /Try again/ })).toBeEnabled();
    },
  );
  it("does not sign until the rent disclosure is confirmed, then advances in result order", async () => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    const input = props();
    await mount(input);
    fireEvent.click(await screen.findByRole("radio", { name: "×5" }));
    fireEvent.click(screen.getByRole("button", { name: /Rip 5/ }));
    await screen.findByRole("dialog");
    expect(input.onPrepare).toHaveBeenCalledWith(
      "original",
      5,
      expect.any(AbortSignal),
    );
    expect(input.onRip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign and Rip" }));
    await screen.findByRole("button", { name: /Next pack/ });
    expect(input.onRip).toHaveBeenCalledWith("original", 5);
    expect(
      stage.setResult.mock.calls.map(([value]) => value.hit.symbol),
    ).toEqual(["ONE"]);
    fireEvent.click(screen.getByRole("button", { name: /Next pack/ }));
    await screen.findByRole("list", { name: "Your Pull" });
    expect(
      stage.setResult.mock.calls.map(([value]) => value.hit.symbol),
    ).toEqual(["ONE", "TWO"]);
    expect(input.onRip).toHaveBeenCalledTimes(1);
    await act(async () => {
      await stage.callbacks.get("cardAction")?.(4, "sell_back");
    });
    expect(input.onAction).toHaveBeenCalledWith(4, "sell_back", 1);
  });
  it("cancels the disclosure without cranking or requesting a wallet signature", async () => {
    const input = props();
    await mount(input);
    fireEvent.click(screen.getByRole("button", { name: /Rip 1/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(input.onRip).not.toHaveBeenCalled();
    expect(stage.play).not.toHaveBeenCalled();
  });
  it("Turbo advances through the already verified batch without another signature", async () => {
    const input = props();
    await mount(input);
    fireEvent.click(await screen.findByRole("button", { name: "Turbo" }));
    fireEvent.click(screen.getByRole("button", { name: /Rip 1/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Sign and Rip" }));
    await waitFor(() => expect(stage.setResult).toHaveBeenCalledTimes(2));
    expect(input.onRip).toHaveBeenCalledTimes(1);
  });
  it("retains the deep-linked quantity while allowance loads and clamps when it arrives", async () => {
    const input = { ...props(), quantity: 10, maxQty: () => 0 };
    const view = await mount(input);
    await screen.findByRole("radio", { name: "×10" });
    expect(input.onQty).not.toHaveBeenCalled();
    view.rerender(
      <Suspense fallback={null}>
        <RipView {...input} maxQty={() => 5} />
      </Suspense>,
    );
    await waitFor(() => expect(input.onQty).toHaveBeenCalledWith(5));
    expect(
      (screen.getByRole("radio", { name: "×10" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

it("keeps deposits and the copyable program inside collapsed Details", async () => {
  const input = props();
  const program = "DoNH1CexampleProgramAddress1234567890abcd";
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  input.onPrepare.mockResolvedValue(
    ripPreview({
      quantity: 5,
      priceEach: 100_000_000n,
      costs: {
        price: 500_000_000n,
        drawFee: 500_000n,
        pullDeposit: 1000n,
        binderDeposit: 3872n,
        binderHeader: 1000n,
        cardSlots: 2872n,
      },
      networkFee: 5000n,
      program,
    }),
  );
  await mount(input);
  fireEvent.click(screen.getByRole("button", { name: /Rip 1/ }));
  await screen.findByRole("dialog");
  expect(screen.getByText("5 × 0.10 SOL")).toBeVisible();
  expect(screen.getByText("Refundable deposits · ≈0.000005 SOL")).toBeVisible();
  expect(screen.getByText("Total · ≈0.501 SOL")).toBeVisible();
  expect(screen.getByText("1 transaction, 1 approval")).toBeVisible();
  expect(screen.getByText(/Pull deposit ·/)).not.toBeVisible();
  fireEvent.click(screen.getByText("Details", { exact: true }));
  expect(screen.getByText(/Pull deposit ·/)).toBeVisible();
  expect(screen.getByText(`Program · ${short(program)}`)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Copy program address" }));
  await screen.findByText("Address copied.");
  expect(writeText).toHaveBeenCalledWith(program);
  expect(input.onRip).not.toHaveBeenCalled();
});

it("includes optional Settle approvals and fees without charging rent twice", () => {
  const preview = ripPreview({
    quantity: 1,
    priceEach: 100_000_000n,
    costs: {
      price: 100_000_000n,
      drawFee: 500_000n,
      pullDeposit: 1000n,
      binderDeposit: 3872n,
      binderHeader: 1000n,
      cardSlots: 2872n,
    },
    networkFee: 5000n,
    program: "program",
    settleCount: 2,
    settleFee: 1_000_000n,
  });
  expect(preview.approvals).toBe("Up to 3 transactions, 3 approvals");
  expect(preview.total).toBe("Total · ≈0.102 SOL");
  expect(preview.lines.map((line) => line.label)).toContain(
    "Network fee · ≈0.00101 SOL",
  );
});
