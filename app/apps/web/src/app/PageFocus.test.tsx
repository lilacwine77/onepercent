import "../test/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageFocus } from "./PageFocus";

const href = "http://localhost/rip";
describe("route heading focus", () => {
  it("keeps focus on the pack control when only its quantity query changes", () => {
    const content = (
      <>
        <h1 tabIndex={-1}>Packs</h1>
        <button>×5</button>
      </>
    );
    const view = render(
      <main>
        <PageFocus href={`${href}?n=10`}>{content}</PageFocus>
      </main>,
    );
    screen.getByRole("button").focus();
    view.rerender(
      <main>
        <PageFocus href={`${href}?n=5`}>{content}</PageFocus>
      </main>,
    );
    expect(screen.getByRole("button")).toHaveFocus();
  });
  it("focuses a heading inserted after an inner lazy view loads", async () => {
    const view = render(
      <main>
        <PageFocus href={href}>
          <div role="status" />
        </PageFocus>
      </main>,
    );
    view.rerender(
      <main>
        <PageFocus href={href}>
          <h1 tabIndex={-1}>Packs</h1>
        </PageFocus>
      </main>,
    );
    await waitFor(() => expect(screen.getByRole("heading")).toHaveFocus());
  });

  it("transfers focus from a removed loading heading to the final heading", async () => {
    const view = render(
      <main>
        <PageFocus href={href}>
          <section>
            <h1 tabIndex={-1}>Loading</h1>
          </section>
        </PageFocus>
      </main>,
    );
    expect(screen.getByRole("heading")).toHaveFocus();
    view.rerender(
      <main>
        <PageFocus href={href}>
          <article>
            <h1 tabIndex={-1}>Packs</h1>
          </article>
        </PageFocus>
      </main>,
    );
    await waitFor(() => expect(screen.getByRole("heading")).toHaveFocus());
  });

  it("does not steal focus from a wallet control while the view loads", async () => {
    const view = render(
      <>
        <button>Connect</button>
        <main>
          <PageFocus href={href}>
            <div />
          </PageFocus>
        </main>
      </>,
    );
    screen.getByRole("button").focus();
    view.rerender(
      <>
        <button>Connect</button>
        <main>
          <PageFocus href={href}>
            <h1 tabIndex={-1}>Packs</h1>
          </PageFocus>
        </main>
      </>,
    );
    await waitFor(() => expect(screen.getByRole("heading")).toBeVisible());
    expect(screen.getByRole("button")).toHaveFocus();
  });

  it("stops deferred focus after a keyboard interaction", async () => {
    const view = render(
      <main>
        <PageFocus href={href}>
          <div />
        </PageFocus>
      </main>,
    );
    fireEvent.keyDown(document, { key: "Tab" });
    view.rerender(
      <main>
        <PageFocus href={href}>
          <h1 tabIndex={-1}>Packs</h1>
        </PageFocus>
      </main>,
    );
    await waitFor(() => expect(screen.getByRole("heading")).toBeVisible());
    expect(screen.getByRole("heading")).not.toHaveFocus();
  });
});
