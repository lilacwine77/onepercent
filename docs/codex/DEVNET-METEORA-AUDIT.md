# Audit Meteora — reprise devnet du 2026-10-10

## Mainnet en premier : aucun changement de binaire détecté

Lectures publiques finalisées uniquement. Aucune clé chargée par l'auditeur,
aucune signature et aucun envoi pendant le relevé de provenance initial à 17:13 UTC.
Les transactions devnet de la reprise sont décrites plus bas.
Le script `app/scripts/meteora-pin-audit.mjs` limite ses méthodes RPC à
`getGenesisHash`, `getAccountInfo`, `getBlockTime` et `getBalance`.
Il écrit dans `reports/devnet/meteora-pin-audit/`, sans remplacer les pins ou les
binaires de référence sous `fixtures/meteora/`.

| Programme | Slot observé | Slot de déploiement, inchangé | SHA-256 complet, identique au pin capturé                          |
| --------- | -----------: | ----------------------------: | ------------------------------------------------------------------ |
| DBC       |    455333580 |                     445503633 | `4c26a8a5da99f8ce932fa0300c46675b527090021fbb74214c9486bedda9f23b` |
| DAMM v2   |    455333620 |                     445230614 | `4d5b920baebc090f89b2e8796a3452ed067c9667a143058c96a312f2c1e6848b` |

Le hash complet couvre les octets après l'en-tête loader de 45 octets, y compris
le padding alloué, comme le relevé initial. L'autorité reste
`JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` pour les deux programmes.
**Aucun bloqueur de lancement lié à un changement mainnet détecté.**

La comparaison des captures ne constitue pas une preuve indépendante de build
reproductible depuis les commits source. Le dépôt le précisait déjà dans
`fixtures/meteora/SOURCE.md`. Vérification supplémentaire auprès d'OtterSec :

- DBC : le hash après retrait des zéros terminaux est
  `b3f7b765e1b9a2e87e45c4663165974819d248f00c1beefe678af60e9dfe6c44`.
  [resolve-hash](https://verify.osec.io/resolve-hash/b3f7b765e1b9a2e87e45c4663165974819d248f00c1beefe678af60e9dfe6c44)
  renvoie un build du commit `f552f20aa3c1c7631427c3827aeea7c58b902813`, terminé
  le 2026-09-16, `matches_deployed=true`, mais **`trusted=false`**. Le statut
  global reste `is_verified=false`. Ce résultat est une indication de provenance,
  pas une certification de l'autorité d'upgrade.
- DAMM v2 : hash sans zéros terminaux
  `7c479dd7de729ada87d141e9d422a572d42df79f4cc8947a751b5f15719d94e0` ;
  [resolve-hash](https://verify.osec.io/resolve-hash/7c479dd7de729ada87d141e9d422a572d42df79f4cc8947a751b5f15719d94e0)
  ne renvoie aucun build. La correspondance source → binaire avec `a85c926`
  n'est donc pas établie indépendamment ici. Le binaire capturé est inchangé.

## Devnet : dérogation de provenance, validation empirique

| Programme | Slot observé | Slot de déploiement | SHA-256 complet                                                    |
| --------- | -----------: | ------------------: | ------------------------------------------------------------------ |
| DBC       |    509612069 |           508712305 | `5edf76d972abaf355048db5d9003bc4dfa843cd98a5f93785430dac371678ad3` |
| DAMM v2   |    509612087 |           503166267 | `82bb9375921bb8007551cb65f9ca43b191597496cc9922926468b36671081ec2` |

Les hashes correspondent à la passe devnet précédente, mais pas aux captures
mainnet. Les deux binaires restent sous l'autorité
`DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX`.
DBC a été déployé le **2026-10-08 à 05:33:08 UTC**.

Le dépôt officiel a pour branche principale le pin `f552f20` ; la branche
[`release_0.2.2`, commit `82054dfdffafeb62eac1a158462d0f633bb410e1`](https://github.com/MeteoraAg/dynamic-bonding-curve/tree/82054dfdffafeb62eac1a158462d0f633bb410e1)
contient `CONFIG_VERSION=1`. Ce commit date du 2026-10-07 à 06:25:00 UTC.
Il est le head de la [PR officielle #211](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/211),
encore ouverte. **C'est un candidat de source, pas le commit déployé prouvé.**

Recherches de provenance effectuées :

- Archives officielles des deux commits téléchargées via HTTPS, sans git ;
  extraction de fichiers source uniquement dans `app/target/meteora-audit/`.
- Aucun release/tag publié, aucune entrée GitHub Deployment et aucun artefact
  Actions téléchargeable dans les listes publiques consultées.
- Le workflow CI du candidat construit et teste ; il ne fournit pas un lien
  attesté entre ce commit et le hash déployé sur devnet.
- `solana-verify get-program-pda --url https://api.devnet.solana.com`, avec le
  programme DBC et le pubkey de son autorité explicitement indiqués : PDA absent.
- Résolution des hashes devnet sans zéros terminaux via OtterSec : aucun build
  pour DBC `9f652df38b27f83565eb2d5271a6a4e8c9ccbc6a721ed1fadf299154b1753b0d`
  ni DAMM `f838b2ae3ed237211319493045b0a172c0946fd72ba8152895b98bb4d8a29a9c`.
- Aucun bloc `security.txt` portant une révision source dans les binaires lus.

**Décision d'architecte du 2026-10-10 : poursuivre la répétition devnet sans
preuve de provenance ; aucune demande à Meteora.** Le candidat `82054dfd`
(`release_0.2.2`) demeure une référence non prouvée. Le profil nommé
`devnet-dbc-v1-zero-transfer-fee-v1` est sélectionné par le cluster : il accepte
v1 uniquement sur devnet et exige que les octets 216 à 220 soient nuls.
Les autres paramètres restent comparés intégralement au modèle D29. La version
0 reste admise ; mainnet et localnet conservent uniquement le contrôle v0.
Les tests couvrent le refus mainnet et chaque octet non nul de ces nouveaux champs.

La preuve de fonctionnement repose désormais sur le swap et les claims réels
devnet, puis sur une migration à 85 SOL sur validator local chargeant les binaires
devnet ci-dessus. Les captures mainnet ne sont pas remplacées.

## Différences établies dans le source candidat, sans attribution au binaire

Comparaison de `f552f20` et `82054df` : 41 fichiers Rust du programme changent.
Le manifeste public conserve les hashes de chaque fichier concerné. Ni l'IDL
épinglée, ni le Rust Onepercent, ni les pins mainnet n'ont été modifiés.

Dans [PoolConfig](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/82054dfdffafeb62eac1a158462d0f633bb410e1/programs/dynamic-bonding-curve/src/state/config.rs),
la taille reste **1048 octets**, discriminateur inclus. Les champs existants ne
sont pas déplacés. Cinq octets du padding antérieur sont réutilisés :

| Champ candidat                           | Offset absolu | Taille | Valeur des octets de notre config devnet |
| ---------------------------------------- | ------------: | -----: | ---------------------------------------: |
| `transfer_fee_basis_points`              |           216 |      2 |                                        0 |
| `transfer_fee_withheld_authority`        |           218 |      1 |                                        0 |
| `migrated_transfer_fee_authority_option` |           219 |      1 |                                        0 |
| `transfer_fee_flag`                      |           220 |      1 |                                        0 |
| `padding_0` restant                      |           221 |      9 |                                    Zéros |
| `version`                                |           236 |      1 |                          1, au lieu de 0 |

`version=0` signifie désormais config legacy. Le candidat ajoute `create_config2`
et un paramètre optionnel de transfer fee ; l'ancien `create_config` transmet
`None`. Il change les validations des quote mints, les calculs de swaps avec
transfer fees, certains events et les voies de migration/collecte associées.
Le `create_config` historique reste présent, mais son ancien event
`EvtCreateConfig` disparaît au profit de `EvtCreateConfigV2`/`EvtCreateConfig3`.

La [migration DAMM v2 candidate](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/82054dfdffafeb62eac1a158462d0f633bb410e1/programs/dynamic-bonding-curve/src/instructions/migration/dynamic_amm_v2/migrate_damm_v2_initialize_pool.rs)
a deux voies : legacy, et prise en charge des transfer fees. Cette dernière peut
réduire la liquidité déposée et changer les frais de migration/claims. Dans le
source candidat, une base SPL classique et wSOL sans extension de transfer fee
empruntent la voie ordinaire même avec `version=1`. Cela reste une analyse du
source candidat, non une preuve du comportement du binaire devnet.

## Paramètres D29 : observations disponibles et preuves manquantes

| Exigence                    | État des paramètres de notre config                                                   | Limite de la preuve                                           |
| --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Fee courbe 2,5 %            | Numérateur 25000000, dénominateur 1000000000 ; scheduler et dynamique désactivés      | Pas de swap exécuté avec le nouveau binaire dans cette passe  |
| Fee post-migration 2,5 %    | `migratedPoolFeeBps=250`, scheduler/dynamique/compounding à zéro                      | Aucun pool DAMM issu de cette config                          |
| Seuil 85 SOL                | `migrationQuoteThreshold=85000000000`                                                 | Config lue ; migration non répétée                            |
| Forme de courbe             | `sqrtStartPrice=97575587997945580` et tous les points validés par le checker existant | Math/exécution du binaire non prouvées depuis le source exact |
| LP 100 % verrouillé à FeeIn | Partner permanent lock 100, trois autres allocations 0 ; feeClaimer=FeeIn             | Pas de position NFT créée ni vérifiée                         |
| Métadonnées immuables       | `tokenUpdateAuthority=1` (Immutable dans les deux sources)                            | Mint/metadata non créés                                       |
| DAMM v2                     | `migrationOption=1`, collect mode DBC 0 → DAMM quote-only 1 dans le candidat          | Binaire DAMM devnet différent du pin, provenance non établie  |
| Claims                      | Adresses FeeIn conformes ; nouveaux chemins transfer fee dans le candidat             | Aucune collecte Meteora exécutée                              |

Le checker de tous les autres champs D29 passait déjà ; le seul écart de ses
champs reconnus reste `version`. Les nouvelles zones supposées contenir les
transfer fees sont à zéro. **L'identité de stockage ne prouve pas l'identité
d'interprétation. Ce tableau décrit l’analyse source antérieure ; les résultats empiriques sont consignés ci-dessous.**

## MAJOR fictif approuvé et financé

Profil `devnet-major-sol-fixture-v1`, dans
`app/packages/config/src/devnet-major.ts`, sélectionné par le cluster du
`ClusterDeployment` du driver. Mint pump existant
`8qHh54rJXmwegYvCz7369akQUnx1DTj3G3amoYzmYdFV`, flux Pyth SOL/USD devnet
`7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE`, couverture **1,5 SOL**.
Une unité de coin fictif représente une unité SOL pour ce test uniquement ; ce
n'est pas une cotation économique du coin. Le driver vérifie le mint et la
couverture dérivée des paramètres avant de préparer ses transferts.

Cinq tests passent : sélection explicite devnet, absence de mutation de HIT_LIST,
refus mainnet, mainnet-beta, localnet et chaîne vide. Le driver a financé le
bucket 0 à 1,5 SOL via exec_begin/end ; signature et relevé dans provisioning.json.

## État, budget, transactions et tests

Le programme Onepercent est inchangé depuis son déploiement. Le launch, son
rapport, le claim Curve et collect sont finalisés ; les adresses, signatures,
le budget et le résultat du smoke sont dans `DEVNET.md` et
`app/fixtures/devnet/provisioning.json`.

Tests de cette reprise : 361 CLI (dont 93 contrôles launch), 571 SDK, 126 config,
3 release ; typecheck CLI/root, lint et vocabulaire PASS. Les vecteurs PDA Rust
ont été régénérés pour le program id devnet ; le test du vecteur power_on
historique utilise l'identité explicitement enregistrée dans sa fixture.
Le release mainnet reste refusé sans aucune lecture réseau.

Preuves publiques : `app/fixtures/devnet/meteora-pin-audit.json`. Archives,
dumps et réponses détaillées restent dans les répertoires ignorés.

## Validation empirique de cette reprise — PASS

1. **Devnet** : dev buy exact-out de 40000000000000 unités SPL, input
   1192328122 lamports. Fees 29808204 = ceil(input × 250 / 10000), protocole
   5961640 et partenaire 23846564. Réserves et compteurs on-chain vérifiés.
2. **Validator local, binaires devnet** : `quote_reserve=85000000001`, seuil
   85000000000 (arrondi de +1 lamport identique à v0). Migration DAMM v2 réussie.
   Liquidité permanente = liquidité totale ; liquidité débloquée/vesting = 0 ;
   NFT de position détenu par FeeIn, préservé après claims.
3. **Devnet Curve** : claim de 23846564 lamports vers FeeIn, compteur partenaire
   ramené à zéro. Collect accroît le stock de 25335214, incluant 1488440 de rent
   ATA récupérée et 210 lamports pump déjà présents. **Local Pool** : swap 1 SOL,
   25000000 de fees, 5000000 protocole, 20000000 LP ; claim 19999999 après
   arrondi par unité de liquidité. Claim aussi réussi après fin de saison.
4. **Métadonnées** : isMutable=false relu sur Metaplex devnet ; autorités mint et
   freeze nulles. Le test local vérifie aussi isMutable=false après migration.

Le test local affirme que tous les vecteurs économiques sont identiques au
rapport v0 de référence. Profil local `devnet-observed-v1`, hashes vérifiés avant
chargement ; aucun remplacement des fichiers `fixtures/meteora/*.so`.

```sh
ONEPERCENT_METEORA_FIXTURE_PROFILE=devnet-observed-v1 UPDATE_REPORT=1 CARGO_BUILD_JOBS=3 VITEST_MAX_WORKERS=2 pnpm e2e:validator meteora-season
```

Rapport : `app/reports/devnet/meteora-season-v1.json`, copié dans la preuve publique
`app/fixtures/devnet/provisioning.json`. La migration n'a pas été faite sur devnet
faute de budget pour 85 SOL ; ce résultat local n'est pas présenté comme une
transaction devnet. Le callback VRF du smoke devnet reste un contrôle séparé.
La provenance source demeure non établie et ne constitue plus un blocage devnet.
Mainnet K1/S3 restent PENDING avec 24 h de mesures obligatoires.
