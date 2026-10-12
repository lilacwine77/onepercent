# Landing cleanup — 2 October 2026

The live page is reduced to the animated hero, packs, pool introduction and footer. The former editorial, quote, spinning-model and gallery sections remain represented in historical documentation and reusable assets, but are no longer mounted or downloaded by the landing.

## Pack interaction

Reference: https://jup.ag/gacha/packs, visually inspected in Chrome, including its draggable ring and edition selector. `src/pack-display.js` reproduces that browsing pattern with Onepercent artwork: eight copies of the selected edition arranged in perspective, inertia on horizontal dragging, floor reflections, left/right and spin controls, and a separate details action. It uses DOM/CSS transforms, not an additional GLB download. The four finishes and guide prices are unchanged.

The page keeps its Fraunces typography and cream/plum identity. Buttons now use a dark plum surface with a lilac arrow inset and asymmetric rounded corner. The cleaned photographic hero backdrop has no gold percentage props; the violet hero doodle is removed. The token strip remains inside the packs section, with smaller logos and less copy.

## Verification

- `npm test`: all 14 reveal geometry/lifecycle/export checks pass.
- `npm run build`: both site and reusable module compile. Vite retains the existing large Three.js chunk advisory.
- Chrome review at 1440 × 900 and 390 × 844, plus the initial wide desktop viewport.
- All four edition choices update the name, price and art; arrow/Home/End navigation checked.
- Horizontal dragging changes the ring pose without opening the details dialog. Details open via the explicit button; Escape returns to the page.
- Vertical wheel scrolling over the ring changes page position, including at mobile viewport width. Native phone touch gestures were not exercised; `touch-action: pan-y`, drag-axis detection and pointer cancellation are implemented and code-reviewed.
- Hero, pack selection, deposit section and details inspected visually. No horizontal page overflow at either checked width. No application errors in the compiled preview's console (unrelated browser wallet-extension errors excluded).
- The pool action opens the deposit explanation; its return action closes the dialog and returns to the packs.

Screenshots and compact report: `artifacts/cleanup-v8/`. The integration archive is regenerated with the current sources and active images; retired campaign photos are excluded from the archive.
