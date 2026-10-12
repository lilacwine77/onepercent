import "../test/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchGoRoute } from "../go/route";
import { canonicalize, isAddress, matchRoute, navigate } from "./router";
import { routes } from "./table";

const address = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
describe("canonical route matching", () => {
  beforeEach(() => history.replaceState(null, "", "/"));
  it.each([
    ["/", "home"],
    ["/x", "xray"],
    ["/feed", "feed"],
    ["/rip", "rip"],
    ["/cards", "cards"],
    ["/fairness", "fairness"],
    ["/live", "live"],
    ["/token", "token"],
    ["/status", "notFound"],
    ["/missing", "notFound"],
  ])("matches %s as %s", (path, expected) =>
    expect(matchRoute(path).route).toBe(expected),
  );
  it.each(["/go", "/go/"])(
    "uses the not-found route and title for %s without a session id",
    (path) => {
      const pathname = canonicalize(
        new URL(path, window.location.origin),
      ).pathname;
      const match = matchRoute(pathname);
      expect(matchGoRoute(pathname)).toBeNull();
      expect(match).toEqual({ route: "notFound", params: {} });
      expect(routes).toMatchObject({
        [match.route]: { title: "title.notFound" },
      });
    },
  );
  it.each(["", "/"])(
    "keeps a valid go session with suffix %s in the main entry-point matcher",
    (suffix) => {
      const id = "0123456789abcdef0123456789abcdef";
      const pathname = `/go/${id}${suffix}`;
      expect(matchGoRoute(pathname)).toBe(id);
      expect(matchRoute(pathname)).toEqual({ route: "notFound", params: {} });
    },
  );
  it("keeps query and hash when resolving permanent aliases", () => {
    for (const [alias, canonical] of [
      ["/packs", "/rip"],
      ["/me", "/cards"],
    ]) {
      const url = canonicalize(
        new URL(`${alias}?ref=friend_01#section`, window.location.origin),
      );
      expect(url.pathname + url.search + url.hash).toBe(
        `${canonical}?ref=friend_01#section`,
      );
    }
  });
  it("validates decimal Pull sequence range and supports the address form", () => {
    for (const seq of ["0", "1", "18446744073709551615"])
      expect(matchRoute(`/verify/${seq}`)).toMatchObject({
        route: "verify",
        params: { pull: seq },
      });
    expect(matchRoute(`/verify/${address}`)).toMatchObject({
      route: "verify",
      params: { pull: address },
    });
    for (const seq of [
      "01",
      "-1",
      "1e3",
      "18446744073709551616",
      "",
      "%2F",
      "%252F",
      "%E0%A4",
    ])
      expect(matchRoute(`/verify/${seq}`).route).toBe("notFound");
  });
  it("decodes once and rejects malformed address and nonce routes before fetching", () => {
    expect(matchRoute(`/x/${address}`).route).toBe("xray");
    expect(matchRoute("/x/name.sns").route).toBe("xray");
    for (const path of [
      "/x/a%2Fb",
      "/x/%252F",
      "/x/%E0%A4",
      `/x/${"1".repeat(44)}`,
      "/link/abc",
      `/link/${"a".repeat(31)}`,
      `/link/${"G".repeat(32)}`,
    ])
      expect(matchRoute(path).route, path).toBe("notFound");
    expect(matchRoute(`/link/${"a".repeat(32)}`)).toMatchObject({
      route: "link",
      params: { nonce: "a".repeat(32) },
    });
  });
  it("checks the decoded byte length of base58 addresses", () => {
    expect(isAddress(address)).toBe(true);
    expect(isAddress("1".repeat(32))).toBe(true);
    for (const input of [
      "1".repeat(44),
      "2".repeat(32),
      "0".repeat(32),
      "<script>",
    ])
      expect(isAddress(input)).toBe(false);
  });
  it("navigates same-origin links with aliases and refuses external navigation", () => {
    navigate("/packs?ref=friend_01#pack");
    expect(location.pathname + location.search + location.hash).toBe(
      "/rip?ref=friend_01#pack",
    );
    navigate("https://example.com/path");
    expect(location.pathname).toBe("/rip");
  });
});

describe("the 1% transition", () => {
  const root = document.documentElement;
  // jsdom has no View Transitions; the test adds and removes the method.
  const doc = document as unknown as {
    startViewTransition?: (update: () => void) => void;
  };
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    // Browsers with View Transitions take the animated paths.
    doc.startViewTransition = (update: () => void) => update();
    history.replaceState(null, "", "/rip");
    root.className = "";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete doc.startViewTransition;
    delete root.dataset.motion;
    root.className = "";
  });

  it("covers a journey turn, swaps the route under the cover, then lifts it", async () => {
    navigate("/cards");
    expect(root.classList.contains("is-brand")).toBe(true);
    expect(location.pathname).toBe("/rip");
    await vi.advanceTimersByTimeAsync(230);
    expect(location.pathname).toBe("/cards");
    expect(root.classList.contains("is-brand-out")).toBe(false);
    await vi.advanceTimersByTimeAsync(40);
    expect(root.classList.contains("is-brand-out")).toBe(true);
    await vi.advanceTimersByTimeAsync(320);
    expect(root.className).toBe("");
  });

  it("lets a newer navigation interrupt the cover, which then never comes back", async () => {
    navigate("/cards");
    await vi.advanceTimersByTimeAsync(100);
    navigate("/fairness");
    expect(root.className).toBe("");
    await vi.advanceTimersByTimeAsync(1200);
    expect(location.pathname).toBe("/fairness");
    expect(root.className).toBe("");
  });

  it("keeps the other turns on the plain view transition", async () => {
    history.replaceState(null, "", "/cards");
    navigate("/fairness");
    expect(root.className).toBe("");
    await vi.advanceTimersByTimeAsync(0);
    expect(location.pathname).toBe("/fairness");
  });

  it("never wipes under reduced motion", async () => {
    root.dataset.motion = "reduced";
    navigate("/cards");
    expect(root.className).toBe("");
    await vi.advanceTimersByTimeAsync(0);
    expect(location.pathname).toBe("/cards");
  });
});
