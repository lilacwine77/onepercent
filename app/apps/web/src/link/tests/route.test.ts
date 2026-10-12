import "./setup";
import { describe, expect, it } from "vitest";
import { walletBrowserLinks } from "../links";
import { matchLinkRoute } from "../route";

const nonce = "0123456789abcdef0123456789abcdef";

describe("link routing", () => {
  it.each([`/link/${nonce}`, `/link/${nonce}/`])("matches %s", (path) => {
    expect(matchLinkRoute(path)).toBe(nonce);
  });

  it.each([
    "/",
    "/link",
    "/link/",
    `/link/${nonce.toUpperCase()}`,
    `/link/${nonce.slice(1)}`,
    `/link/${nonce}0`,
    `/link/${nonce}/extra`,
    `/link/${nonce}//`,
    `/link/${nonce}?ref=code`,
    `/other/link/${nonce}`,
    `/link/${nonce.replace("a", "g")}`,
  ])("rejects %s", (path) => {
    expect(matchLinkRoute(path)).toBeNull();
  });

  it("pins all three universal links with the complete URL and its origin", () => {
    expect(
      walletBrowserLinks(
        `https://preview.example/link/${nonce}?source=telegram`,
      ),
    ).toEqual({
      phantom: `https://phantom.com/ul/browse/https%3A%2F%2Fpreview.example%2Flink%2F${nonce}%3Fsource%3Dtelegram?ref=https%3A%2F%2Fpreview.example`,
      solflare: `https://solflare.com/ul/v1/browse/https%3A%2F%2Fpreview.example%2Flink%2F${nonce}%3Fsource%3Dtelegram?ref=https%3A%2F%2Fpreview.example`,
      backpack: `https://backpack.app/ul/v1/browse/https%3A%2F%2Fpreview.example%2Flink%2F${nonce}%3Fsource%3Dtelegram?ref=https%3A%2F%2Fpreview.example`,
    });
  });
});
