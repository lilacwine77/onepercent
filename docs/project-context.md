# Onepercent — contexte du projet

Contexte enregistré le **1er octobre 2026**, actualisé le **3 octobre 2026** à partir des demandes du porteur du projet et du [document fourni](research/project-context-source.txt), conservé intégralement.

## Mise à jour du 9 octobre 2026 : landing Solana

Cette mise à jour remplace les précisions plus bas sur Robinhood Chain, les Stock Tokens, les prix en dollars et le « plus gros lot de 1 % de la supply d’un token sélectionné ». Le produit est désormais **The 1% Machine, sur Solana uniquement**, tel que défini dans [`docs/codex/MODEL.md`](codex/MODEL.md) ; la formulation suit [`docs/codex/COPY.md`](codex/COPY.md) et les textes de la home de l’app (`app/apps/web/src/experience/home/copy.ts`).

- Héros : **« Bags in, / Packs out. »** (virgule, demandée par le fondateur), puis « Feed your dust to the machine. Rip foil packs with real Solana tokens inside. » Titre et aperçus : « Onepercent · Bags in, Packs out. » ; même devise dans le footer et l’image d’aperçu.
- Packs : The Original 0.10 SOL, Blue Shift 0.25, Signature 0.50, After Hours 1.00 ; chaque pack contient 4 Dust Cards + 1 hit. Les cartes se Redeem, se Sell back (≈87 %, hits seulement), se Feed ou se Keep.
- Section dépôt : « Got dust? Feed the machine. » Chaque bag devient une Dust Card ; quand un pack la tire, le déposant reçoit 2 % du prix du pack en SOL. Jackpot et The 1% (quatre cartes de 10 000 000 $1PCT) sont expliqués dans « How packs work ».
- X-ray : les coins **$WIF, $FONE et $JIMOTHY** remplacent PONS, BONER et Tesla. Les dix logos Solana de `public/assets/tokens/` et leurs sources sont dans [`SOURCES.md`](../public/assets/tokens/SOURCES.md).
- Nouveau film de 25,0 s, sans voix : l’app réelle capturée en mode preview, en six temps (X-ray de vrais bags pump.fun « Your bags are dust. », « Feed the machine. » avec la carte $HAHA qui paie jusqu’à 0.02 SOL quand un pack la tire, Rip jusqu’à un hit Holo Foil 4× $WIF, « Sell it instantly. Or keep it in My cards. », « Go for the 1%. » avec la seule carte The 1%, carte de fin « Dust in, Packs out. »). L’ancien film à voix synthétique et son pipeline sont retirés. Détails et contrôles dans [concept-video.md](concept-video.md).
- L’écran de la télévision affiche désormais « Find your 1%. » (texture, GLB et poster régénérés).
- Aperçus de liens : balises og:* et twitter:* (carte `summary_large_image`) avec `public/assets/og-onepercent.jpg`, 1200 × 630, régénérée par `node scripts/build-og-image.mjs`.
- Aucun tiret cadratin dans les textes visibles, les titres, les attributs ARIA ou les sous-titres.

## État actuel

Le dépôt contient un site concept pour « 1 % » et plusieurs assets réutilisables. À la demande du fondateur, une **télévision CRT crème en 3D remplace le pack qui se déchirait dans le héros**. Son écran affiche le logo « 1 % » dans l’en-tête et **Pepe entièrement blanc, sans taches**, à partir de la mascotte existante ; le grand lettrage derrière Pepe a été retiré. Au survol, la télévision s’incline avec l’inertie d’un ressort amorti et un léger flottement, avec des reflets de studio mobiles sur la coque et le verre. L’effet de vieille télévision est présent dès le chargement et reste animé tant que la télé est visible, indépendamment du pointeur ; il s’adapte à la taille affichée. Le héros occupe une seule scène à hauteur d’écran et défile normalement, sans piste sticky. Le module de révélation du pack, son export GLB et son exemple React / Next.js restent disponibles séparément et inchangés ; la landing ne les charge plus. L’asset CRT et son intégration sont documentés dans [crt-television.md](crt-television.md).

La landing se limite au **héros, à la section packs, à « Got tokens? Fill the pool. » puis au footer « Find your next tokens. »**. La mascotte blanche du récit et du footer est conservée. Le sélecteur de packs reprend le principe de couronne manipulable de Jupiter Gacha, avec quatre éditions et leurs détails. Le bandeau séparé de logos de tokens est retiré : le survol d’un booster révèle maintenant des coins **PONS, BONER et Tesla** en X-ray cyan/violet, tandis que son artwork natif reste visible au repos. Les éditions **The Original, Blue Shift, Signature et After Hours** portent des prix guides de **10 $, 25 $, 50 $ et 100 $** ; ces montants ne sont pas des devis ni des offres en direct.

La télévision donne accès à un **film de 25 secondes, sans voix**, porté par la musique, des effets sonores et de grands textes anglais. Au clic, elle se rapproche et son écran fait face au spectateur : le film est projeté directement sur le verre avec lignes CRT et reflets. Il montre l’app réelle, capturée en mode preview : le X-ray de vrais bags pump.fun (« Your bags are dust. »), le Feed et ce qu’une Dust Card paie quand un pack la tire (2 % du prix du pack, 0.002 à 0.02 SOL), le Rip d’un pack jusqu’à un hit Holo Foil 4× $WIF, le choix de le vendre tout de suite ou de le garder dans My cards, puis la carte The 1% (« Go for the 1%. »), avant la carte de fin « Dust in, Packs out. » et onepercent.fun. Le film est chargé seulement au clic ; sa fabrication est décrite dans [concept-video.md](concept-video.md).

Le produit envisagé derrière cette identité visuelle est un marché de distributions aléatoires de tokens, financées par des fournisseurs de liquidité (LP). **Le moteur économique, les contrats, les dépôts, les paiements et les tirages ne sont pas implémentés. Les packs visibles sur le site ne sont pas achetables.**

Les mentions publiques de preview et les bandeaux de statut du catalogue, des fiches, du footer et du film sont retirés à la demande du fondateur. Cette suppression éditoriale ne change pas le périmètre technique décrit ci-dessus.

### Précisions produit confirmées par le fondateur

- La landing page doit conduire vers **deux parcours** : obtenir des tokens en ouvrant des packs, ou déposer des tokens dans leurs pools. Le parcours sponsor a été retiré de la présentation active.
- L’intention de réseau est **Robinhood Chain**. Le héros dit **« Get RH tokens. »**, avec la phrase courte **« Open packs for Robinhood Chain tokens. Top prize: 1% of a token’s total supply. »**. La formulation explique le produit à côté de la télévision. Elle ne présente pas les tokens communautaires comme des actifs émis par Robinhood.
- Le nom **Onepercent** vient du **plus gros lot de chaque pack : 1 % de la supply totale d’un token sélectionné**. Les packs plus chers visent des tokens de capitalisation plus élevée. Le pourcentage décrit la taille du plus gros lot ; il ne fixe pas sa probabilité. Les capitalisations visées, les tokens retenus et les chances de tirage restent à définir à partir d’un inventaire financé.
- Les coins X-ray utilisent les logos existants **PONS, BONER et Tesla**. Ils reprennent les identités documentées dans [token-carousel-assets.md](token-carousel-assets.md) ; le logo Tesla représente le Stock Token lié à Tesla. L’ancien bandeau à dix logos appartient désormais à l’historique. Il ne s’agit pas d’un inventaire disponible ni d’une liste de partenaires, et un Stock Token ne confère pas une part de propriété de l’entreprise sous-jacente.
- Le survol révèle les coins du booster ; le focus clavier révèle le pack central et un tap tactile active ou désactive le X-ray. **Explore** reste l’action distincte qui ouvre les détails. Le glisser, le défilement horizontal et les gestes verticaux de page sont conservés. Le mouvement réduit permet une révélation statique.
- L’explication des pools doit montrer les deux flux : part de paiements reçue et tokens distribués depuis la position. La réception de paiements ne constitue pas à elle seule un profit ni un rendement garanti.

Ces précisions de l’utilisateur font autorité sur le contenu de la landing. La [direction éditoriale V4](content-direction-v4.md) en donne les formulations ; [token-carousel-assets.md](token-carousel-assets.md) conserve les sources d’identification et des logos. Les mécanismes détaillés de la note de recherche ci-dessous restent des hypothèses.

Les finitions du catalogue restent **The Original argent poli (10 $)**, **Blue Shift bleu électrique (25 $)**, **Signature holographique (50 $)** et **After Hours noir anthracite (100 $)**. Leurs artworks natifs apparaissent au repos dans le sélecteur et dans leurs fiches ; la mise en scène photographique parmi des jetons dorés a été retirée. Le X-ray révèle les trois coins dans le booster pendant l’interaction. Signature reprend exactement le pack fermé de l’ancien héros. Bronze et Pearl restent des études inactives. Le pack holographique qui révèle Pepe reste inchangé comme module autonome. Le modèle Signature volumétrique, avec texture native de 1254 × 1254 et relief indépendant du contraste de l’image, est conservé comme asset réutilisable ; sa section tournante et son chargement ont été retirés de la landing. Sa validation historique est dans [verification-v3.md](verification-v3.md).

Le document joint est une note de conception et de recherche. Ses recommandations, paramètres, comparaisons concurrentielles et interprétations juridiques ne constituent pas des décisions validées. Ses sources externes n’ont pas été revérifiées lors de cet import.

## Intention visuelle et comportement

- Le pack frontal du carrousel doit rester entier au repos et au survol, avec des proportions natives et une taille contenue sur desktop et téléphone. Retirer la ligne « Drag to spin » et les commandes flèches/shuffle sous les packs ; conserver le glisser, la navigation clavier et les onglets d’édition.
- Accélérer la rotation automatique des sachets à **0,12 rad/s**, soit **2,5 fois** la vitesse précédente. Avec huit positions, cela représente environ **6,5 secondes par pack** pendant la rotation libre, contre 16,4 secondes auparavant. Conserver les pauses de survol, de manipulation et de focus, ainsi que l’arrêt demandé par le mouvement réduit.
- Révéler les coins PONS/BONER/Tesla à travers le booster en X-ray cyan/violet au survol, au focus clavier ou par tap. Garder les textures imprimées intactes au repos, le cadrage de l’arc et les gestes de déplacement ; **Explore** ouvre les détails sans confondre cette action avec le tap de révélation.

- Le héros utilise la télévision CRT inspirée de la référence fournie : coque crème, écran brillant, logo « 1 % » dans l’en-tête et Pepe blanc sur un fond dégagé. Le grand « 1%1% » derrière Pepe est retiré ; les signatures de l’en-tête et du bas de l’écran restent présentes. Le modèle source est dans `assets/blender/crt/`, le GLB actif dans `public/models/onepercent-crt.glb` et le lecteur dans `src/crt-tv.js`.
- Afficher l’effet de vieille télévision dès le premier rendu et l’animer en permanence lorsque la télé est visible. Le déplacement du pointeur, normalisé sur la taille projetée de la télévision et centré sur l’écran, pilote le boîtier par un ressort amorti : inclinaison, léger soulèvement et flottement pendant le survol, puis retour au repos. L’amplitude horizontale cible est limitée à ±0,18 rad pour éviter une orientation trop prononcée. Le scroll et la molette relâchent le pilotage en conservant la vitesse du boîtier : une courte inertie accompagne le retour au repos et le flottement s’estompe progressivement. Le pilotage ne reprend qu’après un déplacement réel du pointeur. Les panneaux de studio produisent des reflets qui suivent ce mouvement. Les lignes CRT s’adaptent à la taille projetée de l’écran pour rester visibles dans les aperçus étroits. Le replay du header garde la relecture de la scène et du balayage.
- **Watch the film**, le boîtier et le poster déclenchent le même zoom vers le verre. Pepe reste affiché pendant tout le rapprochement. Après le zoom et une courte stabilisation, un fondu de 400 ms passe de Pepe à la première image du film, noire ; la lecture et le son ne commencent qu’après ce fondu, et le film s’ouvre par un allumage CRT. À la fin, la carte de fin reste à l’écran avec Replay. Le film conserve les bandes horizontales CRT ; son format 16:9 est contenu dans le verre 4:3 sans rognage. Lenis et le survol de la TV sont suspendus pendant cette lecture, tandis que son rendu 3D continue. Lecture/pause, replay, son, sous-titres et progression sont accessibles au clavier. Le bouton de fermeture, Échap ou le fond arrêtent le son et fondent l’image du film vers Pepe pendant le dézoom, puis restaurent le focus. Un geste de défilement tactile ne lance pas le film. Le header garde son replay de scène.
- Le héros a une hauteur d’écran avec un minimum adapté à la lisibilité ; il ne comporte plus de piste de déchirure ni de maintien sticky. Les gestes verticaux sur la télévision laissent défiler la page.
- Respecter le mouvement réduit : la TV garde une pose et un traitement CRT statiques ; le zoom devient instantané, mais le film demandé reste lisible. Suspendre le rendu quand la scène est hors écran ou l’onglet caché. Cacher l’onglet suspend aussi son et vidéo ; une pause manuelle reste conservée au retour. Un poster identique au rendu sert au chargement de la TV. Si WebGL, le GLB ou la préparation ne sont pas disponibles au clic, un écran CRT de secours lit immédiatement le même film et garde ses commandes.
- Préparer le téléchargement du GLB et de l’atlas du studio pendant l’intro quand le héros est visible, puis différer le décodage et le contexte WebGL jusqu’à la fin de l’entrée. Le studio conserve ses reflets grâce à l’atlas préfiltré `crt-studio-v1.bin.gz`, produit hors ligne ; aucune convolution GPU de l’environnement n’est nécessaire à chaque visite. Les étapes de préparation GPU cèdent la main au navigateur et le poster reste présent jusqu’à la première image prête. Les liens directs vers une autre section gardent la télévision différée. La mesure locale sur RTX 3090 constate un constructeur à 18 ms contre 129 ms et aucune tâche longue après l’intro. Les contrôles de restauration WebGL, de pause vidéo et de raccord poster/modèle passent ; le rendu logiciel reste lent et ne représente pas les performances de tous les appareils.
- Conserver **Pepe intégralement blanc, de la tête aux mains**, dans tous les visuels. La texture `public/assets/crt-screen.png` est composée à partir de `pepe-mascot-white.png`. La référence originale du pack avec Pepe tacheté reste uniquement une source de provenance dans le dépôt.
- Garder la navigation fixe et visible : transparente sur le héros, puis crème lorsqu’il quitte l’écran.
- Conserver de [Vibebevvy](https://vibebevvy.com/) le tracé d’entrée, la vague de transition et la composition du héros. Le sélecteur reprend désormais le principe de couronne draggable de [Jupiter Gacha](https://jup.ag/gacha/packs), adapté aux quatre packs 1 %. La page doit rester courte : héros, packs, dépôts et footer. Les messages centraux présentent les tokens à obtenir, le plus gros lot de 1 % de supply totale et les dépôts qui financent les lots.
- Supprimer le graffiti violet et remplacer le fond du héros par `hero-studio-clean.webp`, sans les objets « % » qui chevauchaient le sachet. Retirer les boutons jaunes et les photographies de survol parmi les jetons dorés.
- Animer la typographie, la télévision et la manipulation du sélecteur de packs ; proposer une version lisible quand l’utilisateur demande moins de mouvement. Le site utilise Lenis pour le défilement et Fraunces pour les grands titres, sans rendre ces dépendances nécessaires aux assets autonomes.
- La piste ouverte et les images affinées de la V9 ont été rejetées : les sachets doivent conserver leurs proportions natives. Reprendre la couronne de Jupiter, sa manipulation à la souris, son flottement, son soulèvement et son inclinaison au survol, ainsi que les reflets suivant le curseur. La V10 utilise huit exemplaires sur une boucle en profondeur ; le mobile cadre la couronne au lieu de compresser tous les packs pour les faire tenir. Voir [carousel-jupiter-v10.md](carousel-jupiter-v10.md).
- Retirer la banderole violette au-dessus de la navigation. Le header commence au bord supérieur.
- Ne pas employer de microtexte gris, de labels décoratifs gris en capitales ou monospace, de numéros de série gris, ni de règles horizontales pâles pour créer la hiérarchie. Préférer une copie concrète, de taille lisible, en encre ou en couleur de marque.
- Préserver un focus clavier visible intégré au contrôle, sans rectangle supplémentaire autour du champ ou de son texte.

La **révélation de Pepe conservée séparément** reste une reconstruction **2,5D conçue pour la vue frontale**. Les lumières sont intégrées aux textures ; l’image seule ne fournit pas les faces cachées nécessaires à une sculpture complète à 360°. Le pack fermé de l’ancienne section tournante est un modèle volumétrique Signature séparé, conservé pour réutilisation ; il ne remplace pas la géométrie de la révélation ni son GLB. Il conserve la texture nette de l’ancien héros, une tranche fine jointe et des reflets de studio mobiles. Le logo « 1 % » possède un relief géométrique arrondi ; les grands plis du foil sont sculptés indépendamment de la luminosité de l’image. Ses deux textures natives sont empaquetées sans perte ; les vues de face, trois-quarts, profil et dos ont été inspectées dans Chrome et Blender. La validation historique de ce GLB ne relève aucune erreur ni aucun avertissement ; les vérifications de la télévision sont décrites séparément dans [crt-television.md](crt-television.md).

La page charge le GLB de la télévision, son poster, son fond de studio nettoyé, les sachets du sélecteur et les mascottes en WebP. `npm run assets:optimize` régénère les dérivés des images du site et ceux des études historiques encore présentes dans le dépôt ; la reconstruction de la télévision et de sa texture d’écran est décrite dans [crt-television.md](crt-television.md). Le module autonome de révélation continue à utiliser ses textures PNG, mais ni ce module, ni ces PNG, ni son GLB ne sont chargés par la landing. Le modèle tournant de **6 306 676 octets** et son lecteur restent aussi absents de la landing. Sa source éditable Blender, son GLB master et les commandes de reconstruction restent dans [assets/blender/README.md](../assets/blender/README.md). Le kit d’intégration garde les assets réutilisables de révélation et de volume ; les photographies retirées de la landing sont conservées uniquement dans le dépôt.

## Historique de la composition visuelle

Le bandeau de tokens retiré le 3 octobre 2026 alternait **PONS, BUN, NVDA, AI, UBIK, TSLA, BONER, AAPL, AUR et META**. Il avançait au survol et au focus, se suspendait seulement pendant le maintien du pointeur, du toucher ou d’Espace, et conservait le défilement horizontal natif. Ces interactions concernaient le bandeau séparé, pas le sélecteur de packs. Les sources des dix identités restent dans [token-carousel-assets.md](token-carousel-assets.md) ; seuls PONS, BONER et Tesla sont réutilisés par le X-ray actuel.

La version du 1er octobre 2026 suivait la progression longue de Vibe : rangée de cartes avec survol parmi les jetons dorés, machine gacha et accordéon, carrousel de messages, typographie défilante, pack tournant, photographie de mains, récit des dépôts, deux cartes de parcours et galerie animée. Le fondateur a demandé leur retrait le 2 octobre pour limiter la page au héros, aux packs, au récit des dépôts et au footer. Les documents de provenance et les sources 3D conservent ce travail comme historique, sans le réintroduire dans la landing.

Avant son remplacement par la télévision le 2 octobre, le héros utilisait le pack fermé puis sa déchirure pilotée par le scroll dans les deux sens. Sa piste mesurait `220svh` sur bureau et `210svh` sur mobile, avec une scène sticky de `100svh` ; la progression suivait `distance / (hauteurPiste - hauteurScène + hauteurScène × 0.15)`. Le module `PackReveal` conserve l’animation de la tête et des mains, les deux feuilles connectées, les pointes de foil repliées et la même texture du logo et du texte pendant toute l’ouverture. Cette chorégraphie reste disponible pour une autre intégration et ne décrit plus le héros actif.

## Proposition historique issue du document fourni

Cette partie conserve les propositions de la note de recherche. Elle ne réintroduit pas les campagnes sponsorisées comme un troisième parcours de la landing et ne remplace pas les précisions produit confirmées ci-dessus.

Des LP déposeraient des lots de tokens en escrow. Un joueur paierait pour recevoir un lot choisi selon des probabilités annoncées. La valeur des lots distribués doit être soustraite des paiements reversés aux LP pour calculer leur résultat économique.

La différenciation proposée repose sur des vaults LP avec une exposition choisie et sur des packs communautaires sponsorisés. Les références FWA et NFW dans la note servent de pistes de recherche ; leurs paramètres et leur état actuel restent à vérifier avant toute comparaison publique.

### Hypothèses économiques à simuler

| Affectation pour 10 $ payés | Hypothèse |
| --- | ---: |
| Valeur attendue des tokens distribués | 9,00 $ |
| Paiement total crédité aux LP | 9,50 $ |
| Résultat LP attendu après tokens cédés | 0,50 $ |
| Budget buyback du token natif | 0,20 $ |
| Budget exploitation et distribution | 0,20 $ |
| Réserve opérationnelle | 0,10 $ |

Les tokens distribués proviendraient de l’inventaire des LP : leurs 9 $ de valeur attendue ne sont pas une seconde sortie de cash sur les 10 $ encaissés. Le calibrage proposé correspond à un RTP de 90 %, une marge LP attendue de 5 % du volume et un prélèvement protocole de 5 %. Il suppose des valorisations constantes et précède les coûts propres des LP. Aucun APY ni rendement garanti n’est défini.

Pour des lots actifs de valeur positive `v_i`, la note propose :

```text
S = somme(1 / v_j)
p_i = (1 / v_i) / S
E = somme(p_i × v_i) = N / S
Prix du pack = E / 0,90
Part de rémunération du lot i = (p_i × v_i) / E
```

Avec ces probabilités inverses, chaque lot finance la même perte attendue en valeur. Les 95 % de paiement destinés aux LP seraient donc partagés également entre les lots actifs, y compris le lot sélectionné. Avec une autre distribution, la rémunération devrait suivre le risque `p_i × v_i`.

Le prix serait dynamique dans la première version proposée. Un prix fixe, des lots entiers de taille libre et des probabilités toujours exactement inverses à leur valeur ne peuvent pas être imposés simultanément pour tout inventaire.

### Expérience LP

La note recommande le mode mutualisé par défaut : un vault d’un même token fournit plusieurs lots et répartit les prélèvements et les revenus entre ses déposants. Le mode individuel expose un lot entier jusqu’à sa sélection. Chaque utilisateur pourrait limiter la fraction de son inventaire engagée.

Une espérance positive ne garantit pas un résultat positif pour la majorité des LP individuels. La note illustre ce risque sous des hypothèses simplifiées de probabilité et de rémunération constantes : environ 61,2 % de probabilité de perdre le lot avant d’avoir encaissé sa valeur. Cette illustration n’est pas une prévision pour un pool réel. La mutualisation réduit la concentration des pertes, sans supprimer le coût des lots distribués ni le risque de marché.

### Inventaire et valorisation

Les pistes à spécifier incluent :

- Lots effectivement déposés, quantités vérifiables et valorisation tenant compte de la liquidité à cette taille.
- Contrôle des prix périmés, écarts entre sources et permissions de transfert des tokens.
- Pause des nouveaux engagements quand les conditions d’admission ne sont plus réunies.
- Construction de lots standardisés par le moteur, indépendante du nombre de dépôts ou de wallets. Sous la loi inverse, découper un lot de valeur `V` en `n` lots multiplie son poids total de `1/V` à `n²/V`.
- Économie des points, referrals et subventions qui garde l’activité circulaire déficitaire.
- Livraison des tokens ; une éventuelle revente se ferait au prix réellement exécutable, sans cashout garanti au prix historique.

### Tirage vérifiable

La proposition consiste à figer paiement, inventaire admissible, quantités, probabilités et règle de valorisation avant la connaissance de l’aléa. Le résultat serait lié à un identifiant unique et sélectionné de manière déterministe, puis le lot attribué sans possibilité de double distribution.

Une file de règlement simple est suggérée pour la V1. La chaîne visée est désormais Robinhood Chain. Le fournisseur de randomness, le modèle de confiance, la gestion des indisponibilités et les règles de retrait restent à choisir. Le ZK est une piste ultérieure de preuve du calcul ; il ne remplace pas une source d’aléa imprévisible.

### Token et campagnes sponsorisées

La note propose un budget de buyback puis burn de 2 % des achats, financé par l’activité réelle et exécuté séparément du règlement des gagnants. Le produit devrait pouvoir fonctionner sans émissions incitatives. Aucun lancement de token ni allocation définitive n’est décidé dans ce dépôt.

Les packs sponsorisés utiliseraient un budget supplémentaire préfinancé. Une contribution de sponsor pourrait augmenter la valeur attendue pour le joueur sans réduire la rémunération LP prévue. Le coût d’acquisition, le farming et les frais du service restent à modéliser.

## Questions ouvertes avant développement du produit

1. Spécifier le déploiement sur Robinhood Chain, l’actif de paiement, les tokens admissibles, la granularité des lots et les conditions pour financer les gros lots de 1 % de supply totale.
2. Simuler les distributions de résultats LP, le RTP, le renouvellement de l’inventaire et les variations de prix.
3. Définir les quotes, leur expiration, les réservations concurrentes, les retraits et le règlement des tirages en cours.
4. Choisir les sources de prix et de randomness, avec leurs seuils et leurs procédures de panne.
5. Valider la demande sans subventions et mesurer séparément volume organique, activité circulaire et résultat LP net.
6. Faire qualifier juridiquement le jeu, les positions LP et un éventuel token selon les pays visés. La discussion du cadre français dans la source reste une analyse à vérifier, pas une autorisation de lancement.
7. Décider des paramètres commerciaux après simulation et validation ; les tableaux ci-dessus restent des hypothèses.

## Reprise technique

| Fichier ou dossier | Rôle |
| --- | --- |
| `src/crt-tv.js`, `src/crt-hero.css` | Lecteur WebGL de la télévision active, interactions de survol et présentation du héros. |
| `src/crt-resources.js`, `src/crt-studio.js`, `public/assets/crt-studio-v1.bin.gz` | Préchargement des octets et atlas de reflets préfiltré ; préparation GPU différée sans convolution de l’environnement à chaque visite. |
| `scripts/bake-crt-studio.mjs` | Reconstruction hors ligne de l’atlas du studio, avec les panneaux et lumières de référence. |
| `public/models/onepercent-crt.glb`, `assets/blender/crt/` | GLB actif de la télévision et sources Blender éditables. |
| `public/assets/crt-screen.png`, `public/assets/crt-poster.webp` | Image « 1 % » avec Pepe blanc affichée à l’écran, et aperçu fixe du modèle. |
| `public/media/onepercent-explained.mp4`, `.webp`, `.vtt` | Film de 25 s sans voix, poster et sous-titres anglais ; chargement à l’ouverture du lecteur. |
| `scripts/film/` | Fabrication du film : capture déterministe de l’app sous temps virtuel, compositeur et rendu des images. |
| `src/pack-reveal.js` | Module autonome conservé : renderer Three.js, progression, export et nettoyage ; absent de la landing. |
| `src/pack-asset.js` | Deux feuilles de foil connectées, reliefs et animation du personnage. |
| `src/pack-character.js` | Contours des parties du personnage dans la photo originale. |
| `src/pack-turntable.js`, `src/pack-turntable-source.js` | Lecteur et surfaces du pack fermé volumétrique conservés pour réutilisation ; absents du chargement de la landing actuelle. |
| `src/entrance.js`, `src/entrance.css` | Entrée dessinée et transition en vague. |
| `src/main.js`, `src/styles.css`, `index.html` | Site concept, intégration de la télévision et interactions de navigation. |
| `src/pack-display.js`, `src/pack-display.css`, `src/pack-carousel-scene.js` | Sélecteur de packs en arc, révélation X-ray des coins, choix des quatre éditions et ouverture des détails. |
| `public/assets/tokens/` | Logos PONS/BONER/Tesla réutilisés par les coins X-ray ; autres identités conservées pour provenance. |
| `src/token-carousel.js`, `src/token-carousel.css` | Ancien bandeau de logos, conservé comme historique et retiré de l’intégration active. |
| `public/assets/` | Fond actif `hero-studio-clean`, sachets PNG/WebP, textures du pack et de Pepe blanc, mascotte et GLB de révélation ; anciennes scènes conservées pour provenance. |
| `public/models/onepercent-foil.glb`, `assets/blender/` hors `crt/` | GLB optimisé du pack tournant et ses sources Blender éditables, son master non optimisé, ses scripts et vues de contrôle. |
| `examples/react/` | Exemple d’intégration React / Next.js du module de révélation conservé. |
| `tests/`, `scripts/` | Régressions de géométrie, vérification navigateur, export, enregistrement et régénération des images WebP via `scripts/optimize-images.mjs`. |
| `docs/asset-provenance.md` | Provenance des images et prompt de reconstruction du pack fermé. |
| `docs/asset-provenance-v2.md` | Huit nouvelles scènes imagegen et adaptation de la chorégraphie de la référence. |
| `docs/pack-palette-v3.md` | Masters et dérivés argent/bronze/anthracite, scènes de survol assorties, prompts et provenance. |
| `docs/content-direction-v4.md`, `docs/token-carousel-assets.md` | Direction du contenu, définition du plus gros lot de 1 % et provenance des logos actuels et historiques. |
| `docs/crt-television.md` | Reconstruction, intégration, provenance et vérifications de la télévision du héros. |
| `docs/concept-video.md` | Découpage du film, faits à garder vrais, format, fabrication, lecture dans les deux télévisions et vérification. |
| `docs/verification.md` | Audit historique de la version précédente. |
| `docs/verification-v2.md` | Validation et limites de la deuxième direction. |
| `docs/verification-v3.md` | Validation de la correction des scènes sticky, de la nouvelle palette et de la refonte PBR du pack tournant. |
| `deliverables/one-percent-pack-kit.zip` | Kit d’intégration avec sources, textures, modèle et module compilé. |

Les corrections du module de révélation conservé doivent rester intactes : aucune surface photographiée du sachet derrière le foil mobile, aucun morceau de crâne fixe, aucune bande de foil embarquée dans les contours du personnage, aucune transition de texture sur le logo et le texte. Les bords partagés de chaque feuille restent joints pendant toute l’animation. Le rendu en direct de ce module et son GLB doivent utiliser la même texture `pepe-all-white.png`.

Les commandes de démarrage et d’intégration sont dans le [README](../README.md). La production utilise Railway, décrit dans [railway-deployment.md](railway-deployment.md). Le dépôt ne contient pas de backend financier.
