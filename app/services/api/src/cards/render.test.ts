import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  createCardRenderer,
  FONT_FILES,
  loadFonts,
  renderCardSvg,
} from "./render.js";
import { CARD_SIZE, XrayCard, type CardFormat } from "./xray-card.js";
import { fixtureModel } from "./test-model.js";

beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network in card tests");
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

function textNodes(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textNodes);
  if (
    node &&
    typeof node === "object" &&
    "type" in node &&
    typeof node.type === "function" &&
    "props" in node
  ) {
    return textNodes((node.type as (props: unknown) => unknown)(node.props));
  }
  if (
    node &&
    typeof node === "object" &&
    "props" in node &&
    node.props &&
    typeof node.props === "object" &&
    "children" in node.props
  )
    return textNodes(node.props.children);
  return [];
}

describe("X-ray card rendering", () => {
  it("loads the five local woff fonts once", async () => {
    const first = loadFonts();
    expect(loadFonts()).toBe(first);
    const fonts = await first;
    expect(fonts).toHaveLength(5);
    expect(FONT_FILES.every((font) => font.path.endsWith(".woff"))).toBe(true);
    for (const font of fonts)
      expect(
        (Buffer.isBuffer(font.data) ? font.data : Buffer.from(font.data))
          .subarray(0, 4)
          .toString(),
      ).toBe("wOFF");
  }, 15_000);
  for (const name of ["trencher", "clean"] as const) {
    for (const format of ["landscape", "square"] as const) {
      it(`${name} ${format} matches its SVG snapshot and uses SVG glyphs`, async () => {
        const model = fixtureModel(name);
        // The golden text and dynamic data must also pass through CardText.
        const nodes = textNodes(XrayCard({ model, format }));
        expect(nodes.some((text) => /[✳≈]/u.test(text))).toBe(false);
        await expect(await renderCardSvg(model, format)).toMatchFileSnapshot(
          `./__snapshots__/${name}-${format}.svg`,
        );
      }, 15_000);
    }
  }
  it.each<CardFormat>(["landscape", "square"])(
    "omits Worst and shows unknown drawdown placeholders in %s",
    (format) => {
      const model = fixtureModel("trencher");
      model.result.worst = null;
      model.coins = [
        { ticker: "DUST", drawdownPct: null },
        { ticker: "COIN", drawdownPct: null },
      ];
      const nodes = textNodes(XrayCard({ model, format }));
      expect(nodes.join(" ")).not.toMatch(/Worst|from ATH|−98.5%/u);
      expect(nodes.filter((text) => text === "n/a")).toHaveLength(2);
      expect(nodes).toContain("D");
      expect(nodes).toContain("C");
    },
  );
  it("retains a sourced Worst line and drawdown label", () => {
    const model = fixtureModel("trencher");
    model.result.worst = {
      mint: model.result.bags[0]!.mint,
      symbol: "DUST",
      drawdownPct: 98.5,
    };
    model.coins = [
      { ticker: "DUST", drawdownPct: 98.5 },
      { ticker: "COIN", drawdownPct: null },
    ];
    const nodes = textNodes(XrayCard({ model, format: "landscape" }));
    expect(nodes.join(" ")).toContain("Worst: $DUST −98.5% from ATH");
    expect(nodes).toContain("−98.5%");
    expect(nodes).toContain("n/a");
  });
  it.each<CardFormat>(["landscape", "square"])(
    "renders %s PNG dimensions and reuses the cache",
    async (format) => {
      const model = fixtureModel("trencher");
      const render = createCardRenderer();
      const [png, same] = await Promise.all([
        render(model, format),
        render(model, format),
      ]);
      expect(same).toBe(png);
      expect(await render(model, format)).toBe(png);
      expect(Buffer.from(png).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
      expect({
        width: header.getUint32(16),
        height: header.getUint32(20),
      }).toEqual(CARD_SIZE[format]);
    },
    15_000,
  );
});
