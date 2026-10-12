# Onepercent

The interactive website for **Onepercent**, the 1% Machine on Solana. Feed your dust to the machine, or rip foil packs with real tokens inside: 4 Dust Cards + 1 hit. Go for **the 1%**: four cards of 10,000,000 $1PCT.

**Live site:** [onepercent.fun](https://onepercent.fun)

## Experience

- **Interactive CRT television.** A cream 3D television with the Onepercent identity and all-white Pepe, spring-driven tilt, glass reflections and continuous CRT scanlines. Its smooth entrance is synchronized with the hero copy.
- **A film inside the screen.** Clicking the television, its poster or **Watch the film** zooms into the glass. After the zoom and fade, a 25-second film powers on like a CRT and walks through the real app: an X-ray of real pump.fun dust, the Feed and what a Dust Card can pay when a pack pulls it, a Rip up to a Holo Foil hit, selling it or keeping it, then The 1%. Music, sound effects and bold on-screen type carry it; there is no voiceover. Its end card, “Dust in, Packs out.”, stays on screen with Replay. Closing fades back to Pepe and restores the hero view.
- **An arc of packs.** Four editions—The Original, Blue Shift, Signature and After Hours—follow a visible circular arc with depth, floating motion and reflections. Drag, touch and keyboard controls select an edition; **Explore** opens its details.
- **X-ray token reveal.** Hover a booster to reveal $WIF, $FONE and $JIMOTHY coins in cyan and purple, while the original wrapper artwork returns at rest. Keyboard focus reveals the central pack; tapping toggles the reveal on touchscreens. Reduced motion keeps the revealed view static. The standalone token-logo strip has been removed.
- **Accessible motion.** Keyboard controls, captions, focus restoration and reduced-motion support apply throughout. Static posters and an HTML CRT player keep the experience usable when WebGL is unavailable.

Built with JavaScript, HTML and CSS, using **Vite**, **Three.js** and **Lenis**. Fraunces and DM Sans are bundled locally through Fontsource.

## Local development

Use **Node.js 22** and npm.

```sh
npm ci
npm run dev
```

Open the local address printed in the terminal, normally `http://127.0.0.1:5173`.

```sh
npm test
npm run build
npm run preview
```

The build creates the website in `dist/` and the reusable PackReveal ES module in `dist-lib/`. The local production server normally runs at `http://127.0.0.1:4173`. These commands do not publish the site.

## Validation

With the production build served locally, run the checks relevant to the change:

```sh
node scripts/verify-first-visit.mjs
node scripts/verify-crt-presentation.mjs
node scripts/verify-carousel-presentation.mjs
node scripts/verify-concept-video.mjs
```

The scripts use Chrome through Playwright and save reports and captures under `artifacts/`. They cover first-visit loading, the poster-to-WebGL transition, responsive pack framing and the film player. Inspect the captures alongside the automated results. Detailed procedures and additional lifecycle checks are linked below.

## Asset workflow

The active television is `public/models/onepercent-crt.glb`; its editable Blender source is in `assets/blender/crt/`. The screen artwork, matching poster and prefiltered studio atlas are in `public/assets/`. The film, poster and English captions are in `public/media/`.

```sh
# Regenerate WebP derivatives from the available image masters.
npm run assets:optimize

# Capture the CRT poster while the development server is running.
node scripts/render-crt-poster.mjs

# Film: capture the app frame by frame under virtual time, then render the compositor's frames.
node scripts/film/capture.mjs --profile desktop --out <captures>
node scripts/film/render.mjs --layout 16x9 --cap <captures> --out <frames>
```

The film is made from the real app, served in preview mode with the capture hooks applied; rendering needs Python 3 with Pillow and NumPy, and the encode uses the FFmpeg bundled with Blender. Follow the [film production guide](docs/concept-video.md) for the capture setup, the score, encoding and verification, and the [CRT guide](docs/crt-television.md) for model and lighting reconstruction.

## Reusable PackReveal module

The original foil-opening animation remains available independently of the live television hero. The landing does not load it. It preserves two connected foil sheets, separate character cutouts and the same pack texture throughout the reveal.

After `npm run build`, import `dist-lib/pack-reveal.js` into a project with Three.js installed. Copy `public/assets/pack-closed.png` and `public/assets/pepe-all-white.png` into that project’s public asset directory, and give the container a nonzero width and height.

```js
import { PackReveal } from './dist-lib/pack-reveal.js';

const pack = new PackReveal({
  container: document.querySelector('#pack'),
  assetsBase: '/assets/',
});

await pack.ready;
pack.setProgress(0.5); // Progress ranges from 0 (closed) to 1 (revealed).

// Call pack.destroy() when the containing view is removed.
```

Connect `setProgress()` to your own scroll or animation controller. Three.js remains external to the library bundle. `exportGLB()` returns the animated asset as an `ArrayBuffer`; a ready-made export is also available at `public/assets/one-percent-pack.glb`.

See the [TypeScript API](src/pack-reveal.d.ts), [React / Next.js example](examples/react/PackReveal.tsx) and [its stylesheet](examples/react/pack-reveal.css). The reveal is designed for a frontal view; the separate volumetric pack and editable sources are documented in the [Blender asset guide](assets/blender/README.md).

## Integration kit

Build the modules, then inspect or regenerate the portable kit:

```sh
npm run build
python scripts/package-kit.py --dry-run
python scripts/package-kit.py
```

The archive is written to `deliverables/one-percent-pack-kit.zip`. It includes the current site source, reusable modules, active assets, editable model sources, media masters, documentation and compact validation reports. Archived visual studies and most screenshots remain outside the kit. The packaging script preserves the previous archive if the replacement exceeds its 99 MiB limit.

## Deployment

Production is hosted at [onepercent.fun](https://onepercent.fun) on **Railway**, deploying the repository’s **`main` branch**. The root `Dockerfile` builds with Node.js 22 and serves `dist/` through Caddy. Railway supplies `PORT`; the healthcheck path is `/`.

See the [Railway deployment guide](docs/railway-deployment.md) for service configuration, static asset caching and range-request checks.

## Developer notes

The entrance and hero presentation stay coordinated while heavy GPU preparation is deferred until the entrance has settled and the scene is visible. Model and environment bytes may download earlier; the poster remains until the first rendered frame is ready. Studio reflections use an atlas prefiltered offline, and preparation yields between GPU steps. Offscreen scenes and hidden tabs suspend animation, while reduced motion keeps the television and CRT treatment static without blocking requested video playback.

This repository implements the website’s presentation and interactions; token draws, payments, deposits and smart contracts are not implemented, and desktop browser checks do not guarantee performance on every device.

## Documentation

- [Project context and product decisions](docs/project-context.md)
- [CRT model, integration and validation](docs/crt-television.md)
- [Film production and player behavior](docs/concept-video.md)
- [Pack carousel layout and interactions](docs/carousel-jupiter-v10.md)
- [Token logo sources](public/assets/tokens/SOURCES.md) (rebuild the X-ray coins with `node scripts/build-xray-coins.mjs`) and the [historical logo record](docs/token-carousel-assets.md)
- [Original asset provenance](docs/asset-provenance.md)
- [Standalone pack validation history](docs/verification-v3.md)

The detailed documents retain the research and implementation history; the supplied research material is context rather than a deployment specification.
