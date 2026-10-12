# Signature foil turntable — modeling contract

- **Purpose:** a sealed holographic Signature pack with a complete 360° turn for the editorial website.
- **Bound reference:** exact front art and alpha silhouette from `public/assets/pack-closed.png`. The matching holographic `pack-back.png` informs the reverse; its hidden construction is inferred.
- **Parts:** one continuous curved front, a separately curved branded reverse, and a narrow joined metallic hem along the heat-sealed perimeter.
- **Shape:** about 4 × 4 scene units; a curved pillow body with pinched sides, four sculpted foil facets aligned to the front artwork, and a raised gold 1% mark with rounded transitions. The source geometry has 366,604 triangles; the front uses denser topology than the reverse to resolve the logo and folds.
- **Materials:** native 1254² front/back art, no albedo blur or global luma-derived displacement/normal map. A local binary glyph mask defines the 1% contour; authored heights define its embossing independently of pixel brightness. Metallic PBR response to broad studio cards. Rear ink stamp reads correctly at 180°.
- **Motion:** stable group pivot controlled by website scroll from 0–360°. The GLB has no baked animation.
- **Finish checks:** sharp raised gold 1% and lower label; folds and raised lettering remain visible with every texture map removed. Moving highlights, readable reverse, no ghosted front logo, open hole, detached side, straight rectangular wall, or doubled seam at front, quarter, profile, rear angles.
- **Deliverables:** reproducible JS geometry source, Blender builder, editable packed `.blend`, uncompressed master GLB, lossless texture/Meshopt runtime GLB, four preview PNGs, and validation report.
- **Boundary:** this sealed turntable pack is separate from the two-sheet tear animation and white Pepe reveal.
