# Déployer Onepercent et lancer $1PCT avec Proxima

Ce document s'adresse à l'ami développeur Solana qui déploie le programme et
lance le token. Toutes les commandes partent de `app/`. Elles sont une procédure
à exécuter par l'opérateur, **pas une preuve d'exécution mainnet**. La release
reste bloquée tant que les quatre pins publics ne sont pas fournis.

D31 : un seul wallet du fondateur détient l'admin final et l'autorité d'upgrade,
Ledger recommandé, sans Squads ni timelock. D32 : le **Deployer Proxima de l'ami
est le `launch_wallet`**. Les 40 000 000 1PCT du dev buy arrivent directement sur
ce wallet ; il signe leur dépôt puis `power_on`. Aucun transfert par le wallet
du fondateur ou un wallet de transit.

**Ordre obligatoire : déployer → init → préparer Setup → Proxima → dépôt →
Power-On → contrôle final de Power-On → transférer admin → transférer upgrade.**
`initialize` exige la signature
de l'autorité d'upgrade actuelle. La config DBC exige une Config Onepercent déjà
initialisée. `SetTokenMint` exige Setup et l'admin actuel. On prépare donc ces
opérations avec l'ami avant les transferts au Ledger ; le fondateur ne communique
jamais sa clé. **Ne jamais transférer l'upgrade authority avant `init`.** Les deux
autorités restent chez le Deployer jusqu'au contrôle final de Power-On (§7).

## 1. Rassembler les entrées et les clés publiques

Le fondateur et l'opérateur fournissent, sans inventer de valeur :

- `release/mainnet.json` : `programId` (P6), `dbcConfig` (P3),
  `landing.tipLamports` (P1), `landing.maxComputeUnitPriceMicroLamports` (P2).
  P1/P2 sont les résultats des mesures PARAMS §26.3 avec leurs rapports.
- Wallet public du fondateur, Deployer Proxima de l'ami, ops, keeper, executor,
  intake signer, quote signer, deux guardians distincts, team wallet ; le mint
  vanity et la queue VRF mainnet vérifiée. Deux guardians restent dans l'ABI,
  sans créer deux admins. L'opérateur peut garder ces deux clés de secours.
- Huit adresses publiques `team_wallets`, avec au minimum fondateur, Deployer et
  ops ; compléter les places inutilisées par `11111111111111111111111111111111`.
  Publier les wallets de l'équipe qui doivent être exclus des achats.
- `rent_buffer_lamports` (chaîne décimale, borne config à 50 000 000), et le
  timestamp `stock_up_ts` choisi pour la saison. Ni rent ni calendrier ne sont
  devinés. Metadata finale HTTPS, immuable, nom/symbole de la config produit.
- RPC mainnet, Helius Sender et providers des services, selon leurs besoins.

Les keypairs programme et DBC sont **générées hors ligne avant le build** ; seule
leur adresse publique entre dans le dépôt. Le compte DBC sera créé après init.
La keypair vanity est préparée pour Proxima « Custom Token Address » : Onepercent
ne la charge jamais dans le flux D32. Le secret Deployer doit correspondre au
wallet choisi dans Proxima, jamais à une clé générée par ce runbook à sa place.

L'opérateur des services génère les clés chaudes sur sa propre machine hors du
dépôt, avec `umask 077`. S'il utilise `solana-keygen new`, ajouter `--silent`
pour ne pas afficher la phrase et fournir un `--outfile` externe explicite.
Ne pas activer `set -x`, imprimer les fichiers, coller leurs contenus dans un
terminal enregistré, un rapport, Git, CI ou une conversation. Les commandes
suivantes ne montrent que les adresses publiques :

```sh
solana-keygen pubkey "$PROGRAM_KEYPAIR"
solana-keygen pubkey "$DBC_CONFIG_KEYPAIR"
solana-keygen pubkey "$DEPLOYER_KEYPAIR"
solana-keygen pubkey "$OPS_KEYPAIR"
solana address --keypair 'usb://ledger'
```

| Identité | Destination du secret |
|---|---|
| Fondateur | Ledger du fondateur ; admin et upgrade seulement |
| Ami / Deployer Proxima | Machine de l'ami et son lancement Proxima ; init, Setup, dépôt, Power-On |
| Programme, buffer déploiement, signer DBC | Stockage opérateur externe ; jamais un service |
| Ops | CLI DBC et LUT, ≤5 SOL ; jamais keeper/executor |
| Keeper | Secret `KEEPER_KEYPAIR` du worker `ROLE=keeper`, partagé seulement entre ses réplicas élus |
| Executor | Secret `EXECUTOR_KEYPAIR` du worker `ROLE=executor` |
| Intake signer | Secret `INTAKE_SIGNER_KEYPAIR` du service `ROLE=intake-signer` |
| Quote signer | Secret `QUOTE_SIGNER_KEYPAIR` du service `ROLE=quote-signer` |
| Guardians 0 et 1 | Stockage opérateur séparé, procédure de pause ; aucun service automatique |
| Team wallet | Wallet de réception équipe ; aucune clé requise dans les services |

Chaque rôle chaud est distinct de l'admin, du launch wallet, d'ops et des autres
rôles. Aucun de ces rôles ne garde les fonds de la Machine. Après installation,
contrôler `/ready`, la clé publique du rôle et sa correspondance avec Config,
puis faire le drill de désactivation/rotation en répétition.

Créer un fichier **public**, par exemple `$PUBLIC/init.mainnet.json`, avec cette
structure. Remplacer chaque libellé par une adresse ; les libellés ci-dessous ne
sont volontairement pas des valeurs valides :

```json
{
  "founder_admin": "FONDATEUR",
  "ops_wallet": "OPS",
  "params": {
    "admin": "DEPLOYER_PROXIMA",
    "guardians": ["GUARDIAN_0", "GUARDIAN_1"],
    "keeper": "KEEPER",
    "executor": "EXECUTOR",
    "intake_signer": "INTAKE_SIGNER",
    "quote_signer": "QUOTE_SIGNER",
    "launch_wallet": "DEPLOYER_PROXIMA",
    "team_wallet": "TEAM",
    "team_wallets": ["FONDATEUR", "DEPLOYER_PROXIMA", "OPS", "TEAM", "11111111111111111111111111111111", "11111111111111111111111111111111", "11111111111111111111111111111111", "11111111111111111111111111111111"],
    "token_mint": "MINT_VANITY",
    "vrf_queue": "QUEUE_VRF_MAINNET",
    "rent_buffer_lamports": "0"
  }
}
```

Le `0` de l'exemple est un buffer supplémentaire nul, pas une estimation du rent.
Le compte mint peut ne pas encore exister ; son adresse est connue à l'avance.
Le fichier est strict : les champs supplémentaires, clés secrètes, rôles
confondus et ops/launch/fondateur absents de `team_wallets` sont refusés.

## 2. Geler, produire et reproduire le binaire

```sh
pnpm install --frozen-lockfile
pnpm release:mainnet:apply --input release/mainnet.json
pnpm build:libs
pnpm program:release:check --cluster mainnet
pnpm program:release:build --cluster mainnet
```

L'architecte commite les valeurs publiques et le code avant le build de release.
Le build exige la recette Docker figée, compile deux fois dans des répertoires
propres et refuse des hashes différents. Il produit
`target/release/mainnet/onepercent.so`, `onepercent.so.sha256`, `manifest.json`.
Le manifeste identifie commit, entrées, image/toolchain et features. Un tiers
checkout exactement ce commit, vérifie les entrées publiques du manifeste,
installe le lockfile et relance la même commande avec la même base Docker par
digest et la recette toolchain figée de `app/release/Dockerfile`. L'identifiant
d'image construit peut différer ; la preuve porte sur les octets ELF identiques.
Il compare le SHA-256 de l'ELF, pas celui d'un build local par défaut localnet.
Recette complète : [`app/release/README.md`](../../app/release/README.md).
Publier ces trois artefacts et le miroir public du programme. Aucun déploiement
ne doit utiliser `target/deploy/onepercent.so` d'un autre cluster.

## 3. Préparer les variables et calculer le budget de déploiement

Fournir les chemins externes `PUBLIC`, `PROGRAM_KEYPAIR`, `BUFFER_KEYPAIR`,
`DEPLOYER_KEYPAIR`, `OPS_KEYPAIR`, `DBC_CONFIG_KEYPAIR` et l'URL `MAINNET_RPC_URL`.
Les fichiers de signer doivent être réguliers, hors dépôt, mode 600. Fournir aussi
`APPROVED_RC_COMMIT` (commit Git complet) et `APPROVED_RC_ELF_SHA256` (SHA-256 de
l'ELF), issus de la validation indépendante de la RC approuvée. Ne pas extraire
ces références du manifeste adjacent à l'ELF à vérifier.

```sh
PROGRAM_ID=$(node -p 'require("./release/mainnet.json").programId')
DBC_CONFIG=$(node -p 'require("./release/mainnet.json").dbcConfig')
INIT="$PUBLIC/init.mainnet.json"
FOUNDER=$(node -p 'require(process.argv[1]).founder_admin' "$INIT")
DEPLOYER=$(solana-keygen pubkey "$DEPLOYER_KEYPAIR")
OPS=$(solana-keygen pubkey "$OPS_KEYPAIR")
BUFFER=$(solana-keygen pubkey "$BUFFER_KEYPAIR")
MINT=$(node -p 'require(process.argv[1]).params.token_mint' "$INIT")
ARTIFACT=target/release/mainnet/onepercent.so
MAX_LEN=$(wc -c < "$ARTIFACT" | tr -d ' ')

deploy_ops() {
  node packages/cli/dist/deploy/ops.js "$@" --cluster mainnet \
    --rpc "$MAINNET_RPC_URL" --program "$PROGRAM_ID" --init "$INIT"
}
launch_ops() {
  node packages/cli/dist/launch/ops.js launch "$@" --cluster mainnet \
    --rpc "$MAINNET_RPC_URL" --program "$PROGRAM_ID" \
    --mainnet-program "$PROGRAM_ID" --dbc-config "$DBC_CONFIG"
}
deploy_ops validate
deploy_ops addresses > "$PUBLIC/addresses.json"
solana --url "$MAINNET_RPC_URL" genesis-hash
```

Le genesis mainnet attendu est
`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. Vérifier aussi que les trois
`solana-keygen pubkey` programme, DBC et Deployer correspondent aux fichiers
publics ; ne pas financer ou signer en cas d'écart.

```sh
pnpm program:deploy:check budget --cluster mainnet --rpc "$MAINNET_RPC_URL" \
  --artifact "$ARTIFACT" --program "$PROGRAM_ID" --payer "$DEPLOYER" \
  --approved-commit "$APPROVED_RC_COMMIT" --approved-elf-sha256 "$APPROVED_RC_ELF_SHA256" \
  --buffer "$BUFFER" --max-len "$MAX_LEN" --out "$PUBLIC/budget.json"
solana --url "$MAINNET_RPC_URL" balance "$DEPLOYER" --lamports
```

Les commandes `budget` et `verify` exigent le `manifest.json` adjacent à l'ELF
et les deux références approuvées explicites. Avant tout RPC, elles vérifient
les pins, la feature mainnet, les deux builds identiques, le commit non nul, son
tree Git et le SHA-256 de l'ELF. Le hash `cargoLockSha256` doit correspondre au
`app/Cargo.lock` de ce commit et au lockfile local. Le commit approuvé doit être
disponible dans le dépôt Git local ; un manifeste auto-cohérent ne suffit pas.
`budget.json` utilise la taille ELF réelle, le `max-len` explicite, les rent RPC
et les frais RPC des messages de chargement/déploiement. Avec Agave 4.3.0, le rent
du buffer est réutilisé pour ProgramData : ne pas additionner deux fois cette
réserve. Le budget décrit le premier essai avec compute-unit-price zéro ; un
renvoi ajoute des frais. `MAX_LEN` égal à la taille actuelle évite une réserve
arbitraire ; un upgrade plus grand demandera extension et rent supplémentaires.

Ce chiffre est le **budget de déploiement**, pas le budget complet du lancement.
Init crée Config, Machine, Deck et le rent de FeeIn, plus le buffer demandé.
DBC, LUT, création des ATA et dev buy ont leurs propres comptes/frais. Simuler
chaque opération avant signature et consulter les rent RPC actuels ; archiver
le devis Proxima du dev buy exact 40M avec frais/max input. Le prix SOL du dev buy
change avec le marché : aucun total de lancement statique n'est annoncé. Ops
reste plafonné à 5 SOL ; recharger ses frais séparément si nécessaire.

## 4. Déployer et vérifier l'ELF

```sh
solana --url "$MAINNET_RPC_URL" --keypair "$DEPLOYER_KEYPAIR" program deploy \
  "$ARTIFACT" --program-id "$PROGRAM_KEYPAIR" --buffer "$BUFFER_KEYPAIR" \
  --upgrade-authority "$DEPLOYER_KEYPAIR" --max-len "$MAX_LEN" \
  --with-compute-unit-price 0 --max-sign-attempts 1
pnpm program:deploy:check verify --cluster mainnet --rpc "$MAINNET_RPC_URL" \
  --artifact "$ARTIFACT" --program "$PROGRAM_ID" --authority "$DEPLOYER" \
  --approved-commit "$APPROVED_RC_COMMIT" --approved-elf-sha256 "$APPROVED_RC_ELF_SHA256"
deploy_ops check --stage deployed
```

La vérification relit Program/ProgramData finalisés, contrôle le propriétaire,
le lien canonique, l'autorité et le hash ELF, y compris le padding du compte.
Une signature reçue seule n'est pas une preuve de succès. En cas d'envoi ambigu,
réconcilier la signature avant de relancer ; garder le même buffer.

## 5. Initialiser, créer DBC, préparer Setup

Pour les mutations `deploy_ops`, lancer une première fois sans `--confirm` : le
CLI simule, imprime le plan public et sa `confirmation`, puis s'arrête avec
`deployment_confirmation_required` **sans ouvrir le signer**. Vérifier les
rôles et recopier la confirmation complète dans la seconde commande ; toute
modification du fichier ou de l'instruction invalide cette confirmation.

```sh
deploy_ops init --wallet "$DEPLOYER_KEYPAIR"
# Recopier la valeur confirmation imprimée après revue dans CONFIRM_INIT.
deploy_ops init --wallet "$DEPLOYER_KEYPAIR" --confirm "$CONFIRM_INIT"
deploy_ops check --stage initialized

launch_ops config --wallet "$OPS_KEYPAIR" --dbc-config-keypair "$DBC_CONFIG_KEYPAIR"
launch_ops check --flow proxima --mint "$MINT" --wallet-address "$DEPLOYER"
```

`launch config` utilise **la keypair DBC pré-générée dont la publique est déjà
compilée**. Il vérifie FeeIn, tous les champs D29, le pin, les 2,5 % de frais,
la collecte SOL et le LP verrouillé ; puis relit les mêmes champs finalisés.
Aucune édition de cette config n'est possible après création. Le seuil D29 par
défaut est 85 SOL ; une autre valeur demande décision explicite et cohérence de
tous les contrôles, jamais une valeur choisie par le déployeur.

```sh
deploy_ops season-point > "$PUBLIC/season-point.json"
SNAPSHOT_SLOT=$(node -p 'require(process.argv[1]).slot' "$PUBLIC/season-point.json")
SNAPSHOT_TS=$(node -p 'require(process.argv[1]).ts' "$PUBLIC/season-point.json")
# STOCK_UP_TS est fourni par le fondateur ; entier Unix supérieur à SNAPSHOT_TS.
deploy_ops set-season --wallet "$DEPLOYER_KEYPAIR" --slot "$SNAPSHOT_SLOT" \
  --ts "$SNAPSHOT_TS" --stock-up-ts "$STOCK_UP_TS"
# Recopier la confirmation du plan dans CONFIRM_SEASON.
deploy_ops set-season --wallet "$DEPLOYER_KEYPAIR" --slot "$SNAPSHOT_SLOT" \
  --ts "$SNAPSHOT_TS" --stock-up-ts "$STOCK_UP_TS" --confirm "$CONFIRM_SEASON"
deploy_ops check --stage initialized
launch_ops set-mint --flow proxima --mint "$MINT" --wallet "$DEPLOYER_KEYPAIR" \
  --confirm "${MINT:0:8}"
launch_ops check --flow proxima --mint "$MINT" --wallet-address "$DEPLOYER"
```

Le slot doit être finalisé et son blockTime correspondre exactement au timestamp.
`set-mint` ne reçoit que l'adresse publique vanity. Si init a déjà enregistré
cette adresse, la commande vérifie l'état et le signale sans envoi supplémentaire.
Ne pas faire avancer Setup avant ce contrôle. Préparer également les listings
initiaux tant que l'ami est admin, selon le plan de stock approuvé ; aucun montant
ou coin n'est déduit de ce document. Les commandes admin/K1 existantes acceptent désormais `--keypair` pour
l'admin actuel sans Squads, vérifient Config.admin finalisé et simulent avant
confirmation. Après transfert au Ledger, `--admin "$FOUNDER"` fournit un export
`unsigned-admin-transaction` à signer avec un outil wallet revu ; cet export
n'est pas un transport Ledger intégré. Ne jamais exporter sa seed pour le CLI.

## 6. LUT protocole

```sh
PROTOCOL_ADDRESSES=$(node -p 'require(process.argv[1]).protocolLutAddresses.join(",")' "$PUBLIC/addresses.json")
node packages/cli/dist/launch/ops.js --cluster mainnet --rpc-url "$MAINNET_RPC_URL" \
  --program-id "$PROGRAM_ID" --ops-wallet "$OPS" lut create \
  --addresses "$PROTOCOL_ADDRESSES"
# Copier confirmation.value du plan dans CONFIRM_LUT.
node packages/cli/dist/launch/ops.js --cluster mainnet --rpc-url "$MAINNET_RPC_URL" \
  --program-id "$PROGRAM_ID" --ops-wallet "$OPS" --keypair "$OPS_KEYPAIR" \
  --confirm-mainnet-lut "$CONFIRM_LUT" lut create --addresses "$PROTOCOL_ADDRESSES"
```

Le CLI demande aussi le préfixe/suffixe programme au terminal, crée/étend puis
fige la table. Il attend la finalité et n'annonce le succès qu'après lecture
exacte des six adresses et absence d'autorité. Publier uniquement la LUT du
rapport final, puis vérifier sans signer avec `lut freeze --lut "$PROTOCOL_LUT"
--addresses "$PROTOCOL_ADDRESSES"` et les mêmes options publiques `--ops-wallet`.
Configurer cette adresse dans les services (`PROTOCOL_LOOKUP_TABLE` du keeper et
`PROTOCOL_LUT_ADDRESS` de l'API selon leurs schémas). Une tentative incomplète se
reprend sur sa LUT existante après réconciliation, pas par création aveugle.

D32 utilise des transactions courtes séparées et n'exige pas la LUT du launch
atomique D28. `launch lut` demeure disponible pour les répétitions atomiques.

## 7. Stock-Up, Proxima, dépôt et Power-On

À partir de `stock_up_ts`, après les contrôles de stock/services applicables :

```sh
launch_ops stock-up --flow proxima --mint "$MINT" --wallet "$DEPLOYER_KEYPAIR" \
  --confirm "${MINT:0:8}"
launch_ops check --flow proxima --mint "$MINT" --wallet-address "$DEPLOYER"
```

Le contrôle doit indiquer `awaiting-proxima`. Dans Proxima, l'ami sélectionne son
même wallet **Deployer**, sa Custom Token Address pré-générée, **notre config DBC
`$DBC_CONFIG`**, les metadata immuables et un dev buy de **40 000 000 1PCT**
(4 % de 1 000 000 000, 6 décimales). Il vérifie l'aperçu avant signature.
Team bundle, Block-0 et Sniper Guard restent des options externes ; aucun outil
Onepercent ne les suppose ni ne les configure. Conserver la signature Proxima.

Le token peut commencer à trader dès la transaction Proxima, avant Power-On.
Ne pas annoncer Machine allumée avant la preuve ci-dessous. Si Proxima ne permet
pas de sélectionner notre config, notre mint ou ce dev buy exact, arrêter le
lancement : une config Proxima par défaut ne convient pas à D29.

```sh
launch_ops check --flow proxima --mint "$MINT" --wallet-address "$DEPLOYER"
# Le rapport doit indiquer deposit (ATA >=40M) ou power-on si le vault est déjà financé.
launch_ops deposit --flow proxima --mint "$MINT" --wallet "$DEPLOYER_KEYPAIR" \
  --confirm "${MINT:0:8}"
launch_ops check --flow proxima --mint "$MINT" --wallet-address "$DEPLOYER"
# Le rapport doit indiquer power-on : vault >=40M non comptabilisés ; surplus wallet permis.
launch_ops power-on --flow proxima --mint "$MINT" --wallet "$DEPLOYER_KEYPAIR" \
  --confirm "${MINT:0:8}"
launch_ops check --flow proxima --mint "$MINT" --wallet-address "$DEPLOYER"
launch_ops report --flow proxima --mint "$MINT" --wallet-address "$DEPLOYER"
# Exiger powered-on et un rapport final ok avant le transfert des autorités (§8).
```

Avant chaque signature et dans le rapport final, les outils contrôlent config
DBC et `fee_claimer = FeeIn`, pool/mint canoniques, supply initiale prouvée par
la config DBC et le lancement finalisé, supply courante ≤ supply initiale,
décimales, autorités nulles et métadonnées immuables. Un burn externe ne bloque
pas la suite. Le dépôt transfère exactement `TOKEN_1PCT.devBuyAmount` (40M)
depuis un ATA détenant au moins ce montant ; les surplus restent au Deployer,
y compris dans ses autres comptes token. Le passage à Power-On exige au moins
40M non comptabilisés dans le vault, sans condition de wallet vide. Un vault déjà
financé permet de passer directement à Power-On sans refaire le dépôt. Les 40M
sont comptabilisés exactement ; un surplus de vault
provenant d'un don reste distinct et non comptabilisé. Le dépôt et Power-On sont
deux transactions, toutes deux
signées par le même launch wallet. Le rapport final immédiat, avant toute activité de packs, prouve phase, horodatages,
vault et comptabilité des 40M ; il ne reconstruit pas artificiellement une unique
transaction D28. Archiver la signature externe Proxima et les journaux publics
du dépôt/Power-On. Tout envoi ambigu exige réconciliation des mêmes signatures
et comptes finalisés avant reprise. Après le transfert des autorités (§8), ouvrir
les flags publics seulement après couverture, services et go/no-go ; un programme déployé n'est pas une Machine
ouverte ni une acceptation des éléments encore ouverts de MAINNET-READINESS.

## 8. Transférer les deux autorités au fondateur

Effectuer ces transferts uniquement après le contrôle final `powered-on` et le
rapport `ok` de la section 7. Ne jamais transférer l’upgrade authority avant `init`.

```sh
deploy_ops transfer-admin --wallet "$DEPLOYER_KEYPAIR"
# Recopier la confirmation du plan dans CONFIRM_ADMIN.
deploy_ops transfer-admin --wallet "$DEPLOYER_KEYPAIR" --confirm "$CONFIRM_ADMIN"
solana --url "$MAINNET_RPC_URL" --keypair "$DEPLOYER_KEYPAIR" \
  program set-upgrade-authority "$PROGRAM_ID" --upgrade-authority "$DEPLOYER_KEYPAIR" \
  --new-upgrade-authority "$FOUNDER" --skip-new-upgrade-authority-signer-check
pnpm program:deploy:check verify --cluster mainnet --rpc "$MAINNET_RPC_URL" \
  --artifact "$ARTIFACT" --program "$PROGRAM_ID" --authority "$FOUNDER" \
  --approved-commit "$APPROVED_RC_COMMIT" --approved-elf-sha256 "$APPROVED_RC_ELF_SHA256"
deploy_ops check --stage handoff
```

`transfer-admin` n'annonce le succès qu'après relecture finalisée de Config avec
l'adresse du fondateur, les autres rôles inchangés. Vérifier la publique du Ledger
avec le fondateur avant `set-upgrade-authority` : l'option explicite ci-dessus
permet ce transfert sans demander au fondateur de communiquer son signer à l'ami.
Si le Ledger est physiquement disponible, utiliser `--new-upgrade-authority
'usb://ledger'` et retirer l'option de saut pour obtenir sa cosignature.
Ne jamais employer `--final` : cela supprimerait l'upgrade nécessaire avant la
fin de saison. `check --stage handoff` exige **les deux autorités** au même wallet
fondateur ; il ne se contente pas d'une transaction envoyée.
