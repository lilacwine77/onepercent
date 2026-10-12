# Volumetric pack carousel

The pack selector now renders a single Three.js scene instead of rotating flat wrapper images. Eight instances share the sealed pouch geometry. The Original, Blue Shift, Signature and After Hours retain the existing artwork and prices.

## Model and appearance

- Runtime: `public/models/onepercent-carousel.glb` (4,690,396 bytes; 45,312 triangles).
- Editable Blender source and reproducible builders: `assets/blender/carousel/`.
- Connected front, reverse and sealed rim; curved body, sculpted folds and raised 1% mark.
- The derived rim has outward triangle winding and normals. Canonical reveal and turntable assets are unchanged.
- Studio environment reflections use the real surface normals. Hover changes the pouch orientation and elevation. Ground shadows and a faded mirrored mesh follow its pose.
- Native external edition maps use `flipY=true`; embedded GLB maps keep the loader's orientation. Their UVs are fitted to the common silhouette without changing the source image files.

## Interaction and framing

Drag horizontally to rotate the ring; vertical touch gestures continue page scrolling. Arrow keys and the visible controls rotate it. Click a pouch or use Explore this pack to open the existing concept details. Edition tabs support arrows, Home and End.

The camera uses a fixed vertical field with room for the maximum lift, tilt and bob. Mobile intentionally shows a window into the ring, with neighboring pouches extending past the sides. Pack tops stay inside the canvas. Hover holds a stable region spanning the resting and raised bounds so the target cannot move away from a stationary pointer.

The renderer loads near the viewport, shares meshes and cached edition materials, bounds the drawing buffer, and stops rendering offscreen or in a hidden document. Reduced motion disables idle rotation, bob, hover lift and cursor tilt. Artwork remains available as a fallback if WebGL or model loading fails.

## Verification

Asset reports in `assets/blender/carousel/` record fresh GLB import, finite geometry, zero degenerate faces, correct surface names and glTF validation. Browser evidence and responsive interaction checks are retained in `artifacts/carousel-volume/` in the working directory. The integration kit includes the source, runtime and compact reports.
