# Vérifications

## Reprise du site et Pepe entièrement blanc — 1er octobre 2026

La reprise du site a été vérifiée après l’intégration des nouveaux visuels et de la texture `pepe-all-white.png`. Les sections suivantes conservent l’historique des contrôles de la version précédente.

- `npm test` : **14 tests sur 14 réussis**. `npm run build` : site Vite et module ES compilés.
- `node scripts/verify-browser.mjs` : terminé sans erreur navigateur. Le pack a été contrôlé aux progressions de scroll `0`, `0,2`, `0,5`, `0,8` et `1`, avec le rétrécissement et l’arrondi du héros. Pepe apparaît entièrement blanc ; le site ne référence plus la photographie originale tachetée.
- Les interactions ont été contrôlées : image dorée de survol des cartes visible à opacité `1`, déplacement au pointeur d’environ `-3,57 px` et échelle `1,08`, quatre rangées d’accordéon indépendantes, carrousel des principes et rotation du pack en volume à environ `0`, `3,1436` et `6,282` radians.
- À `390 px`, le menu mobile, l’ordre de l’accordéon et les cartes de `195 px` ont été vérifiés. Aucun débordement horizontal n’a été observé à `390 px` ou `320 px`. Le mode de mouvement réduit conserve une image fixe de remplacement.
- Le GLB régénéré contient **11 maillages et 18 pistes d’animation**, pour **13 095 436 octets**. Après rechargement, 39 260 positions ont été comparées avec la scène source ; l’écart maximal est d’environ `5,06 × 10⁻⁸` unité.
- La version finale a été inspectée visuellement sur ordinateur et mobile, notamment le héros, les images au survol, la section de la mascotte et le pack tournant. Les scènes photographiques et la mascotte sont des assets conceptuels ; cette vérification ne couvre pas de moteur de paiement ou de tirage, absents du dépôt.

## Site concept et Pepe blanc — 1er octobre 2026

- `npm test` : 14 tests réussis sur la géométrie et l’animation.
- `npm run build` : site Vite et module ES compilés.
- `node scripts/verify-browser.mjs` : dix étapes desktop, mobile à 390 et 320 px, navigation, cartes de packs, carrousel de déclarations de marque, images générées, contrôles clavier, mouvement réduit et export GLB vérifiés sans erreur navigateur ni débordement horizontal.
- Le rendu animé montre Pepe blanc sans taches ; les pixels du logo et du texte inférieur restent stables tout au long de l’ouverture.
- Le GLB régénéré contient 11 maillages et 18 pistes d’animation. Le rechargement compare 39 260 positions avec une erreur maximale d’environ 0,000000051 unité. Taille : 13 115 264 octets.
- Le site a aussi été inspecté visuellement dans Chrome à 1440 px et 390 px : hiérarchie, cadrages, lisibilité et comportement des sections.

## Vérification avant commit — 1er octobre 2026

`npm test` : 14 tests réussis. `npm run build` : démo et module ES compilés. L’archive d’intégration a été reconstruite avec le contexte du projet, puis contrôlée avec `unzip -tq`. La note source correspond exactement au document fourni. Les contrôles visuels ci-dessous datent du 27 septembre ; la géométrie et l’animation n’ont pas changé lors de l’ajout du contexte.

## Géométrie et rendu — 27 septembre 2026

- `npm test` : 14 tests réussis. Géométrie, morphs, progression bornée, aller-retour du scroll, pistes exportées et libération des ressources. Les régressions vérifient deux feuilles connectées sans second sachet, leurs bords joints pendant 41 étapes live et 41 étapes du clip, l’ordre des surfaces et la stabilité des zones intactes. Neuf points de foil sont exclus des personnages ; les points du crâne, des mains et de l’avant-bras restent sur leur partie mobile.
- `npm run build` : démo de production et module ES compilés avec succès. Le bundle principal représente environ 140 Ko gzip ; l’exporteur GLB est chargé à la demande.
- `node scripts/verify-browser.mjs` : Chrome, dix étapes desktop (0/12,5/20/25/35/50/60/75/90/100 %), mobile 390 et 320 px, lecture au clavier, retour au début, fenêtre de référence, mouvement réduit et destruction du composant. Aucun débordement horizontal ni erreur navigateur.
- Les pixels rendus du logo et du texte inférieur restent identiques à huit étapes entre 0 et 100 %, dont sept pendant la fin de l’ouverture.
- GLB rechargé via `GLTFLoader` : 11 maillages, 18 pistes, animation de 4 secondes, textures intégrées. 39 260 positions de sommets comparées avec la scène source ; erreur maximale 0,000000051 unité.
- Export : 12 948 400 octets. Ce fichier est optionnel ; la démo charge directement les deux textures et construit ses maillages.
- Vidéo du défilement réel, puis de son retour : `artifacts/pepe-reveal.webm`.
- Captures de contrôle disponibles dans `artifacts/` (fichiers locaux ignorés par Git).
- Les captures `foil-detail-60.png` et `foil-detail-75.png` montrent le raccord du bord mobile avec le menton et les mains, sans second sachet en dessous.

La fidélité s’applique à la vue frontale projetée. Les tests ne démontrent pas une sculpture complète sous tous les angles ni une copie physique des propriétés du matériau : l’éclairage original est intégré aux textures.
