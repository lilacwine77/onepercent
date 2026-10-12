# Pack carousel refinement — 2 October 2026

The user found the original eight-copy ring too wide, crowded and flat. The carousel now presents one front pack with separated, smaller side copies on an open curved track. There are five visible positions on desktop and three on a narrow viewport; offstage copies fade before wrapping to the other side.

## Changes

- Portrait presentation of the existing wrapper art: 0.65 width/height on desktop, 0.59 on narrow stages. Thumbnail artwork uses the same elongated treatment. Masters and hero reveal textures are unchanged.
- Side packs scale down, rise and turn inward. Explicit depth ordering keeps the front pack dominant; the previous wall of overlapping wrappers is removed.
- A diffuse lilac floor light, individual contact shadows and short blurred reflections ground the packs. A restrained specular band follows the pose, masked to each wrapper's alpha so no rectangular overlay is visible.
- Dragging keeps inertia, then settles on a centered pose. Catching a moving pack stops its pending ease immediately. Previous, next, spin and keyboard controls remain available.
- Vertical touch intent leaves page scrolling intact. Dragging moves keyboard focus to the orbit, so no focused clone is hidden as it passes offstage.
- The purple announcement band above the navigation is removed. Navigation now starts at the top edge, with mobile hero clearance adjusted accordingly.

## Verification

- Production builds of the landing and reusable reveal module pass.
- Desktop and narrow mobile layouts inspected in Chrome. The mobile track clips offstage copies without adding horizontal page overflow.
- Dragging moves the packs without opening a details dialog, then recenters a pack. Clicking the pack after a drag opens its details; Escape closes them.
- Edition selection, keyboard navigation and vertical page scrolling over the track checked.

The carousel is a lightweight DOM/CSS presentation, with no new textures or GLB downloads. The four editions, prices, details dialogs and page content remain the same. Screenshots and browser checks are stored in `artifacts/carousel-v9/`.
