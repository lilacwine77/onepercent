/**
 * Re-copies an experience lab module into the app (see rip/SYNC.md, cards/SYNC.md).
 *
 *   node app/apps/web/src/experience/sync-lab.mjs rip     # experience/lab/src/rip       → experience/rip/module
 *   node app/apps/web/src/experience/sync-lab.mjs cards   # experience/cards-lab/src/cards → experience/cards/module
 *
 * The labs live next to the repository (…/onepercent/experience); override with LAB_ROOT.
 * Every copied file gets a provenance header, eslint-disable and `@ts-nocheck` (the labs
 * typecheck under their own, looser tsconfig). The app patches below are asserted: if a
 * lab file changes shape, the sync fails instead of shipping an unpatched module.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { controllerPatches } from "./rip/controller-patches.mjs";
import { readVocabulary, wordMatches } from "../../scripts/lint-words.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../../../..");
const repo = resolve(app, "..");
const labRoot = process.env.LAB_ROOT ?? resolve(repo, "../experience");
const which = process.argv[2];
const publicDir = join(app, "apps/web/public/experience");

const targets = {
  rip: {
    source: join(labRoot, "lab/src/rip"),
    dest: join(here, "rip/module"),
    assets: [
      // RIP_ASSET_FILES (packs, studio, Pepe, machine posters) and the dock thumbnails.
      [
        join(labRoot, "lab/public/assets"),
        join(publicDir, "rip"),
        (f) => /^(thumb-|machine-poster|hero-studio|pack-|pepe-)/.test(f),
      ],
      [
        join(labRoot, "lab/public/models"),
        join(publicDir, "rip"),
        (f) => f === "onepercent-machine.glb",
      ],
    ],
    // The lab's synthesized sound cues (WebAudio, no samples), used by the host page.
    extra: [
      [
        join(labRoot, "lab/src/sound.ts"),
        join(here, "rip/sound.ts"),
        [["from './rip';", "from './module';"]],
      ],
    ],
    patches: {
      "controller.ts": controllerPatches,
      // CSP: style-src 'self' blocks an injected <style>; constructable sheets are CSSOM.
      "overlay.ts": [
        [
          /const style = document\.createElement\('style'\);\s*style\.dataset\.rip = '';\s*style\.textContent = CSS;\s*document\.head\.appendChild\(style\);/,
          "const sheet = new CSSStyleSheet();\n  sheet.replaceSync(CSS);\n  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];",
        ],
      ],
      // CSP: meshopt without WebAssembly (a Worker), GLB images through <img> (shared/gltf.ts).
      "machine.ts": [
        [
          "import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';",
          "import { cspGltfLoader } from '../../shared/gltf';",
        ],
        [
          "new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)",
          "cspGltfLoader()",
        ],
      ],
    },
  },
  cards: {
    source: join(labRoot, "cards-lab/src/cards"),
    dest: join(here, "cards/module"),
    assets: [
      [
        join(labRoot, "cards-lab/public/assets"),
        join(publicDir, "cards"),
        (f) => f.endsWith(".webp"),
      ],
      [
        join(labRoot, "cards-lab/public/assets/foil"),
        join(publicDir, "cards/foil"),
        () => true,
      ],
      [
        join(labRoot, "cards-lab/public/assets/packs"),
        join(publicDir, "cards/packs"),
        () => true,
      ],
    ],
    extra: [],
    patches: {
      "styles/index.css": [
        [/@import ["']@fontsource\/fraunces\/latin-700\.css["'];\s*/, ""],
        [/@import ["']@fontsource\/dm-sans\/latin-500\.css["'];\s*/, ""],
      ],
    },
  },
};
const target = targets[which];
if (!target) throw new Error("Usage: sync-lab.mjs rip|cards");
if (!existsSync(target.source))
  throw new Error(`Lab source not found: ${target.source}`);

// Words never shipped (AGENTS.md lists 1–2, read from the same source as lint:words):
// known comment hits are rewritten, anything else fails the sync.
const vocabulary = readVocabulary().everywhere;
// COPY.md §0.8: no em dash in user-facing text. The labs' lone dash (a pending or
// missing value) becomes the app's no-value marker, `n/a` (common.noValue);
// any other em dash becomes a colon.
const rewrites = [
  [new RegExp(`\\b${"s" + "weep"}\\b`, "gi"), "glide"],
  [/(['"`])\u2014\1/g, "$1n/a$1"],
  [/\s*\u2014\s*(?=SOL\b)/g, " n/a "],
  [/\s+\u2014\s+/g, ": "],
  [/\u2014/g, "n/a"],
];
const header = (from) =>
  `/* eslint-disable */\n// Synced from experience/${relative(labRoot, from)} by experience/sync-lab.mjs; edit the lab, then re-sync.\n// @ts-nocheck\n`;
const copied = [];
function write(from, to, text) {
  for (const [pattern, replacement] of rewrites)
    text = text.replace(pattern, replacement);
  writeFileSync(
    to,
    /\.(ts|js)$/.test(to)
      ? header(from) + text
      : `/* Synced from experience/${relative(labRoot, from)} by experience/sync-lab.mjs. */\n${text}`,
  );
  copied.push(to);
}
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (entry === "package.json") continue;
    const source = join(from, entry);
    const dest = join(to, entry);
    if (statSync(source).isDirectory()) copyTree(source, dest);
    else if (/\.(ts|js|css)$/.test(entry)) {
      let text = readFileSync(source, "utf8");
      const name = relative(target.source, source);
      for (const [pattern, replacement] of target.patches[name] ?? []) {
        const before = text;
        text = text.replace(pattern, replacement);
        if (text === before)
          throw new Error(`Patch not applied in ${name}: ${pattern}`);
      }
      write(source, dest, text);
    } else cpSync(source, dest);
  }
}
rmSync(target.dest, { recursive: true, force: true });
copyTree(target.source, target.dest);
for (const [from, to, edits] of target.extra) {
  let text = readFileSync(from, "utf8");
  for (const [a, b] of edits) {
    if (!text.includes(a))
      throw new Error(`Patch not applied in ${from}: ${a}`);
    text = text.replace(a, b);
  }
  write(from, to, text);
}
for (const [from, to, keep] of target.assets) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (keep(entry) && !statSync(join(from, entry)).isDirectory())
      cpSync(join(from, entry), join(to, entry));
  }
}
execFileSync(
  process.execPath,
  [
    join(app, "node_modules/prettier/bin/prettier.cjs"),
    "--write",
    "--log-level",
    "warn",
    target.dest,
    ...target.extra.map(([, to]) => to),
  ],
  { stdio: "inherit" },
);
for (const file of copied) {
  const [hit] = wordMatches(readFileSync(file, "utf8"), vocabulary);
  if (hit)
    throw new Error(
      `Prohibited vocabulary "${hit.word}" in ${relative(app, file)}:${hit.line}; fix it in the lab.`,
    );
}
console.log(
  `Synced ${copied.length} files into ${relative(app, target.dest)}.`,
);
