# 1% site v2 — visual provenance and reference choreography

This file records the new visual campaign as assets are accepted. The user's [Vibe Bevvy](https://vibebevvy.com/) reference and supplied screenshots guide **composition, sequence and motion**. No Vibe photograph, can artwork, logo or page copy is included in the 1% asset set. The original holographic 1% pack artwork came from the user and remains at `public/assets/pack-reference.jpg` for provenance only; it contains the spotted character and must not appear in the new page.

## Reference choreography translated to 1%

| Reference section's job | 1% translation |
| --- | --- |
| Full-bleed lifestyle hero and oversized brand line | Violet-and-gold studio photograph, large `RIP. REVEAL. OWN.` type and the scroll-driven pack opening with fully white Pepe. |
| Four tightly arranged product cans | Four isolated foil packs in original holographic, electric blue, pearl lilac and deep violet. Cards keep image/finish/guide-price rhythm; names, prices and descriptions live in HTML. |
| Product hero surrounded by ice | A 1% pack placed among gold `%` tokens and a separate close-up token bed. These are visual props, not a native token or financial reserve. |
| Large feature photograph with short benefit rows | A gacha-machine editorial scene beside four concise rules about deposited inventory, displayed odds, one revealed token lot and proposed sponsor-funded drops. |
| Quoted social proof | A graphic carousel of product principles. No invented customers or reviews. |
| Moving slogan and spinning can | The existing pack motto as marquee, followed by a code-driven 3D pack turntable over oversized `1%` typography. The turntable is not a raster can replacement. |
| Lifestyle/story image and editorial cards | All-white Pepe mascot and a foil-hands photograph, followed by concise player, LP and sponsor paths. |
| Moving visual gallery | Project imagery only: foil, tokens, gacha, Pepe and generated lifestyle scenes. |

The first-visit scribble and the wave wipe are implemented as SVG paths and timing in `src/entrance.js` and `src/entrance.css`, following the reference site's entry choreography with 1% colors and glyph. They are code-driven effects, not part of an imagegen bitmap.

## Eight newly generated v2 scenes

All files in this table were created with the built-in **imagegen** tool on 1 October 2026. They depict a concept, not live tokens, available packs or a functioning gacha. The exact delivered asset, not its prompt alone, must be inspected before use.

| File | Generation direction and intended use | Review |
| --- | --- | --- |
| `public/assets/hero-studio.png` | New 1,672 × 941 violet studio with warm light and scattered gold `%` forms; open space for the hero title and live pack. | Visually clean; no readable generated copy. |
| `public/assets/token-bed.png` | New 1,122 × 1,402 close-up of gold `%` coins and metallic nuggets, replacing the reference's ice texture in a product scene. | Visually usable as a texture or scene background. |
| `public/assets/gacha-editorial.png` | Corrected 1,122 × 1,402 gacha machine containing a foil 1% pack and gold `%` tokens. The corrected imagegen output `exec-ecb0992b-5797-458c-8ea6-ad906a7bc5f0.png` replaced an earlier version with invented copy. Intended for the image-led mechanics section. | Inspected at full size: the unrelated signs and `TRADING CARD PACK` text are gone. The pack shows `1%` and `RIP. REVEAL. OWN.`; the machine has a `ONEPERCENT` plaque. |
| `public/assets/hover-original.png` | New 1,122 × 1,402 product close-up of the original holographic 1% foil among gold `%` coins and nuggets. Intended as the Original card's image-swap scene. | Visually consistent with the pack art; exact pack motto is legible. |
| `public/assets/hover-blue.png` | New 1,122 × 1,402 close-up of the electric blue foil edition among the same gold props. Intended for Blue Shift's image swap. | Visually consistent with the blue pack art; exact pack motto is legible. |
| `public/assets/hover-lilac.png` | New 1,122 × 1,402 close-up of the pearlescent lilac foil edition among gold props. Intended for Pearl Drop's image swap. | Visually consistent with the pearl pack art; exact pack motto is legible. |
| `public/assets/hover-purple.png` | New 1,122 × 1,402 close-up of the deep violet foil edition among gold props. Intended for After Hours' image swap. | Visually consistent with the violet pack art; exact pack motto is legible. |
| `public/assets/campaign-hands.png` | New 1,672 × 941 warm close-up of hands tearing the holographic pack, with lilac nail color. Intended for the editorial/lifestyle band. | Visually clean; the `1%` and `RIP. REVEAL. OWN.` marks remain readable. |

The eight files above are actual delivered outputs, not prompts or planned assets. Each was inspected as an image file; this does not verify its final crop, animation or browser rendering.

## PNG masters and WebP delivery

The page serves `.webp` derivatives at the PNG masters' original dimensions. `scripts/optimize-images.mjs` regenerates them with `npm run assets:optimize`; the masters remain in `public/assets/` for editing and provenance. The fifteen converted assets are `hero-studio`, `token-bed`, `gacha-editorial`, `hover-original`, `hover-blue`, `hover-lilac`, `hover-purple`, `campaign-hands`, `pack-closed`, `pack-first-light`, `pack-prism`, `pack-after-hours`, `pepe-mascot-white`, `pepe-all-white` and `pack-3d`. Together they measure **40,401,213 bytes as PNG** and **7,322,006 bytes as WebP**, an **81.9%** reduction. The scroll-driven pack reveal retains its original PNG texture inputs in `src/pack-reveal.js`.

## Ninth output: rear pack texture

`public/assets/pack-back.png` is a separate **imagegen edit** of `pack-closed.png`, delivered as `exec-045a49da-d8ba-4bf4-913c-3f4d5aaf4001.png` on 1 October 2026. It is a 1,254 × 1,254 transparent rear texture for the volumetric turntable. The direction preserved the original pack's foil wrinkles and silhouette, replaced the front `1%` graphic with `ONEPERCENT` and `RIP. REVEAL. OWN.`, and introduced a vertical heat-sealed rear seam. The user's original art did not show the back; this is a generated interpretation for the rotating model, not a documented physical reverse side. The scroll-driven Pepe reveal and its GLB still use the front pack and all-white character textures.

The rotating sealed pack uses this back texture on an independent volumetric asset. `src/pack-turntable-source.js` defines its editable geometry and materials; `assets/blender/onepercent-foil-source.blend` is the editable Blender document, and `assets/blender/onepercent-foil-master.glb` is the uncompressed master export. The website loads the optimized `public/models/onepercent-foil.glb` through `src/pack-turntable.js` near the turntable section. Its named surfaces are **Printed front**, **Branded reverse** and **Sealed foil edge**. The source and rebuild instructions are in [assets/blender/README.md](../assets/blender/README.md). This sealed model does not replace the animated, connected foil sheets and white Pepe in `public/assets/one-percent-pack.glb`.

## Reused project assets

- `public/assets/pack-closed.png` and the blue, pearl and violet foil variants are earlier imagegen edits of the user's pack reference. They remain the source for the four product cards.
- `public/assets/pepe-all-white.png` is the current WebGL/GLB character texture. `public/assets/pepe-mascot-white.png` is a separate transparent editorial illustration. Both were generated from the original project art, with an explicit all-white character direction.
- `public/assets/pack-gold-tokens.png`, `foil-hands-banner.png` and `pack-3d.png` are earlier 1% concept visuals. `pack-3d.png` is raster fallback art, not the code-driven model or GLB.

All product labels, prices, probabilities and calls to action should remain live HTML rather than generated text embedded in a bitmap. The sole pack status line must make clear that guide prices are creative targets and the model is not for sale.
