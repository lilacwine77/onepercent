import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binary = process.argv[2];
assert(
  binary,
  "Usage: node scripts/check-gitleaks-config.mjs <gitleaks binary>",
);
const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const config = join(appDirectory, "scripts/gitleaks.toml");
const temporary = mkdtempSync(join(tmpdir(), "onepercent-gitleaks-check-"));
const source = join(temporary, "source");
const report = join(temporary, "findings.json");
const canaryConfig = join(temporary, "canary.toml");
const publicFixtures = [
  [
    "app/packages/market/tests/fixtures/jupiter/swap-major-bonk-ladder-10.json",
    "ammKey",
    "4GQeEya6ZTwvXre4Br6ZfDyfe2WQMkcDz2QbkJZazVqS",
  ],
  [
    "app/fixtures/vectors/ix.json",
    "token_mint",
    "gBxS1f6uyyGPuW5MzGBukidSb71jdsCb5fZaoSzULE5",
  ],
  [
    "app/packages/market/tests/fixtures/rpc/pool-pqc.json",
    "quoteTokenAccount",
    "8XBzLnrtgagBccJ7FuTznkh1adJvWt5HzwE1tKUYTgGz",
  ],
];
const morePublicFixtures = [
  [
    "app/packages/cli/tests/fixtures/m1-ix.json",
    "token_mint",
    "gBxS1f6uyyGPuW5MzGBukidSb71jdsCb5fZaoSzULE5",
  ],
  [
    "app/packages/crosschain/fixtures/rpc/base-clanker.json",
    "token",
    "0x1ed3bafef7ed1ccb464d949ea2b3ddba028c7777",
  ],
  [
    "app/packages/crosschain/fixtures/relay/requests-refund.json",
    "tokenAddress",
    "0x4da3916d3ae6feece32ec8a2c4856d4abeb41bfd",
  ],
  [
    "app/packages/crosschain/fixtures/relay/requests-native-success.json",
    "idempotencyKey",
    "0x33a5c112cdfa50d89aa4c45b888f6d9aaf365663c20d863243b9a52c352fa73b",
  ],
];
const fixtures = [...publicFixtures, ...morePublicFixtures].map(
  ([file, field, value]) => ({
    file,
    value,
    render: (replacement) =>
      `${JSON.stringify({ [field]: replacement }, null, 2)}\n`,
  }),
);
fixtures.push(
  {
    file: "app/packages/service-kit/src/intake/constants.ts",
    value: "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP",
    render: (value) => `export const TOKEN_2022_NATIVE_MINT =\n  "${value}";\n`,
  },
  {
    file: "app/packages/crosschain/scripts/record-relay-fixtures.ts",
    value: "0x222fbc37a431138e4a8ecc8b8a21c5a8e8b1f035",
    render: (value) => `{token:"${value}"},\n`,
  },
);
const placeholders = [
  {
    file: "app/packages/cli/tests/ops.test.ts",
    source: '  "https://rpc.invalid/?api-key=never-print-this",\n',
  },
  {
    file: "app/packages/service-kit/tests/lifecycle.test.ts",
    source:
      "    const error = new Error('provider-secret https://rpc.invalid/private?api-key=private-key-value');\n",
  },
];
const launchCaptures = [
  {
    mint: "Eq5pnbQMvUKyu2DndJvyWnaW7KsxckNi6t264mtcQr2e",
    vault: "B14HGd3HawstPK6hDQijCsxCuMFykD7EDBMqez51kFSY",
    account: "BMFF8Y8fJhKM37r81sZXdN8einTbUGafqrKD5KffvWFc",
  },
  {
    mint: "3whKVaUcs2GEzGasMEMAvjtXKqExVnwNbPfrxkznRMhP",
    vault: "4qCNAaQZbbUwLCfFF2TJn7T2NooS9xRgBFh1k1qUwyJf",
    account: "GStznhvRyYGBsaq6Z7vFnRmUZppfWMvknKj8gu4Wves8",
  },
];
const launchLines = launchCaptures.flatMap((capture) =>
  [
    ["tokenMint", capture.mint, 10, ""],
    ["tokenMint", capture.mint, 12, ""],
    ["tokenMint", capture.mint, 6, ","],
    ["tokenVault", capture.vault, 6, ","],
    ["launchTokenAccount", capture.account, 6, ","],
  ].map(([field, value, indent, suffix]) => ({
    file: "app/fixtures/meteora/validator-launch.json",
    field,
    value,
    line: `${" ".repeat(indent)}"${field}": "${value}"${suffix}`,
  })),
);
function randomControlValue() {
  for (;;) {
    const value = randomBytes(24).toString("hex");
    const entropy = [...new Set(value)].reduce((total, character) => {
      const frequency = (value.split(character).length - 1) / value.length;
      return total - frequency * Math.log2(frequency);
    }, 0);
    // Keep negative controls above generic-api-key's 3.5 entropy threshold.
    if (entropy > 3.75) return value;
  }
}
function put(file, content) {
  const destination = join(source, file);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}
function scan(expected, selectedConfig = config, rule = "generic-api-key") {
  rmSync(report, { force: true });
  const result = spawnSync(
    resolve(binary),
    [
      "dir",
      "--redact",
      "--no-banner",
      "--config",
      selectedConfig,
      "--report-format",
      "json",
      "--report-path",
      report,
      source,
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    expected === 0 ? 0 : 1,
    "Gitleaks returned an unexpected status",
  );
  const findings = JSON.parse(readFileSync(report, "utf8"));
  assert.equal(
    findings.length,
    expected,
    "Gitleaks fixture exception was too broad or failed to match",
  );
  for (const finding of findings) assert.equal(finding.RuleID, rule);
}
try {
  for (const fixture of fixtures)
    put(fixture.file, fixture.render(fixture.value));
  for (const fixture of placeholders) put(fixture.file, fixture.source);
  scan(0);
  let negativeControls = 0;
  for (const fixture of fixtures) {
    // All three dimensions remain checked: path, field and exact reviewed value.
    put(fixture.file, fixture.render(randomControlValue()));
    scan(1);
    put(fixture.file, JSON.stringify({ api_key: fixture.value }));
    scan(1);
    put(fixture.file, fixture.render(fixture.value));
    const outside = `${fixture.file}.unlisted`;
    put(outside, fixture.render(fixture.value));
    scan(1);
    rmSync(join(source, outside));
    negativeControls += 3;
  }
  for (const fixture of placeholders) {
    put(fixture.file, JSON.stringify({ api_key: randomControlValue() }));
    scan(1);
    put(fixture.file, fixture.source);
    negativeControls += 1;
  }
  // A second detector still sees the same content at every allowed path.
  // This guards rule scoping, including placeholders the default rules ignore.
  const canaryPattern =
    fixtures.map((fixture) => fixture.value).join("|") +
    "|never-print-this|private-key-value";
  writeFileSync(
    canaryConfig,
    `[extend]\npath = ${JSON.stringify(config)}\n\n[[rules]]\nid = "fixture-boundary-canary"\nregex = '''${canaryPattern}'''\n`,
  );
  scan(
    fixtures.length + placeholders.length,
    canaryConfig,
    "fixture-boundary-canary",
  );
  console.log(
    `Gitleaks exceptions: ${fixtures.length} public families and ${placeholders.length} test placeholders accepted; ${negativeControls} negative controls and ${fixtures.length + placeholders.length} rule-scope canaries detected (redacted).`,
  );
  // Historical and current captures share one path; exercise each exact line alone.
  rmSync(source, { recursive: true, force: true });
  let launchNegativeControls = 0;
  for (const fixture of launchLines) {
    const render = (line) => `{\n${line}\n}\n`;
    const original = render(fixture.line);
    put(fixture.file, original);
    scan(0);
    put(fixture.file, original.replace(fixture.value, randomControlValue()));
    scan(1);
    put(fixture.file, original.replace(fixture.field, "api_key"));
    scan(1);
    put(fixture.file, render(` ${fixture.line}`));
    scan(1);
    put(
      fixture.file,
      render(
        fixture.line.endsWith(",")
          ? fixture.line.slice(0, -1)
          : `${fixture.line},`,
      ),
    );
    scan(1);
    put(fixture.file, render(`${fixture.line} extra`));
    scan(1);
    put(fixture.file, original);
    const outside = `${fixture.file}.unlisted`;
    put(outside, original);
    scan(1);
    rmSync(join(source, outside));
    launchNegativeControls += 6;
    writeFileSync(
      canaryConfig,
      `[extend]\npath = ${JSON.stringify(config)}\n\n[[rules]]\nid = "fixture-boundary-canary"\nregex = '''${fixture.value}'''\n`,
    );
    scan(1, canaryConfig, "fixture-boundary-canary");
  }
  console.log(
    `Launch fixture exceptions: ${launchLines.length} exact lines accepted; ${launchNegativeControls} negative controls and ${launchLines.length} rule-scope canaries detected (redacted).`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
