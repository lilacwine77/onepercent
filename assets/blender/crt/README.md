# Onepercent CRT

The asset is a fully volumetric ivory CRT monitor adapted from the supplied reference. It replaces the hero pack in the website integration. The screen uses the project's white Pepe artwork. The curved screen is a single opaque PBR surface; reflections and reactive CRT treatment are enhanced by the browser integration.

## Rebuild

From the repository root in PowerShell:

```powershell
node scripts/build-crt-screen.mjs
& 'C:/Users/user/blender.exe' --background --factory-startup --python 'assets/blender/crt/build_crt.py' -- --poster
node scripts/optimize-crt-glb.mjs
node 'C:/Users/user/.codex/tools/web-3d/validate-glb.mjs' 'public/models/onepercent-crt.glb' 'assets/blender/crt/web-validation.json'
```

The builder reads `public/assets/crt-screen.png`, packs it in the native `.blend`, exports a lossless master and produces `public/assets/crt-poster.png`. Blender 5.2.2 LTS was used. The repository optimizer uses the project's local dependencies and preserves the native screen dimensions. `--graybox --render` regenerates the neutral proportion study. `--render` writes a local beauty image instead of the public poster.

## Runtime contract

- Load `public/models/onepercent-crt.glb` with `GLTFLoader` and `MeshoptDecoder`.
- Rotate the complete `CRT_Root` hierarchy. The model origin is near its visual center; it has no stand.
- The screen mesh and material are `CRT_Screen` and `CRT_ScreenMaterial`. UVs span 0–1; the image is upright after glTF import. It is convex by 0.19 units and recessed within the facade.
- In glTF, X is horizontal, Y is up and +Z faces forward. Exact final bounds: X −2.1…2.1, Y −1.7545…1.75, Z −1.3705…1.52.
- `CRT_Case` is the front ivory satin plastic; `CRT_RearCase` the slightly warmer rear shell. `CRT_Recess`, `CRT_Seam`, `CRT_Graphite`, `CRT_Metal`, `CRT_Logo` and `CRT_StatusLED` preserve stable material identities.
- The web file uses quantized Meshopt geometry. Shader changes should use `vMapUv`/UVs or world positions instead of assuming unquantized local positions. Preserve the decoded node matrices and scale.
- No baked action is exported: subtle pointer movement and hover scanlines are renderer interactions. The native source includes the beauty rig; camera and lights are intentionally excluded from GLB.

## Files and verification

- `build_crt.py`: deterministic source; `onepercent-crt-source.blend`: packed editable source.
- `onepercent-crt-master.glb`: lossless uncompressed master, 2,330,048 bytes.
- `../../../public/models/onepercent-crt.glb`: optimized runtime, 555,440 bytes, 45,944 triangles, 32 meshes and 9 materials.
- `metrics-authored-final.json`, `metrics-fresh-import-final.json`: technical inspection, no invalid vertices, degenerate faces, zero-length edges or missing materials. The native inspector counts mesh objects only, omitting the editable FONT logo; the builder and GLB counts include it.
- `web-validation.json`: zero errors and zero warnings for original and decoded validation. Informational entries note supported runtime extensions, unused UV channels on solid-color materials and the non-power-of-two 1536×1152 screen image.
- `evidence-final-v2/`: six standardized geometry views rendered from a fresh import before the texture-only revision. Hero and all six views were opened and reviewed. The inner mould line is assigned to the bezel's existing faces, avoiding a superimposed strip that could shimmer after quantization.
- `texture-revision-fresh-import.png`: current screen artwork after independent GLB import under the unchanged beauty camera and lighting. The oversized background `1% 1%` was removed; Pepe, small logo, header and footer remain. Native PNG, packed blend image and embedded GLB PNG hashes match.
- `texture-revision-invariants.json`: exact geometry, normals, indices, transforms, hierarchy, material parameters and screen UV comparison against the preserved candidate. Unused UV channels on constant-color parts have only Blender Float32 interpolation differences up to 1.2e−7. The modeling source is byte-identical.
- `reference-comparison-final/`: supplied-reference silhouette comparison using the authored camera. It is a visual comparison without a subject mask or numerical similarity claim. The image's rear step remains an interpreted smooth taper rather than a manufacturer-exact reconstruction.
- `final_report.md`: stage outcomes and review findings. Initial graybox and repair diagnostics are retained as work evidence.

The finished master opens without external texture files. Browser interaction validation is recorded with the web integration, separately from Blender's material and geometry checks.

The pre-revision candidate, including source, master, web GLB, texture, poster and metrics, is retained under `artifacts/crt-v2/before/` using its original repository-relative paths. `iteration_review.json` records the targeted texture repair and its accepted checks. `texture-revision-file-manifest.json` records final artifact hashes and byte counts.
