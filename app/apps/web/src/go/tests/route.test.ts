import "../../link/tests/setup";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { matchGoRoute } from "../route";
import { GO_EDITION_IDS, resolveGoTarget } from "../target";

const id = "0123456789abcdef0123456789abcdef";
const origin = "https://onepercent.fun";
const address = "11111111111111111111111111111111";

describe("go route", () => {
  it.each([`/go/${id}`, `/go/${id}/`])("matches %s", (pathname) => {
    expect(matchGoRoute(pathname)).toBe(id);
  });

  it.each([
    "/",
    "/go",
    "/go/",
    `/go/${id.toUpperCase()}`,
    `/go/${id.slice(1)}`,
    `/go/${id}0`,
    `/go/${id}/extra`,
    `/go/${id}//`,
    `/go/${id}?ref=alias`,
    `/go/%30${id.slice(1)}`,
  ])("does not match %s", (pathname) => {
    expect(matchGoRoute(pathname)).toBeNull();
  });
});

describe("go target allow-list", () => {
  it("keeps the temporary edition identifiers aligned with config", async () => {
    const config = await readFile(
      resolve(process.cwd(), "../../packages/config/src/constants.ts"),
      "utf8",
    );
    const editions = /export const PACK_EDITIONS = \[([\s\S]*?)\]/.exec(config);
    expect(editions).not.toBeNull();
    expect(
      [...(editions?.[1] ?? "").matchAll(/id: "([a-z_]+)"/g)].map(
        (match) => match[1],
      ),
    ).toEqual(GO_EDITION_IDS);
  });

  it.each([
    "/feed",
    `/feed?ref=${address}`,
    "/feed?ref=valid_alias",
    "/rip",
    "/rip?edition=original&n=10",
    `/rip?edition=after_hours&n=5&ref=${address}`,
    "/cards",
  ])("preserves the canonical target %s", (target) => {
    expect(resolveGoTarget(target, origin)).toBe(`${origin}${target}`);
  });

  it.each(GO_EDITION_IDS)("accepts the edition %s", (edition) => {
    const target = `/rip?edition=${edition}&n=1`;
    expect(resolveGoTarget(target, origin)).toBe(`${origin}${target}`);
  });

  it("accepts an absolute target only on the current origin", () => {
    expect(resolveGoTarget(`${origin}/cards`, origin)).toBe(`${origin}/cards`);
  });

  it.each([
    "https://other.example/feed",
    "//other.example/rip",
    "https://onepercent.fun.other.example/cards",
    "http://onepercent.fun/feed",
    "https://onepercent.fun:444/feed",
    "https://onepercent.fun@other.example/feed",
    "https://[invalid",
    "javascript:location.href='/feed'",
    "/",
    "/packs",
    "/me",
    "/link/0123456789abcdef0123456789abcdef",
    "/feed/extra",
    "/feed/",
    "/rip?amount=1",
    "/feed?ref=INVALID",
    "/feed?ref=two%20words",
    "/feed?ref=ab",
    "/feed?ref=alias&ref=INVALID",
    "/feed?ref=",
    "/rip?edition=unknown",
    "/rip?edition=original&edition=unknown",
    "/rip?n=0",
    "/rip?n=11",
    "/rip?n=-1",
    "/rip?n=1.5",
    "/rip?n=NaN",
    "/rip?n=Infinity",
    "/rip?n=1&n=11",
    "/rip?n=01",
    "/rip?n=1e1",
    "/rip?n=1.0",
    "/rip?n=",
    "/cards?return=https://other.example",
  ])("rejects %s", (target) => {
    expect(resolveGoTarget(target, origin)).toBeNull();
  });
});
