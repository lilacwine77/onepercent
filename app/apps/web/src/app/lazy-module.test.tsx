import "../test/setup";
import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { lazyModule, preloadModule } from "./lazy-module";

function View() {
  return <p>view</p>;
}

describe("lazyModule", () => {
  it("renders a module that preloadModule brought in, without its fallback", async () => {
    const load = () => Promise.resolve({ default: View });
    await preloadModule(load);
    const Lazy = lazyModule(load);
    render(
      <Suspense fallback={<p>loading</p>}>
        <Lazy />
      </Suspense>,
    );
    expect(screen.getByText("view")).toBeInTheDocument();
    expect(screen.queryByText("loading")).toBeNull();
  });

  it("suspends on a module that is not in yet, then renders it", async () => {
    const load = () => Promise.resolve({ default: View });
    const Lazy = lazyModule(load);
    render(
      <Suspense fallback={<p>loading</p>}>
        <Lazy />
      </Suspense>,
    );
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("view")).toBeInTheDocument();
  });

  it("remembers a module once a first render loaded it", async () => {
    const load = () => Promise.resolve({ default: View });
    const First = lazyModule(load);
    const { unmount } = render(
      <Suspense fallback={<p>loading</p>}>
        <First />
      </Suspense>,
    );
    await screen.findByText("view");
    unmount();
    const Second = lazyModule(load);
    render(
      <Suspense fallback={<p>loading</p>}>
        <Second />
      </Suspense>,
    );
    expect(screen.getByText("view")).toBeInTheDocument();
    expect(screen.queryByText("loading")).toBeNull();
  });
});
