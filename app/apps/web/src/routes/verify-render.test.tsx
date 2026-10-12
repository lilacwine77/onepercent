import "../test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { short, t } from "@onepercent/copy";
import { AppShell } from "../app/AppShell";
import { loadVerify } from "../data/verify";
const address = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
vi.mock("../app/providers", () => ({
  Providers: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../wallet/WalletProvider", () => ({ WalletButton: () => null }));
vi.mock("../data/config", () => ({
  useConfig: () => ({}),
  useWebConfig: () => ({}),
}));
vi.mock("../data/verify", () => ({
  loadVerify: vi.fn().mockRejectedValue(new Error("Fixture RPC unavailable")),
}));
vi.mock("../data/public-machine", async (original) => ({
  ...(await original<typeof import("../data/public-machine")>()),
  loadTrust: vi.fn().mockResolvedValue(null),
}));
vi.mock("../data/flags", () => ({ useFlag: () => false }));
vi.mock("../analytics/client", () => ({ beacon: vi.fn() }));
beforeEach(async () => {
  localStorage.clear();
  // Match router navigation: its actual preload contract resolves both bridge and view
  // before PageFocus runs. Avoid racing a cold lazy chunk against focus assertions.
  await (await import("./pages/Verify")).ready();
});
it.each([
  ["42", "42"],
  [address, short(address)],
])("renders and titles Verify for %s", async (pull, formatted) => {
  history.replaceState(null, "", `/verify/${pull}`);
  render(<AppShell />);
  expect(
    await screen.findByRole(
      "heading",
      { name: t("common.verify") },
      // The lazy route chunk can take longer than the 1 s default on a busy runner.
      { timeout: 10_000 },
    ),
  ).toBeVisible();
  expect(await screen.findByText(t("verify.error"))).toBeVisible();
  expect(loadVerify).toHaveBeenCalledWith(expect.anything(), pull, null);
  expect(screen.queryByText(t("verify.passed"))).not.toBeInTheDocument();
  await waitFor(() =>
    expect(document.title).toBe(t("title.verify", { seq: formatted })),
  );
  expect(
    screen.getByRole("heading", { name: t("common.verify") }),
  ).toHaveFocus();
});
