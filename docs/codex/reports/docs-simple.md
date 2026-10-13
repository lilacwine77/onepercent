# Docs simplifiée, 13 octobre 2026

Page `/docs` après la PR #87, sur `feat/docs-simple`.

Six sections et une introduction de deux lignes. Le texte reste en anglais, comme l’app. Les adresses courtes sont copiables dans leur section ; les quatre adresses complètes restent accessibles en bas. Le tableau conserve les probabilités exactes issues de config.

Le rendu desktop contient 495 mots, ou 518 avec les adresses dépliées, contre 1 176 auparavant. La comparaison avec toutes les adresses représente **44,0 % du texte initial**. Le mobile ajoute cinq mots pour signaler le défilement du tableau.

## Captures

- [Desktop, 1440 px](docs-desktop.png)
- [Mobile, 375 px](docs-mobile.png)

Captures Chromium du rendu final avec les fixtures habituelles de l’app. Avant ces captures, les mêmes tests vérifient la page avec l’API hors ligne, les images chargées, l’absence de débordement de page, axe et la CSP. Sur mobile, le tableau est aussi défilé jusqu’à After Hours.

Les deux images affichées dans la page viennent de l’app preview réelle : fin d’un Rip, puis My cards après le même tirage démo. Le badge Demo et les légendes explicitent les données de démonstration. Aucune interface n’a été recréée pour les images. Les adaptateurs preview, les fixtures config/RPC existantes et l’horloge de `scripts/film/virtual-time.js` ont permis la capture de l’animation sous Chromium.

Capture source 1200 × 900, réduction Lanczos en 960 × 720 et WebP qualité 75, méthode 6 :

| Image | Octets |
| --- | ---: |
| `rip.webp` | 42 406 |
| `cards.webp` | 40 984 |
| Total | 83 390 (81,4 Kio) |

Les images ont des dimensions réservées, `loading="lazy"` et `decoding="async"`.

## Vérifications

Node 22.22.3, pnpm 10.34.5. Commandes depuis `app/` :

- `pnpm --filter web test --testTimeout=30000` : 73 fichiers, 591 tests passent. Le premier passage au délai standard de 5 secondes a dépassé ce délai dans deux tests Feed existants (`plan` et `run`). La relance complète avec 30 secondes passe, sans modification de ces tests.
- `pnpm --filter @onepercent/copy test` : 25 tests passent, dont la parité avec `COPY.md`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm lint:words` : passent.
- `pnpm --filter web test:static`, `pnpm --filter web build`, `pnpm --filter web dist:check` : passent.
- `pnpm --filter web budget` : aucune limite dépassée.
- Depuis `app/apps/web/`, `DOCS_SCREENSHOTS_DIR="$PWD/../../../docs/codex/reports" pnpm exec playwright test w1-docs.spec.ts --project=fixtures` : 3 tests Chromium passent, zéro violation axe ou CSP.

| Budget gzip | Mesuré | Limite |
| --- | ---: | ---: |
| JS initial | 119 554 | 123 000 |
| Route Docs, dépendances différées comprises | 15 097 | 250 000 |
| CSS initial | 21 623 | 30 000 |
| CSS Docs | 1 115 | 16 000 |

Le budget automatisé mesure JS/CSS ; les 83 390 octets d’images sont indiqués séparément ci-dessus.

Les limites de Sell, le partage des frais à la collecte, le stock sous 2 SOL, la fermeture des ventes, Final Pull différée et le pouvoir de mise à jour du fondateur restent explicites. Les valeurs et les affirmations ont été confrontées aux spécifications D18/D27/D29/D31/D37, à config et aux handlers concernés ; ce contrôle ne constitue pas une nouvelle vérification de l’état mainnet.
