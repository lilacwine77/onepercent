# Télévision CRT du héros

La télévision remplace le pack qui se déchirait dans le héros. Elle reprend le boîtier crème, la vitre bombée, la profondeur et les boutons de la référence fournie. L’écran affiche le logo « 1% » dans l’en-tête et l’illustration existante de Pepe entièrement blanc tenant son sachet/carte. Le grand « 1%1% » derrière Pepe est retiré ; l’en-tête, la signature Onepercent et le message du bas sont conservés. Le dos et les connecteurs sont une interprétation des parties cachées de la référence.

Le héros occupe une hauteur d’écran, avec des minimums de hauteur pour garder les textes lisibles. Le fond de studio, les titres, les packs, la section des dépôts et le footer restent ceux du site. L’ancien `PackReveal` et son export GLB restent des assets autonomes, sans chargement par la landing actuelle.

## Interaction et rendu

- Au chargement, la télévision apparaît avec le titre : fondu, légère remontée et mise à l’échelle sur 850 ms, après un décalage de 90 ms. Le poster porte cette animation ; la préparation WebGL attend sa fin, y compris lors des visites suivantes sans loader. La préférence de mouvement réduit supprime cette entrée.
- Le pointeur est normalisé sur les dimensions projetées de la télévision, avec le centre projeté de l’écran comme point neutre pour éviter un biais vers la gauche. Un ressort amorti analytique pilote le mouvement, avec une légère inertie et un retour à la pose de repos ; son calcul tient compte du temps écoulé entre les images. Les amplitudes cibles sont ±0,18 rad horizontalement (environ 10°), ±0,16 rad verticalement (9°) et ±0,05 rad en roulis (3°).
- Un petit soulèvement et un flottement continu accompagnent le survol. Après la sortie du pointeur, le boîtier revient à sa pose neutre ; le balayage de l’écran continue.
- Le scroll et la molette relâchent le pilotage du boîtier : la télévision conserve sa vitesse puis revient à sa pose neutre avec une courte inertie, tandis que le flottement s’estompe progressivement. Le pilotage ne reprend qu’au déplacement réel du pointeur, pour que le défilement de la page ne laisse pas la télévision orientée sur le côté.
- Matériaux PBR de plastique satin et de verre, avec panneaux de studio réfléchis. Une bande lumineuse est alignée sur le reflet de la vitre dans la pose de référence ; l’inclinaison déplace donc un reflet réel sur le verre et la coque. Le verre reste une seule surface courbe, sans superposition transparente.
- L’aspect de vieille télévision est présent dès le premier rendu : grain, lignes, bandes de balayage, séparation RGB et déformation analogique. Le balayage reste animé tant que la télévision est visible, indépendamment du pointeur. Les lignes s’adaptent à la hauteur projetée de l’écran : une période visée de 2,8 pixels CSS, bornée entre 55 et 210 lignes, avec anticrénelage. La séparation RGB suit aussi la largeur projetée de l’écran.
- **Watch the film**, accessible au clavier, remplace « Tune in ». Le bouton et un clic ou tap sur le boîtier ouvrent le film de 25 secondes, sans voix : musique, effets sonores et textes anglais à l’écran. Il joue directement sur le verre de la TV, après rapprochement, redressement et fondu vers sa première image, noire, d’où part un allumage CRT. L’activation concerne la coque comme l’écran ; le poster de secours conserve la même action. Un glissement vertical sur la télé laisse défiler la page.
- La préférence de mouvement réduit conserve un aspect CRT statique et fige la pose : ressort, flottement et effets temporels sont désactivés. **Watch the film** reste visible et le film n’est lancé que sur demande.
- En mode animé, le rendu continue au repos du boîtier et s’arrête lorsque la télévision est hors écran, l’onglet caché. Le film demandé continue à se dessiner dans le verre ; le mouvement réduit fige ses effets CRT et supprime le zoom, sans figer les images vidéo. Le tampon est limité à deux millions de pixels et à un DPR maximal de 2.
- Le cadrage conserve une perspective fixe et ajuste son zoom aux sommets projetés de la pose neutre. La télévision occupe davantage d’espace face au titre, avec une marge pour son inclinaison.
- Un poster produit par le même lecteur Three.js apparaît avant le premier rendu, en cas d’échec de chargement et pendant une perte du contexte WebGL. Il partage la pose, la caméra, les matériaux et les lumières du modèle interactif. Le fondu de 260 ms commence après compilation des shaders et rendu de la première image. Après restauration, l’atlas HDR conservé en mémoire est renvoyé au GPU sans recalculer le studio.
- Quand le héros est visible, les fichiers du modèle et du studio sont téléchargés pendant l’intro. Le lecteur est importé après sa stabilisation ; le décodage, les transferts de textures et la compilation cèdent la main au navigateur entre les étapes. Une arrivée directe à `#packs` conserve le poster sans télécharger ni initialiser la scène hors écran. L’ouverture du film suspend aussi la préparation ; sa fermeture reprend le travail si le héros est visible.

Le GLB fournit le modèle, ses UV et ses matériaux. Le mouvement au pointeur, les lumières de studio et l’effet CRT sont gérés par JavaScript ; ils ne constituent pas un clip d’animation exporté. L’image de l’écran est une composition graphique, pas une sculpture de Pepe.

Le film est un média séparé, chargé uniquement à l’ouverture : MP4 H.264 High 1280 × 720 à 60 images/s, 25,0 s, musique et effets sonores sans voix, textes à l’écran et piste anglaise VTT. À la fin, sa carte de fin reste sur le verre avec Replay. La boîte suspend aussi Lenis. Le bouton de fermeture, Échap ou le fond arrêtent le son, ramènent la caméra au héros et restaurent le focus. Une indisponibilité de WebGL bascule vers un écran CRT HTML qui utilise la même vidéo. Les commandes incluent lecture/pause, replay, son, captions et progression. Le replay du header conserve son action de retour/relecture de la scène. Le storyboard, la reconstruction et la procédure de validation du lecteur sont dans [concept-video.md](concept-video.md).

Le premier réglage atténuait le mouvement en rapportant le pointeur à tout le conteneur et utilisait de faibles amplitudes. Ses 300 lignes fixes devenaient trop fines dans un aperçu étroit et l’anticrénelage les effaçait. Le réglage actuel utilise la projection de la télévision et de son écran, renforce les amplitudes et réaligne l’éclairage réfléchi. Les constats et captures de cette révision sont conservés dans `artifacts/crt-v2/`.

## Fichiers

| Fichier | Usage |
| --- | --- |
| `public/models/onepercent-crt.glb` | Asset web, géométrie Meshopt et texture WebP |
| `assets/blender/crt/onepercent-crt-source.blend` | Source Blender éditable, texture empaquetée |
| `assets/blender/crt/onepercent-crt-master.glb` | Export master sans compression de géométrie |
| `assets/blender/crt/build_crt.py` | Construction reproductible et rendu de référence Blender |
| `src/crt-tv.js` | Lecteur Three.js réutilisable et shader d’écran |
| `src/crt-resources.js` | Téléchargement anticipé des octets, sans contexte WebGL |
| `src/crt-studio.js` | Décodage et validation de l’atlas HDR, lumières du studio |
| `public/assets/crt-studio-v1.bin.gz` | Atlas CubeUV RGBA16F préfiltré hors ligne, 670 857 octets |
| `scripts/bake-crt-studio.mjs` | Reconstruction reproductible de l’atlas du studio |
| `src/crt-hero.css` | Composition responsive du héros |
| `public/assets/crt-screen.png` | Écran 1536 × 1152 généré depuis le Pepe existant |
| `scripts/build-crt-screen.mjs` | Composition reproductible de l’écran |
| `public/assets/crt-poster.png` / `.webp` | Poster transparent de secours |
| `scripts/render-crt-poster.mjs` | Capture 1280 × 1280 du lecteur web au repos |
| `scripts/optimize-crt-glb.mjs` | Compression en conservant noms et hiérarchie |
| `public/media/onepercent-explained.mp4` / `.webp` / `.vtt` | Film de 25 s chargé au clic, poster vidéo et sous-titres anglais |
| `scripts/film/` | Fabrication du film : capture de l’app sous temps virtuel, compositeur et rendu des images |

## Intégration autonome

Installer les dépendances du dépôt puis donner des dimensions au conteneur. Copier le GLB et `public/assets/crt-studio-v1.bin.gz` dans le répertoire public de l’application, avec leurs chemins respectifs. Conserver les trois modules `crt-tv.js`, `crt-studio.js` et `crt-resources.js` ensemble.

```js
import { CRTTelevision } from './src/crt-tv.js';

const tv = new CRTTelevision({
  container: document.querySelector('#crt-stage'),
  modelUrl: '/models/onepercent-crt.glb',
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});
await tv.ready;
tv.replay(); // Redémarrer le balayage déjà actif.
// Relier les changements de préférence à tv.setReducedMotion(boolean).
// Au démontage : tv.destroy().
```

Le conteneur émet `crt:ready` après le premier rendu et après restauration, et `crt:error` lors d’une perte de contexte. La promesse `ready` rejette si le chargement initial échoue. Le lecteur du site utilise ces signaux pour gérer le poster HTML.

L’appel autonome `tv.replay()` reste une action sur le balayage CRT. `tv.enterFilm(video, { duration: 900 })` anime la caméra vers l’écran en conservant Pepe. Après le zoom et une stabilisation de 100 ms, `tv.revealFilm({ duration: 400 })` fond Pepe vers la première image décodée du film (noire pour le film actuel) ; la landing ne démarre la lecture qu’après sa résolution. `tv.exitFilm({ duration: 650 })` ramène le boîtier et fond la vidéo vers Pepe en parallèle, sans changer brutalement de texture. `tv.isFilmActive` et `tv.getFilmScreenBounds()` exposent l’état et le cadre projeté. La landing gère le déplacement du conteneur dans le dialogue, les commandes et le focus. Amorcer le média dans le geste utilisateur par `play()` immédiatement suivi de `pause()` ; le temps reste à zéro pendant le zoom et le fondu. Démarrer la lecture après préparation et laisser le rendu TV actif pendant le film ; la vidéo est contenue dans le verre avec une marge optique pour les déformations CRT. Ces actions ne sont pas des clips exportés dans le GLB.

Le conteneur peut changer de taille pendant le zoom. `resize()` prépare les dimensions et la caméra ; `draw()` applique le changement de framebuffer juste avant son unique rendu. Déplacer ce changement dans le callback ResizeObserver effacerait l’image entre rendu et composition du navigateur. Le contrôle de transition dans `artifacts/film-tv-v1/transition/` vérifie les pixels du compositeur à plusieurs étapes, en plus de l’état JavaScript.

Les noms du contrat d’intégration sont `CRT_Root`, `CRT_Screen` et `CRT_ScreenMaterial`. Le front du GLB pointe vers +Z, Y vers le haut. Les positions de géométrie Meshopt sont quantifiées : conserver les matrices des nœuds. Le shader d’écran emploie les UV, indépendantes de cette quantification.

## Reconstruction et vérification

```powershell
node scripts/build-crt-screen.mjs
& 'C:/Users/user/blender.exe' --background --factory-startup --python assets/blender/crt/build_crt.py -- --poster
node scripts/optimize-crt-glb.mjs
npm run assets:optimize
node scripts/bake-crt-studio.mjs
node scripts/render-crt-poster.mjs
npm test
npm run build
node scripts/verify-crt.mjs
node scripts/verify-crt-v2.mjs
python scripts/package-kit.py
```

Le test navigateur utilise par défaut `http://127.0.0.1:5173`, à lancer séparément avec `npm run dev`. `CRT_PREVIEW_URL` permet de viser un autre serveur, dont le build de production servi localement.

Le contrôle de première visite `node scripts/verify-crt-startup.mjs` compare les phases de préparation dans `artifacts/crt-startup-v1/`. Sur le GPU RTX 3090 utilisé pour cette vérification, le constructeur passe de 129 à 18 ms et aucune tâche longue n’apparaît après l’intro ; la pause maximale entre images passe de 137 à 37 ms. Il s’agit d’une mesure locale, pas d’une garantie pour tous les appareils. Le rendu logiciel reste lent, mais la synchronisation bloquante d’environ une seconde a disparu. L’atlas et l’ancien studio donnent exactement les mêmes pixels dans la comparaison de référence, y compris après restauration du contexte. Les tests de cycle de vie couvrent aussi la boîte vidéo avant la disponibilité du modèle, les erreurs de fichiers et le retour depuis `#packs`.

Le GLB web pèse **553 448 octets** pour **45 944 triangles**, avec neuf matériaux (555 440 octets avant le 9 octobre 2026, quand le bas de l’écran est passé de « Find your next tokens. » à « Find your 1%. » : seule la texture `crt-screen` a été remplacée dans le master, sans Blender, puis `optimize-crt-glb.mjs` et `render-crt-poster.mjs` ont été relancés). Le master et l’import indépendant passent la validation glTF sans erreur ni avertissement. Les 14 tests de l’ancien pack restent valides et le build de production réussit.

Les [mesures du modèle](../assets/blender/crt/final_report.md), ses [vue frontale de contrôle](../assets/blender/crt/evidence-final-v2/front.png) et son [contrat de construction](../assets/blender/crt/contract.md) décrivent les vérifications Blender et glTF. Les contrôles initiaux sont conservés dans `artifacts/crt/`. Les captures avant/après et mesures perceptuelles de la première révision sont dans `artifacts/crt-v2/`. Les nouveaux contrôles de CRT permanent et d’inertie au scroll sont conservés dans `artifacts/crt-v3/`. La suite complète couvre le survol à 910 et 1440 pixels, le tap à 390 × 844, le retour du boîtier au repos, le mouvement réduit, la restauration WebGL et les différences de pixels du shader et des reflets. `CRT_TARGETED=1` limite `verify-crt-v2.mjs` aux interactions et au cycle de vie à 910 pixels pour les ajustements de mouvement ; le rapport précise le périmètre exécuté. Les rapports antérieurs à l’activation permanente décrivent le fonctionnement au survol de leur version. Ces contrôles utilisent Chrome avec rendu logiciel ; ils ne mesurent pas les performances d’un téléphone physique. L’aperçu IAB réel est également inspecté visuellement après reconstruction.

La publication du site suit le déploiement Railway décrit dans [railway-deployment.md](railway-deployment.md). Les commandes de reconstruction locales ne publient pas à elles seules.

Les contrôles historiques de tap et de replay ci-dessus précèdent **Watch the film**. Ils ne valident pas son téléchargement différé, sa boîte de dialogue ou son comportement au clavier. La validation de cette nouvelle interaction doit suivre [concept-video.md](concept-video.md) sur les fichiers vidéo et le build finaux ; aucune réussite de QA vidéo n’est déduite des rapports Blender ou CRT antérieurs.
