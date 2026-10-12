import "./setup.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "tests" || entry.name === "__fixtures__") return [];
    const file = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(file)
      : /\.tsx?$/.test(entry.name)
        ? [file]
        : [];
  });
}
it("keeps custody primitives out of M5 API runtime sources", () => {
  const directory = fileURLToPath(new URL("../../", import.meta.url));
  for (const area of ["actions", "link", "go"])
    for (const file of sources(join(directory, area))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /\b(?:Keypair|fromSecretKey|secretKey|partialSign|signTransaction|derivePath)\b|\.sign\(|(?:bip39|tweetnacl|ed25519-hd-key)/,
      );
    }
});
it("keeps Action display literals in the copy module", () => {
  const directory = fileURLToPath(new URL("../", import.meta.url));
  for (const file of sources(directory).filter(
    (value) => !value.endsWith("/copy.ts"),
  )) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(
      /\b(?:title|description|label|message)\s*:\s*["'`][A-Za-z]/,
    );
  }
});
