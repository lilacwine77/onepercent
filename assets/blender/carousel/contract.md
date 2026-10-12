# Carousel Signature volume

- Derive a separate runtime LOD from the authoritative Signature master, preserving its native 1254² artwork, sculpted 1% mark, connected foil facets, softly inflated body and sealed perimeter.
- Preserve the front/back UVs and original native silhouette. Do not stretch the artwork or use flat sprites.
- Keep three named mesh/material slots: `Printed front`, `Branded reverse`, `Sealed foil edge`.
- The derived seal must face outward: repair canonical inward winding and normals, retaining the DoubleSide material for the thin hem. Do not change the canonical master.
- Native external artwork replacements use `flipY = true`; embedded GLB image bytes are already vertically flipped and GLTFLoader uses `flipY = false` for those.
- Aim for 40–50k triangles, shared among the carousel copies. This is a smooth product model, not a visibly faceted low-poly design.
- The parent task owns Three.js carousel layout, pointer interaction, edition materials, browser lighting and visual checks.
- Preserve all canonical assets and the unrelated opening animation. New source and evidence live only in this folder; runtime is `public/models/onepercent-carousel.glb`.
- Inspect front, three-quarter, rear, both profiles, top and texture-free clay evidence, including a fresh-import check. Native front artwork and broad physical relief are the acceptance references.

## Reference observations

Opened the canonical `../previews/quarter.png` and `../previews/profile.png`. The wrapper has a puffed foil body with pinched perimeter, large curved triangular facets, a raised 1% mark, and a connected rear. Its tilted photographed silhouette is an identity feature. The carousel should reveal this existing shape through actual lighting and changing perspective. No source image resolution or geometry proportions need to be invented.
