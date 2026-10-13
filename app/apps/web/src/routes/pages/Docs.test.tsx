import "../../test/setup";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Docs from "./Docs";

const addresses = [
  ["Program", "7H19ieb7A8s8re2fxoh4bd3jf51XXefLroougKLHvreH", "safety"],
  [
    "DBC launch settings",
    "35kjYpFKkNfViR9sNfcS3ZuocHor8Ju3xB5WTHybrWdS",
    "token",
  ],
  [
    "FeeIn fee receiver",
    "AtRkb16chRvFRokhpwefiNkAQCeGyb1jNe1jfnnQLexN",
    "token",
  ],
  [
    "Transaction address list (LUT)",
    "9oKigMfhYcYjX2vHzMwQZoU5JLPQuvK75JfomdnXwfs9",
    null,
  ],
] as const;

describe("launch Docs", () => {
  it("publishes exact standard odds in an accessible comparison table", () => {
    render(<Docs />);
    const table = screen.getByRole("table", { name: "Chance per pack" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Chance per pack",
      "The Original0.10 SOL",
      "Blue Shift0.25 SOL",
      "Signature0.50 SOL",
      "After Hours1.00 SOL",
    ]);
    const expected = [
      ["86.3225%", "86.24375%", "86.1125%", "85.85%"],
      ["11.3925%", "11.41875%", "11.4625%", "11.55%"],
      ["2%", "2%", "2%", "2%"],
      ["0.25%", "0.25%", "0.25%", "0.25%"],
      ["0.025%", "0.0625%", "0.125%", "0.25%"],
      ["0.01%", "0.025%", "0.05%", "0.1%"],
    ];
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByRole("cell")
            .map((cell) => cell.textContent),
        ),
    ).toEqual(expected);
    for (const row of within(table).getAllByRole("rowheader"))
      expect(row).toHaveAttribute("scope", "row");
    expect(screen.getByText(/unavailable special.*Silver Foil/)).toBeVisible();
    expect(screen.getByText(/MagicBlock.*one operator/)).toBeVisible();
  });

  it("keeps six sections readable offline with the launch limitations", () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<Docs />);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Docs" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(container.querySelectorAll("section")).toHaveLength(6);
    expect(screen.getByText(/Pack sales last 48 hours/)).toBeVisible();
    expect(
      screen.getByText(/87% of the lower.*recorded cost.*sale quote/),
    ).toBeVisible();
    expect(
      screen.getByText(/100 SOL.*2.5 SOL.*0.5.*Meteora.*2.*Machine/),
    ).toBeVisible();
    expect(
      screen.getByText(/1 SOL to stock.*1 to the team.*at least 2 SOL/),
    ).toBeVisible();
    expect(
      screen.getByText(/Below.*all.*stock.*After.*all.*team/),
    ).toBeVisible();
    expect(screen.getByText(/collection time/)).toBeVisible();
    expect(screen.getByText(/Final Pull is not active.*upgrade/)).toBeVisible();
    expect(
      screen.getByText(
        /founder wallet.*replace the program.*without multiple signers or a waiting period/,
      ),
    ).toBeVisible();
    expect(
      within(container.querySelector<HTMLElement>("#safety")!).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(4);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).toHaveAttribute("decoding", "async");
      expect(image.getAttribute("src")).toMatch(/^\/assets\/docs\/.+\.webp$/);
      expect(image).toHaveAttribute("width", "960");
      expect(image).toHaveAttribute("height", "720");
    }
    expect(container.textContent).not.toContain("\u2014");
  });

  it("places short addresses in context and preserves the complete address list", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "navigator",
      Object.create(navigator, { clipboard: { value: { writeText } } }),
    );
    const { container } = render(<Docs />);
    const details = container.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    for (const [label, address, section] of addresses) {
      if (section) {
        const region = within(
          container.querySelector<HTMLElement>(`#${section}`)!,
        );
        expect(
          region.getByText(`${address.slice(0, 4)}…${address.slice(-4)}`),
        ).toBeVisible();
        expect(
          region.getByRole("link", { name: `View ${label} on Solscan` }),
        ).toHaveAttribute("href", `https://solscan.io/account/${address}`);
        fireEvent.click(
          region.getByRole("button", { name: `Copy ${label} address` }),
        );
        expect(writeText).toHaveBeenLastCalledWith(address);
      }
    }
    expect(await screen.findAllByText("Copied")).toHaveLength(3);
    fireEvent.click(screen.getByText("All mainnet addresses"));
    expect(details).toHaveAttribute("open");
    for (const [label, address] of addresses) {
      expect(within(details).getByText(address)).toBeVisible();
      expect(
        within(details).getByRole("link", { name: `View ${label} on Solscan` }),
      ).toHaveAttribute("href", `https://solscan.io/account/${address}`);
      fireEvent.click(
        within(details).getByRole("button", { name: `Copy ${label} address` }),
      );
      expect(writeText).toHaveBeenLastCalledWith(address);
    }
    expect(await within(details).findAllByText("Copied")).toHaveLength(4);
  });

  it("announces clipboard failure while keeping the complete address accessible", async () => {
    vi.stubGlobal(
      "navigator",
      Object.create(navigator, {
        clipboard: {
          value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
        },
      }),
    );
    const { container } = render(<Docs />);
    const safety = within(container.querySelector<HTMLElement>("#safety")!);
    fireEvent.click(
      safety.getByRole("button", { name: "Copy Program address" }),
    );
    expect(
      await safety.findByText("Copy failed. Use the full address below."),
    ).toHaveAttribute("role", "status");
    fireEvent.click(screen.getByText("All mainnet addresses"));
    expect(screen.getByText(addresses[0][1])).toBeVisible();
  });
});
