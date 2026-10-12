import "./setup.js";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { BANNED_COPY, BANNED_EVERYWHERE } from "@onepercent/config";
import { COPY_KEYS, MACHINE_COPY } from "../copy.js";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "test" || entry.name.endsWith(".test.ts")) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.name.endsWith(".ts")
        ? [path]
        : [];
  });
}
it("keeps the issued D18 bot keys byte-identical to the copy deck", () => {
  const root = realpathSync(
    fileURLToPath(new URL("../../../../", import.meta.url)),
  );
  const deck = Object.fromEntries(
    [
      ...readFileSync(join(root, "../docs/codex/COPY.md"), "utf8").matchAll(
        /^\| `([^`]+)` \| `([^`]+)` \|/gm,
      ),
    ].map((match) => [match[1]!, match[2]!.replaceAll("\\n", "\n")]),
  );
  for (const key of [
    "bot.alerts.fromOnAir",
    "bot.me.placeholder",
    "bot.hits.on",
  ] as const) {
    expect(COPY_KEYS[key], key).toBe(deck[key]);
    expect(COPY_KEYS[key], key).not.toContain("On Air");
    expect(COPY_KEYS[key], key).not.toContain("\u2014");
  }
});
it("makes no launch timing promise in bot copy", () => {
  for (const [key, text] of Object.entries({ ...COPY_KEYS, ...MACHINE_COPY })) {
    expect(text, key).not.toMatch(
      /\b(?:coming soon|on air soon|from on air|(?:start|live|launch|available)s? (?:at|by|from) (?:on air|launch))\b/i,
    );
    expect(text, key).not.toContain("\u2014");
  }
});
it("contains no custody libraries, signing identifiers, payment or embedded-app paths", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = [
    ...sourceFiles(root),
    fileURLToPath(new URL("../../package.json", import.meta.url)),
  ];
  const prohibited = [
    /["'](?:bip39|@scure\/bip39|ed25519-hd-key|tweetnacl|@solana\/web3\.js|@solana\/kit)["']/,
    /\b(?:Keypair|fromSecretKey|secretKey|derivePath)\b/,
    /\b(?:web_app|WebApp|sendInvoice|createInvoiceLink|pre_checkout_query|successful_payment|setChatMenuButton|answerWebAppQuery)\b|["']XTR["']/,
  ];
  for (const path of files) {
    const code = readFileSync(path, "utf8");
    for (const pattern of prohibited)
      expect(code, relative(root, path)).not.toMatch(pattern);
    expect(code, path).not.toMatch(
      /from\s+["'](?:@onepercent\/service-kit(?!\/safe-cause["'])|@solana\/)/,
    );
    expect(code, path).not.toMatch(
      /from\s+["']@onepercent\/sdk(?!\/api)[^"']*["']/,
    );
    if (!path.endsWith("/notify/sender.ts"))
      expect(code, path).not.toMatch(/\bapi\.sendMessage\b/);
  }
  const diagnostics = readFileSync(
    new URL(
      "../../../../packages/service-kit/src/safe-cause.ts",
      import.meta.url,
    ),
    "utf8",
  );
  expect(diagnostics).not.toMatch(/\b(?:import|require)\s*[({"*]/);
  const sentence =
    "// The bot must never ask for, receive, store or derive private keys or seed phrases.";
  for (const name of ["index.ts", "guard.ts"])
    expect(readFileSync(join(root, name), "utf8").split("\n")[0]).toBe(
      sentence,
    );
  expect(readFileSync(join(root, "index.ts"), "utf8")).not.toContain(
    "createNotificationSender",
  );
});

it("uses the current art-direction vocabulary in all three copy modules", () => {
  const words = [...BANNED_EVERYWHERE, ...BANNED_COPY];
  expect(words.length).toBeGreaterThan(30);
  expect(words).toContain("verify your wallet");
  for (const location of [
    "../copy.ts",
    "../../../api/src/actions/copy.ts",
    "../../../../apps/web/src/link/copy.ts",
    "../../../../apps/web/src/go/copy.ts",
  ]) {
    const copy = readFileSync(new URL(location, import.meta.url), "utf8");
    for (const word of words)
      expect(copy).not.toMatch(
        new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
      );
    expect(copy).not.toMatch(/\bZK\b/);
  }
});

it("keeps message and button copy out of handlers", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const path of sourceFiles(root).filter(
    (path) => !path.endsWith("/copy.ts"),
  )) {
    const source = readFileSync(path, "utf8");
    for (const pattern of [
      /(?:\b(?:ctx\.reply|answerCallbackQuery)|\.(?:url|text))\(\s*["'][^"'\n]*[A-Za-z][^"'\n]*["']/,
      /\breply\(\s*ctx\s*,\s*["'][^"'\n]*[A-Za-z][^"'\n]*["']/,
      /answerCallbackQuery\(\s*\{\s*text:\s*["'][^"'\n]*[A-Za-z][^"'\n]*["']/,
    ])
      expect(source, path).not.toMatch(pattern);
  }
});
