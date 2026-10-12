# Adresses publiques devnet

État du 2026-10-10 : **programme déployé et initialisé, OnAir ; launch et smoke réels PASS**.
Source structurée : `app/fixtures/devnet/provisioning.json`.

| Usage                                         | Adresse publique                               | État                                                          |
| --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Programme                                     | `DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr` | Déployé, ELF vérifié ; max-len 1966080                        |
| ProgramData                                   | `9vcrRW2eRKUuJ5Mjywmp1TMTm5HFWBLJUih9tvVUkiLB` | Créé et vérifié                                               |
| Config                                        | `B5FNEXw35wcDFe8kcb9MkG8sF9SswdW21hG8guaXpGRH` | Créé et vérifié                                               |
| Machine                                       | `3Hstj284yCh3y6s8KRk29p96d3WsH54EdfQwgjQ5yrSG` | Créé et vérifié                                               |
| Deck                                          | `DefNHJMKJHoCiwaK6imf9fQYBRU6uzDci6imdV8JFDFt` | Créé et vérifié                                               |
| FeeIn                                         | `4VSTrYbFSeuprTkd81mwQqFYGxt28GpkjGJaQB9Zymt2` | Créé et vérifié                                               |
| Vault authority                               | `32Q218Feqn6wV88bjZRrNHvxfCcL2nGx5P3vuEbKvy7C` | PDA dérivé                                                    |
| Payeur, admin, team wallet, upgrade authority | `DpMXTAcBPhEpNA2joqP6eEgJkfetjzRiQyVUfQoqZG93` | Payeur et rôles on-chain vérifiés                             |
| Keeper                                        | `Fu1Kpogh6cPTdVn7PRQmWGkrkUHNdzW7K82YF2Hp7Brw` | Rôle initialisé ; réserve 0,05 SOL                            |
| Executor                                      | `4NPtS1mPchcSNU7iG9bzZWndvKERmvTYu8yZ163WMoqL` | Rôle initialisé ; réserve 0,05 SOL                            |
| Intake signer                                 | `HBZUBCmXSNsFEWXh5yof2zgzfSH17XUHknUYMSNZS3si` | Rôle initialisé                                               |
| Quote signer                                  | `EuDMwq4t1bft7qnBDGPEVABNbZiPQXqtvjfgFy1gBLfD` | Rôle initialisé                                               |
| Guardian 1                                    | `AMLdjDKPotXi2LrvAauhjf2mM8vgoF2PVKGrJnJv28Y4` | Rôle initialisé                                               |
| Guardian 2                                    | `2GZRvx8PTSiKri91762UCZF8DXn8NX6Z7F41NXfcUUk5` | Rôle initialisé ; réserve de frais 0,005 SOL                  |
| Launch wallet                                 | `B4WWapt2X6A6MeH9vk3CswcAixkk3R8fXYTtj8inDmGU` | Launch finalisé                              |
| Mint du token de répétition                   | `5UTKhyEem2niArN56XGDuCjeYXwGCHMy4typ2YrE5bVQ` | Créé ; mint/freeze authorities nulles                                   |
| Config DBC                                    | `AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k` | Créée ; profil v1 devnet validé |
| Pool DBC                                      | `iyGGHFujSRRekqsc5PENBb5cwPL16jftyXKJ71n5Dvx`  | Créé et vérifié                                          |
| MintLedger du token de répétition             | `7kQjZSV3zQKXC4Ti3AxCJjWZkoQyZXThHc5TPpe9bgd1` | Créé et vérifié                                          |
| Vault du token de répétition                  | `CYDwo5bkp8y7ayePw89NP6ePoa2LVuWmEyYb1es7yG8B` | Créé et vérifié                                          |
| Autorité LUT prévue                           | `BKFejgbN7D9MvKidTbs6zJ69U5nFruXvgT3ZDeopj2RP` | Deux LUT créées et figées             |
| LUT protocole                                 | `81AcVRQcvUfPgNAcDgcAAJNT3RtWsG2hbjW5xrmjL5Um` | Créée, 106 adresses, figée                                    |
| LUT launch                                    | `EWr5gTsf7Dc9NkF7fdNCAPfG6Q5E7dr9CXCSKctt4jK1` | Créée, 17 adresses, figée                                              |
| Queue VRF partagée                            | `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` | Compte devnet vérifié                                         |

Ce registre est hors des constantes économiques. Le symbole TypeScript
`ONCHAIN_KEYS` de `packages/config` est la liste des constantes générées en Rust :
il ne reçoit pas les PDA ou identités de déploiement. Le pin DBC devnet y est déjà
résolu par `METEORA_BY_CLUSTER`. Aucun pin mainnet ni paramètre économique ne change.

## Fixtures Feed créées

| Usage                   | Adresse                                        |
| ----------------------- | ---------------------------------------------- |
| Coin pump devnet 1      | `8qHh54rJXmwegYvCz7369akQUnx1DTj3G3amoYzmYdFV` |
| Coin pump devnet 2      | `5SatqsL5EZPmsonD7Xt9Y3t3cC3wCVwE3PQpohBYfmUf` |
| Coin pump devnet 3      | `X2BfHo37mrsXBJEuwradkxsayB6nSYp35S2QMZ2kdt2`  |
| Wallet créateur de test | `4BbHoUmkLRKt2zrUTQMRFzxBUsYKM6nxFyAEAahXUvwr` |

54 cartes Feed déposées par 18 wallets ; snapshot `509605276`.
Le token de répétition, son pool, le ledger et le vault existent ; `power_on`
est finalisé. Les deux binaires mainnet restent identiques aux captures épinglées
lors de l'audit public. La provenance devnet a fait l'objet d'une dérogation
explicite, documentée dans [l'audit Meteora](DEVNET-METEORA-AUDIT.md).

Wallet Rip : `5ie3Vb8pw3CMi3ZSFXJpJvR5tScQa1VJaKrghKujd7Bb` ; Pull fermé, Binder vide, tokens reçus.
Après le coverage refill du 2026-10-12 : 62 cartes Deck, bucket MAJOR 4,95 SOL pour un cap de 5 SOL,
`maxQty=[3,1,0,0]` ; détails dans [DEVNET.md](DEVNET.md#coverage-refill-2026-10-12).
