import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const eslint = new ESLint({ cwd: workspace });
async function copyMessages(source, name = "bridge/placeholders/Probe.tsx") {
  const [result] = await eslint.lintText(source, {
    filePath: `apps/web/src/${name}`,
  });
  return result.messages.filter(
    (message) => message.ruleId === "no-restricted-syntax",
  );
}

test("copy lint rejects visible text, direct labels and expression escapes", async () => {
  for (const element of [
    "<h1>Raw heading</h1>",
    '<input aria-label="Raw label" />',
    '<input title="Raw title" />',
    '<img alt="Raw description" />',
    '<input placeholder="Raw hint" />',
    '<h1>{"Raw expression"}</h1>',
    '<input aria-label={"Raw expression"} />',
    "<h1>{`Raw template`}</h1>",
    "<h1>{`Raw ${value}`}</h1>",
    "<input placeholder={`Raw ${value}`} />",
  ])
    assert.ok(
      (await copyMessages(`const Probe = () => ${element};`)).length > 0,
      element,
    );
});

test("copy lint allows translation calls, whitespace and technical attributes", async () => {
  assert.equal(
    (
      await copyMessages(
        `const Probe = () => <div className="shell"><h1>{t('home.title')}</h1><a href={'/x'} aria-label={t('nav.xray')}>{t('nav.xray')}</a></div>;`,
      )
    ).length,
    0,
  );
  assert.equal(
    (await copyMessages("const Probe = () => <div>\n  </div>;")).length,
    0,
  );
});

test("architect templates and test components retain their explicit boundaries", async () => {
  for (const path of [
    "experience/Hero.tsx",
    "xray/XrayView.tsx",
    "app/Probe.test.tsx",
  ]) {
    assert.equal(
      (
        await copyMessages(
          "const Probe = () => <h1>Fixture content</h1>;",
          path,
        )
      ).length,
      0,
    );
  }
});
