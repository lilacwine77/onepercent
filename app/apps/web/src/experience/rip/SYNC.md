# The Rip module: synced from the lab

`module/` and `sound.ts` are copies of `experience/lab/src/rip/**` and
`experience/lab/src/sound.ts` (the architect's Rip prototype, still polished in the
lab). Do not edit them here: change the lab, then re-sync from the repository root:

```
node app/apps/web/src/experience/sync-lab.mjs rip    # LAB_ROOT=… if the labs live elsewhere
```

The script replaces `module/`, copies the lab's static assets into
`app/apps/web/public/experience/rip/` (packs, studio, Pepe, machine posters, dock
thumbnails, `onepercent-machine.glb`), formats the copy and refuses any word of
AGENTS.md lists 1–2. The lab's sample token logos are not copied: the app shows
real Solana tokens with their logos from `/api/logo/:mint`.

## App patches (asserted: the sync fails if a pattern disappears)

| File         | Patch                                                                                          | Why                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overlay.ts` | the injected `<style>` becomes a constructable stylesheet (`document.adoptedStyleSheets`)      | CSP `style-src 'self'` blocks inline `<style>` elements; CSSOM is allowed                                                                                                                                                                 |
| `machine.ts` | `new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)` → `cspGltfLoader()` (`../shared/gltf.ts`) | CSP: no `'wasm-unsafe-eval'`, so meshopt decodes with meshoptimizer's pure-JS reference decoder in a Worker (byte-identical output, checked); GLB images load through `<img>` (`img-src blob:`) instead of `fetch` (`connect-src 'self'`) |
| every file   | provenance header, `/* eslint-disable */`, `// @ts-nocheck`                                    | the lab typechecks under its own, looser tsconfig                                                                                                                                                                                         |
| comments     | one known word of AGENTS.md list 2 rewritten                                                   | `lint:words` scans everything under `app/`                                                                                                                                                                                                |

Interface requests for the lab (so the patches can go): accept a `gltfLoader`
(or `meshoptDecoder` + texture loader) option, and ship CSS through
`adoptedStyleSheets`.

Host workarounds for lab issues (remove them once the lab fixes the cause):

- `rip.css`: Reveal all is centred with `translate: -50% 0` because
  `pressable()` writes an inline transform that drops the module's
  `translateX(-50%)` (the button sits half its width right of centre).
- `RipView.tsx`: the dock takes its end layout while hidden during a Rip, because
  the end beat frames the cards at once and `setInsets` only re-frames in the
  idle and end states.

`RipView.tsx`, `rip.css` and `copy.ts` are the app host (dock, balance, card
actions) around `mountRip`; they are not synced.

App lifecycle patch (`controller-patches.mjs`, also applied by `sync-lab.mjs`):
stop rendering and detach immediately on teardown, but retain materials and the
renderer until pending shader compilations finish. Three polls those materials
asynchronously; early disposal removes `currentProgram` before `isReady` is read.
Destroyed stages skip subsequent initialization and warm-up work. Initialization
failures notify the host to use the same static poster as unsupported WebGL.

The host monitors visible, uncapped frame gaps. Three gaps over 150 ms in a rolling
2-second window, or one gap of at least 1 second, permanently select the existing
machine poster for that mount. Hidden-tab time is excluded. Transaction preparation
and result delivery remain independent of the scene. Capable devices keep the
existing renderer, framing and animation.

The `fixtures` Playwright project disables WebGL. `pnpm --filter web test:e2e:webgl`
runs one separate smoke with WebGL enabled, including teardown during compilation.

The controller patch also removes regular Fraunces 600/700 and DM Sans 500
font imports already provided by the app shell. Route-only faces remain lazy.
