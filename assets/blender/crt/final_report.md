# CRT asset completion report

Status: modeling, material, source, export and fresh-import gates complete. Browser interaction is owned by the website integration.

## Stage outcomes

1. Contract and references: the supplied image was opened and its visible proportions, shell depth, smooth ivory plastic, inset glass, lower controls and vents recorded in `reference_notes.md`. Hidden rear construction is explicitly inferred.
2. Neutral proportion review: `graybox.png` and `graybox.blend` retain the first neutral material view. Broad bezel, 4:3 display and deep taper are coherent from three-quarter view. Primary proportions were retained through later detail.
3. Primary and secondary forms: continuous sculpted bezel, convex grid screen, closed tapered rear shell, casing seam, stepped inner molding, control insert, two buttons and LED.
4. Structure and topology: side openings are real boolean cuts with beveled lips and controlled normals. Bottom ventilation is bounded by trim. The preliminary lower comb appearance was corrected by recessing the louvres. Repeated static elements have applied transforms before joining. The first VGA contact bevel was diagnosed and narrowed to remove 180 degenerate source faces; final fresh import reports no degeneracy.
5. Materials and texture: nine named PBR materials; packed 1536×1152 screen artwork; full-range upright UVs; no stacked coplanar glass pane. Warm ivory plastic, cavity and trim variation, metal contacts and a restrained status LED are visible.
6. Polish: soft manufactured edges, smooth glass bulge, metallic 1% mark, physical rocker/power controls, rear socket detail, side/back/underside ventilation. The final transparent 1400×1400 poster was opened and checked after the last source build. Beauty lighting gives broad controlled highlights; the stronger interactive light/reflection response is supplied by the browser.
7. Export: the final source was generated in a new Blender 5.2.2 LTS process. Master GLB was imported in another new process. The six-view contact sheet and separate hero render were opened; orientation, surface continuity, ports, seam, glass image and rear taper are coherent. Web optimization preserved root, every node name and all nine material names.

## Final measurements

| Measurement | Result |
|---|---:|
| Master GLB | 2,330,048 bytes |
| Web GLB | 555,440 bytes |
| Evaluated/exported triangles, including logo | 45,944 |
| Exported mesh objects | 32 |
| Materials | 9 |
| Width × height × depth, glTF | 4.2 × 3.5045 × 2.8905 |
| Screen surface | 3.34 × 2.50; bulge 0.19 |
| Invalid coordinates | 0 |
| Degenerate faces / zero-length edges | 0 / 0 |
| Missing-material faces | 0 |
| glTF validation errors / warnings | 0 / 0 |

Open screen boundary is intentional. Imported glTF duplicates vertices on UV and normal seams, so its raw boundary count is not a solid-manifold manufacturing test. Source mesh inspection excludes the editable FONT logo whereas the exported mesh total includes its 2,680 triangles. All authored and imported bounds agree.

## Visual review and limitations

The final reference overlay corrects the initial oversized framing, preserving a comparable three-quarter roll and the primary front silhouette. No mask or numerical similarity score was used. The new shell is deliberately smoother, with an inferred tapered rear instead of claiming exact recovery of unseen surfaces. The reference is used as shape and finish direction; its Vibe branding and web content are replaced.

Six required views show a finished product asset, with functional vents and ports, and no stand. At the intended hero view the screen remains the focal point. The bare PBR export contains constant material values and the display image; browser environment lighting, pointer easing and analog-screen effect are separate renderer behavior. This report does not claim measured mobile performance or browser hover validation.

Final browser review exposed a fine dotted inner trim at the bezel. That strip was replaced with a material band on existing bezel faces, eliminating the overlapping surface. The final revision was rebuilt, freshly imported, rendered in all six views again and reinspected with no topology findings. Primary geometry and bounds are unchanged. The reference overlay predates this purely local trim-material correction.

Evidence: `public/assets/crt-poster.png`, `assets/blender/crt/evidence-final-v2/contact_sheet.png`, `assets/blender/crt/evidence-final-v2/perspective.png`, `assets/blender/crt/reference-comparison-final/comparison.png`, and the final JSON reports in this directory.

## Targeted screen revision

The oversized `1% 1%` behind Pepe was removed from the SVG construction in `scripts/build-crt-screen.mjs`; the original mascot image, small header logo, Onepercent label and footer are unchanged. The previous source/master/web files, screen texture, posters and metrics were preserved under `artifacts/crt-v2/before/` before editing.

The screen PNG, packed `.blend`, lossless master, optimized web GLB and PNG/WebP posters were rebuilt through the same deterministic pipeline. Current embedded and native-packed screen content matches the PNG hash. Source poster and fresh-import poster were both opened using the same beauty camera and lights; the large text is absent and Pepe remains intact/readable.

`texture-revision-invariants.json` confirms byte-identical modeling source and identical exported positions, normals, indices, transforms, hierarchy, material parameters, screen UVs, names, counts and bounds. The only non-image differences are unused UV interpolation roundoff on solid-color plastic/metal parts (maximum 1.1920928955078125e−7); these do not affect visible geometry or materials. Fresh source/import inspections remain clear, and current web validation reports zero errors and warnings.

Final WebP poster: 72,066 bytes. Current web GLB SHA-256: `7FA8C3732C37A34E27C937746D1A9321D4F81C0BA75768D4DDEA9C6F54AC499E`. Current texture evidence: `texture-revision-fresh-import.png`, `public/assets/crt-screen.png` and `public/assets/crt-poster.png`. The previous six-view evidence remains valid for unchanged geometry and is labeled as preceding the texture edit.
