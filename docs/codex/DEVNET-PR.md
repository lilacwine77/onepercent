# Plan de commits proposé

Le provisionnement initial a été commité par l'architecte (`cd21ac5`).
Commit complémentaire proposé, non exécuté :

`fix(program): isolate localnet and devnet build identities`

Inclure les features Cargo et pins par cfg, les wrappers de build et contrôles
release/CI, les IDL/events/PDA canoniques localnet, les tests de cluster, la
correction de fermeture des flux du lanceur validator, la documentation et les
preuves publiques. Le scénario launch a aussi régénéré neuf snapshots/rapports
publics Meteora, listés dans `devnet-cluster-build.json`.

Exclure target/, reports/, journaux signés et tous les signers externes.

# Titre de PR

Provisionner devnet et valider le launch Meteora v1, les claims et le smoke

# Corps de PR

Le programme devnet persistant est déployé avec 1966080 octets de capacité.
Config, Machine et rôles sont initialisés ; trois vrais coins pump ont permis
54 cartes Feed. Le launch atomique crée mint/pool, achète les 4 % prévus et
active power_on. Les deux LUT sont figées. Les clés restent hors du dépôt.

Le même arbre source compile localnet par défaut et devnet avec la feature
`devnet`. La feature `mainnet` reste bloquée sur les pins PENDING ; sélectionner
les deux features provoque une erreur de compilation. Les wrappers transmettent
le cluster, le contrôle de release vérifie l'identité réellement compilée, et
le SDK garde ses artefacts canoniques localnet tout en utilisant
`ClusterDeployment` au runtime.

Le rebuild devnet diffère du ProgramData : 176 octets, entièrement expliqués
par la permutation de quatre fonctions et l'ajustement de leurs appels relatifs.
La reconstruction de cette permutation reproduit exactement le nouvel ELF.
Les deux hashes et la preuve sont dans DEVNET.md. Aucun redéploiement n'a été
effectué pendant ce correctif.

Deux profils isolent devnet : transport RPC standard sans Sender, p75 mesuré
par envoi et plafonné ; compatibilité DBC v1 avec transfer fees strictement
nulles. Les tests refusent ces extensions sur mainnet. K1/S3 restent PENDING
et leur exigence de 24 h de mesures est inchangée. L'architecte a explicitement
levé la preuve de provenance devnet : `82054dfd` est une référence source non prouvée.

Validation empirique devnet : fees Curve 250 bps, claim partenaire de 23846564
lamports vers FeeIn et collecte, métadonnées immuables. Faute de 85 SOL devnet,
le validator local charge les binaires devnet vérifiés par hash : migration,
LP 100 % permanent vers FeeIn, fees DAMM 250 bps, claims Pool pendant/après saison.
Tous les vecteurs économiques sont identiques au rapport v0 de référence.

Le MAJOR fictif a une couverture de 1,5 SOL et un profil explicitement devnet ;
le smoke Rip a passé avec la vraie queue MagicBlock partagée : callback, settle,
Redeem de cinq cartes et réception des tokens vérifiée. Aucun Pull ni réserve
ne reste ouvert. Les résultats et
signatures finalisés sont consignés dans DEVNET.md et provisioning.json.

Builds, lint, format, typecheck, 3655 tests JS/TS avec Postgres 17/Redis locaux,
351 tests Rust et les 11 scénarios validator passent. Deux assertions propres
à Postgres sont inapplicables au backend mémoire. Un test keeper intermittent
a passé en relance complète ; la course entre fin de processus et lecture de
stdout dans le lanceur validator est corrigée. Aucun service
Railway n'a été déployé ; les parcours déployés API/web/bot restent à éprouver.
M4.2 est fusionné dans les sources ; l'upgrade reste distincte de ce correctif.
Une répétition
jetable de retrait d'autorité ne doit jamais viser ce programme persistant.

Solde payeur relevé à la fin du provisionnement : 11.063616614 SOL ; débit cumulé
14.036373386 SOL, incluant rents et transferts de test. Après le smoke,
Deck=50 et book MAJOR=1,45 SOL : réapprovisionner avant un autre Rip OG.
