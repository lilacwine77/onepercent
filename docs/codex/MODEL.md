# The 1% Machine — modèle retenu (VALIDÉ par le fondateur, 2026-10-08)

Source de vérité du modèle validé avec le fondateur. Remplace model-v1.md (casino SOL, abandonné). Noms : da-direction.md.

**Pitch :** Bags in, Packs out. Go for the 1%. Solana, saison courte, token $1PCT lancé le même jour sur Meteora DBC.

## 1. Déposer (Feed)
- Tokens éligibles : nés sur pump.fun (vérifié on-chain : BondingCurve PDA), autorités mint/freeze nulles, extensions Token-2022 autorisées uniquement.
- Anti-abus : bag acheté (pas airdrop), tenu ≥ 3 jours, 1 carte par (wallet, token), plafond de cartes par wallet.
- Feed = transfert du bag dans le coffre de la machine (programme). Comptes vides fermés → rent rendu au déposant.
- 1 bag = 1 carte dust dans la machine.
- Quand un ouvreur tire la carte → le déposant reçoit **2 % du prix du pack en SOL, instantanément** (dans la même transaction de règlement).
- Tant que la carte n'est pas sortie, le déposant peut **reprendre son bag** (toujours, même après la saison).
- Bag encore vivant : choix **Sell** (vente au marché, SOL tout de suite) ou **Feed**.
- Cross-chain (Robinhood Chain, Base, BSC : vente + bridge vers SOL) : après le launch.

## 2. Ouvrir (Rip)
- 4 éditions : The Original 0.1 SOL · Blue Shift 0.25 · Signature 0.5 · After Hours 1 SOL.
- 5 cartes par pack : **4 dust** (bags des déposants, vrais tokens) + **1 hit** (vrai token liquide acheté par la machine).
- Paliers du hit (valeur ≈ × prix du pack) : Silver 0.5× · Blue 1.5× · Holo 4× · Black 15× · **Jackpot** (cagnotte, payée en $1PCT) · **The 1%** (10M $1PCT). Odds publiées, calibrées par simulation ; RTP cible ~77 % en valeur + loterie des dust.
- Tirage : MagicBlock VRF, page Verify par pack.
- Les cartes vont dans « Mes cartes » (tokens réservés au nom du joueur dans le coffre). Par carte ou en lot :
  - **Redeem** : tokens dans le wallet, une signature (création de compte ~0.0015 SOL de rent, remboursable). Toujours possible, même après la saison, non bloquable.
  - **Sell back** : la machine rachète instantanément à ~87 % de la valeur (quote Jupiter valable 60 s), paiement SOL ; la carte retourne dans le stock. Hits uniquement. Si la réserve est vide : revente au marché via Jupiter.
  - **Feed** : remettre la carte dans la machine → devient déposant (2 % quand elle ressort).
  - **Keep** : garder, redeem plus tard.

## 3. D'où viennent les hits (0 seed)
- La machine achète des tokens liquides d'une **liste publique** : WIF, BONK, POPCAT, PUMP, FARTCOIN + tokens trending nés sur pump.fun avec assez de liquidité.
- Financement : 72 % de chaque pack + cartes rachetées via Sell back (≈ 87 % de leur valeur → réappro moins cher que le marché).
- La machine ne distribue que ce qu'elle détient → pas d'insolvabilité possible. Avant l'ouverture des packs, les trading fees du token remplissent la machine. Stock affiché en direct sur 1% TV.

## 4. Jackpot & The 1%
- Jackpot : 5 % de chaque pack sert à acheter **en continu** du $1PCT qui s'accumule dans la cagnotte ; le gagnant reçoit la cagnotte instantanément, en $1PCT (décision fondateur 2026-10-08).
- The 1% : 4 cartes de 10M $1PCT (1 % de la supply chacune), financées par un dev buy annoncé de 4 %, libérées au fil de la saison.
- Option Spotlight : une commu CTO dépose 1 % de la supply de son token → « The 1% » de ce token.

## 5. Token $1PCT
- Launch Meteora DBC le jour du produit, frais de 2,5 % par trade dont 2 % pour Onepercent et 0,5 % pour Meteora ; dev buy 4 % annoncé → cartes The 1%.
- Chaque pack : 5 % achète et brûle $1PCT ; 5 % achète en continu le $1PCT de la cagnotte Jackpot.
- Trading fees (D27, fondateur, 2026-10-09) : en PoweredOn ou OnAir, 100 % au stock si son book est inférieur à 2 SOL ; sinon 50 % au stock sans plafond et 50 % à l'équipe. Dès BuysClosed, 100 % à l'équipe. Le régime est lu une fois au début de la collecte. Aucun burn sur ces frais ; le burn de 5 % par pack ne change pas.
- Holders ≥ 1M $1PCT : chances ×1.5 sur The 1%.

## 6. Partage d'un pack de 1 SOL
| Destination | SOL |
|---|---|
| Stock (achat des hits) | 0.72 |
| Royalties déposants (4 × 0.02) | 0.08 |
| Cagnotte Jackpot | 0.05 |
| Buy & burn $1PCT | 0.05 |
| Referral | 0.02 |
| Équipe | 0.08 |

Revenus équipe : 8 % des packs + marge du Sell back (~13 % de la valeur rachetée) + part des trading fees.

## 7. Saison
X-ray Week (scan viral de wallets) → Stock-Up (dépôts ouverts avant le launch) → Power-On (token) → On Air (packs) → Spotlight Drops → Last Call → The Final Pull. Fin de saison : Redeem et reprise des bags toujours possibles ; stock restant distribué au Final Pull.

## 8. Non-négociables
Tokens vérifiés on-chain · rien ne peut rester bloqué (Redeem/reprise non bloquables) · seulement des claims vrais (« ZK » uniquement si Redeem en tokens ZK-compressés via Light Protocol) · launch transparent (dev buy annoncé, wallets publiés, pas de bundles cachés ni faux volume).

## 9. Décisions confirmées par le fondateur
- Tokens équipe : **0** (tout le dev buy de 4 % va aux 4 cartes The 1%).
- Durée de saison : **7 jours**.
- ZK : Redeem en tokens ZK-compressés **plus tard, sauf si c'est simple** (à évaluer).
- Hits : liste publique de memecoins Solana liquides (option 1A).
- Partage : ~77 % ouvreur + loterie dust, 2 % par carte au déposant (option 2A).
