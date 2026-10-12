# Film Onepercent : « The 1% Machine »

**Montage de 25 s du 9 octobre 2026.** Il remplace l’ancien film concept (V1 à V6, voix synthétique) et son pipeline, retirés du dépôt, puis une première coupe de 22 s qui n’a pas été publiée (voir [Historique](#historique)).

La télévision ouvre un film de **25,0 secondes**, sans voix : de la musique, des effets sonores et de grands textes anglais à l’écran. Il montre l’app réelle, **The 1% Machine sur Solana**, capturée en mode preview : le X-ray de vrais bags pump.fun, le Feed et ce qu’une Dust Card peut rapporter, le Rip d’un pack jusqu’à un hit Holo Foil 4× $WIF, le choix de le vendre tout de suite ou de le garder dans My cards, puis la carte The 1%, avant la carte de fin « Dust in, Packs out. ». Le même fichier joue dans la télévision 3D de la landing (onepercent.fun) et dans celle de l’accueil de l’app (1% TV).

## Faits à garder vrais

Les images, les textes et les sous-titres du film ne doivent rien dire qui contredise ces faits :

- Les packs coûtent **0.10, 0.25, 0.50 ou 1.00 SOL** ; chacun contient 4 Dust Cards + 1 hit.
- Chaque bag nourri devient une Dust Card. Elle ne paie son déposant que **quand un pack la tire** : **2 % du prix de ce pack**, en SOL, soit **0.002 à 0.02 SOL**.
- « up to 66× » compare ce maximum (0.02 SOL, tirage par un pack à 1.00 SOL) au devis « if sold now » de $HAHA au moment du X-ray (≈0.000301638 SOL) : 0.02 / 0.000301638 = 66,3, arrondi par défaut. C’est un plafond conditionnel, ni une promesse de gain ni un rendement.
- « 1% » désigne la **taille du plus gros lot** : une carte The 1% vaut **10 000 000 $1PCT, soit 1 % de la supply de $1PCT**. Ce n’est pas une probabilité de gain.
- Le **Jackpot** est payé en **$1PCT** ; il n’apparaît plus dans le film.
- Sell back : la machine rachète un hit tout de suite pour **≈87 % de sa valeur**, en SOL. Dans le film, le Holo Foil 4× d’un pack à 0.10 SOL vaut ≈0.40 SOL et se vend +0.348 SOL.
- Les devis « if sold now » du X-ray sont ceux, exécutables, d’un X-ray réel (voir `scripts/film/fixtures/dust-bags.json`). Les tirages montrés sont forcés pour la capture (crochets de démo, voir [Fabrication](#fabrication)) : ils illustrent des issues possibles, pas leurs chances. Aucun rendement ni profit n’est promis.

## Découpage

La partition fait 25 s à 120 BPM ; ses repères (groove à 2 s, montée à 8 s, drop à 10 s, accent du hit à 14 s, relance à 16 s, élan à 20 s, coup final à 22 s) calent les temps forts.

| Temps | Temps fort | Texte à l’écran | Images |
| --- | --- | --- | --- |
| 0–0,3 s | Allumage | (aucun) | Première image noire ; une ligne horizontale lumineuse s’ouvre en image, comme un CRT qu’on allume. |
| 0–3,5 s | X-ray | **Your bags are dust.** · « X-ray ✳ 207 pump.fun bags » | Quatre vrais bags pump.fun d’un wallet de trencher, dont l’adresse n’est pas montrée : $HAHA 13,452 ≈0.000301 SOL, $OGPEPE 20,075 ≈0.0006 SOL, $PEPE 8,649 ≈0.000803 SOL, $JapanWhale 15,718 ≈0.000821 SOL, chacun « if sold now ». Les lignes passent du X-ray au réel sous une ligne de balayage ; « dust. » tombe sur le temps et de la poussière s’échappe des bags. |
| 3,5–8 s | Feed | **Feed the machine.** · « Each card pays you when a pack pulls it. » · « ≈0.0003 SOL if sold now » · « pays up to 0.02 SOL when pulled » · « up to 66× » · « 2% of the pack price: 0.002 to 0.02 SOL » | Les quatre bags tombent dans la machine à 4,0, 4,25, 4,5 et 4,75 s ; les Dust Cards en ressortent à 5,0 s et se retournent. À partir de 6,0 s, la carte $HAHA s’avance : « ≈0.0003 SOL if sold now » devient « pays up to 0.02 SOL when pulled » à 6,5 s, puis le badge « up to 66× » arrive à 7,0 s, avec « 2% of the pack price: 0.002 to 0.02 SOL ». |
| 8–16 s | Rip | **Rip a pack.** · « Rip 1 · 0.10 SOL » · « 4 Dust Cards + 1 hit » · « You pulled Holo Foil 4×. » | Gros plan sur le vrai bouton « Rip 1 · 0.10 SOL » et les prix des éditions, clic à 8,3 s ; déchirure à 10,0 s ; les quatre Dust Cards ($HAHA, $OGPEPE, $PEPE, $JapanWhale) se retournent à 11,0, 11,5, 12,0 et 12,5 s ; le hit **Holo Foil 4× $WIF** éclate à 14,0 s (≈0.4 SOL). |
| 16–19,5 s | Vendre ou garder | **Sell it instantly.** (16,0 s) · **Or keep it in My cards.** (17,0 s) · pastilles « Sell · +0.348 SOL instant » et « My cards » · « +0.348 SOL » | Le hit en grand avec les deux choix que l’app propose après un pull. À 18,0 s, la carte entre dans la pastille Sell et le SOL en jaillit, puis « +0.348 SOL » s’affiche : 87 % de ses 0.40 SOL. |
| 19,5–22 s | The 1% | **Go for the 1%.** (20,0 s) · « 10,000,000 $1PCT · 1% of the supply » | Une seule révélation lente : la carte The 1% seule, centrée, sur une scène calme. Plus de plan du Jackpot. |
| 22–25 s | Carte de fin | **Dust in, Packs out.** · **onepercent.fun** | Le studio violet, le logo « 1% » et les quatre packs ; la carte reste à l’écran jusqu’à la dernière image. |

Les textes font partie des images ; ils doivent rester lisibles à la taille du lecteur mobile. Les sous-titres anglais WebVTT les reprennent mot pour mot en 13 cues, de 0 à 25 s, avec l’indication « [Upbeat electronic music] » au début ; « You pulled Holo Foil 4×. » est le titre que l’app affiche elle-même au moment du hit. Sur les captures, le compositeur masque quelques éléments de l’app hors sujet : les petites mentions du dock et le solde pendant le gros plan du Rip, et l’estimation de démo « ≈0.00 SOL est. » de la carte The 1%. Les Dust Cards du Rip portent « Fed by » le wallet de démo de la capture (option `--wallet`), pas le wallet du X-ray.

## Son

Il n’y a pas de narration. La bande-son vient d’un **dossier audio** généré par `scripts/film/audio/build.py` (les WAV ne sont pas versionnés) : un lit musical de 25 s à **120 BPM** (`bed-25s.wav` : groove à 2 s, montée à 8 s, drop à 10 s, accent du hit à 14 s, relance à 16 s, élan à 20 s, coup final à 22 s) et un kit d’effets (`sfx/`). `scripts/film/sfx.json` nomme son lit et sa durée (`bed-25s.wav`, 25,0 s) ; `scripts/film/mix.py` pose le lit à −6 dB, place chaque effet à l’image près sur les événements visuels du compositeur (allumage CRT à 0 s, chute des bags de 4,0 à 4,75 s, Dust Cards à 5,0 s, carte $HAHA de 6,0 à 7,0 s, clic à 8,3 s, déchirure à 10,0 s, cartes de 11,0 à 12,5 s, impact du hit à 14,0 s, SOL à 18,0 s, The 1% à 20,0 s, carte de fin à 22,0 s), puis limite la crête vraie et normalise vers **−14 LUFS intégrés, plafond −1 dBTP** (BS.1770-4). La capture enregistre aussi les signaux sonores du module Rip avec leur numéro d’image.

Mix livré : −14,2 LUFS intégrés, crête vraie −1,3 dBTP, lit `bed-25s.wav` à −6 dB. Le lit et les effets sont entièrement synthétisés par script (NumPy et SciPy), sans échantillon ni morceau tiers, donc sans licence externe : `scripts/film/audio/build.py` (avec `bed.py`, `sfx.py` et `dsp.py`) régénère dans `FILM_AUDIO_OUT` les lits, les effets, `cues.json` (repères et points de synchronisation) et des contrôles dans `qc/`. Un morceau sous licence peut remplacer le lit sans toucher à l’image : le caler sur la même grille de 120 BPM (drop à 10 s, coup final à 22 s), relancer `mix.py`, puis réencoder.

## Format et fichiers

| Fichier | Rôle |
| --- | --- |
| `public/media/onepercent-explained.mp4` | Master 16:9 : 1280 × 720, 60 images/s, H.264 High + AAC, démarrage rapide (`moov` avant `mdat`), image d’exactement 25,0 s (1 500 images), 5,84 Mo |
| `public/media/onepercent-explained.webp` | Poster 1280 × 720 WebP : la carte de fin (image 1476, à 24,6 s) |
| `public/media/onepercent-explained.vtt` | Sous-titres anglais de la landing (13 cues) |
| `app/apps/web/public/experience/home/onepercent-explained.vtt` | Copie des sous-titres propre à l’app, identique à celle de la landing, servie depuis `/experience/home/` |
| `app/apps/web/public/landing/` | Copies du MP4 et du poster pour l’app, faites par `app/apps/web/scripts/sync-landing-assets.mjs` (liste reprise dans le Dockerfile de l’app) ; ignorées par git |
| `scripts/film/fixtures/dust-bags.json` | Les quatre bags du film : vrais bags pump.fun issus d’un X-ray en direct (API de preview, Solana mainnet, le 9 octobre 2026 à 14:20:23 UTC) d’un wallet de trencher qui en détient 207, avec leur mint, leur quantité et leur devis exécutable « if sold now » à ce moment ; l’adresse du wallet est volontairement omise |
| `scripts/film/virtual-time.js` | Temps virtuel injecté avant les scripts de la page |
| `scripts/film/capture.mjs`, `scripts/film/lib/kit.mjs` | Capture image par image des parcours de l’app |
| `scripts/film/capture-hooks.patch` | Crochets de démo appliqués seulement pendant la capture, jamais commités |
| `scripts/film/compose/` | Compositeur : `index.html`, `film.js` (durée, temps forts et allumage CRT), `scenes.js` (16:9) et `scenes-v.js` (9:16), `engine.js`, `style.css` |
| `scripts/film/render.mjs`, `scripts/film/lib/serve.mjs`, `scripts/film/lib/downscale.py` | Rendu des images finales du compositeur |
| `scripts/film/mix.py`, `scripts/film/sfx.json` | Mixage du lit musical et des effets, placés à l’image près |
| `scripts/film/encode.py` | Encodage H.264 + AAC par le FFmpeg de Blender |
| `scripts/film/mp4tool.py` | Démarrage rapide (`moov` avant `mdat`) et lecture des faits du MP4, sans FFmpeg |
| `scripts/film/make.mjs` | Chaîne complète : images, mixage, encodage, démarrage rapide, contrôle et poster |
| `scripts/film/splice.py` | Raccord de deux encodages à une image clé, sans réencodage, quand seule la fin change |
| `scripts/film/qa.mjs`, `scripts/film/storyboard.py` | Décodage du MP4 dans Chrome (PSNR par rapport aux images rendues, niveaux audio) et planche d’une image par temps fort |
| `scripts/film/audio/` | Synthèse du lit musical et du kit d’effets (`build.py`) |
| `scripts/film/compose/scenes-v.js`, `scripts/film/vertical/` | Montage vertical 9:16 (1080 × 1920) pour X, Telegram et TikTok, sur la même chronologie ; `pillfix.py` et `ringfix.py` corrigent, dans des copies des images mobiles (`rip-fix/`), le compteur de la pastille de valeur et l’anneau de focus laissé par le tap |

Les trois fichiers de `public/media/` gardent leurs noms d’une version à l’autre. Les deux lecteurs les demandent avec `?v=10` : changer cette valeur à chaque nouveau montage publié, dans `src/concept-video.js` et `app/apps/web/src/experience/home/film/film.ts`, pour qu’aucun cache ne garde l’ancienne image, l’ancien poster ou les anciens sous-titres. Les montages publiés de 25 s ont pris `?v=7`, `?v=8` et `?v=9` ; la version 5 (« Dust in, Packs out. ») prend `?v=10`.

La typographie (Fraunces et DM Sans, depuis `@fontsource` de l’app) et la palette viennent de la direction artistique de la marque. Les écrans, cartes et logos montrés sont ceux de l’app ; aucun extrait vidéo externe ni enregistrement d’une personne n’est incorporé.

## Fabrication

Le film est une fabrication locale. Elle ne publie rien : la mise en ligne reste celle du site (voir [railway-deployment.md](railway-deployment.md)).

1. **Capture de l’app réelle.** Appliquer `git apply scripts/film/capture-hooks.patch` : ces crochets forcent, dans le magasin de démo (`app/apps/web/src/demo/store.ts`), le palier du hit, son coin et les quatre Dust Cards du pack (les bags du film), et exposent le module Rip (`app/apps/web/src/experience/rip/RipView.tsx`). Lancer l’app en mode preview (`VITE_PREVIEW=1`, adaptateurs de démo) avec `VITE_API_URL` vers l’API de preview, puis :

   ```sh
   node scripts/film/capture.mjs --profile desktop      --out <captures>/desktop --only rows,dustcards,hitcard,onepctcard
   node scripts/film/capture.mjs --profile desktop-tall --out <captures>/desktop-tall --only rip-tap
   node scripts/film/capture.mjs --profile mobile       --out <captures>/mobile
   git apply -R scripts/film/capture-hooks.patch
   ```

   La page tourne sous **temps virtuel** (`virtual-time.js`) : minuteries, `requestAnimationFrame`, `performance.now`, `Date` et animations CSS / Web Animations n’avancent qu’au pas demandé, et `Math.random` est initialisé avec une graine fixe. Chaque image est donc exacte et la capture se rejoue à l’identique ; seuls les médias, les workers et le réseau gardent le temps réel. Les profils de `scripts/film/lib/kit.mjs` fixent la fenêtre et la densité de capture (`desktop` : 1440 × 810 px CSS à 2× ; `desktop-tall` : 1440 × 900 à 2× ; `mobile` : 432 × 768 à 2,5× pour le montage vertical). Chaque clip est une suite WebP numérotée à 60 images par seconde virtuelle, avec un `clip.json` (appuis du pointeur, temps forts et signaux sonores du Rip, avec leur numéro d’image) ; les lignes de bags (pièce, ticker, devis), les Dust Cards, la carte du hit et la carte The 1% sont aussi capturées en PNG transparents. Le Rip est capturé en mode « Tap to reveal » : les quatre Dust Cards sont touchées à des instants calculés depuis la déchirure, pour que leurs retournements tombent sur les temps de la musique. Les bags viennent de `scripts/film/fixtures/dust-bags.json` (option `--fixture`) ; l’option `--logos` sert leurs logos depuis un dossier local de fichiers nommés par mint.

2. **Compositeur.** `scripts/film/compose/` dessine l’image N comme une fonction pure de N : les captures y sont recadrées et animées, avec les titres, les particules et l’allumage CRT. Les temps forts suivent la grille de 120 BPM ; les scènes écrites pour la coupe de 22 s (Rip, vente, carte de fin) sont décalées d’une mesure (2 s), la mesure ajoutée revenant au Feed et à sa carte $HAHA.

3. **Rendu des images.**

   ```sh
   node scripts/film/render.mjs --layout 16x9 --cap <captures> --out <frames>
   ```

   Chrome (le `playwright-core` du workspace `app/`, sans autre installation) dessine chaque image à 2× ; `lib/downscale.py` (Python 3, Pillow et NumPy) la réduit en Lanczos à 1280 × 720. Les images que les scènes marquent pour le flou de bouger moyennent plusieurs sous-images. `--frames 0-1499` ou une liste limite le rendu ; `--preview` écrit directement des WebP à 1× pour un contrôle rapide. Le compositeur sait aussi produire un montage vertical 9:16 (`--layout 9x16`, captures du profil `mobile`), que le site n’utilise pas.

4. **Mixage, encodage et poster.** `make.mjs` enchaîne le rendu, le mixage, l’encodage et le contrôle :

   ```sh
   node scripts/film/make.mjs --layout 16x9 --cap <captures> --audio <dossier audio> --work <dossier de travail> \
     --out public/media/onepercent-explained.mp4 \
     --poster public/media/onepercent-explained.webp
   ```

   Ce Mac n’a pas de commande `ffmpeg` : l’encodage passe par le **FFmpeg intégré à Blender** (`Blender --background --factory-startup --python scripts/film/encode.py`, variable `BLENDER` si Blender n’est pas dans `/Applications`). Le séquenceur de Blender assemble les PNG et le mix en H.264 High (libx264, CRF 23 par défaut, préréglage le plus lent, GOP de 120 images, jusqu’à 3 images B, plafond de débit optionnel `--maxrate`) et AAC stéréo 48 kHz à 160 kbit/s, avec des couleurs sRGB transmises telles quelles (vue « Standard »). `mp4tool.py faststart` place ensuite `moov` avant `mdat`, et `mp4tool.py probe` relit le résultat. Le poster est l’image 1476 (24,6 s, la carte de fin, défaut de `--poster-frame`), rendue seule puis enregistrée en WebP qualité 90 avec Pillow. Réglages du montage livré : CRF 23, sans plafond de débit (défauts de `make.mjs`, lancé avec `--keep-frames`). Après les deux corrections de la version 3 (le retournement de la carte et le passage vers le Rip), seules les images 205 à 490 ont été rendues de nouveau avec `render.mjs --frames` (et 440 à 482 pour la version 4), puis le mix et l’encodage relancés (`mix.py`, `encode.py --crf 23`, `mp4tool.py faststart`).

   **Changer seulement la fin.** Quand seule la fin du film change (par exemple la carte de fin), rendre et encoder le nouveau montage complet, puis le raccorder à l’ancien sans réencoder : `python3 scripts/film/splice.py <ancien.mp4> <nouveau.mp4> <sortie.mp4> --first-changed-frame 1320`. Le script garde, octet pour octet, les échantillons vidéo de l’ancien fichier jusqu’à la dernière image clé qui précède la première image changée, puis prend ceux du nouveau, avec la piste audio de l’ancien ; il vérifie avant d’écrire que les deux encodages ont la même configuration (avcC, images clés, tables de temps, liste d’édition) et que le GOP du raccord est fermé.

5. **Sous-titres et copies de l’app.** Les sous-titres de la landing (`public/media/onepercent-explained.vtt`) reprennent mot pour mot les textes à l’écran, cue par cue. Les copier tels quels vers `app/apps/web/public/experience/home/onepercent-explained.vtt`, puis lancer `node app/apps/web/scripts/sync-landing-assets.mjs` pour mettre à jour les copies du MP4 et du poster dans l’app.

## Lecture dans les deux télévisions

La landing (`src/concept-video.js`) et l’app (`app/apps/web/src/experience/home/film/film.ts`, portage du même lecteur) se comportent de la même façon.

**Watch the film**, le boîtier et le poster ouvrent un lecteur immersif accessible au clavier. Le conteneur WebGL est déplacé dans un dialogue plein écran ; la caméra se rapproche et redresse la TV pendant 900 ms, Pepe restant à l’écran. Après 100 ms de stabilisation, un fondu de 400 ms passe de Pepe à la première image du film, qui est noire : l’écran s’éteint, puis la lecture et le son démarrent et le film s’ouvre sur son propre allumage CRT. Le fondu ne commence qu’une fois cette image décodée, et rien n’avance pendant le zoom. La `VideoTexture` garde les reflets PBR et les lignes CRT ; le film 16:9 est contenu dans l’écran 4:3, avec une petite marge contre le rognage par la courbure.

Les fichiers sont demandés seulement à l’activation. Un appel lecture/pause synchrone dans le geste utilisateur prépare l’autorisation sonore ; le média reste ensuite en pause à zéro jusqu’à la fin du fondu. Tant que les métadonnées ne sont pas arrivées, la barre de progression et le compteur supposent 25 s (`FILM_SECONDS`, et `0:00 / 0:25` dans `index.html`). Les commandes proposent lecture/pause, Replay, son, sous-titres et progression. Si le navigateur demande un autre geste pour le son, le bouton Play reste disponible. À la fin, la carte de fin reste sur le verre et le bouton principal devient Replay. Les sous-titres sont affichés à part du shader, dans une zone lisible.

Lenis et le défilement sont suspendus pendant la lecture ; le rendu de la TV continue. Close, Échap ou un clic sur le fond arrêtent aussitôt le son et lancent un retour de 650 ms vers le héros, pendant lequel un fondu de 400 ms ramène Pepe. La texture de Pepe, la caméra et le focus du déclencheur sont restaurés. Une fermeture pendant le zoom ou le fondu annule proprement l’entrée. Un glissement vertical sur la TV n’ouvre jamais le film.

Avec le mouvement réduit, le zoom, les fondus et le retour sont instantanés ; la vidéo joue et les lignes CRT restent statiques. Si la 3D n’est pas prête, indisponible ou perd son contexte, un écran CRT HTML lit le même film avec les mêmes commandes : la vidéo y apparaît en fondu de 400 ms par-dessus l’écran de Pepe. Cacher l’onglet suspend vidéo et son ; la lecture ne reprend au retour que si elle était en cours.

Dans l’app, le MP4 et le poster sont servis depuis `/landing/` (copies exactes de `public/media/`), et les sous-titres depuis `/experience/home/`. Le module du lecteur est chargé pendant l’inactivité du navigateur ; rien n’est téléchargé ni joué avant la première ouverture.

## Vérification

### Média

Montage de 25 s, version 5 (`?v=10`). La version 3 (`?v=8`) corrigeait le retournement de la carte et le passage vers le Rip ; la version 4 (`?v=9`), une bande noire de 8 images au bord droit pendant ce passage (7,6 à 7,7 s). La version 5 change seulement la carte de fin, qui devient « Dust in, Packs out. » : ses 1 318 premières images vidéo (jusqu’à 21,967 s) et toute la piste audio sont celles de la version 4, octet pour octet (raccord à l’image clé, voir [Fabrication](#fabrication)) :

- Durée : image **25,000 s**, soit **1 500 images à 60 images/s** ; le conteneur annonce 25,003 s et la piste AAC 25,024 s (trames AAC). Démarrage rapide : `moov` avant `mdat`.
- Vidéo : H.264 High@4.0, 1280 × 720, 1 683 kbit/s ; une fois décodé dans Chrome, PSNR de 34,3 à 40,6 dB par rapport aux images rendues (16 instants, de 0,5 à 24,6 s). Décodée à 17 instants, la version 5 est identique pixel pour pixel à la version 4 jusqu’à 21,99 s et à son nouvel encodage complet à partir de 22 s.
- Audio : AAC-LC 48 kHz stéréo, 167 kbit/s ; mix à **−14,2 LUFS intégrés**, crête vraie **−1,3 dBTP**, lit `bed-25s.wav` à −6 dB.
- Fichiers : MP4 5 824 733 octets (SHA-256 `a1d629fe380f31ede6257e9c4d9f34531c48b345ef772ceb6d642a6789d87d8b`) ; poster WebP 1280 × 720, carte de fin (image 1476), 107 878 octets (`bea4a5eb94ea9ba4270c131129072aaf3380cdd4f159b49cec218721096a9c48`) ; sous-titres 873 octets, 13 cues (`9fc3bc8292e36e59d8a90a4b8479a3910e4d2042024e7eb1cdf191e8280b1009`). Les copies de l’app (`/landing/` et `/experience/home/`) doivent être identiques octet pour octet.
- Première image entièrement noire (luminance moyenne 0) ; la carte de fin reste à l’écran jusqu’à la dernière image, avec Replay.

`scripts/verify-film-tv.mjs` relit ces faits dans le fichier lui-même, sans FFmpeg : durée (image de 25 s exactement), taille, cadence et nombre d’images (1 500 à 60 images/s), H.264 High, AAC et démarrage rapide. Le décodage complet n’est lancé que si `ffmpeg` est dans le `PATH` ou si `FFMPEG_BIN` désigne un exécutable ; `QA_SKIP_DECODE=1` l’ignore.

### Lecteurs

Contrôle du 9 octobre 2026 sur la version 4 (`?v=9`, MP4 `9215fb40…`) : les quatre passages (landing en build de production et app, desktop 1440 × 900 et tactile 390 × 844) réussissent les 14 contrôles, sans erreur console ; les 13 cues des sous-titres se chargent et s’affichent dans les deux lecteurs.

`scripts/verify-film-players.mjs` joue le film dans les deux télévisions, la landing en build de production (`npm run preview`) et l’app sur son serveur de développement en mode preview, à 1440 × 900 et à 390 × 844 tactile, dans Chrome for Testing headless (GPU Metal, son coupé). Il vérifie qu’aucune requête vers le film ne part avant l’ouverture, que le MP4, le poster et les sous-titres portent `?v=10` et viennent du bon chemin, que la TV 3D joue le film sur son verre et ne lance la lecture qu’après le zoom et le fondu, la durée de 25 s et le format 1280 × 720, la lecture jusqu’à `ended`, la première image noire, la carte de fin tenue avec Replay, le chargement et l’affichage des sous-titres (à 12 s, « 4 Dust Cards + 1 hit »), l’absence d’erreur console et le retour de la TV à son écran de repos. Les captures sont prises pendant la lecture naturelle vers 0,5, 2,5, 5,2, 7,4, 8,2, 12,2, 14,6, 18,6, 21 et 24,5 s, plus le zoom, le fondu, l’allumage, la fin, les sous-titres et le retour ; le rapport donne pour chacune le temps réel du film. Captures et rapport : `artifacts/film-tv-v10/players/` (hors dépôt).

### Procédure

Servir le build de production de la landing (`npm run build`, puis `npm run preview`, sur `http://127.0.0.1:4173`), puis lancer les contrôles Chrome :

```sh
node scripts/verify-film-players.mjs --out artifacts/film-tv-v10/players   # les deux télévisions, landing et app
node scripts/verify-concept-video.mjs          # lecteur : scénarios desktop, compact, mobile, mouvement réduit, secours, chargement
node scripts/verify-film-tv-transition.mjs     # pixels du compositeur pendant le zoom, le fondu et le retour
node scripts/verify-film-preparation.mjs       # média retenu, erreur puis Retry, onglet caché pendant la préparation
node scripts/verify-film-tv-races.mjs          # perte de contexte pendant le retour, mouvement réduit pendant l’entrée
```

Les rapports et captures sont écrits dans `artifacts/film-tv-v10/` (`QA_OUT` pour un autre dossier, `QA_SCENARIOS` pour une partie des scénarios). Les scripts vérifient notamment la durée de 25 s (1 500 images), le format 1280 × 720, `?v=9` sur le film, le poster et les sous-titres, la première image noire, la carte de fin tenue jusqu’à la dernière image avec Replay, des sous-titres sans tiret cadratin et le retour de la TV à son écran de repos. Une machine chargée (rendu ou capture en cours) peut faire échouer les contrôles de cadence : les relancer au repos.

À contrôler aussi à la main :

1. Lire le film en entier, avec le son : rythme, effets, absence de voix, lisibilité des textes à 390 px.
2. Inspecter une image de chaque temps fort, l’allumage et la carte de fin ; comparer les textes aux [faits à garder vrais](#faits-à-garder-vrais) et aux sous-titres.
3. Dans un contexte navigateur neuf, constater qu’aucune requête vers `onepercent-explained.*` ne part avant l’activation ; ouvrir ensuite depuis le bouton, la coque 3D et le poster de secours.
4. Au clavier : focus initial dans le dialogue, circulation, Échap et retour au bouton d’origine ; fermeture par le fond, arrêt du son, reprise du défilement.
5. Refaire l’ouverture avec le mouvement réduit, à 390 px et sur desktop, dans la landing et dans l’app.

Les mesures dans Chrome headless ne remplacent ni Safari iOS, ni un téléphone physique, ni une écoute humaine du mix.

## Historique

Le film précédent (V1 à V6, du 2 au 9 octobre 2026) durait de 11 à 14,5 s, à 30 images/s. Il était dessiné sur Canvas, avec une voix synthétique anglaise locale (Microsoft Zira) et une musique générée par script. Il a été écarté avec son pipeline : `scripts/render-concept-video.mjs`, `scripts/concept-video/` et les masters de voix `assets/audio/concept-video/` ne font plus partie du dépôt. Ils restent consultables dans l’historique git, jusqu’au commit `6aecf85`.

Une première coupe de 22 s du nouveau film (commit `96b6105`, jamais publiée) montrait le X-ray d’un autre wallet, « Each bag becomes a Dust Card. » sans la carte $HAHA, le hit à 12 s, puis le Jackpot avant The 1%. Le montage de 25 s ajoute une mesure au Feed pour la carte $HAHA et ce qu’elle peut rapporter, et réduit le 1 % à la seule carte The 1%.
