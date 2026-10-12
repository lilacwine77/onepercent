# Pack carousel: current behavior and V10 history

## Current interaction — 3 October 2026

The pack selector keeps its visible circular arc and native wrapper artwork. Hovering a booster reveals **$WIF, $FONE and $JIMOTHY coins** (PONS, BONER and Tesla until 9 October 2026) through it with cyan/purple X-ray shading; returning to rest restores the printed artwork. The separate token-logo strip has been removed. The marks and their sources are recorded in [`public/assets/tokens/SOURCES.md`](../public/assets/tokens/SOURCES.md).

Keyboard focus reveals the central pack, and a touch tap toggles the X-ray. **Explore** remains the action for opening edition details. Drag momentum, horizontal scrolling, edition selection and vertical page gestures are preserved. Reduced motion displays the reveal statically. The following reference observations and original CSS adaptation are historical; the later sections describe the active volumetric layout.

The runtime effect is implemented in `src/pack-xray.js`. The three relief coins are drawn from the existing marks into `public/assets/pack-xray-coins.svg` and its 1024 px WebP atlas. Per-pack shader uniforms reveal that atlas through the printed front and its reflection, preserving the original artwork at zero progress. The atlas is uploaded and the shader compiled before the carousel appears; hovering does not compile a new shader. The HTML fallback uses the same atlas clipped to the selected wrapper silhouette.

The X-ray browser check in `artifacts/pack-xray-v1/` covers all four editions at desktop and phone widths, hover isolation and restoration, touch toggling, dragging, vertical touch scrolling, keyboard focus, reduced motion and the HTML fallback. Final screenshots were inspected after correcting the hidden status layout and mouse-to-keyboard handoff. The isolated pixel comparison in `artifacts/pack-xray/pixel-report.json` confirms unchanged native pixels at rest and after exit, and unchanged neighboring packs during inspection.

## Original V10 correction — 2 October 2026

The user rejected the V9 open track: it distorted the wrappers and omitted Jupiter's mouse interaction and foil response. This version follows a fresh browser inspection of https://jup.ag/gacha/packs, including dragging, hovering and its narrow viewport.

### Historical reference observations

- Jupiter uses a looping orbit, not a straight row: horizontal sine position, cosine depth and scale, with smaller back packs fading out.
- Its visible DOM showed a 1500px perspective, ±90px depth, scale from .44 to 1.12, and sinusoidal yaw near ±44 degrees.
- The hovered wrapper lifts above the orbit, tilts with the cursor and shows moving highlights. Each wrapper has a subtle independent 4.2-second floating motion and a fading floor reflection.
- On mobile, the orbit extends outside the viewport: a central pack and partial neighbors remain visible.

### Original CSS adaptation

Eight copies give the wider Onepercent artwork room. Images and alpha masks retain their native square canvases; the visible foil is naturally portrait (roughly .86–.89 width/height). There is no `object-fit: fill` or separate horizontal compression.

The ring follows the measured positional relationships. Hover lift and cursor tilt are separate transforms. A masked specular streak, restrained iridescence and a soft light spot follow the cursor; the highlights remain inside the foil outline. The foil effect is implemented with CSS layers over our own artwork, not Jupiter's assets or shader.

The original ring drifted gently while idle, paused under inspection, supported drag momentum, and settled after release. It included arrow controls and keyboard navigation. Touch gestures preserved vertical scrolling, and reduced motion removed idle spin, bobbing and hover tilt. The visible arrow controls were subsequently removed, as recorded below.

The top purple announcement band remains removed. Hero reveal geometry, textures, exported GLB, content and prices are unchanged.

Browser evidence is stored in `artifacts/carousel-v10/`.

## Current sizing and controls

The active carousel now renders sculpted foil volumes through `src/pack-carousel-scene.js`, with the original artwork retained as a fallback. Its framing must keep the front pack fully visible, including its lifted hover pose, at desktop and phone widths. Packs retain their native proportions; partial neighboring packs can remain at the horizontal edges.

The visible “Drag to spin” line and the previous/next/shuffle controls have been removed at the user's request. Dragging, edition tabs and keyboard arrows remain available; **Explore** opens details separately from the touch X-ray toggle. The sizing checks recorded in `artifacts/carousel-sizing/` predate the X-ray addition.

## First-load and fidelity correction

The sine orbit above made front and back wrappers occupy the same horizontal positions. The current presentation uses a spaced front arc with offscreen recycling, retaining depth, yaw, scale and drag inertia. The fallback and WebGL scene share their layout calculations. Phase-by-phase checks cover the entire loop and lifted poses at desktop and phone widths.

All four printed fronts load the exact WebP used by their edition thumbnail. Alternate editions adapt the mesh silhouette to their artwork, preserving native XY-to-UV proportions instead of stretching a new image over the Signature outline. The print shader preserves the artwork's baked gold and foil lighting and adds a small physical reflection, avoiding a second strong metallic lighting pass over the logo.

Initialization waits for the branded entrance to settle and for the carousel to approach the viewport. Animation pauses outside the viewport or when the document is hidden. The first-visit and visual checks are recorded in `artifacts/quality-v4/` and `artifacts/carousel-repair/`; software-rendered timings are diagnostic comparisons, not measurements of phone GPU performance.

## Visible circular arc

The first repair flattened the carousel too far. The current layout follows a true semicircle in a plane tilted 45 degrees: `phi = theta / 2`, `R = spacing / sin(pi / 8)`, `x = R sin(phi)`, with equal vertical rise and backward travel of `R (1 − cos(phi)) / sqrt(2)`. The central wrapper is lower and larger; its neighbours rise, recede and turn along the circle. Only the front semicircle is used, keeping horizontal order monotone and recycling the eight slots outside the viewport. The native artwork, hover, drag inertia and deferred initialization are retained. The shared floor is lowered to preserve room for the central pack and its reflection.

The arc-layout audit checks a perceptible difference in neighbour height, depth and scale, alongside full-loop spacing and hover framing. This evidence is in `artifacts/quality-v5/final/` and predates the X-ray addition.
