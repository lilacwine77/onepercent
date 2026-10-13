# Déployer Onepercent et lancer $1PCT avec Proxima

D31 et D36 : le fondateur déploie depuis sa machine, prépare la Machine puis
transfère admin et upgrade authority à son Ledger. Pendant Setup, l'ami lance un
mint sans adresse prédéfinie et transfère exactement 40M 1PCT au `launch_wallet`
du fondateur, distinct de son Deployer Proxima. Le fondateur vérifie le lancement,
fait `set-mint` avant Stock-Up, puis signe le dépôt et `power_on` avec ce wallet.
Cette procédure ne constitue pas une preuve d'exécution mainnet.

## Fondateur

**1. Préparer la release et les identités.** Toutes les commandes partent de
`app/`. L'architecte remplit `release/mainnet.json` avec `programId`, `dbcConfig`
et les valeurs provisoires D35 : `landing.tipLamports = 1_000_000`,
`landing.maxComputeUnitPriceMicroLamports = 50_000`. La mesure 24 h est abandonnée.
Ce runbook ne remplit pas le fichier ; la release reste bloquée tant qu'il est
incomplet. Générer les signers programme et DBC hors ligne avant le build, avec
leurs secrets hors dépôt. L'ami fournit seulement l'adresse publique de son
Deployer à ce stade. Aucune Custom Token Address ni adresse finale de mint n'est
préparée à l'avance.

Fournir les chemins externes `PUBLIC`, `PROGRAM_KEYPAIR`, `BUFFER_KEYPAIR`,
`DEPLOYMENT_KEYPAIR`, `OPS_KEYPAIR`, `DBC_CONFIG_KEYPAIR`, puis `MAINNET_RPC_URL`.
Le wallet `DEPLOYMENT_KEYPAIR` appartient au fondateur et sert aussi de
`launch_wallet` : le CLI exige `params.admin == params.launch_wallet` à l'init.
Il est distinct du Ledger final et du Deployer de l'ami. Les signers sont des
fichiers réguliers mode 600, jamais imprimés ni committés. Aucun secret de l'ami
ni seed du Ledger n'entre dans le CLI. Keeper, executor, intake signer, quote
signer, ops et les deux guardians restent distincts ; seuls les rôles chauds
rejoignent leurs services respectifs. Ops reste plafonné à 5 SOL.

Créer `$PUBLIC/init.mainnet.json`, uniquement avec des données publiques :

```json
{
  "founder_admin": "LEDGER_FONDATEUR",
  "ops_wallet": "OPS",
  "params": {
    "admin": "DEPLOIEMENT_FONDATEUR",
    "guardians": ["GUARDIAN_0", "GUARDIAN_1"],
    "keeper": "KEEPER",
    "executor": "EXECUTOR",
    "intake_signer": "INTAKE_SIGNER",
    "quote_signer": "QUOTE_SIGNER",
    "launch_wallet": "DEPLOIEMENT_FONDATEUR",
    "team_wallet": "TEAM",
    "team_wallets": ["LEDGER_FONDATEUR", "DEPLOIEMENT_FONDATEUR", "DEPLOYER_AMI", "OPS", "TEAM", "11111111111111111111111111111111", "11111111111111111111111111111111", "11111111111111111111111111111111"],
    "token_mint": "PROGRAMME_ONEPERCENT",
    "vrf_queue": "QUEUE_VRF_MAINNET",
    "rent_buffer_lamports": "0"
  }
}
```

Remplacer chaque libellé par l'adresse vérifiée. **`token_mint` ne peut pas être
vide** : le schéma CLI et `initialize` refusent une valeur absente ou nulle.
Mettre provisoirement l'adresse publique non nulle du programme dans ce champ.
Init la stocke sans créer de mint ; elle devra être remplacée par `set-mint`
pendant Setup. Aucun changement Rust n'est requis. `rent_buffer_lamports` est un
supplément choisi, borné à 50 000 000 ; `0` n'est pas une estimation du rent.
Publier les wallets d'équipe à exclure des achats. Les champs supplémentaires,
secrets et rôles confondus sont refusés.

```sh
pnpm install --frozen-lockfile
pnpm release:mainnet:apply --input release/mainnet.json
pnpm build:libs
pnpm program:release:check --cluster mainnet
# L'architecte fait relire et commite les entrées et le code avant ce build.
pnpm program:release:build --cluster mainnet

PROGRAM_ID=$(node -p 'require("./release/mainnet.json").programId')
DBC_CONFIG=$(node -p 'require("./release/mainnet.json").dbcConfig')
INIT="$PUBLIC/init.mainnet.json"
FOUNDER=$(node -p 'require(process.argv[1]).founder_admin' "$INIT")
DEPLOYMENT_WALLET=$(solana-keygen pubkey "$DEPLOYMENT_KEYPAIR")
LAUNCH_WALLET=$(node -p 'require(process.argv[1]).params.launch_wallet' "$INIT")
OPS=$(solana-keygen pubkey "$OPS_KEYPAIR")
BUFFER=$(solana-keygen pubkey "$BUFFER_KEYPAIR")
# POOL_CREATOR : adresse publique du Deployer fournie par l'ami, distincte de LAUNCH_WALLET.
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
proxima_ops() {
  launch_ops "$@" --flow proxima --mint "$MINT" --pool-creator "$POOL_CREATOR"
}
deploy_ops validate
deploy_ops addresses > "$PUBLIC/addresses.json"
solana --url "$MAINNET_RPC_URL" genesis-hash
solana-keygen pubkey "$PROGRAM_KEYPAIR"
solana-keygen pubkey "$DBC_CONFIG_KEYPAIR"
solana address --keypair 'usb://ledger'
```

Vérifier les publiques contre les fichiers et le Ledger, ainsi que le genesis
mainnet `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. Le build doit reproduire
deux ELF identiques avec la recette Docker figée. Publier ELF, checksum, manifeste
et miroir des sources selon [la recette de release](../../app/release/README.md).
Obtenir `APPROVED_RC_COMMIT` et `APPROVED_RC_ELF_SHA256` de la validation indépendante
de la RC, jamais du seul manifeste adjacent à l'ELF à vérifier.

**2. Déployer et initialiser.** Le budget lit tailles, rent et frais RPC. Il couvre
le déploiement seul, avec réutilisation du rent du buffer dans ProgramData.
Init, DBC, LUT, ATA et dev buy ont leurs propres frais ; simuler ou obtenir leur
devis. Un retry ajoute des frais ; réconcilier tout envoi ambigu avant reprise.

```sh
pnpm program:deploy:check budget --cluster mainnet --rpc "$MAINNET_RPC_URL" \
  --artifact "$ARTIFACT" --program "$PROGRAM_ID" --payer "$DEPLOYMENT_WALLET" \
  --approved-commit "$APPROVED_RC_COMMIT" --approved-elf-sha256 "$APPROVED_RC_ELF_SHA256" \
  --buffer "$BUFFER" --max-len "$MAX_LEN" --out "$PUBLIC/budget.json"
solana --url "$MAINNET_RPC_URL" balance "$DEPLOYMENT_WALLET" --lamports
solana --url "$MAINNET_RPC_URL" --keypair "$DEPLOYMENT_KEYPAIR" program deploy \
  "$ARTIFACT" --program-id "$PROGRAM_KEYPAIR" --buffer "$BUFFER_KEYPAIR" \
  --upgrade-authority "$DEPLOYMENT_KEYPAIR" --max-len "$MAX_LEN" \
  --with-compute-unit-price 0 --max-sign-attempts 1
pnpm program:deploy:check verify --cluster mainnet --rpc "$MAINNET_RPC_URL" \
  --artifact "$ARTIFACT" --program "$PROGRAM_ID" --authority "$DEPLOYMENT_WALLET" \
  --approved-commit "$APPROVED_RC_COMMIT" --approved-elf-sha256 "$APPROVED_RC_ELF_SHA256"
deploy_ops check --stage deployed

deploy_ops init --wallet "$DEPLOYMENT_KEYPAIR"
# Après revue du plan simulé, recopier confirmation dans CONFIRM_INIT.
deploy_ops init --wallet "$DEPLOYMENT_KEYPAIR" --confirm "$CONFIRM_INIT"
deploy_ops check --stage initialized
launch_ops config --wallet "$OPS_KEYPAIR" --dbc-config-keypair "$DBC_CONFIG_KEYPAIR"
```

`initialize` exige l'upgrade authority actuelle : **ne pas transférer les
autorités avant init**. Pour les mutations `deploy_ops`, la première commande
sans `--confirm` simule et s'arrête avec `deployment_confirmation_required`
sans ouvrir le signer ; recopier sa confirmation exacte après revue. Les checks
relisent les comptes finalisés et l'ELF, pas seulement la signature. DBC utilise
la clé pré-générée et vérifie le pin, FeeIn et tous les paramètres D29 immuables.

**3. Préparer la saison et la LUT, rester en Setup.** Choisir `STOCK_UP_TS`
(entier Unix supérieur au snapshot) avec assez de temps pour que l'ami lance et
transfère, puis pour vérifier et enregistrer le mint avant cette heure. Préparer
les listings et services selon le plan de stock approuvé ; vérifier `/ready` et
les publiques des rôles contre Config.

Dès cette heure, n'importe qui peut appeler `advance_phase` et sortir de Setup.
La saison ne se fixe qu'une fois : ne pas compter sur un report de cette fenêtre.

```sh
deploy_ops season-point > "$PUBLIC/season-point.json"
SNAPSHOT_SLOT=$(node -p 'require(process.argv[1]).slot' "$PUBLIC/season-point.json")
SNAPSHOT_TS=$(node -p 'require(process.argv[1]).ts' "$PUBLIC/season-point.json")
deploy_ops set-season --wallet "$DEPLOYMENT_KEYPAIR" --slot "$SNAPSHOT_SLOT" \
  --ts "$SNAPSHOT_TS" --stock-up-ts "$STOCK_UP_TS"
# Après revue, recopier confirmation dans CONFIRM_SEASON.
deploy_ops set-season --wallet "$DEPLOYMENT_KEYPAIR" --slot "$SNAPSHOT_SLOT" \
  --ts "$SNAPSHOT_TS" --stock-up-ts "$STOCK_UP_TS" --confirm "$CONFIRM_SEASON"

PROTOCOL_ADDRESSES=$(node -p 'require(process.argv[1]).protocolLutAddresses.join(",")' "$PUBLIC/addresses.json")
node packages/cli/dist/launch/ops.js --cluster mainnet --rpc-url "$MAINNET_RPC_URL" \
  --program-id "$PROGRAM_ID" --ops-wallet "$OPS" lut create \
  --addresses "$PROTOCOL_ADDRESSES"
# Après revue, recopier confirmation.value dans CONFIRM_LUT.
node packages/cli/dist/launch/ops.js --cluster mainnet --rpc-url "$MAINNET_RPC_URL" \
  --program-id "$PROGRAM_ID" --ops-wallet "$OPS" --keypair "$OPS_KEYPAIR" \
  --confirm-mainnet-lut "$CONFIRM_LUT" lut create --addresses "$PROTOCOL_ADDRESSES"
# PROTOCOL_LUT vient du rapport final, après finalité et gel vérifiés.
node packages/cli/dist/launch/ops.js --cluster mainnet --rpc-url "$MAINNET_RPC_URL" \
  --program-id "$PROGRAM_ID" --ops-wallet "$OPS" lut freeze \
  --lut "$PROTOCOL_LUT" --addresses "$PROTOCOL_ADDRESSES"
```

Le snapshot doit être finalisé avec le blockTime exact. La LUT contient six
adresses indépendantes du mint ; fournir sa publique aux services via
`PROTOCOL_LOOKUP_TABLE` (keeper) et `PROTOCOL_LUT_ADDRESS` (API). Donner à l'ami
`$DBC_CONFIG`, `$LAUNCH_WALLET` et l'heure de Stock-Up, puis lui faire exécuter la
partie « Ami ». Ne pas avancer la phase avant réception et vérification.

**4. Vérifier le token reçu, enregistrer le mint pendant Setup.** Renseigner
`MINT` avec l'adresse du token transmise par l'ami. Conserver les signatures
Proxima et transfert. `POOL_CREATOR` reste l'adresse publique de son Deployer,
vérifiée séparément ; notre config DBC étant publique, un tiers peut la réutiliser.

```sh
# MINT : adresse du token transmise après le lancement de l'ami.
proxima_ops verify --wallet-address "$LAUNCH_WALLET"
# Exiger ok avant set-mint : ce contrôle ne signe et ne soumet rien.
proxima_ops set-mint --wallet "$DEPLOYMENT_KEYPAIR" --confirm "${MINT:0:8}"
proxima_ops check --wallet-address "$LAUNCH_WALLET"
# Exiger stock-up, avec le mint final enregistré et la Machine encore en Setup.

# Après succès seulement : conserver l'init original et actualiser son mint public.
cp -n "$INIT" "$PUBLIC/init.initial.mainnet.json"
node --input-type=commonjs - "$INIT" "$MINT" <<'NODE'
const fs = require("node:fs");
const [path, mint] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(path, "utf8"));
input.params.token_mint = mint;
fs.writeFileSync(path, JSON.stringify(input, null, 2) + "\n");
NODE

# À partir de STOCK_UP_TS, après les contrôles de stock et services :
proxima_ops stock-up --wallet "$DEPLOYMENT_KEYPAIR" --confirm "${MINT:0:8}"
proxima_ops check --wallet-address "$LAUNCH_WALLET"
```

`launch verify` vérifie le lancement même avant l'enregistrement de son mint.
Un mint existant en Setup n'est accepté qu'avec `--pool-creator` et tous les
contrôles valides. `set-mint` exige phase 0 et est refusé après Stock-Up, y compris
si le mint demandé est déjà enregistré. L'actualisation de l'input public après
succès permet aux contrôles de déploiement et de transfert d'admin de vérifier
le mint final. Un retard ne permet jamais de contourner la phase Setup.

**5. Transférer admin et upgrade authority au Ledger.** Ces transferts ont lieu
après `set-mint` et Stock-Up, avant le dépôt et Power-On. Ils ne changent pas
`launch_wallet`.

```sh
deploy_ops transfer-admin --wallet "$DEPLOYMENT_KEYPAIR"
# Après revue, recopier confirmation dans CONFIRM_ADMIN.
deploy_ops transfer-admin --wallet "$DEPLOYMENT_KEYPAIR" --confirm "$CONFIRM_ADMIN"
solana --url "$MAINNET_RPC_URL" --keypair "$DEPLOYMENT_KEYPAIR" \
  program set-upgrade-authority "$PROGRAM_ID" --upgrade-authority "$DEPLOYMENT_KEYPAIR" \
  --new-upgrade-authority 'usb://ledger'
pnpm program:deploy:check verify --cluster mainnet --rpc "$MAINNET_RPC_URL" \
  --artifact "$ARTIFACT" --program "$PROGRAM_ID" --authority "$FOUNDER" \
  --approved-commit "$APPROVED_RC_COMMIT" --approved-elf-sha256 "$APPROVED_RC_ELF_SHA256"
deploy_ops check --stage handoff
```

Vérifier et cosigner avec le Ledger du fondateur, sans exporter sa seed.
Ne jamais employer `--final`. `handoff` exige admin et upgrade au même Ledger.

**6. Déposer et Power-On.** Depuis la machine du fondateur :

```sh
proxima_ops check --wallet-address "$LAUNCH_WALLET"
# Exiger deposit avec ATA >=40M ; si le vault est déjà financé, passer à power-on.
proxima_ops deposit --wallet "$DEPLOYMENT_KEYPAIR" --confirm "${MINT:0:8}"
proxima_ops check --wallet-address "$LAUNCH_WALLET"
# Exiger power-on avec vault >=40M non comptabilisés.
proxima_ops power-on --wallet "$DEPLOYMENT_KEYPAIR" --confirm "${MINT:0:8}"
proxima_ops check --wallet-address "$LAUNCH_WALLET"
proxima_ops report --wallet-address "$LAUNCH_WALLET"
# Exiger powered-on et rapport final ok avant toute activité de packs.
```

`--pool-creator` vérifie `pool.creator == POOL_CREATOR` et refuse cette adresse si
elle égale `LAUNCH_WALLET`. Sans l'option, le créateur doit rester le launch wallet.
Tous les autres contrôles restent requis : config DBC et `fee_claimer = FeeIn`,
pool/mint canoniques, supply initiale prouvée et supply courante au plus égale,
décimales, autorités nulles et métadonnées immuables. Le dépôt transfère exactement
`TOKEN_1PCT.devBuyAmount` (40M) depuis l'ATA du launch wallet détenant au moins 40M.
Power-On exige au moins 40M non comptabilisés dans le vault, sans wallet vide.
Les surplus du wallet restent au fondateur ; un don au vault reste distinct et
non comptabilisé ; un burn externe est toléré. Archiver rapports et journaux des
deux transactions séparées. Réconcilier toute signature ambiguë avant reprise.
Le token peut trader avant Power-On ; n'ouvrir les flags publics qu'après le
rapport final, la couverture, les services et le go/no-go applicables.

## Ami

**Avant l'heure de Stock-Up donnée par le fondateur**, coller notre config dans
le champ **« DBC Config public key »** de Proxima. Lancer avec son propre wallet
Deployer et un mint quelconque, sans Custom Token Address, avec les métadonnées
finales immuables et un dev buy d'**au moins 4 % (40 000 000 1PCT)**.

Envoyer **exactement 40 000 000 1PCT** à **l'adresse `launch_wallet` donnée par le
fondateur**, puis lui transmettre **l'adresse du token** et les signatures du
lancement et du transfert. Le surplus reste sur le Deployer de l'ami. Rien à
déployer ni à exécuter dans le CLI.
