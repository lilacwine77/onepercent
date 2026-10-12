# Devnet — provisionnement et reprise

**Mainnet D31/D32 :** ce document conserve les opérations et preuves devnet ;
ses wallets, secrets, profils de transport et lancements atomiques ne constituent
pas la matrice de garde ni la procédure mainnet. Suivre
[`DEPLOY-MAINNET.md`](DEPLOY-MAINNET.md) : l'ami déploie et lance depuis son wallet
Deployer Proxima, reçoit directement les 40M, puis signe dépôt et Power-On ; le
wallet unique du fondateur reçoit admin et upgrade avec vérifications on-chain,
sans Squads ni timelock. Les rôles chauds et guardians sont générés et gardés par
l'opérateur des services, séparément des clés devnet, sans affichage des secrets.

État du 2026-10-11 : **premier upgrade M4.2 déployé ; Config/Machine conservés et launch
Meteora et smoke réel terminés**. Go fondateur limité à devnet ; aucune écriture mainnet/canary,
aucun commit, aucune variable Railway posée. Adresses : [ONCHAIN_KEYS.md](ONCHAIN_KEYS.md).

## Compatibilité et résultats

L'architecte autorise la répétition sans preuve de provenance Meteora. Le source
candidat `82054dfd` (`release_0.2.2`) n'est pas attribué au binaire déployé.
Le profil `devnet-dbc-v1-zero-transfer-fee-v1`, sélectionné par cluster, accepte
config v1 uniquement sur devnet avec cinq octets 216–220 nuls. Les paramètres
D29 sont toujours vérifiés. Tests : mainnet refuse v1, chaque champ de transfer
fee non nul est refusé sur devnet. Voir [audit](DEVNET-METEORA-AUDIT.md).
Mainnet conserve ses pins v0 et K1/S3 PENDING (24 h de mesures requises).

| Étape          | Résultat                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| Déploiement    | ELF relu identique ; max-len 1966080, upgrade authority wallet de test             |
| Initialisation | Config, Machine, rôles, deux guardians, queue partagée ; pauses à zéro             |
| Feed           | Trois vrais coins pump devnet ; 54 cartes déposées par 18 wallets                  |
| Launch         | Mint SPL, pool, dev buy, power_on atomiques ; 744 octets ; launch report PASS      |
| Curve 250 bps  | Input 1192328122 lamports ; fees 29808204 = ceil(input × 250 / 10000)              |
| Claim Curve    | Partenaire 23846564 lamports reçus ; protocol 5961640 reste au DBC                 |
| Collect        | Stock +25335214 lamports : claim +1488440 de rent ATA +210 fees pump préexistants  |
| Métadonnées    | Metaplex isMutable=false ; mint/freeze authorities absentes                        |
| LUT            | Protocole 106 entrées ; launch 17 entrées ; toutes deux figées                     |
| MAJOR / Rip    | PASS : couverture financée, vraie VRF, settle, Redeem x5, tokens reçus             |
| Migration      | Répétition locale avec les binaires devnet ; budget devnet insuffisant pour 85 SOL |

La simulation avant launch mesurait un coût total de **1215464842 lamports**,
rent et frais compris, depuis le launch wallet financé à 1,3 SOL. Le compte DBC
v1 préexistant a été conservé. La création future valide aussi le compte simulé
avant signature ; une version non admise est refusée avant toute création.

Le MAJOR `devnet-major-sol-fixture-v1` utilise le coin pump de test
`8qHh54rJXmwegYvCz7369akQUnx1DTj3G3amoYzmYdFV`, le vrai flux SOL/USD devnet
`7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE` et 1,5 SOL de couverture.
C'est une fixture de stock avec transferts entre exec_begin/exec_end, pas une
mesure du prix ni de la liquidité réelle de ce coin. Hit lists production et
Rust inchangés ; le sélecteur de fixture refuse mainnet.

## Transport devnet approuvé

Profil partagé `devnet-rpc-p75-v1`, sélectionné uniquement par `cluster=devnet`.
RPC standard `https://api.devnet.solana.com`, **aucun tip Sender**.
Chaque nouvelle transaction mesure `getRecentPrioritizationFees` sur les comptes
écrits, payeur inclus, dédupliqués et triés, au maximum 128 adresses.
Prix : rang `ceil(0,75 × N)` après tri croissant, zéro si tableau vide, plafond
**1 000 000 microlamports/CU**. Une erreur de lecture arrête l'envoi.
Les retransmissions conservent leurs octets signés et leur mesure ; une nouvelle
transaction après expiration réconciliée refait la mesure. Le journal conserve
le prix et les comptes interrogés. L'upload réserve 10000 CU par écriture ;
le launch mesure ses CU et applique la marge existante avant simulation finale.

Le sélecteur refuse mainnet et localnet, test à l'appui. Les paramètres mainnet
K1/S3 restent PENDING (`null`) et exigent toujours 24 h de mesures, PARAMS §26.3.
Le release check et `launch check` mainnet restent bloqués. Les tests utilisent
un RPC simulé pour mainnet ; aucun accès au réseau mainnet.

## Identités et stockage

Payeur, admin, team wallet et autorité d'upgrade :
`~/.config/onepercent/devnet-test-wallet.json`.
Adresse : `DpMXTAcBPhEpNA2joqP6eEgJkfetjzRiQyVUfQoqZG93`.
Toutes les keypairs externes sont lues en mode 600 sans affichage.

Les clés programme et rôles sont dans `~/.config/onepercent/devnet/` :
`program.json`, `keeper.json`, `executor.json`, `intake-signer.json`,
`quote-signer.json`, `guardian-1.json`, `guardian-2.json`, `lut-authority.json`.
Les huit fichiers déplacés par l'architecte y sont bien lus : `mint.json`,
`launch.json`, `guardian-2.json`, `pump-fixture-mint.json`, `log-ip-salt.txt`,
`intake-internal-token.txt`, `quote-internal-token.txt`, `bot-api-secret.txt`.
`target/devnet-provision/secrets/` reste vide.

Exception de test explicitement épinglée :
`app/fixtures/meteora/keys/localnet-devnet-dbc-config-TEST-ONLY.json`.
Le provisionneur ne copie jamais son contenu dans un rapport.

Clés supplémentaires créées hors repo dans un répertoire autorisé en écriture :

- `~/.config/solana/onepercent-devnet-deployment-buffer.json` : buffer loader,
  fermé après déploiement, solde nul ; conserver sa clé pour les reprises.
- `~/.config/solana/onepercent-devnet/feed-wallet-0.json` à `feed-wallet-17.json` :
  wallets de test, mode 600, répertoire 700.
- `~/.config/solana/onepercent-devnet/pump-fixture-mint-2.json` et
  `pump-fixture-mint-3.json` : coins 2 et 3.
- `rip-wallet.json` dans ce même répertoire : créé pour le smoke, mode 600.

Aucun déplacement manuel nécessaire pour ces fichiers. Le lien
`app/target/deploy/onepercent-keypair.json` pointe vers la clé programme externe.
Les journaux ignorés `app/reports/` contiennent preuves publiques et transactions
signées, jamais les keypairs. Conserver une sauvegarde privée des journaux ; ne
pas effacer une signature incertaine avant réconciliation. Un seul script qui
envoie des transactions doit tourner à la fois.

## SOL : historique du provisioning (2026-10-10)

Relevé finalisé après smoke, slot **509650291** :

| Mesure                                               |              SOL |
| ---------------------------------------------------- | ---------------: |
| Payeur avant provisionnement                         |     25.099990000 |
| Payeur restant                                       | **11.063616614** |
| Débit du payeur                                      | **14.036373386** |
| Autres wallets de test, rôles et launch (SOL natifs) |      0.994146742 |

Cette reprise débite **3.037693546 SOL** du payeur.

Le relevé final avec les soldes de tous les wallets de test est dans
`app/fixtures/devnet/provisioning.json`. Les fonds du wallet Rip et le wSOL
reçu par le wallet marché de la fixture restent des fonds de test récupérables.

Le débit inclut les rents et les fonds transférés aux comptes applicatifs ; il
ne représente pas uniquement les frais réseau. Rents lus sur devnet, sans taux
codé en dur :

| Poste                                            |                                     SOL | État                                     |
| ------------------------------------------------ | --------------------------------------: | ---------------------------------------- |
| Programme + ProgramData                          |                             9.989398360 | Immobilisés, capacité comprise           |
| Frais réseau du déploiement                      |                             0.006025000 | Dépensés                                 |
| Buffer temporaire                                |                             4.878694840 | Récupéré lors du déploiement ; solde nul |
| Somme prudente des trois rents avant déploiement |                            14.868093200 | Besoin temporaire couvert                |
| Init, dont 0,05 SOL de buffer rent               |                             0.076700480 | Créée, hors frais 0.000005000            |
| Config DBC                                       |                             0.005974080 | Créée, hors frais 0.000010000            |
| LUT protocole                                    |                             0.018166080 | Créée et figée                           |
| Réserves keeper / executor                       |                      0.050000000 chacun | Transférées                              |
| Réserves guardian 1 / 2                          |                      0.005000000 chacun | Transférées                              |
| Dev buy calculé D29                              |                             1.192328122 | Exécuté, quote identique                 |
| Pool DBC / mint SPL / MintLedger                 | 0.002804160 / 0.001066800 / 0.001056640 | Créés                                    |
| Compte token SPL                                 |                  0.001488440 par compte | À recalculer dans la simulation launch   |
| LUT launch, 17 entrées                           |                             0.003698240 | Créée et figée                           |
| Couverture fixture MAJOR proposée                |                             1.500000000 | Financée via exec_begin/end              |

Aucun airdrop ni complément nécessaire. Simulation atomique launch :
1215464842 lamports de débit total, dont 1192328122 pour le dev buy ; le reliquat
couvre rent et frais. La couverture de 1,5 SOL est financée et le wallet Rip a
reçu 0,25 SOL. Chaque script contrôle son budget avant envoi. Le test à 85 SOL
est réalisé sur validator local, sans débit devnet ni demande de financement.

## Reproduire le build et reprendre

Depuis `app/`, pnpm 10.34.5 ; une étape lourde à la fois :

```sh
pnpm --version
CARGO_BUILD_JOBS=3 VITEST_MAX_WORKERS=2 pnpm install --frozen-lockfile
pnpm program:release:check --cluster devnet
CARGO_BUILD_JOBS=3 VITEST_MAX_WORKERS=2 ONEPERCENT_CLUSTER=devnet pnpm anchor:build
pnpm sdk:idl
pnpm build:libs
node --test scripts/program-release-check.test.mjs
node scripts/devnet-preflight.mjs
```

Le programme utilise un arbre source unique (M6-A4). Sans feature de cluster,
`declare_id!` sélectionne localnet (`DoNH1Cxvv9umyWV9i77LEK4CoqTotDxPRzPxPBzjMJpe`).
La feature Cargo `devnet` sélectionne `DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr`,
comme `[programs.devnet]`. `anchor.mjs` et `program.mjs` transmettent la feature
résolue par `anchor-cluster.mjs` depuis `ONEPERCENT_CLUSTER` ou le provider Anchor.
Une feature contradictoire est refusée. `devnet,mainnet` échoue aussi directement
en compilation Rust ; `mainnet` échoue tant que l'ID et le pin DBC sont PENDING.
Le générateur produit les deux branches `cfg` du pin DBC dans un même `params.rs` ;
changer de cluster ne réécrit donc plus le source. Les autres constantes de
programme sont communes aux clusters.
Cette sélection par features applique la demande explicite de l'architecte du
2026-10-10 pour ce correctif ; elle remplace ici la variation des sources par
tag décrite historiquement dans M6-A4. Elle n'ajoute aucune feature de simulation
au binaire déployable.
Le binaire déployé fait **960208 octets**, sBPFv3, SHA-256
`1f58027ccd8836d4d72141c395dae46a8de5e73cc31389b3cb0a351f7434d937`.
L'IDL de `target/` porte l'identité effectivement compilée. `pnpm sdk:idl`
normalise les adresses racine et `initialize.accounts.program.address` vers
localnet dans les artefacts SDK committés, y compris les events. Au runtime,
le SDK sélectionne le programme avec `ClusterDeployment`.
`program:release:check` sans argument garde mainnet par défaut, même dans un shell
devnet, et échoue sur le pin PENDING. Pour localnet/devnet, il exécute aussi un
probe Rust compilé avec les mêmes features, puis compare son ID au cluster attendu.
`devnet-deploy.mjs` impose ce contrôle et vérifie la présence de l'ID devnet dans
l'ELF avant de poursuivre. Aucun compte mainnet n'est lu pour ces tests.

### Comparaison du build par feature — 2026-10-10

Lecture publique devnet au slot **509663411**, ProgramData
`9vcrRW2eRKUuJ5Mjywmp1TMTm5HFWBLJUih9tvVUkiLB`, slot de déploiement **509603961**.
Relecture au slot **509673841** : ELF, slot de déploiement et autorité inchangés.
Le hash porte sur l'ELF de 960208 octets après l'en-tête loader de 45 octets ;
la capacité restante du ProgramData est vérifiée nulle.

- Déployé : `1f58027ccd8836d4d72141c395dae46a8de5e73cc31389b3cb0a351f7434d937`.
- Rebuild avec `--features devnet` : `7fded56921a2be659e17fcbe41728db8e001db2c58f171106031dd8eb4cd6488`.

Les hashes diffèrent. L'analyse ELF explique **tous les 176 octets différents** :
quatre fonctions de 512 octets sont permutées dans `.text`, et 18 appels relatifs
sont ajustés. Les offsets `.text` ancien → nouveau sont `0x9a340 → 0x9a940`,
`0x9a540 → 0x9a340`, `0x9a740 → 0x9a540`, `0x9a940 → 0x9a740`.
Appliquer uniquement cette permutation et les corrections de destinations des
appels à l'ancien ELF reconstruit exactement le nouvel ELF. `.rodata`, les
en-têtes et tous les autres octets sont identiques. Il s'agit d'un changement
de disposition du code compilé, pas d'une identité binaire conservée.
**Aucun redéploiement n'a été effectué.** La preuve publique est conservée dans
`app/fixtures/reports/devnet-cluster-build.json` ; les binaires et le désassemblage
local restent sous `app/target/cluster-audit/` (ignoré).

Séquence initiale puis reprise exécutée (ne pas relancer les fixtures/season en aveugle sur cet état) :

```sh
node scripts/devnet-deploy.mjs
node scripts/devnet-init.mjs
node scripts/devnet-launch.mjs config
# La création a finalisé, puis le contrôle version a refusé la config.
node scripts/devnet-pump.mjs
node scripts/devnet-feed-fixtures.mjs
node scripts/devnet-season.mjs
node scripts/devnet-protocol-lut.mjs
node scripts/devnet-feed.mjs
node scripts/devnet-fund-roles.mjs
node scripts/devnet-collect-pump.mjs # simulation WrongPhase, aucun envoi
# Après activation du profil devnet approuvé :
node scripts/devnet-launch.mjs fund
node scripts/devnet-launch.mjs lut
node scripts/devnet-launch.mjs check # GO, budget exact simulé
node scripts/devnet-launch.mjs send --accept-warnings
node scripts/devnet-launch.mjs report
node scripts/devnet-fees.mjs
node scripts/devnet-stock-fixture.mjs --fixture-major-approved
node scripts/devnet-rip.mjs
node scripts/devnet-report.mjs
```

`devnet-deploy.mjs` utilise les instructions du loader avec max-len **1966080**,
un buffer persistant explicite et une reprise journalisée. Il évite toute sortie
de phrase de récupération. Après finalisation, il compare ELF, padding,
autorité d'upgrade et capacité. L'upload tolère les limitations du RPC public,
avec retransmission des mêmes octets et vérification finalisée avant remplacement
d'une transaction expirée.

`devnet-launch.mjs` appelle directement `executeLaunch` / `parseLaunchInput`, le
même moteur que **onepct-ops launch**, avec `--cluster devnet`, les clés externes
et le RPC devnet à reprises bornées. Il ne remplace aucun contrôle du CLI.
Métadonnées provisoires de test : Copper Rehearsal / CPRT ; URI d'exemple non
hébergée. Le token de répétition n'est pas présenté comme un token public réel.

Pour reproduire sur une nouvelle saison devnet, vérifier le
profil de compatibilité DBC approuvé, recalculer le budget, financer le launch
wallet, créer et figer sa LUT via `launch lut`, refaire `launch check`, puis
`launch send` et `launch report`. Les commandes du wrapper sont `fund`, `lut`,
`check`, `send`, `report`. `--accept-warnings` n'est à utiliser qu'après examen
et acceptation du nouveau relevé externe. Ne pas appliquer cette option pour
contourner un NO-GO.

Ensuite seulement : fixture MAJOR explicitement acceptée via
`devnet-stock-fixture.mjs --fixture-major-approved`, `devnet-rip.mjs`, puis
`devnet-fees.mjs`. Ces drivers ont passé le smoke initial décrit ci-dessous. Ils gardent
la queue VRF partagée ; le Rip attend le vrai callback, puis settle et Redeem.
Si le callback tarde, préserver la signature et le Pull ; suivre le remboursement
après timeout, sans injecter de résultat. Les délais économiques restent ceux
du programme. Le driver attend OnAir si nécessaire ; la saison persistante a déjà démarré.

Les 18 wallets possédaient leurs coins au snapshot finalisé avant Feed. Les
attestations ont été signées avec l'intake signer externe, via le SDK, puis les
transactions signées par chaque wallet de test. Cela teste le chemin on-chain
Feed ; cela ne valide pas encore l'API, l'indexer ou l'interface Railway.

Une recréation intégrale exige de **nouvelles identités de déploiement** et une
nouvelle saison : il n'existe pas de reset d'une saison sur ces PDA. Adapter alors
les IDs/fixtures/builds au nouveau programme et faire approuver tout nouveau pin
DBC ; ne pas recycler aveuglément les journaux d'un environnement précédent.
`e2e-devnet.ts` reste un test M1 jetable avec identités propres et queue `devnetTest`.
`devnet-upgrade-drill.mjs` retire l'autorité de son programme jetable en fin de
drill : ne jamais l'appliquer au programme persistant. Ni l'un ni l'autre n'a été
exécuté sur ce programme. Un drill jetable complet reste à budgéter séparément.

## Upgrade P3 : pause et absence de Pulls imposées

Pour l'upgrade P3, le même `devnet-deploy.mjs --upgrade --expected-sha256 <hash>`
impose désormais la pause guardian du Rip avant l'upgrade, attend sa finalisation,
puis exige **zéro Pull**, Pending compris. L'inventaire RPC finalisé utilise
`minContextSlot` au moins égal au slot de la Config pausée ; il est répété avant
chaque émission ou retransmission de l'upgrade. Les callbacks, settlements et
refunds restent disponibles pour vider les Pulls. Un échec laisse le Rip en pause.

Après vérification du binaire déployé, l'activation P3 refait ce contrôle au moins
au slot de l'upgrade, exécute `advance_phase`, vérifie le timestamp et les compteurs,
puis seulement restaure le Rip si cette passe l'avait pausé. Une pause préexistante
est conservée. Le journal P3 est indexé par hash du binaire : une reprise après
upgrade déjà finalisé ne saute pas l'activation. Le contrôle en lecture seule
`devnet-upgrade-preflight.mjs` refuse désormais tout Pull et toute absence de pause.

Procédure et tests : [app/DEVNET.md](../../app/DEVNET.md). Aucun realloc ni pouvoir
admin de migration ; aucune modification des conditions du callback ou des sorties.
Le drill de loader jetable refuse désormais toute Config, Machine ou Pull existant.
Ces changements de procédure ne constituent pas une nouvelle exécution sur devnet.

## Upgrade 2 — P3, 2026-10-12

Go explicite de l'architecte ; base annoncée `f3c04c9`. Le binaire de la branche,
bâti avec `--features devnet`, mesure **968904 octets**. Programme,
ProgramData, autorité et capacité **1966080 octets** restent inchangés.

| Mesure                             | Valeur                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| SHA-256 avant                      | `7fded56921a2be659e17fcbe41728db8e001db2c58f171106031dd8eb4cd6488`                         |
| SHA-256 build et ProgramData après | `07ec322c94b26904e3c1ff4b70269493608401b560a93f2132ebf0fead701c65`                         |
| Slot avant → après                 | `509691948` → `510047710`                                                                  |
| Pause Rip finalisée                | `4FyywzYY4aCZGBfeNoeRpPDgrRfMD2sHr9rzSpxfC49h2B9SnrEjrff8MLke69n119MooUi9X2cmRSysPTKr7yBe` |
| Inventaire finalisé avant upgrade  | slot `510046963`, zéro Pull de tout statut                                                 |
| Upgrade                            | `GFoqMKvkhTqygnpcHjQ5JGJSKKSewqAHasTULR9858y8DDFNCcwwQUh3Xy8XhQXCSZmXVtW46NZDLz4rM3Ccj21`  |
| Activation P3                      | `4c6iX8rPzK9VXsA6HCtEMMDft7gM2ERQPfYdJQP6JcMZLRJ4E9BVh3VokKEmvTuRCrVaWQEG3Rtvtj92ScQT7eCh` |
| Reprise Rip                        | `59MWuBFV1Z1US4JLPpVf2JvzcuqA2h3ALR6FDkfhzK3HZPLTG2kGZ66xGc18wV6ui5EZ2MjxAiSwY9V3QB7WKpTb` |

L'ordre finalisé est pause, inventaire vide, upgrade, activation, puis reprise.
L'activation initialise `last_reveal_ts=1791756481` à l'offset **2656** ;
`sb_paid_prev_hour` (**2664**), `keeper_history_version` (**2672**),
`keeper_history_started_ts` (**2680**), les 16 historiques de buckets
(**2688 + 24 × i**) et `unsettled_reveals` (**3072**) restent à zéro à ce stade.
Les rotations normales feront ensuite évoluer l'historique. Aucun realloc.

L'upload a rencontré deux expirations de blockhash. Les reprises ont réconcilié
les signatures et les octets présents ; les lots ont été réduits de 20 à 10.
Le buffer est fermé, rent **4.922870520 SOL** récupérée. Le payeur passe de
**10.422840134** à **10.416750134 SOL** immédiatement après l'upgrade :
**0.006090000 SOL** de frais, activation et pause/reprise comprises.

Le snapshot initial a détecté deux transactions externes du wallet de test
pendant l'upload : TakeBack au slot `510038979`, puis Feed au slot `510039100`.
Elles précèdent l'upgrade et touchent un Binder, le Deck et un MintLedger.
Le snapshot original est conservé. `devnet-upgrade2-reconcile.mjs` rejoue
exactement leurs instructions signées et événements finalisés, après vérification
des signatures, arguments, balances et historique des trois comptes. Il ne copie
aucun octet observé après upgrade dans la référence. La comparaison stricte
`devnet-upgrade2-snapshot.mjs after --reconciled` valide alors **26 comptes** :
23 références originales et trois références rejouées, avec uniquement le
timestamp d'activation autorisé dans Machine. Aucun Pull n'existait à migrer.

Les preuves publiques sont dans
[upgrade-2.json](../../app/fixtures/devnet/upgrade-2.json). L'upgrade est terminée ;
le smoke a le statut **`INCOMPLETE_CONCURRENT_KEEPER`**. Le keeper configuré
`Fu1Kpogh6cPTdVn7PRQmWGkrkUHNdzW7K82YF2Hp7Brw` a settled notre Pull
au slot `510050182`, deux secondes après le callback MagicBlock. Cette transaction
est extérieure au journal de cette passe. La simulation initiale du StockBuy
attendait 6071 ; la seconde simulation a trouvé 6072, donc le harnais a arrêté
l'envoi. La signature sauvegardée a ensuite été vérifiée absente de l'historique
et expirée à un bloc finalisé. Aucun refus 6071 ou 6072 exécuté n'est revendiqué.

| Contrôle réel                              | Résultat                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 6071 pendant draw / révélation non settled | À refaire après suspension du keeper concurrent ; simulation seulement                                            |
| 6072 avant 30 s                            | À refaire ; aucun reçu de refus. Achat MAJOR après 30 s réussi                                                    |
| 6073 TRENDING avant préavis                | Refus exécuté ; achat MAJOR réussi pendant ce même préavis                                                        |
| 6074 sous réserve                          | Refus exécuté : stock 0.096488440 SOL, achat proposé 0.05 SOL, plancher 1 SOL                                     |
| StockSell                                  | Réussi sous réserve et pendant le préavis TRENDING ; fenêtre non settled / 30 s non exercée                       |
| Feed                                       | Cinq transactions après upgrade ; quatre avant préparation du Rip et une après TakeBack                           |
| Rip / VRF / settle                         | Rip OG réel, callback MagicBlock réel, settle et fermeture par le keeper concurrent                               |
| Redeem                                     | Cinq cartes ; crédits vérifiés de 3000050000 unités MAJOR et 1000000000 unités du deuxième coin                   |
| Sorties                                    | TakeBack réussi sous réserve / préavis ; `withdraw_owed` réussi sans montant dû. Refund et Final Pull non exercés |
| Fees Curve                                 | Swap de 0.05 SOL : 1250000 lamports de frais (2,5 %), dont 1000000 partenaire effectivement claimés               |
| Collecte                                   | 2488440 lamports, dont 1488440 de rent WSOL ; 1244220 vers stock et autant vers team                              |
| Métadonnées                                | Toujours immuables                                                                                                |

Les StockBuy/StockSell utilisent le MAJOR fictif autorisé et son adaptateur de
transfert, avec le flux Pyth devnet. Ce n'est pas une preuve d'exécution de marché.
Le test TRENDING utilise les adresses canoniques pour tester l'admission ; aucun
pool gradué ni swap TRENDING réussi n'est revendiqué.

| Transaction                      | Signature                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| Refus 6074                       | `6728Be73KT18socCdv8TYAHpmXtJ6fmHUEYTp8ftbtxD8M6q2NU5ivBvCKgv9DibLREkP5V93BQT4PhRQiv2cbba` |
| StockSell sous réserve / préavis | `2wqrQQnWnWEj1oQq44MbcjaVdp4sEn2LzaLQhqrhpr2puJ84H2sWUGoVFy9KVY2ka54gvrX9hrkoh8sX3d3XqUxk` |
| Refus 6073                       | `53Zqk6mM1ihowEBdUVjB28J35HjD8irJsz5rVKxHxRurErmmWCSMx8tkz4V8SSrMGYCvKNjPrWdcbkv4Rz9eyypt` |
| Rip                              | `58J26BSoHq5RxyGxjTmBhTEXm2p7GVwWKfogBLxzpaFUwHEUtqf61tFTZKXpznatjDswwhcghCsz5ZAgci2jEmbN` |
| Callback VRF                     | `yb7igyrexNyFN84tnG86GdQMveA7ZwzpKpWCqFr9EzYMbM3XomqSgcKuMSJ5qxbUuGoWbxNefPLzZgRRoejouKz`  |
| Settle externe                   | `5DFBSjJCCtjZeznWwUifN7GHvMCqpBGCZ1mrzjsqZKQJqEF4goRuAUZJqv4pJWoToGUfTqAbgRY6n6KXf5WrRx6w` |
| Redeem                           | `2h1DtyndbEZnqA9FKYdb5vxigum3cNhhtimXYJ1sY7AEN7beuHWHLikDrpX6ch5GiqVosqqPr1U9VT16JsCicgoy` |
| Achat MAJOR après 30 s           | `3xsbTrMMZ3DsuMs2ANcpFBDovx8GsqZ6exux9LvrMgPkw4yveAzvsRwCghafigpWFnkzNnNNdx7BaUfgREKqes8Z` |
| Claim Curve + collecte           | `2z6pupug7RuJjbqGEV2RwBo5T6kkD3r6WpqQuMxGUEK2XZXVEikLbAK5XnzriShLuSyBf8TSf38QNE8G2Ah13y5m` |

À la vérification finalisée au slot **510052364**, le Rip est ouvert,
`pending_pulls=0`, `unsettled_reveals=0`, réservations à zéro, Binder du test-user
vide et inventaire global de Pulls vide. Le hash du ProgramData égale toujours
celui du build. Au slot **510052596**, il reste **9.310206294 SOL** au payeur
et **0.393829734 SOL** au test-user. La sortie nette du payeur depuis le snapshot
initial est **1.112633840 SOL**, comprenant l'apport de **1.053511560 SOL** au
stock et le swap Curve de **0.05 SOL** ; ce montant n'est pas uniquement des frais.
La Machine conserve **1.072244220 SOL** de stock comptabilisé.

Commandes exécutées depuis `app/` : `pnpm build:libs`,
`ONEPERCENT_CLUSTER=devnet CARGO_BUILD_JOBS=3 pnpm anchor:build`,
`pnpm program:release:check --cluster devnet`, puis
`node scripts/devnet-deploy.mjs --upgrade --expected-sha256 07ec322c94b26904e3c1ff4b70269493608401b560a93f2132ebf0fead701c65`.
Build et contrôle release passent. Les tests Node des scripts passent (85),
ainsi que les neuf tests Rust P3 ciblés (dont 1000 cas de propriété), les deux
tests ciblés callback/settle, le lint, `format:check` et `lint:words`. Le contrôle
des 35 fichiers de clés externes confirme leurs permissions 600 et ne détecte
aucune de leurs valeurs dans les sources ou rapports locaux. La relecture publique
`node scripts/devnet-upgrade2-verify.mjs --partial` vérifie les reçus, erreurs,
événements, tokens reçus, offsets et hash ; son statut reste incomplet.
Sans `--partial`, le vérificateur exige les quatre refus réellement exécutés.

**Reprise restante :** suspendre le keeper concurrent et les autres smokes,
puis réserver le programme à cette passe. Conserver le journal et les preuves
actuels ; utiliser un nouveau rapport et des labels `upgrade2/guards-retry-1/…`
pour un nouveau Pull. Ne pas relancer `draw` avec les anciens labels. Relire les
soldes, compléter le Feed à au moins 54 cartes et la couverture MAJOR à 1,5 SOL
dans les caps, puis respecter le spacing de 20 s. Réaliser 6071, StockSell pendant
la révélation non settled, settle, 6072 avant l'expiration des 30 s, Redeem et
achat MAJOR après le délai. Ne jamais bloquer les sorties pour isoler ce test.
Rattacher les nouveaux reçus à ce nouveau Pull avant de lever le statut incomplet.

## Coverage refill (2026-10-12)

Objectif : rendre le Rip utilisable sur l'app dev. Avant, `/api/machine` donnait
`maxQty=[0,0,0,0]` (slot `510255823`) : Deck **50**, bucket MAJOR fictif à
**1,451 SOL** de coût pour un cap de **1,5 SOL**. Deux contraintes bloquaient.
La couverture réserve 15 × le prix par pack en attente (1,5 SOL par Original).
Le Deck exige `len ≥ reserved_dust + 4 × qty + 50` : à 50 cartes, aucune quantité
n'est possible, même couverte. Les 18 wallets du snapshot `509605276` ne donnent
que 54 couples wallet/mint, une carte vivante chacun, sans dérogation au snapshot.
Le Deck a donc grandi par Feed back, exempté de cette règle : chaque pack ripé
puis entièrement remis au Deck ajoute une carte nette.

| Étape        | Résultat                                                                                                     | Signature(s)                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Cap          | `UpdateBucket` admin, bucket 0 : 1,5 → **5 SOL**                                                             | `5Tqu1ti2qLCd9JPEitfwfHmTuf2hcs1RAhGttdBM5tFCfDi6KnrQRCUKHmT3GAVCHcfMQ5KE8sowfA1DQa8Zs9qQ`             |
| Achats pump  | Wallet marché : 1000 tokens MAJOR fictif et 1000 tokens coin 2 sur leurs vraies curves devnet (`buy_v3`)     | `sksJWzNFG9uUvTEEoV25WtK5WrFSEAbkivWhJWiFTn4WwnLnjGX2v7Jv4GUJXJktA6WUzWBG7bvm43mmo9vMAfr`              |
| Deck 50 → 54 | Sacs restaurés aux quatre holders du snapshot, puis quatre Feed attestés par le driver                       | `2rdKHWL5miHpCZPdnJRGNdi9jfQaJGezsT4YJNEPjv583F9pM753otU7iPMzupw6j8KQXhwZsPkoKnXeKjL866tm`             |
| Stock        | Donations FeeIn 6,221445514 puis 0,732066046 SOL ; collect 50/50 et `team_withdraw` dans la même transaction | `5utboDf7t5g1hj1JZduKrfgVfhbHMdQeqcktmMHKffqcxHDM3tbhb7R2v7kTMYpqkBmumAKWpGVRaL33GWqT72xe`             |
| StockBuy P1  | `exec_begin`/`exec_end` : 3,182966977 SOL, coût 1,451 → 4,634 SOL                                            | `YqMjXSgCRGFzZ5vkeTJt7QdTFiTxCbyf87A9YbUz5FTGe4iswBM5kEV6YomiYgo34Ggs5T6BAnDXK3zUDJk9Gkc`              |
| StockBuy P1  | 0,366033023 SOL, coût **5,000 SOL** (cap atteint)                                                            | `4rczK3gYWk2fwhDaADrpTfHiKqYqD579qRkFW9bGwa3Vk1vFs6iJiyWiGzQmJpXjCJ1fAUUNPNPuAzAYe5x1rx8u`             |
| Deck 54 → 66 | Wallet Rip : 8 Rips réels, 12 Originals, VRF MagicBlock, settle, Feed back des 60 cartes                     | Premier Rip `3U2CHHKPaPJJKTZsAmCMZy3eW3DBq73a3s3gzX2syCmCPMJbTBj8sammfpgsCf2m1sJkrPY66qALJKU8k3y7ZKhH` |
| StockBuy P1  | 0,700 SOL après les hits de la croissance (coût 4,300 → 5,000 SOL), financé par les Rips                     | `39jxAUBJPHTyFbDrKKFyGUFU2u45UnaW65im9qtyc48SyaX6ohQrTbjdKAyXqcSM2GGYkMPBobEdpxkb8Q3w6RzL`             |

Le cap est un champ `STATE` écrit par l'admin, pas une constante compilée : aucun
build ni upgrade. La valeur vient de `bucketCapLamports` du seul profil
`devnet-major-sol-fixture-v1` : trois couvertures Original (4,5 SOL) plus la marge
d'un hit. Mainnet, PARAMS et hit lists sont inchangés. Le ratio de livraison reste
celui du profil (1 unité de base pour 1000 lamports) ; aucun garde P3, cap horaire,
tranche ou plancher de 1 SOL n'a été modifié. Le wSOL reçu par le wallet marché est
rendu au payeur après chaque achat, y compris 1,701 SOL laissés par les passes
précédentes. Le wallet marché détenait déjà assez de MAJOR pour les achats ; les
achats pump couvrent la restauration des sacs.

`/api/machine` après rattrapage de l'indexer : **`maxQty=[3,1,0,0]`** au slot
`510258037` (Deck 66, coût 5,0 SOL), puis **`[3,1,0,0]`** après la preuve au slot
`510259297` : Deck **62**, coût **4,95 SOL**, stock **1,236 SOL**, cap 5 SOL.

Rip de preuve, test-user `77jH6NwGHobGetQYQPyJrmBz9bsrhaSKk86RmA3KFypG`, Original ×1 :

| Action                   | Signature                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Rip, slot `510258093`    | `3tNwPDJxPusena8fdrmaPbS25xMb8y6utfhnA8asCmxjEwC3xm8tj9NH7f86wG7HiTFT9i6KYNDjwQpUGGwBcdpw` |
| Callback VRF MagicBlock  | `4sNhCj7UGT6emQXUhEzPyXQ6KSTWnrnwfW69DaSJNRCkn24WdZSE7BFQyoFbMpfRCpx7KhT4cuXpmN2zj2KM6iSQ` |
| Settle (keeper, ferme)   | `1BNSf5voAKT1n9C5GQnmsgvGC9Juu2AjNuYxKoH3BqM641YBGMPBKanvVYzzxzE6HG6iSnSBidDTpPhY5Db25vs`  |
| Settle du driver (no-op) | `29oXXKcgQouK4Cx8VwQnnMQ3Gzvf9DKjtd6LGb7CJU35YF7XK7S3P8CJ8Gu829gxVWWWBwCUedrcAzQi5sAwqzmJ` |
| Redeem ×5                | `3hL4XAjqQy2ES7Vmmrcrhgs1k4nrNu6a4kATyCu3WJEuckH8UuWLrz4ZGURxRtZN59A7qcjvHgCPVXY3GFhixsbg` |

Callback quatre slots après le Rip. Le keeper configuré
`Fu1Kpogh6cPTdVn7PRQmWGkrkUHNdzW7K82YF2Hp7Brw`, actif sur Railway, a fermé le Pull ;
le settle du driver, arrivé ensuite, est un no-op idempotent. Il en va de même pour
les huit Pulls de croissance. Cartes : une Silver Foil (50000 unités MAJOR) et
quatre dust ; les comptes token reçoivent exactement +1000100000 unités MAJOR et
+2000000000 unités du coin 3. Binder vide, aucun Pull ouvert.

Payeur : **9,321450514 → 10,771580454 SOL**, dont 1,701 SOL de wSOL récupéré.
Test-user : 0,291800894 SOL ; wallet Rip : 0,114302800 SOL. Chaque Rip suivi d'un
Redeem retire quatre cartes du Deck : trois Originals redeemés le ramènent à 50.
Pour réalimenter, refaire Feed back ou `fill` dans le cap ; ne jamais signer
d'attestation hors snapshot. Preuves : [coverage-refill.json](../../app/fixtures/devnet/coverage-refill.json).
`devnet-p3-trade.mjs` importe désormais `minOutMajor` depuis l'entrée `server` du
SDK, qui seule l'exporte. Depuis `app/`, après `pnpm build:libs` :

```sh
node scripts/devnet-coverage-refill.mjs restore # reports ignorés depuis provisioning.json
node scripts/devnet-coverage-refill.mjs cap
node scripts/devnet-coverage-refill.mjs inventory
node scripts/devnet-refill-feed.mjs
node scripts/devnet-feed.mjs
node scripts/devnet-coverage-refill.mjs fill
node scripts/devnet-coverage-refill.mjs grow
node scripts/devnet-coverage-refill.mjs prove
node scripts/devnet-coverage-refill.mjs report
```

## Répétition de migration sans 85 SOL devnet

Les dumps locaux doivent correspondre aux hashes publics de
`app/fixtures/devnet/meteora-pin-audit.json`. Les obtenir avec l'auditeur public
si les fichiers ignorés manquent ; ne pas remplacer les captures mainnet.

```sh
CARGO_BUILD_JOBS=3 pnpm mockvrf:build
ONEPERCENT_METEORA_FIXTURE_PROFILE=devnet-observed-v1 UPDATE_REPORT=1 CARGO_BUILD_JOBS=3 VITEST_MAX_WORKERS=2 pnpm e2e:validator meteora-season
```

Ce profil ne s'applique qu'au harnais local. Il vérifie version 1, fees Curve
et DAMM à 250 bps, migration à 85 SOL (+1 lamport d'arrondi), LP 100 % permanent
vers FeeIn, claims Curve/Pool, métadonnées immuables après migration et identité
des vecteurs économiques avec la référence v0. `UPDATE_REPORT=1` écrit uniquement
`reports/devnet/meteora-season-v1.json` pour ce profil. Aucun SOL devnet consommé.

## Upgrade 1 — M4.2, 2026-10-11

Go explicite de l'architecte ; base de branche annoncée `f674762`. Programme et
ProgramData inchangés, capacité **1966080 octets**, autorité conservée au wallet
de test. Le nouvel ELF devnet mesure **960208 octets**.

| Mesure                                     | Valeur                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| SHA-256 avant                              | `1f58027ccd8836d4d72141c395dae46a8de5e73cc31389b3cb0a351f7434d937`                         |
| SHA-256 build et ProgramData après         | `7fded56921a2be659e17fcbe41728db8e001db2c58f171106031dd8eb4cd6488`                         |
| Slot de déploiement avant → après          | `509603961` → `509691948`                                                                  |
| Upgrade finalisé                           | `2ekwieNn2q4xwqHCxJHgstJafkmVqfX7X2smTQuurGfbs6RkJNyfdkcc9CW9W3dHj1Mjcrj4QKQyBKTsR2z8Jkm9` |
| Buffer fermé après upgrade                 | `j91ru7R1FvoAiPZirU9eEbhsvT3vKfUXdBFeMHE55mr`, solde zéro                                  |
| Payeur avant / immédiatement après upgrade | `11.063616614` / `11.057596614 SOL`                                                        |
| Frais réseau de l'upgrade                  | **0.006020000 SOL** ; rent buffer `4.878694840 SOL` récupérée                              |

Les snapshots finalisés aux slots `509685015` et `509692308` décodent les
**26 mêmes comptes** avec le SDK courant : Config, Machine et son bucket,
Deck de 50 cartes, 19 Binders, 4 MintLedgers. Données, tailles et lamports sont
strictement identiques avant/après. Aucun Pull ouvert n'existait avant ; le
nouveau Pull du smoke vérifie ce type de compte après upgrade.

```sh
CARGO_BUILD_JOBS=3 VITEST_MAX_WORKERS=2 ONEPERCENT_CLUSTER=devnet pnpm anchor:build
pnpm program:release:check --cluster devnet
node scripts/devnet-upgrade-snapshot.mjs before
node scripts/devnet-deploy.mjs --upgrade --expected-sha256 7fded56921a2be659e17fcbe41728db8e001db2c58f171106031dd8eb4cd6488
node scripts/devnet-upgrade-snapshot.mjs after
```

Ces snapshots nommés `upgrade1-*` sont la preuve de cette passe : les archiver
avant une future upgrade. Le mode upgrade refuse un hash absent/différent, une
mauvaise autorité ou un ELF dépassant la capacité. Il contrôle désormais aussi
le budget au plafond intégral de priority fee du profil. Besoin maximal calculé
avant upload : **6.396734840 SOL**, couvert par le wallet. Ne jamais retirer
l'autorité d'upgrade.

Le RPC public a épuisé les retries pendant l'upload. La relance a réconcilié
901 chunks déjà présents, puis écrit les 300 restants ; aucune transaction
confirmée n'a été renvoyée. Le buffer a été fermé par l'upgrade. Le journal
local reste sous `app/reports/devnet/transactions.json` ; la preuve publique
sans secrets est `app/fixtures/devnet/upgrade-1.json`.

### Smoke après upgrade

Quatre nouveaux Feed ont porté le Deck de 50 à 54 cartes. Un StockBuy réel
encadré par `exec_begin` / `exec_end` a utilisé **0,05 SOL** et livré 50000
unités du MAJOR fictif, portant le book de 1,45 à 1,50 SOL, dans les caps et
l'espacement P1. Il utilise l'adaptateur de transferts de test approuvé ; cela
ne mesure pas un prix de marché. Une première simulation a refusé
`OracleStale` (62 secondes, limite 60). Le driver attend maintenant un flux
réel suffisamment frais ; il a envoyé à 8 secondes d'âge, sans modifier la
borne on-chain.

Rip OG séquence 2 : callback MagicBlock réel **trois slots** après Rip,
settle, puis Redeem des cinq cartes. Les hausses des comptes token correspondent
exactement aux cartes : 150000 unités MAJOR, 2000000000 unités coin 2 et
2000000000 unités coin 3. Pull fermé, Binder vide, aucune réservation ni Pull
en attente. Les attestations Feed viennent des drivers de test ; l'API intake
et le parcours Railway ne sont pas validés par ce smoke.

| Action                    | Signature finalisée devnet                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Feed (premier des quatre) | `2XFenkyu8Arzz8v9jyGCjPhdAHPZW3RyFXnQDWMHRmr7Ey8CzxepU4yvpjEE8Gxddp4nNT8BovVdoBPR3VfsbwdN` |
| StockBuy P1               | `4QZJ8Nix9Tcb3sqEUAKyskv5gtqddtKC3J83y6xeHu18i3sdm9vVbfAjVNBj6uDh3KBwyjZEW4PS8SX4sSbscTAx` |
| Rip                       | `3iFMKM8dfn2a158mCRDprKcEzDPPuXpiZA5t8QLX5vcWon4ySjdNSzwDq6XM9XcmDGkzW6Z6cTLppRBb6zUWfcSJ` |
| Callback VRF              | `4LHcp2sTjY89k9NFkpZQtfv1tcarGjg8AR8J5rYk8mA3AsyG7QM6gfwRKVVSVfMCwvQdtpjYyAdr6zpuMGc1FFwA` |
| Settle                    | `wAfyUtv7PpavP2Z1yu5XEUUbPtusjKA1WZdTguDTB8iS18nxqeC6MYvPmWh3ct6HWAWNSdKeXRYDVhkPacLyHCz`  |
| Redeem ×5                 | `293W2CGDLRzKESDeC4T2pYsGanzRmjUa3k2o4GhqsasVZZqmEvcqZT5WWN3UzkbhF3BkrLNFwxNu9nBSL59HjJaN` |
| Swap DBC de 0,05 SOL      | `33ez56EsTU5Kr8VfxZ3wF6qoAmUhFc7Xx3xYDaa2GT8VcpT6NeGV95iUBfQgM5zWNa1ReTVcBtcJVNWZfgkyooYu` |

Le swap DBC a produit **1250000 lamports de fees (2,5 %)** : 250000 protocole
et **1000000 partenaire claimables**. Les métadonnées restent immuables.

### Services M4.2 réels et écarts observés

Postgres **17.11** et Redis **8.10.2** dédiés à cette passe, migrations appliquées.
Les trois processus utilisent l'entrée compilée `services/worker/dist/index.js`,
les rôles on-chain et le profil devnet. Le lanceur local limite leur durée ; il
n'intercepte que le transport RPC pour imposer devnet et espacer les lectures.
Il ne remplace ni les comptes, ni les décisions, ni les envois.

| Service      | Résultat constaté                                                                                                                                                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Indexer      | **44/44 transactions réussies**, 96 événements, aucune quarantaine ; trois tentatives échouées exclues conformément au store. Config, 15 champs Machine, bucket, 50 cartes Deck et deux Pulls fermés concordent avec les comptes finalisés. Dernier contrôle : slot `509698357`, retard observé 4 slots / 1 seconde. |
| Fee keeper   | `Curve + collect_creator_fees` confirmé : `4BMYWvNtqkZF7xKjhagcFkUpjjh48UoK6iidQaSd7DYWWMwke5uoEHPSzXUy2nZcRzEHUokcAUCPNEtfRSoM8Nb8`. Quote claimée **1000000 lamports**, base zéro ; **2488440 lamports** collectés vers Stock, dont **1488440** de rent du compte wSOL fermé. Partenaire restant : zéro.           |
| Keeper, team | Retrait automatique des **0,020 SOL** dus vers le wallet de test : `2LASrCxyaCtBLfnjGU3M8RFpu3qKUgaTEd6FEkiTpJVW8Q6qjSqDp5Q8YvSWLCAxpvAYtUEyuRoZVcExMGf4xTvJ`. Team restant zéro.                                                                                                                                    |
| Executor     | Cycles Burn et Jackpot réels : **`BelowMinimumTranche`**, aucun job signé ni swap envoyé. Soldes 0,010 SOL chacun, minimum 0,050 SOL, caps de réserves inchangés. Le StockBuy P1 réel du tableau précédent est une preuve distincte.                                                                                 |

Écarts conservés dans la preuve publique :

- Le RPC public a renvoyé des 429 pendant le backfill. Espacement local :
  250 ms entre départs de requêtes, 3 secondes entre `getBlock`, sans retenir
  les autres méthodes dans la file des blocs. Le premier espacement global
  provoquait aussi un timeout de lecture de compte ; la reprise l'a résolu.
  Faire tourner les trois services ensemble a encore produit des indisponibilités
  RPC, notamment deux cycles Jackpot. Les cycles suivants et la réconciliation
  finale ont passé après sérialisation. Un RPC devnet dédié reste nécessaire
  pour une exploitation durable ; le lanceur local n'est pas inclus dans l'image.
- `intake_log_missing` : les 58 événements Feed proviennent de drivers et leur
  preuve de signer historique n'existe pas dans la nouvelle base. Ils gardent
  `path=unknown` ; aucune provenance n'a été inventée. Le snapshot et les cartes
  sont cohérents, mais cela ne valide pas l'API d'attestation.
- `bucket_history_incomplete` a été émis pendant le rattrapage avant disponibilité
  de l'historique. Les valeurs courantes amount/cost/reserved/cap ont ensuite été
  comparées aux comptes ; l'alerte historique reste dans la base.
- `vrf_queue_unavailable` vise **`11111111111111111111111111111111`**, une des
  entrées vides de `Config.vrf_queues`. Le monitoring parcourt les quatre cases
  sans filtrer ces entrées (`keeper/index.ts`). C'est un faux signal à corriger
  séparément ; la queue active a effectivement livré le callback du smoke.
- Le premier démarrage simultané a rencontré un port local occupé. Le lanceur
  affecte maintenant indexer/keeper/executor aux ports privés 3015/3016/3017.

**Solde final du payeur : 10.922845134 SOL**. Débit net de la passe :
**0.140771480 SOL**, après réception des 0,020 SOL de Team. Cela inclut les
financements de fixtures et le swap ; ce n'est pas uniquement des frais réseau.
État final : OnAir, Deck 50, Stock **0.096488440 SOL**, book MAJOR **1,350 SOL**,
Burn et Jackpot **0,010 SOL** chacun. Un autre Rip OG nécessite quatre Feed
supplémentaires et **0,150 SOL** de book MAJOR ; le Stock actuel ne couvre pas
seul ce réapprovisionnement. Aucun paramètre économique n'a été abaissé.

Rejouer les contrôles et les services localement depuis `app/`, après création
d'une base Postgres 17 et d'un Redis **isolés, sur loopback**. Le fichier ignoré
`reports/devnet/upgrade1-services-local.json` contient `directory`, `databaseUrl`
et `redisUrl` ; il ne doit jamais pointer vers les ressources de production.
Appliquer les migrations avant le premier démarrage :

```sh
DATABASE_URL=postgresql://onepercent@127.0.0.1:65443/onepercent_devnet pnpm --filter @onepercent/db migrate
pnpm --filter worker build
node scripts/devnet-service.mjs indexer 480
node scripts/devnet-service.mjs keeper 180
node scripts/devnet-service.mjs executor 120
# Relancer l'indexer pour ingérer les transactions du keeper.
node scripts/devnet-service.mjs indexer 180
# Dans un autre terminal pendant cette dernière fenêtre :
node scripts/devnet-services-report.mjs
node scripts/devnet-upgrade-results.mjs
```

Les scripts de résultats attendent les journaux de cette passe et une preuve
indexer fraîche ; ils ne sont pas un scénario neuf automatique. Les processus
et instances locales ont été arrêtés après export de la preuve. Conserver la
base et les journaux pour examen, sans redémarrer les rôles par inadvertance.

Pour la passe upgrade 1 : build devnet et contrôle release PASS ; build et
typecheck worker PASS ; **45 tests executor et 5 tests release PASS** ; lint et
format ciblés et lint vocabulary PASS. Contrôle de secrets : 38 fichiers
externes mode 600, aucune correspondance dans 1990 fichiers texte. Les suites
complètes ci-dessous sont celles du correctif
cluster précédent ; elles ne sont pas présentées comme une nouvelle exécution.

## Vérifications locales

Passe complète après fusion de main et correctif des clusters : `build:libs`,
`lint`, `format:check`, `typecheck`, `program:build`, `program:clippy` et
`program:test` PASS. **351 tests Rust**, campagnes à 1000 cas ; **3655 tests
JS/TS** avec `SERVICES_INTEGRATION=1`, Postgres 17.11 et Redis 8.10.2 isolés en
local. Deux assertions Postgres sont volontairement inapplicables au backend
mémoire ; les intégrations Postgres sont exécutées.

La base neuve nécessite d'abord
`DATABASE_URL=<URL_POSTGRES_LOCAL> pnpm --filter @onepercent/db migrate`.
Passer ensuite cette URL à `TEST_DATABASE_URL`, l'URL Redis locale à
`TEST_REDIS_URL`, et `SERVICES_INTEGRATION=1 VITEST_MAX_WORKERS=2 pnpm test`.
Un échec intermittent d'élection immédiate du keeper a passé isolément puis
dans une relance globale complète ; aucun délai ni code métier n'a été modifié.

Les **11 scénarios validator** passent : `feed`, `rip`, `refund`,
`settle-closed`, `sellback`, `exec`, `power-on`, `launch`, puis `season`
(qui exécute `meteora-season`, `season` et `season-closed`). Le lanceur attend
désormais `close` plutôt que `exit` avant de lire la sortie des processus :
cela corrige la lecture intermittente d'une version vide du validator.
La reprise Sell, le lint et le typecheck ciblés passent après ce correctif.

`launch` régénère neuf fixtures publiques sous `app/fixtures/meteora/` ; les
35 tests SDK Meteora passent sur ces nouveaux snapshots. Les journaux complets
restent dans `app/target/cluster-audit/`, et le rapport public
`app/fixtures/reports/devnet-cluster-build.json` conserve les résultats ainsi
que les échecs initiaux et leur résolution.
Plan de commits et corps de PR : [DEVNET-PR.md](DEVNET-PR.md).

## Smoke initial finalisé (avant upgrade)

Rip OG x1, Pull séquence 1, callback `consume_randomness` réel via MagicBlock
au slot 509650140, deux slots après Rip. Settle puis Redeem x5.
Le compte token du buyer `5ie3Vb8pw3CMi3ZSFXJpJvR5tScQa1VJaKrghKujd7Bb` reçoit **4000050000 unités de base**
du coin pump de test, montant relu égal à la somme des cinq cartes.
Pull fermé, Binder vide sans réservation, `pending_pulls=0`.
Le rejeu du driver retrouve les signatures sans renvoyer de transaction.

État à la fin du smoke initial : OnAir, **50 cartes Deck**, stock SOL **0,072**, book MAJOR
**1,45 SOL**. Avant un autre Rip OG, réapprovisionner au moins quatre cartes
éligibles (54 disponibles requises) et 0,05 SOL de book MAJOR ; le stock SOL
couvre ce dernier besoin. Les drivers journalisés rejouent la preuve initiale,
pas un réapprovisionnement automatique. Aucun contrôle Feed, oracle ou de
couverture n'a été assoupli.

Validation secrets : 38 fichiers externes en mode 600 ; aucune valeur privée
trouvée dans 1591 fichiers texte examinés. Aucun commit, aucune écriture
mainnet/canary, aucun déploiement Railway.

## Transactions initiales (avant upgrade)

Toutes les signatures suivantes sont devnet, finalisées. Les 18 signatures Feed
et les preuves publiques sont aussi dans `app/fixtures/devnet/provisioning.json`.

| Action             | Signature                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Déploiement        | `5m5y7tofoJQeit6oy2FfBQ2ZbcUVQMq4HN6SRTjCYk7HwLtyvfN5zk1a2vnCdQsN4EvGJAJwtApji9HrxuKZr1Gt` |
| Initialisation     | `Zq3wZX3e4v2ADS8EvUWYpuvfxU69fqQdZS6qpofJLAKhr3pzNwYzMw2jVs9nLm1WLKSzVcsfwbZSRxesH4Yy5kg`  |
| Saison             | `4gB5FVRZp8pkdUusAPHVycKVLAseFB2K3n1yzh4Fs1NQKEBTd2iPh5DPN6e8yE4c6ZUkT56d1jbTid24MR1kSiA`  |
| StockUp            | `uEGxdHTykUK7w5Tmgkw3rve9AgpT1rTGPUqKK7h2krM2rs7JxBCXTeetPpEnZmFxgChBCTTciHLFWrBBSc4VjG6`  |
| LUT figée          | `38NzXS5yz4sZFKX9ucJnTgL38iitw4nst5vJYmXcrj3Tsmy1eR5etshz9GY6SeHbN3i65bQcWsaPBqzMJCoCbgj3` |
| Réserves des rôles | `3o91vsJpu1Usqrb7V5ZWUH7T2sCMfK3azTQVAuybB5W3dZyHdz6WUbEp14YxDJDZSnSnfV95s2twHGYKHLM7NhxG` |
| Config DBC         | `2qfaKEr9sYBcswSagTMkxLGVBYumTdpkKmuiWEJEWzBmAENGHHztEo6DdCy4w8hDf834m7weLGi7qnz6KtRFw7AH` |
| Coin pump 1        | `26fZPwL2CnFTnQYMGiLnAy5beuKme2D5mwK5FwHfeHp2iFQqDkA3E3nNXaPTvvFZe69Gf6iFh1EvCD3R8ZHph3qw` |
| Coin pump 2        | `2B7B2QcG7TBsdERY2mGaG2Pqakh81wajwndPjLYrsEuuw7XkKuzzTtXKp9pB3rmbF9kZSVxaLD2rbJhCU8L2hbkB` |
| Coin pump 3        | `4X9eEE6EVpJw5UNWG9Zbth1zndKiYoHkA39kFkMHAS3Xot6Sy2GMyAfKpVGvVYBxDRMvkKX6aJVJft3f6d2XGhEV` |
| Premier Feed       | `s3HRReTaToZ2ruwda637F4hTgZZftTGbgSUbHXDTnfaWwmXypf18sMck3wJV2q97GY7q5PNhcPwT1kynMQarhpq`  |
| Dernier Feed       | `41bNR22Rmgr8aFytyHaaUdJnufFRm29epbabjZSchJUN4vMnhZdww44hb1c1MHfngRztocMpCi7XuM7uNrECLzC`  |
| Launch atomique    | `28ksGyYWbu3cJV54b1ZmvtrsUzMfzYmjU1DSuXByT436YVoYEaCRzDfKikNds4dEcHgjJR2pWN9juHJgYiN77Y34` |
| Curve + collect    | `ZcTKXnrmvWULc2pu9Bio5HZzssqyAXLPYt8icZaHpzZ4cezH2AXGG8zycLKcbJLRaHEdcjRDXWa1Dhzy6GJm9wY`  |
| Rip                | `nWmPRBxHctzH6SmnzWhHngHoHQU8L61zrSfgLoTMeHpUxBcKXcy9uLyQ7yHGww3voDj1RSJwwB4fSNWrAEX7m68`  |
| Callback VRF       | `5qTqQPZqTrGjUy1BPHVbZBDtFikBTixHRUnroUu4iiFfCsdVKjNuqgvght48msczn1E54wzbwKjUjzPYPiihZaXx` |
| Settle             | `5bSTWzyUZwFxxg2MXCcH3jdZDPkuRA4UmV9c9W97He8CxK8h8esM8dyVMfc76CW3H5Y2gtTuLVFWPcQVU5RaD17w` |
| Redeem x5          | `NFuAqobwnHuzyYSrUAuuj4ctk5Ga2osVr7vBnk6YaCXhVmPUBNLo7i8gHFAY2iDQL6Lptx6hNJCGuBdxQHzejC8`  |

## Railway dev — matrice après M4.2

Aucune ressource ni variable Railway n'a été créée depuis cette machine.
Créer les cinq services privés ci-dessous dans **l'environnement dev**, avec
Postgres 17 et Redis dédiés à cet environnement. Chaque conteneur a son propre
port privé 3001 ; ne pas lui attribuer de domaine public.

| Nom Railway                  | `ROLE`                           | Dockerfile, racine `app/`    | Commande de démarrage |
| ---------------------------- | -------------------------------- | ---------------------------- | --------------------- |
| `worker-indexer`             | `indexer`                        | `services/worker/Dockerfile` | `node dist/index.js`  |
| `worker-keeper`              | `keeper`                         | `services/worker/Dockerfile` | `node dist/index.js`  |
| `worker-executor`            | `executor`                       | `services/worker/Dockerfile` | `node dist/index.js`  |
| `intake-signer`              | `intake-signer`                  | `services/api/Dockerfile`    | `node dist/index.js`  |
| `quote-signer`               | `quote-signer`                   | `services/api/Dockerfile`    | `node dist/index.js`  |
| `api` (publique, si absente) | `public`                         | `services/api/Dockerfile`    | `node dist/index.js`  |
| `bot` (si absent)            | Aucune variable `ROLE` consommée | `services/bot/Dockerfile`    | `node dist/index.js`  |

Exécuter une fois les migrations avant les workers, avec la base dev :
`node node_modules/@onepercent/db/dist/migrate-cli.js` dans une image API/worker.
Les commandes ci-dessus visent le répertoire de travail `/app` des images,
pas la racine du monorepo. Depuis le workspace local, l'équivalent est
`pnpm --filter worker start` ou `pnpm --filter api start`.

### Variables communes API, signers et workers

Les fichiers de secrets sont locaux, mode 600. **Le contenu**, installé par
l'architecte dans le secret Railway correspondant, est attendu par le service ;
un chemin dans `*_KEYPAIR` ne fonctionne pas. La présente matrice n'en contient
que les chemins. Ne pas partager un environnement réunissant les clés des rôles :
le contrôle d'isolation le refuse, même si une clé étrangère est vide.

| Variable                        | Valeur publique ou fichier secret                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                      | `production`                                                                                            |
| `CLUSTER`                       | `devnet`                                                                                                |
| `PROGRAM_ID`                    | `DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr`                                                          |
| `RPC_URL`                       | `https://api.devnet.solana.com` pour cette répétition ; exception intake ci-dessous                     |
| `PROTOCOL_LOOKUP_TABLE`         | `81AcVRQcvUfPgNAcDgcAAJNT3RtWsG2hbjW5xrmjL5Um`                                                          |
| `PRIVATE_HOST` / `PRIVATE_PORT` | `::` / `3001`                                                                                           |
| `LOG_LEVEL`                     | `info`                                                                                                  |
| `APP_VERSION`                   | `0.0.0`                                                                                                 |
| `GIT_COMMIT`                    | `f674762` pour la base répétée ; remplacer par le commit contenant cette passe                          |
| `LOG_IP_SALT`                   | `~/.config/onepercent/devnet/log-ip-salt.txt`                                          |
| `DATABASE_URL` / `REDIS_URL`    | Références aux credentials des ressources Railway **dev** ; non fournis, aucun fichier local disponible |
| `ALERT_WEBHOOK_URL`             | Non défini (M6-A8)                                                                                      |

### Variables par service

| Service           | Variables supplémentaires                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker-indexer`  | `ROLE=indexer` ; `INDEXER_WS_URL=wss://api.devnet.solana.com` ; `INDEXER_RPC_URL_FALLBACK=https://api.devnet.solana.com` pour reproduire la passe locale uniquement. C'est le même fournisseur, donc **pas de redondance** ; fournir un second RPC devnet pour Railway durable. Aucune clé Solana.                                                                                                                                                                                                                                             |
| `worker-keeper`   | `ROLE=keeper` ; `KEEPER_KEYPAIR` depuis `~/.config/onepercent/devnet/keeper.json`. `PROTOCOL_LOOKUP_TABLE` obligatoire pour la chaîne de fees.                                                                                                                                                                                                                                                                                                                                                                                |
| `worker-executor` | `ROLE=executor` ; `EXECUTOR_KEYPAIR` depuis `~/.config/onepercent/devnet/executor.json` ; `EXECUTOR_SWAP=stub` ; `EXECUTOR_STUB_QUOTE_ACCOUNT=QYu3EBSjsjraQqR6qYks6k1E47JuEjytTm3LqdMb82a`. Ne définir ni `HELIUS_SENDER_URL` ni `EXECUTOR_JUPITER_API_KEY`.                                                                                                                                                                                                                                                                  |
| `intake-signer`   | `ROLE=intake-signer` ; `INTAKE_SIGNER_KEYPAIR` depuis `~/.config/onepercent/devnet/intake-signer.json` ; `INTERNAL_TOKEN` depuis `~/.config/onepercent/devnet/intake-internal-token.txt` ; `SOLANA_RPC_URL=https://api.devnet.solana.com`. **`RPC_URL` doit être un endpoint Helius devnet autorisant `getTransactionsForAddress` pour que les attestations live fonctionnent** : credential non fourni, aucun fichier local. Le RPC public suffit à la santé/lecture Config, pas à cette preuve historique. |
| `quote-signer`    | `ROLE=quote-signer` ; `QUOTE_SIGNER_KEYPAIR` depuis `~/.config/onepercent/devnet/quote-signer.json` ; `INTERNAL_TOKEN` depuis `~/.config/onepercent/devnet/quote-internal-token.txt` ; `SOLANA_RPC_URL=https://api.devnet.solana.com`. Cotation Jupiter de ces fixtures devnet non validée ; le Redeem reste indépendant du signer.                                                                                                                                                                          |
| `api`             | `ROLE=public` ; `PORT=3000` ; `INTAKE_SIGNER_URL=http://intake-signer.railway.internal:3001` ; `QUOTE_SIGNER_URL=http://quote-signer.railway.internal:3001` ; `PROTOCOL_LUT_ADDRESS=81AcVRQcvUfPgNAcDgcAAJNT3RtWsG2hbjW5xrmjL5Um` (nom propre à la config web) ; `FEED_SNAPSHOT_SLOT=509605276` ; `XRAY_SOURCE=fixtures` ; `XRAY_SNS_ENABLED=false`.                                                                                                                                                                                           |
| `api`, secrets    | `INTAKE_INTERNAL_TOKEN` depuis `~/.config/onepercent/devnet/intake-internal-token.txt` ; `QUOTE_INTERNAL_TOKEN` depuis `~/.config/onepercent/devnet/quote-internal-token.txt` ; `BOT_API_SECRET` depuis `~/.config/onepercent/devnet/bot-api-secret.txt`.                                                                                                                                                                                                                                   |
| `bot`             | `PRIVATE_HOST=::` ; `PRIVATE_PORT=3001` ; `LOG_LEVEL=info` ; `FLAG_BOT_ALERTS=off` ; `BOT_API_SECRET` depuis `~/.config/onepercent/devnet/bot-api-secret.txt` ; `DATABASE_URL` = base Railway dev ; `TELEGRAM_BOT_TOKEN` non fourni, aucun fichier local. Aucun RPC ni clé Solana requis.                                                                                                                                                                                                                                     |

`WEB_ORIGIN`, `PUBLIC_WEB_URL`, `PUBLIC_API_URL` de l'API et les deux dernières
variables du bot attendent les domaines dev choisis par l'architecte ; ne pas
utiliser les domaines de production. Les signers peuvent conserver leurs valeurs
par défaut pour ces URLs de présentation : ils n'exposent que l'API privée.
Pour tous les rôles API, `XRAY_SOURCE=fixtures` et `XRAY_SNS_ENABLED=false` rendent
ce mode de préparation explicite. L'API garde `FLAG_PACKS`, `FLAG_BLINKS_XRAY`,
`FLAG_BLINKS_RIP`, `FLAG_BLINKS_FEED` à `off` jusqu'à validation du parcours complet.
`WEB_FLOW_MODES`, `ADMIN_MULTISIG_ADDRESS`, `WEB_SHELL_URL`
restent non définis.

**Vérification du proxy web, 2026-10-11.** Sur Railway dev, l'API utilise
`TRUST_PROXY_HEADER=X-Real-IP` et le web utilise
`API_UPSTREAM=api.railway.internal:3000`. Le Caddyfile déployé correspond à celui
du dépôt : `trusted_proxies static private_ranges 100.64.0.0/10`, lecture stricte
de `X-Forwarded-For`, puis remplacement de `X-Real-IP` par `{client_ip}` avant
l'appel privé à l'API. Les limites par IP utilisent donc cette adresse validée,
pas celle du conteneur web. Garder ce contrat à chaque déploiement ; ne pas
configurer `TRUST_PROXY_HEADER=X-Forwarded-For`. Les tests de composition de l'API
vérifient deux visiteurs IPv4/IPv6 sur le même socket proxy, le refus des chaînes
d'adresses et l'ignorance des en-têtes fournis sans confiance explicite.
Deux clients IPv4/IPv6 simulés depuis un hop de confiance ont aussi traversé le
Caddy et l'API déployés : chaque compteur Redis par IP a augmenté de un ; le
compteur de l'en-tête `X-Real-IP` falsifié et celui de `unknown` sont restés à zéro.

Un X-ray live exigera un `HELIUS_RPC_URL` **explicitement devnet** et
`TURNSTILE_SECRET` (non fournis, pas de fichier local). Ne pas définir seulement
`HELIUS_API_KEY` : son URL implicite est mainnet. Les providers de prix et de
route du quote signer restent à valider sur ces coins ; ne pas déclarer ce
parcours prêt sur la seule foi du smoke on-chain.

Le keeper et l'executor sélectionnent le profil `devnet-rpc-p75-v1`. L'executor
M4.2 est maintenant effectivement démarré par son rôle, avec garde Config et
verrou Postgres. Le mode `stub` est une répétition à transferts de test, réservée
à devnet/localnet ; il nécessite des tokens de répétition dans l'ATA de
l'executor pour qu'un swap puisse passer la simulation. Ce n'est pas un routeur
Jupiter devnet. Aucun montant de tranche, cap, espacement ni mesure mainnet
`PENDING` n'est modifié pour rendre un trade éligible.

Le payeur, les guardians, l'autorité LUT et les clés programme/mint/launch ne vont
sur aucun service. Postgres/Redis locaux utilisés pour la preuve sont distincts
des ressources Railway ; leurs URLs ne doivent pas être copiées dans Railway.
