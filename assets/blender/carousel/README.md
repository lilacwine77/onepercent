# Signature carousel volume

`public/models/onepercent-carousel.glb` is a real closed-volume foil pack derived from the authoritative `onepercent-foil-master.glb`. It has the same native Signature front and branded reverse artwork, embossed 1% mark, curved broad foil facets, puffed body and narrow connected seal. It is separate from both the canonical turntable and the two-sheet opening animation.

## Rebuild

From the repository root:

```powershell
node assets/blender/carousel/build_carousel.mjs
& 'C:/Users/user/blender.exe' --background --factory-startup --python assets/blender/carousel/build_source.py
& 'C:/Users/user/blender.exe' --background --factory-startup --python assets/blender/carousel/build_source.py -- --fresh
node 'C:/Users/user/.codex/tools/web-3d/validate-glb.mjs' public/models/onepercent-carousel.glb assets/blender/carousel/runtime-validation.json
node assets/blender/carousel/make_contact_sheet.mjs
```

The JS entry point simplifies only interior geometry and keeps boundary vertices locked. It removes duplicate and zero-area triangles already present at the source's seal extremities. The canonical seal's inward winding and normals are reversed in this derived asset so the connected rim faces outward; its DoubleSide material is retained. The native textures are converted losslessly to WebP, and Meshopt compresses full-precision positions. The default 14-bit quantization was deliberately excluded because it collapsed tiny triangles along the crimped seal. The Blender script creates a packed editable `.blend`, studio cameras and independent fresh-import evidence.

## Runtime contract

| Property | Value |
| --- | --- |
| Runtime bytes | 4,690,396 |
| Triangles | 45,312: front 31,977; reverse 7,179; seal 6,156 |
| Vertices | 25,052 |
| Width / height / depth | 3.404531 / 3.849814 / 0.699660 scene units |
| glTF orientation | front +Z, up +Y; origin preserved |
| Front / back artwork | Native 1254 × 1254, lossless WebP |
| Front / reverse materials | Metalness 0.62, roughness 0.28, clearcoat 0.18 |
| Edge material | Metalness 0.94, roughness 0.20, clearcoat 0.28 |

The node and material slots are `Printed front`, `Branded reverse` and `Sealed foil edge`. Three.js sanitizes node spaces into underscores; material names remain unchanged. Front and reverse retain their original full-image UV coordinates; the reverse's U orientation is intentionally mirrored to its physical silhouette. The constant metal edge needs no UV. Embedded maps are already vertically flipped and GLTFLoader handles their `flipY = false` convention. When substituting the original external `/assets/pack-closed.png` or other native pack images through TextureLoader, use `flipY = true`, `SRGBColorSpace` and appropriate anisotropic filtering. The external native images and the embedded GLB image bytes have opposite row order. Do not independently stretch UVs to change the wrapper's screen proportions.

The carousel should share the asset's geometry and texture resources among its copies. Its browser renderer owns shadows, studio reflections, pointer tilt, raycasting and edition changes. Geometry is static and has no baked animation.

## Native artwork and spacing correction

The closed-volume GLB remains unchanged. The browser now loads the exact same native image URL as each edition thumbnail, including Signature. Its printed front preserves the sRGB artwork without ACES grading; only a bounded moving specular reflection is added. Metallic lighting remains on the seal and reverse. This prevents the reconstructed embossing and a second strong lighting pass from changing the photographed logo.

For the other editions, the front UV fit also moves the closed shell's XY positions to their matching native-image coordinates (`x = 4u − 2`, `y = 4v − 2`). The original Z volume is retained. This preserves the edition's actual silhouette and logo proportions instead of stretching its print across the Signature outline. The side and reverse positions follow the same shape mapping so the seal remains attached.

The runtime and loading artwork share `src/pack-carousel-layout.js`. Eight logical slots travel along a spaced front arc; their horizontal order is monotone and they recycle beyond the viewport. The former sine placement overlapped front and rear copies at equal X coordinates. The shared fit includes a half-slot phase and hover clearance, and compilation completes before the first 3D frame replaces the artwork. Before/after visual evidence is retained under `artifacts/carousel-repair/` and the full-cycle browser audit under `artifacts/quality-v4/`.

The current arc is a semicircle tilted 45 degrees, with a visibly lower, larger front pack and neighbours moving upward and back. It retains monotone horizontal order and offscreen recycling. This positioning change leaves the GLB and printed materials unchanged; browser evidence is under `artifacts/quality-v5/`.

## Validation and inspected evidence

The authored master and decoded runtime were imported in separate clean Blender 5.2.2 processes. Both have the same 45,312 triangles, bounds and three materials, with zero nonfinite coordinates and zero degenerate faces. The runtime glTF validator reports zero errors and zero warnings; native non-power-of-two texture sizes and unsupported validator decoding of Meshopt are informational, and the decoded representation passes separately.

Opened and reviewed the native quarter render, fresh front/rear/profile renders and the complete contact sheet at `artifacts/carousel-volume/contact-sheet.png`. The fresh six-angle views show a readable front logo, a connected pinched perimeter, an inflated profile and an intentional branded reverse. Texture-free front/quarter/profile views confirm the logo and folds are actual geometry. The wrapper's photographed slope and asymmetric silhouette are preserved. Evidence is diagnostic asset lighting; final browser lighting and carousel composition require the page's own visual check.

Final evidence files are `authored-metrics.json`, `fresh-metrics.json`, `fresh-front.png`, `fresh-quarter.png`, `fresh-back.png`, `fresh-left.png`, `fresh-right.png`, `fresh-top.png`, `clay-front.png`, `clay-quarter.png` and `clay-right.png` under `artifacts/carousel-volume/`. Compact runtime validation is retained beside the editable source.
