# Pack palette refinement — 1 October 2026

## Request and scope

The final user-confirmed order is **The Original — polished silver ($10), Blue Shift — electric blue ($25), Signature — the exact hero holographic pack ($50), After Hours — black/anthracite ($100)**. These are concept prices. Blue Shift retains `pack-first-light.png` and `hover-blue.png`. Signature reuses `pack-closed.png` and `hover-original.png` exactly; the hero's holographic foil and white Pepe reveal remain unchanged. The bronze and lilac/Pearl editions are retained as studies and are not active catalog choices. The rotating 3D pack is being rebuilt separately as a physical silver PBR model; its final delivery and browser verification are tracked in [verification-v3.md](verification-v3.md), not asserted by this image asset review.

The bronze images were generated during an intermediate palette exploration, then removed from the active catalog at the user's request. The anthracite edition retains its After Hours name. The prompts and generated variants below remain unchanged as provenance.

Created with the built-in imagegen tool in edit mode, then encoded with Sharp WebP quality 90, alpha quality 100, effort 6. No CLI/API image generation was used. PNG masters are preserved. Existing source assets remain untouched.

## Asset provenance

| New master | Edit target | Supporting reference | Generated source |
| --- | --- | --- | --- |
| public/assets/pack-silver.png | public/assets/pack-closed.png | None | exec-b3cd7677-205b-45f1-8c38-8678de73f7fd.png |
| public/assets/pack-anthracite.png | public/assets/pack-after-hours.png | None | exec-0a13bfc0-4f86-4c4e-ba3b-15d46b31cdfb.png |
| public/assets/hover-silver.png | public/assets/hover-original.png | public/assets/pack-silver.png | exec-f8d05068-5ea5-493f-ba8b-df88b84a4c40.png |
| public/assets/hover-anthracite.png | public/assets/hover-purple.png | public/assets/pack-anthracite.png | exec-40dacc2b-2366-4b18-96d0-66d6a07939c1.png |
| public/assets/pack-bronze.png | public/assets/pack-silver.png | None | exec-b01113d2-8763-4299-9b6c-3ab4ff490e22.png |
| public/assets/hover-bronze.png | public/assets/hover-silver.png | public/assets/pack-bronze.png | exec-d57bada9-d9c6-4177-9276-b1d144d27609.png |

Generated source directory: `C:/Users/user/.codex/generated_images/01a0f81f-145b-7022-ba19-4ae5123c3b23/`.

Matching WebP files are saved beside each PNG and are the preferred web delivery assets.

| Asset | PNG bytes | WebP bytes |
| --- | ---: | ---: |
| pack-silver | 2,408,955 | 387,862 |
| pack-anthracite | 2,363,151 | 365,838 |
| hover-silver | 3,220,645 | 568,130 |
| hover-anthracite | 3,243,949 | 575,356 |
| pack-bronze | 2,412,841 | 417,672 |
| hover-bronze | 3,113,093 | 540,982 |

## Review

All input images were inspected before edits. All six generated results and their WebP delivery versions were inspected visually. The silver, bronze and anthracite editions are materially distinct; large gold 1% branding and the exact “RIP. REVEAL. OWN.” bottom label remain readable. The bronze wrapper reads copper-brown, distinct from the yellow gold logo and surrounding tokens. Pack silhouettes, serrated crimps, camera angles and corresponding gold-token scenes are preserved closely. Each catalog output is 1254 × 1254 with genuine transparent alpha. Each hover output is 1122 × 1402, opaque. No recolored character or replacement hero wrapper was introduced.

## Prompts

### bronze

```text
Use case: precise-object-edit.
Asset type: Onepercent Bronze Edition catalog pack cutout.
Input image is the EDIT TARGET. Recolor ONLY the silver foil body to rich burnished BRONZE / COPPER metallic foil: medium-deep warm reddish-brown bronze body, copper specular highlights, chocolate bronze shadows. It must read unmistakably warm bronze/copper, clearly distinct from bright silver, black, yellow gold and rainbow. Retain detailed shiny realistic foil wrinkles.
Keep the exact pack silhouette, front camera angle, framing, top and bottom serrated crimps, original wrinkles, embossed logo size/shape/position and bottom label placement. Keep the large embossed "1%" logo rich yellow GOLD across its full face and edges, clearly differentiated from the copper-bronze wrapper, and bottom text rich gold on its original dark label.
Exact text unchanged: "1%" and "RIP. REVEAL. OWN."
Preserve photographic packaging material and crisp edges. No extra text, objects, shadows outside the silhouette, or redesign. Genuine transparent background alpha, preserving the existing transparent outside.
```

### hoverBronze

```text
Use case: precise-object-edit.
Asset type: Onepercent Bronze Edition pack-on-gold-tokens hover editorial photograph.
Input image 1 is the EDIT TARGET, the silver pack on a bed of gold percent coins and nuggets. Input image 2 is the desired BRONZE pack material/branding reference only.
Change ONLY the material color finish of the existing pack in image 1 to match the rich burnished bronze/copper foil in image 2. It must read warm reddish-brown bronze with copper highlights, chocolate-bronze shadows and crisp reflective foil wrinkles. The embossed "1%" logo stays bright rich yellow GOLD, visibly different from the copper-bronze wrapper; bottom text remains gold "RIP. REVEAL. OWN." on the original dark label.
Keep EXACTLY existing image 1 composition, pack position, angle, dimensions, silhouette, wrinkle shapes, camera perspective, cropping, every gold coin and nugget, golden percent coin faces, warm photographic lighting, granular photographic texture and depth of field.
Do not rearrange anything, don't add text, don't change the bed or label, don't add transparent areas. No blue, magenta, purple or rainbow foil. The wrapper must be distinguishable from the yellow gold token bed through its rich copper-brown bronze color. Photorealistic faithful material recolor.
```


### silver

```text
Use case: precise-object-edit.
Asset type: Onepercent catalog pack cutout.
Edit the supplied holographic foil pack photograph. Change ONLY the foil material color finish from rainbow holographic to bright polished SILVER / neutral CHROME. It must read clearly silver, with white and dark silver reflections, restrained metallic specular wrinkles. Remove ALL purple, blue, pink, orange, cyan and rainbow iridescence from foil.
Keep the exact pack silhouette, front camera angle, framing, top and bottom serrated crimps, original wrinkles, logo size and position, and bottom label placement. Keep the large embossed "1%" logo rich yellow GOLD across the full logo face and edges, and bottom text rich gold on its original dark label.
Exact text unchanged: "1%" and "RIP. REVEAL. OWN."
Preserve physically believable luxury foil packaging, photographic material texture and crisp edges. No extra text, objects, shadows outside silhouette, or redesign. Transparent background with genuine alpha; preserve the existing transparent outside.
```

### anthracite

```text
Use case: precise-object-edit.
Asset type: Onepercent After Hours catalog pack cutout.
Edit the supplied purple/rainbow foil pack photograph. Change ONLY the foil material color finish to deep BLACK / ANTHRACITE graphite metallic foil. Rich charcoal-black body with subtle silvery graphite highlights on the existing wrinkles; definitely dark black overall, not purple, not light gray. Remove ALL purple, blue, pink, orange, cyan and rainbow iridescence from foil.
Keep exact pack silhouette, front camera angle, framing, top and bottom serrated crimps, original wrinkles, logo size and position, bottom label placement. Keep the large embossed "1%" logo rich yellow GOLD across the full logo face and edges, and bottom text rich gold on its original dark label.
Exact text unchanged: "1%" and "RIP. REVEAL. OWN."
Preserve physically believable luxury foil packaging, photographic material texture and crisp edges. No extra text, objects, shadows outside silhouette, or redesign. Transparent background with genuine alpha; preserve the existing transparent outside.
```

### hoverSilver

```text
Use case: precise-object-edit.
Asset type: Onepercent pack-on-gold-tokens hover editorial photograph.
Input image 1 is the EDIT TARGET, an overhead pack in a bed of golden percent coins and nuggets. Input image 2 is the desired SILVER pack material/branding reference only.
Change ONLY the material color finish of the existing pack in image 1 to match the silver/chrome foil in image 2. It must read polished neutral bright silver with white and dark silver specular wrinkles, no rainbow. The large "1%" logo is rich yellow GOLD across full face and edge; bottom text remains gold "RIP. REVEAL. OWN." on the original dark label.
Keep EXACTLY the existing image 1 composition, pack position, angle, dimensions, silhouette, wrinkle shapes, camera perspective, cropping, every gold coin and nugget, golden percent coin faces, warm photographic lighting, granular photographic texture and depth of field. Gold reflections from nearby coins can be subtle warm highlights on silver, but the body reads silver.
Do not rearrange anything, don't add text, don't change the bed, don't add transparent areas. No blue, magenta, purple or rainbow foil. Photorealistic faithful material recolor of the input photograph.
```

### hoverAnthracite

```text
Use case: precise-object-edit.
Asset type: Onepercent After Hours pack-on-gold-tokens hover editorial photograph.
Input image 1 is the EDIT TARGET, an overhead pack in a bed of golden percent coins and nuggets. Input image 2 is the desired BLACK / ANTHRACITE pack material/branding reference only.
Change ONLY the material color finish of the existing pack in image 1 to match the deep anthracite graphite foil in image 2. It must read dark black with subtle silver graphite specular wrinkles, no rainbow. The large "1%" logo is rich yellow GOLD across full face and edge; bottom text remains gold "RIP. REVEAL. OWN." on the original dark label.
Keep EXACTLY existing image 1 composition, pack position, angle, dimensions, silhouette, wrinkle shapes, camera perspective, cropping, every gold coin and nugget, golden percent coin faces, warm photographic lighting, granular photographic texture and depth of field. Gold reflections from nearby coins can be subtle warm highlights on dark graphite, but the body reads black.
Do not rearrange anything, don't add text, don't change the bed, don't add transparent areas. No blue, magenta, purple or rainbow foil. Photorealistic faithful material recolor of the input photograph.
```
