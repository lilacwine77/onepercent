# Signature foil turntable

The website rotates `public/models/onepercent-foil.glb`. It is the **Signature holographic pack** from the hero, with the exact `pack-closed.png` front artwork. Its three connected surfaces are **Printed front**, **Branded reverse**, and **Sealed foil edge**. The separate opening animation and white Pepe remain in `public/assets/one-percent-pack.glb`.

## Rebuild

From the repository root, with dependencies installed:

```powershell
node scripts/export-turntable-master.mjs
& 'C:/Users/user/blender.exe' --background --factory-startup --python assets/blender/build_foil_source.py
node scripts/optimize-turntable-glb.mjs
node 'C:/Users/user/.codex/tools/web-3d/validate-glb.mjs' public/models/onepercent-foil.glb assets/blender/runtime-validation.json
& 'C:/Users/user/blender.exe' --background assets/blender/onepercent-foil-source.blend --python assets/blender/verify_foil_source.py
```

The deterministic geometry and textures are authored in `src/pack-turntable-source.js`. The front uses `public/assets/pack-closed.png` at its **native 1254 × 1254 resolution** without blur or recoloring. `public/assets/pack-back.png` supplies the matching holographic reverse; a small dark ink panel keeps the reverse brand stamp readable when the photo is aligned to the mirrored physical silhouette. The front now has real geometric relief: four broad curved foil facets follow the photographed creases, while a local binary mask of the 1% glyphs defines a raised mark with rounded transitions. Only the contour is segmented from the picture; the relief height is authored independently of pixel brightness. Small internal mask gaps are filled while the two percent counters remain recessed. Body curvature and seal folds are authored mathematically. The front relief is absent from the reverse, so the logo cannot emboss through it.

`onepercent-foil-master.glb` is the uncompressed reference export. `onepercent-foil-source.blend` is the packed editable Blender scene with four inspection cameras, four preview renders in `previews/`, and the three imported material meshes. The optimized runtime GLB uses Meshopt geometry compression and **lossless WebP textures at native resolution**. It is 6,306,676 bytes, with 185,706 vertices and 366,604 triangles. The website's studio environment supplies reflections that move as the pack turns; the Blender preview rig is a separate inspection lighting setup.

The website cache key is `signature-relief-6`. Browser checks and texture-free clay views for this revision are in `artifacts/v6/`; those screenshots stay in the workspace and the compact validation report is included in the integration kit.
