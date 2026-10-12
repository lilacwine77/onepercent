# Validation de la release mainnet D31 / D32

État au 12 octobre 2026, branche `feat/mainnet-release`, base
`b0308f121e570ba5cd7985e12318bad27ddf6ec4`. Validation locale terminée.
Aucune transaction mainnet, aucun commit et aucune clé privée créée ou stockée
dans le dépôt. Les quatre entrées de production restent `null` : aucun artefact
mainnet de production n'est déclaré construit, déployé ou prêt à signer.

## Livré

- Fichier public unique `app/release/mainnet.json`, validation, application des
  pins programme/DBC et mesures P1/P2 aux copies compilées ; refus tant qu'une
  entrée manque. Contrôles de cohérence et tests associés.
- Recette Docker figée : deux builds isolés, comparaison des octets ELF,
  SHA-256 et manifeste lié au commit, aux entrées, au lockfile et à la toolchain.
  Calcul du budget de déploiement depuis la taille réelle et le RPC ; vérification
  finalisée du hash, du padding et de l'autorité on-chain.
- [Runbook D31/D32](../DEPLOY-MAINNET.md), init depuis un fichier strict public,
  vérifications Config/ProgramData, transfert admin puis upgrade au même wallet
  fondateur, DBC pré-générée créée après init et LUT protocole. Les commandes
  admin acceptent la signature de Config.admin sans Squads ; l'export unsigned
  pour un outil wallet externe ne prétend pas intégrer le transport Ledger.
- Flux Proxima : mint public en Setup, Stock-Up, lancement externe, dépôt exact
  de 40 000 000 1PCT puis Power-On séparé, signés par le Deployer Proxima de l'ami.
  Contrôles D29/FeeIn, pool/mint canoniques, quantités et rapports ; scénario
  validator avec pool créé hors du CLI. Le flux atomique reste devnet/localnet.
- Readiness et anciennes procédures annotées selon D31/D32 ; les preuves
  opérationnelles, reproductions et audits encore ouverts restent ouverts.

## Entrées publiques à fournir

Le fondateur fait réunir les éléments suivants avec l'ami déployeur et
l'opérateur des services. Aucun secret n'est attendu dans ces fichiers.

| Fichier ou étape | Entrées exactes |
|---|---|
| `app/release/mainnet.json` | `programId` (P6), `dbcConfig` (P3), `landing.tipLamports` (P1), `landing.maxComputeUnitPriceMicroLamports` (P2), avec rapports des deux mesures |
| Fichier d'init public | `founder_admin`, `ops_wallet` ; `params.admin` = Deployer Proxima de l'ami ; `params.launch_wallet` = cette même adresse |
| Rôles dans `params` | `guardians[0]`, `guardians[1]`, `keeper`, `executor`, `intake_signer`, `quote_signer`, tous distincts entre eux et du fondateur, d'ops et du launch wallet |
| Autres publiques dans `params` | `team_wallet`, `team_wallets[0..7]` (fondateur, ops et Deployer obligatoires ; places inutilisées = adresse System Program), `token_mint` vanity, `vrf_queue` mainnet vérifiée |
| Nombres d'init et saison | `params.rent_buffer_lamports` en chaîne décimale, de 0 à 50 000 000 ; `stock_up_ts` Unix choisi. Le slot et son timestamp sont lus finalisés par `season-point`, pas inventés |
| Déploiement | Publique du buffer pré-généré ; `max-len` explicite calculé depuis l'ELF final ; budget/frais issus du RPC courant |
| Proxima | Metadata HTTPS immuable, nom/symbole du produit ; devis du dev buy exact de 40 000 000 1PCT, frais et maximum SOL d'entrée |

L'ami prépare hors dépôt les signers programme, buffer et DBC ainsi que la
Custom Token Address Proxima. L'opérateur des services génère et installe les
rôles chauds ; les deux guardians restent séparés des services. Le fondateur
conserve son wallet admin/upgrade, Ledger recommandé. Les accès RPC/Helius et
providers sont configurés hors de ces fichiers publics.

## Environnement et commandes

Commandes exécutées depuis `app/`. Hôte Darwin arm64 ; Node 22.22.3,
pnpm 10.34.5, Rust 1.95.0, Solana CLI 4.3.0, Anchor CLI 0.32.2.
Intégrations demandées : PostgreSQL `127.0.0.1:55432`, utilisateur `postgres`,
base dédiée `onepercent_mainnet_release`, préparée avec le migrateur
`pnpm --filter @onepercent/db migrate` ; Redis `127.0.0.1:56379` ;
`SERVICES_INTEGRATION=1`.
Docker est absent de cet environnement.

| Commande ou preuve | Résultat |
|---|---|
| `pnpm build:libs` | PASS |
| `pnpm lint` | PASS |
| `pnpm format:check` | PASS |
| `pnpm lint:words` | PASS |
| `pnpm typecheck` | PASS |
| `SERVICES_INTEGRATION=1 pnpm test --testTimeout=60000 --hookTimeout=60000` avec PostgreSQL/Redis ci-dessus | PASS ; 97 tests Node et 4 072 tests Vitest, 13 workspaces ; `VITEST_MAX_WORKERS=2` ; deux variantes mémoire inapplicables aux contrôles PostgreSQL sautées |
| `pnpm program:build` | PASS ; ELF localnet sBPFv3, 968 904 octets |
| `pnpm program:clippy` | PASS ; warnings refusés |
| `pnpm program:test` | PASS ; 365 tests, aucun échec ni test ignoré ; `PROPTEST_CASES=1000` par défaut conservé |
| `pnpm e2e:validator`, toutes les suites | PASS ; 10/10 commandes : `launch`, `proxima`, `feed`, `rip`, `refund`, `settle-closed`, `sellback`, `exec`, `power-on`, `season` ; `exec` inclut les guards et `season` ses trois variantes |
| Scénario Proxima validator | PASS, répété sur le harness final ; rapport local ignoré par Git : `app/reports/launch/proxima-validator.json` |
| Fixture mainnet isolée : check natif et build SBF | PASS ; ELF de test, 966 680 octets ; aucune valeur de production fournie |
| `pnpm program:release:check --cluster mainnet` avec les entrées du dépôt | Refus attendu : quatre pins PENDING ; fermeture du gate conservée |
| `pnpm program:release:build --cluster mainnet` de production | BLOQUÉ : entrées null, checkout non commité, Docker absent ; aucune preuve de reproduction Docker revendiquée |

La campagne finale utilise les variables suivantes :

```sh
SERVICES_INTEGRATION=1 \
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/onepercent_mainnet_release \
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/onepercent_mainnet_release \
REDIS_URL=redis://127.0.0.1:56379 TEST_REDIS_URL=redis://127.0.0.1:56379 \
VITEST_MAX_WORKERS=2 pnpm test --testTimeout=60000 --hookTimeout=60000
```

Les essais initiaux ont exposé des limites d'exécution trop courtes sur cet hôte
chargé ; les délais ont été relevés pour cette invocation seulement, sans
modifier données, assertions ou seuils métier. La base dédiée a reçu les trois
migrations avant la campagne finale. Le test de bascule keeper limite désormais
la terminaison de session à sa base courante. Les validators choisissent aussi
un port gossip UDP libre pour cohabiter avec les autres worktrees, et leurs
captures temporaires ne réécrivent plus les fixtures Meteora canoniques.

Hashes des builds de validation, **sans valeur d'artefact de release** :

- Localnet : `2292f0a3afd4e6aec09470fd4836bda4b8fc352851d79804f295ea8188b60396`.
- Fixture mainnet isolée : `66f8cb66b7d913ae1a340367be4dc9b1e20d5cd06ad6de01e28e7f72351c608b`.

Après fourniture des entrées et commit par l'architecte, le tiers doit appliquer
la [recette de reproduction](../../../app/release/README.md), produire l'ELF
mainnet et retrouver son hash. La simulation validator de Proxima ne prouve pas
l'exécution du lancement dans l'interface Proxima réelle ni un état mainnet.

Message de commit proposé : `feat: prepare D31 mainnet release and D32 Proxima launch`.
