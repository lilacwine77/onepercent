# My cards module: synced from the lab

`module/` is a copy of `experience/cards-lab/src/cards/**` (the architect's My cards
prototype). Do not edit it here: change the lab, then re-sync from the repository root:

```
node app/apps/web/src/experience/sync-lab.mjs cards
```

The script replaces `module/`, copies `foil/`, `packs/` and `pepe-white.webp` into
`app/apps/web/public/experience/cards/`, formats the copy and refuses any word of
AGENTS.md lists 1–2. Every file gets a provenance header, `/* eslint-disable */`
and `// @ts-nocheck` (the lab typechecks under its own tsconfig). The asserted `styles/index.css` patch removes regular Fraunces 700 and DM Sans
500 imports already provided by the app shell; DM Sans 700 stays lazy.

`CardsView.tsx` and `cards.css` are the app host around `mountCards`; the module
keeps its own copy table (`module/copy.ts`: COPY issue 1 plus the keys it proposes
for issue 2) until `@onepercent/copy` carries issue 2.
