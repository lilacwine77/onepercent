import { afterEach, describe, expect, it, vi } from "vitest";
import { TV_SIZES, tvSet } from "./tv-poster";

const preloads = () => [
  ...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]'),
];
afterEach(() => {
  preloads().forEach((link) => link.remove());
  window.history.replaceState(null, "", "/");
  vi.resetModules();
});

describe("the home poster preload", () => {
  it("asks for the poster's own AVIF on the home, at high priority", async () => {
    window.history.replaceState(null, "", "/?ref=abc");
    await import("./poster-preload");
    const [link] = preloads();
    expect(link).toBeDefined();
    expect(link!.as).toBe("image");
    expect(link!.type).toBe("image/avif");
    expect(link!.getAttribute("imagesrcset")).toBe(tvSet("avif"));
    expect(link!.getAttribute("imagesizes")).toBe(TV_SIZES);
    expect(link!.getAttribute("fetchpriority")).toBe("high");
  });
  it("leaves every other route alone", async () => {
    window.history.replaceState(null, "", "/feed");
    await import("./poster-preload");
    expect(preloads()).toHaveLength(0);
  });
});
