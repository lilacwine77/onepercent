# PARAMS: every number of The 1% Machine, Season 1

> **Issue 3, 2026-10-08 (evening). Frozen for M1, M2 and M3.** Changes only through a new issue of this file, announced with a diff of every changed key. §27 lists every change of this issue against issue 2; §25 lists what issue 2 changed against the 19:20 draft that X1–X3 copied. Issue 3 applies `DECISIONS.md` D1–D11 and adds the operational blocks the M2 and M3 briefs left pending (§26).

Issued 2026-10-08 by the architect (issue 2), re-issued the same evening (issue 3). **This file is authoritative for every number** used by the program, the services, the web app, the bot and the copy, and it restates the rules that use those numbers. The toolchain, account layouts and code rules belong to the master brief and the milestone briefs, not to this file. It replaces the provisional values of `00-M0-SCAFFOLD.md` §6. Codex applies §22 at the start of M1.

- **Mechanics** come from `MODEL.md` (validated by the founder) and from the architect's engineering spec, MODEL-SPEC v2 of 2026-10-08, cited below as "SPEC §n". SPEC is not in this repo. Everything Codex needs from it is restated here or in the milestone briefs.
- **CALIBRATED** values come from the 2026-10-08 Monte Carlo (sim2) as adopted by SPEC. The odds become frozen compiled constants after the S-1 re-run (SPEC §8.9). S-1 can raise `STOCK.targetBaseLamports` or the keeper's anchor size. It never changes the odds.
- **[C1]–[C23]** mark values that come from a SPEC §13 change. **The founder approved all of them on 2026-10-08**, decided C12 as option J-B (the Jackpot pot is pre-bought continuously in $1PCT, §10) and kept the recommended defaults for the open parameters (§23). The tags stay for traceability.
- **[C24]–[C28]** mark changes proposed after SPEC. The founder decided them on 2026-10-08 (evening): C24 at 50 bps, C25, C26 and C28 at their defaults, and C27 made moot by staying on the shared VRF queue (`DECISIONS.md` D2, D5, D6; §23.2).
- **`DECISIONS.md` is binding on this file.** Where a value or a rule below follows one of its entries, it is tagged [D#].
- **Apart from [C24]–[C28] and the [D#] entries, no value in this file differs from SPEC as amended by those founder decisions.** Where SPEC leaves a non-economic detail open (an encoding, a window, a bound implied by a data type), the architect's default is marked **[A]** and listed in §24. Where this file restates a rule that `01-M1-BRIEF.md` §0.3 amends (A1–A4, A7, A9, A11), it states the amended rule.

**D27 amendment, 2026-10-09:** the founder's launch task supersedes §13.4. Added key: `STOCK.creatorFeeFloorLamports = 2_000_000_000n`. Removed split keys: `beforeOnAir`, `onAirBelowTarget`, `onAirAtOrAboveTarget`. Added split keys: `belowFloor = {stock: 10_000, burn: 0, team: 0}` and `season = {stock: 5_000, burn: 0, team: 5_000}`. Changed `afterEnd` to `{stock: 0, burn: 0, team: 10_000}`. `PACK_SPLIT_BPS` and the Sell back target are unchanged. The final D27, D28 and D29 decisions are in `origin/main`; the architect merges them with this PR. D29 replaces the launch venue and fee-chain rows below.

---

## 0. How to use this file

1. **One source.** Every number lives in `app/packages/config` under the keys below. The program, services, web app, bot and copy read it from there. No economic literal appears anywhere else. If a number you need is missing, stop and ask.
2. **"Where" column:**

   | Tag | Meaning |
   |---|---|
   | `CONST` | Compiled into the program. Generated into `programs/onepercent/src/params.rs` from `packages/config` and covered by the verified-build hash. It changes only through a program upgrade, never mid-season (SPEC §8.1). |
   | `CONFIG` | A field of the on-chain `Config` account. Set at init, or later by the founder admin wallet without timelock (D31; the guardian only where stated). These are deployment values, published at Power-On. Services read them from chain, never from code or env. |
   | `STATE` | On-chain `Machine` state written by an admin or guardian instruction, inside `CONST` bounds (for example a bucket's cap). |
   | `OFF` | Off-chain only (services, web, bot). The program never reads it. |
   | `EXT` | A third-party fact (protocol fee, program id, account size). We show or check it; it is never our economic choice. Re-verify it at the named spike. |

3. **Mirror.** `pnpm params:rs` generates `params.rs` (Rust `pub const`) from the `CONST` keys. CI fails when the committed file differs from a fresh generation. The Rust name is the key path in SCREAMING_SNAKE case (`HIT_ODDS.blackPpb` → `HIT_ODDS_BLACK_PPB`). Per-edition values become `[T; 4]` arrays indexed by `PACK_EDITIONS[].index`.
4. **Types.** Lamports and token base units: TS `bigint`, Rust `u64` (intermediate products in `u128`). bps (10,000 = 100%) and ppb (10⁹ = 100%): TS `number`, Rust `u16` or `u32` as given. `valueBps` needs `u32` (150,000 does not fit in `u16`). Seconds: TS `number`, Rust `i64`. Counts: the smallest unsigned type that fits.
5. **Rent is never hard-coded.** On-chain code reads the `Rent` sysvar; off-chain code calls `getMinimumBalanceForRentExemption`. Lamport figures in this file use 5,080 lamports per byte, the mainnet rate verified on 2026-10-08 (`getMinimumBalanceForRentExemption(0)` returned 650,240). They are examples and test values only.
6. **Hourly limits** use the UTC clock hour (`unix_ts / 3600`). Counters reset lazily on the first instruction of a new hour [A].
7. **Rounding** follows §16.4.

---

## 1. Units and rent

| Key | Type | Unit | Value | Where | Source / rationale |
|---|---|---|---|---|---|
| `LAMPORTS_PER_SOL` | bigint / u64 | lamports | 1_000_000_000 | CONST | Solana |
| `BPS_DENOMINATOR` | number / u32 | — | 10_000 | CONST | SPEC conventions |
| `PPB_DENOMINATOR` | number / u32 | — | 1_000_000_000 | CONST | Unit of every odds segment (SPEC §4.2) |
| `ACCOUNT_SIZES.accountOverhead` | number | bytes | 128 | EXT | Rent of an account of `n` data bytes = `(128 + n) × lamports_per_byte` |
| `RENT_EXAMPLE_LAMPORTS_PER_BYTE` | number | lamports/byte | 5_080 | OFF (docs, tests) | Live mainnet rate on 2026-10-08 (SIMD-0437 step 2). Never used to move funds |
| `RENT_TEST_RATES_LAMPORTS_PER_BYTE` | number[] | lamports/byte | 5_080, 2_575, 1_322, 696, 6_960 | OFF (tests) | SPEC §8.9 rent-change fuzz: steps 3–5 may land around November 2026; 6,960 is the pre-SIMD rate, which SIMD-0438 could bring back |

---

## 2. Editions and the pack split

### 2.1 Editions

| Key | Type | Unit | OG | BS | SG | AH | Where | Source / rationale |
|---|---|---|---|---|---|---|---|---|
| `PACK_EDITIONS[].index` | u8 | — | 0 | 1 | 2 | 3 | CONST | On-chain edition id [A] |
| `.id` | string | — | `original` | `blue_shift` | `signature` | `after_hours` | OFF | M0 |
| `.code` | string | — | `OG` | `BS` | `SG` | `AH` | OFF | SPEC conventions |
| `.name` | string | — | The Original | Blue Shift | Signature | After Hours | OFF | MODEL §2, da-direction |
| `.priceLamports` | u64 | lamports | 100_000_000 | 250_000_000 | 500_000_000 | 1_000_000_000 | CONST | MODEL §2 |
| `.maxPerRip` | u8 | packs per Rip | 10 | 10 | 10 | 5 | CONST | SPEC §4.1: at most 5 SOL of list per VRF request bounds the oracle's option to withhold a draw. The live coverage limit `max_qty(E)` (§5) applies on top |
| `MAX_LIST_PER_RIP_LAMPORTS` | u64 | lamports | 5_000_000_000 | | | | CONST (test bound) | SPEC §4.1 |
| `CARDS_PER_PACK` | object | cards | dust 4, hit 1 | | | | CONST | MODEL §2 |
| Royalty per pulled Dust Card (computed `P × 200 / 10_000`) | u64 | lamports | 2_000_000 | 5_000_000 | 10_000_000 | 20_000_000 | CONST (computed, no literal) | MODEL §1: 2% of the pack price |

### 2.2 Split of every pack (`PACK_SPLIT_BPS`, CONST)

| Key | Type | Value (bps of price) | Destination and timing | Source |
|---|---|---|---|---|
| `stock` | u16 | 7_200 | `Machine.stock_sol`, in the VRF callback. **On-chain the stock receives the remainder** `P − 4·royalty − jackpot − burn − referral − team`, exactly 7,200 bps for all four prices | MODEL §6, SPEC §4.1 |
| `royaltyPerDustCard` | u16 | 200 (× 4 = 800) | Each pulled card's depositor, at `settle`. A House Card's 2% goes to the stock [C10]. A payee that can't be credited sees its 2% go to the stock [C11] | MODEL §1, §6 |
| `jackpot` | u16 | 500 | `Machine.jackpot_sol`, in the callback. The executor converts it continuously into the $1PCT pot (`jackpot_tokens`, bought for `jackpot_cost`) [C12, J-B] (§10) | MODEL §4–§5 (founder decision 2026-10-08) |
| `burn1pct` | u16 | 500 | `Machine.burn_sol`, in the callback; spent by burn tranches (§13.1) | MODEL §5 |
| `referral` | u16 | 200 | The bound referrer, at `settle`; the team when there is none or it can't be credited [C16] | MODEL §6 |
| `team` | u16 | 800 | `Machine.team_sol`, in the callback | MODEL §6 |

Per pack, in lamports:

| Line | OG | BS | SG | AH |
|---|---|---|---|---|
| Stock | 72,000,000 | 180,000,000 | 360,000,000 | 720,000,000 |
| Royalties (4 cards) | 4 × 2,000,000 | 4 × 5,000,000 | 4 × 10,000,000 | 4 × 20,000,000 |
| Jackpot pot | 5,000,000 | 12,500,000 | 25,000,000 | 50,000,000 |
| Buy & burn | 5,000,000 | 12,500,000 | 25,000,000 | 50,000,000 |
| Referral | 2,000,000 | 5,000,000 | 10,000,000 | 20,000,000 |
| Team | 8,000,000 | 20,000,000 | 40,000,000 | 80,000,000 |

---

## 3. Hit tiers, card kinds and actions

### 3.1 Stock tiers (`HIT_TIERS`, CONST)

A hit's value is its **stocked value**: what the machine paid for those tokens, carved from a bucket at cost basis [C6]. On-chain the value is `P/2`, `P·3/2`, `P·4` or `P·15`, which is exact for every price.

| `id` | `label` | `valueBps` (u32) | Value OG / BS / SG / AH (lamports) | `majorOnly` | `sellBack` | Source |
|---|---|---|---|---|---|---|
| `silver` | Silver Foil | 5_000 | 50,000,000 / 125,000,000 / 250,000,000 / 500,000,000 | false | true | MODEL §2 |
| `blue` | Blue Foil | 15_000 | 150,000,000 / 375,000,000 / 750,000,000 / 1,500,000,000 | false | true | MODEL §2 |
| `holo` | Holo Foil | 40_000 | 400,000,000 / 1,000,000,000 / 2,000,000,000 / 4,000,000,000 | true | true | MODEL §2; Holo and Black only from MAJOR buckets [C5] |
| `black` | Black Foil | 150_000 | 1,500,000,000 / 3,750,000,000 / 7,500,000,000 / 15,000,000,000 | true | true | MODEL §2 [C5] |

The special prizes have no `valueBps`. The **Jackpot** is the whole $1PCT pot, delivered at once (§10). **The 1%** is 10,000,000 $1PCT (§11). A **Spotlight** card holds the sponsor's tokens (§12); none exists in Season 1 [D1]. A **House Card** is display-only: it holds no tokens and is not written to My cards; its 2% goes to the stock.

### 3.2 Card kinds (`CARD_KINDS`, CONST)

The on-chain `kind` (u8) is the index in this list [A]: `0 dust`, `1 silver`, `2 blue`, `3 holo`, `4 black`, `5 jackpot`, `6 one_pct`, `7 spotlight`, `8 final`. The order is SPEC §8.2's.

### 3.3 Actions allowed per kind (CONST rules; SPEC §2.3, [C3])

| Kind | Redeem | Sell back | Feed (`feed_back`) | Sell at market | Keep |
|---|---|---|---|---|---|
| dust | yes | no | yes | yes | yes |
| silver, blue, holo, black | yes | yes (On Air only) | yes, after a UI confirmation | yes | yes |
| jackpot | yes | no | no | yes | yes |
| one_pct, spotlight, final | yes | no | no | yes | yes |

Redeem works in every phase and never reads a pause bit. $1PCT is never a hit and never a Dust Card.

---

## 4. Odds (CALIBRATED)

### 4.1 Rules (SPEC §4.2–§4.4)

- One tier draw per pack: `t = ((u64le(sha256("1pct:tier:v1" ‖ r ‖ seq_le ‖ i)) as u128 × 10⁹) >> 64)`, so `t ∈ [0, 10⁹)`. MagicBlock's `random_u64` helper must not be used.
- The segments are walked in this order: **The 1% → Spotlight → Jackpot → Black → Holo → Blue**. The first segment with `t < cumulative` wins. Otherwise the pack is **Silver**.
- A special segment counts only while it is live, evaluated **in the callback**:
  - The 1%: a card is Live (§11.2);
  - Spotlight: a drop is Live and inside its window (§12). **Never in Season 1 [D1]:** no instruction can make it live, so its width is always 0;
  - Jackpot: `jackpot_cost` (the SOL already converted into the current $1PCT pot) ≥ 15 × price [C12, J-B]. A pack's own 5% lands in `jackpot_sol` and does not count until the executor converts it.
  When a special is not live, its width goes to Silver. Black, Holo and Blue never change.
- The holder flag is snapshotted at purchase and only widens The 1%.
- Packs of a multi-pack Rip are drawn in order inside one callback. After a Jackpot win `jackpot_cost` is 0, so a later pack of the same Rip cannot win it again.

### 4.2 Keys (`HIT_ODDS`, CONST)

| Key | Type | Unit | Value | Source / rationale |
|---|---|---|---|---|
| `HIT_ODDS.blackPpb` | u32 | ppb | 2_500_000 (1 in 400), every edition | sim2 exp1, table T1 |
| `HIT_ODDS.holoPpb` | u32 | ppb | 20_000_000 (1 in 50), every edition | sim2 exp1, table T1 |
| `HIT_ODDS.bluePpb.{edition}` | u32 | ppb | OG 113_925_000 · BS 114_187_500 · SG 114_625_000 · AH 115_500_000 | Solved by `113_750_000 + (jackpot_ppb + onepct_ppb)/2`, which makes the stock EV exactly 72.00% when the Jackpot and The 1% are live for a non-holder |
| `HIT_ODDS.jackpotPriceDivisor` | u32 | — | 400 | `jackpot_ppb = priceLamports / 400`, so P(Jackpot) = price ÷ 400 SOL. Mean pot 20 SOL (5% × 400). Same Jackpot EV per SOL in every edition [C13] |
| `HIT_ODDS.onePctPriceDivisor` | u32 | — | 1_000 | `onepct_ppb = priceLamports / 1_000`, so P(The 1%) = price ÷ 1,000 SOL [C13]. sim2 exp6: card #1 is pulled in 100% of seasons at 5,000 SOL of packs and in 50% at 500 SOL |
| `TOKEN_1PCT.holderTier.onePctOddsMultiplierBps` | u32 | bps | 15_000 | MODEL §5: ×1.5. `onepct_ppb_holder = onepct_ppb × 15_000 / 10_000`, exact for every price |
| `HIT_ODDS.spotlightPriceDivisor` | u32 | — | 500 | `spotlight_ppb = priceLamports / 500`. At 5,000 SOL per season (≈700 SOL a day) a 24 h window is pulled about 75% of the time [C20]. Kept as a compiled constant (layouts and the draw are frozen); the segment is never live in Season 1 [D1] |
| `HIT_ODDS.walkOrder` | const list | — | one_pct, spotlight, jackpot, black, holo, blue | SPEC §4.3 |
| `HIT_ODDS.calibratedStockEvBps` | u32 | bps | 7_200 | Test identity; equals `PACK_SPLIT_BPS.stock` |
| `JACKPOT.minPotPriceMultiple` | u32 | × price | 15 | The Jackpot is live in edition E only while `jackpot_cost ≥ 15 × price(E)`, so it always outranks Black Foil at cost |

### 4.3 The calibrated table, per edition (ppb of 10⁹)

| Segment | Live when | The Original 0.1 SOL | Blue Shift 0.25 SOL | Signature 0.5 SOL | After Hours 1 SOL |
|---|---|---|---|---|---|
| **The 1%** | a card is Live | 100,000 (1 in 10,000) | 250,000 (1 in 4,000) | 500,000 (1 in 2,000) | 1,000,000 (1 in 1,000) |
| The 1%, verified holder | same, with a holder attestation | 150,000 (1 in 6,667) | 375,000 (1 in 2,667) | 750,000 (1 in 1,333) | 1,500,000 (1 in 667) |
| **Spotlight** | a drop is live (never in Season 1 [D1]) | 200,000 (1 in 5,000) | 500,000 (1 in 2,000) | 1,000,000 (1 in 1,000) | 2,000,000 (1 in 500) |
| **Jackpot** | pot cost ≥ 15 × price | 250,000 (1 in 4,000) | 625,000 (1 in 1,600) | 1,250,000 (1 in 800) | 2,500,000 (1 in 400) |
| **Black Foil 15×** | always | 2,500,000 (1 in 400) | 2,500,000 | 2,500,000 | 2,500,000 |
| **Holo Foil 4×** | always | 20,000,000 (1 in 50) | 20,000,000 | 20,000,000 | 20,000,000 |
| **Blue Foil 1.5×** | always | 113,925,000 (11.3925%, 1 in 8.78) | 114,187,500 (11.41875%, 1 in 8.76) | 114,625,000 (11.4625%, 1 in 8.72) | 115,500,000 (11.55%, 1 in 8.66) |
| **Silver Foil 0.5×** | the rest | 863,225,000 (86.3225%) | 862,437,500 (86.24375%) | 861,125,000 (86.1125%) | 858,500,000 (85.85%) |

The Silver row shows the calibration state: Jackpot and The 1% live, non-holder, no Spotlight.

### 4.4 Silver width and stock EV by live state

Stock EV = `Σ valueBps × ppb / 10¹³`, Silver to Black at stocked value. It leaves out the Jackpot, The 1% and Spotlight prizes.

| State | OG | BS | SG | AH |
|---|---|---|---|---|
| Calibration: Jackpot + The 1% live, non-holder | 863,225,000 · 72.0000% | 862,437,500 · 72.0000% | 861,125,000 · 72.0000% | 858,500,000 · 72.0000% |
| No special segment live | 863,575,000 · 72.0175% | 863,312,500 · 72.04375% | 862,875,000 · 72.0875% | 862,000,000 · 72.1750% |
| Jackpot live only | 863,325,000 · 72.0050% | 862,687,500 · 72.0125% | 861,625,000 · 72.0250% | 859,500,000 · 72.0500% |
| The 1% live only, non-holder | 863,475,000 · 72.0125% | 863,062,500 · 72.03125% | 862,375,000 · 72.0625% | 861,000,000 · 72.1250% |
| Jackpot + The 1%, holder | 863,175,000 · 71.9975% | 862,312,500 · 71.99375% | 860,875,000 · 71.9875% | 858,000,000 · 71.9750% |
| Jackpot + The 1% + Spotlight, non-holder | 863,025,000 · 71.9900% | 861,937,500 · 71.9750% | 860,125,000 · 71.9500% | 856,500,000 · 71.9000% |
| Everything live, holder (minimum Silver) | 862,975,000 · 71.9875% | 861,812,500 · 71.96875% | 859,875,000 · 71.9375% | 856,000,000 · 71.8750% |

The Verify page publishes these rules. When the Jackpot and The 1% are not live, the stock EV rises by up to +0.175 pt (AH). A holder's extra width lowers it by up to −0.025 pt, and a live Spotlight by up to −0.1 pt. The two rows with Spotlight live cannot occur in Season 1 [D1]; they stay for the audit of the compiled draw.

### 4.5 Derived per-pack figures (calibration state)

| Figure | OG | BS | SG | AH | Source |
|---|---|---|---|---|---|
| P(a win ≥ 1.5×), Jackpot and The 1% included | 13.68% (1 in 7.31) | 13.76% (1 in 7.27) | 13.89% (1 in 7.20) | 14.15% (1 in 7.07) | computed |
| P(Holo Foil or better) | 2.285% (1 in 43.8) | 2.3375% (1 in 42.8) | 2.425% (1 in 41.2) | 2.60% (1 in 38.5) | computed |
| Value back at stocked value: stock tiers + Jackpot, season average | 77% | 77% | 77% | 77% | 72% + 5% |
| ×10 Rip: P(at least one win) / median return / P(up) | 77% / 60% / 9% | 77% / 60% / 9% | 78% / 60% / 10% | 78% / 60% / 12% | sim2 exp1 |

- Jackpot EV per pack, in % of the price, is `pot cost ÷ 400 SOL`: 5% at the sim2 mean pot of 20 SOL. The pot's SOL value floats with $1PCT, so the UI shows it as "≈Y if sold now".
- The 1% EV per pack, while a card is live, is `card executable value ÷ 1,000 SOL`: for example +6.9 pts at a $1M market cap. It comes from the value function (§18), never from price × amount.

### 4.6 Draw constants (`DRAW_TAGS`, CONST)

| Key | Value | Use |
|---|---|---|
| `DRAW_TAGS.tier` | `1pct:tier:v1` | Tier draw (§4.1) |
| `DRAW_TAGS.dust` | `1pct:dust:v1` | Dust index `((u64le(H(tag ‖ r ‖ seq_le ‖ i ‖ k)) as u128 × deck.len) >> 64)`, then O(1) swap-remove |
| `DRAW_TAGS.bucket` | `1pct:bucket:v1` | Bucket pick, weighted by free capacity (SPEC §4.6) |
| `DRAW_TAGS.vrfSeed` | `1pct:vrf:v1` | `caller_seed = sha256(tag ‖ program_id ‖ seq_le ‖ buyer)` |
| `DRAW_TAGS.royaltyMemoPrefix` | `1pct:roy:` | Memo `1pct:roy:<pull_seq>` on each royalty transfer |

---

## 5. Coverage and the Deck (CONST)

| Key | Type | Unit | Value | Source / rationale |
|---|---|---|---|---|
| `COVERAGE.perPackValueBps` | u32 | bps of price | 150_000 (= 15 × price) | [C8] SPEC §4.5. At purchase, each pack reserves 15 × P of free book in one enabled MAJOR bucket (greedy, largest free first). The callback releases it before carving; `refund_pull` releases it too. This makes every drawn tier payable: no void path, no downgrade |
| Coverage per pack, by edition | u64 | lamports | OG 1,500,000,000 · BS 3,750,000,000 · SG 7,500,000,000 · AH 15,000,000,000 | Computed. A ×N Rip needs N × 15P free; AH ×2 needs 30 SOL |
| `COVERAGE.dustBuffer` | u32 | cards | 50 | [C10] `buy_packs` requires `deck.len − reserved_dust ≥ 4 × qty + 50`; the UI shows "Machine hungry" otherwise. A slot still empty at the reveal becomes a House Card |
| `COVERAGE.deckMax` | u32 | Deck entries | 120_000 | 80 B × 120,000 = 9.6 MB, under the 10 MiB account cap. CPI copy ≈ 40k CU (spike 2 measures it) |
| `max_qty(E)` | derived | packs | Greedy coverage loop, capped by `maxPerRip` and by `deck_free` | SPEC §4.5. Shown as "Rip up to N now" |

---

## 6. Feed (fresh bags), re-feed and attestations

### 6.1 On-chain checks in `feed` (CONST)

| # | Check | Parameters |
|---|---|---|
| H1 | Origin: PDA `["bonding-curve", mint]` under the pump.fun program exists, is owned by it, and its data starts with the discriminator. Length-tolerant (live accounts are 81, 150 or 166 B); nothing else is read | `PROGRAM_IDS.pumpFun`, `PUMP_LAYOUTS.bondingCurveSeed`, `PUMP_LAYOUTS.bondingCurveDiscriminatorHex` |
| H2 | `mint_is_safe`: owner is SPL Token or Token-2022; decimals ≤ 9; mint and freeze authorities `None`; Token-2022 extensions ⊆ {MetadataPointer, TokenMetadata} | `FEED_RULES.maxMintDecimals` = 9; `FEED_RULES.allowedToken2022Extensions` |
| H3 | mint ≠ `Config.token_mint` and mint ≠ wSOL | `WSOL_MINT` |
| H4 | Measured deposit: the depositor's own top-level `TransferChecked` of that amount to the vault precedes `feed` in the same transaction, and `vault.amount − ledger.accounted ≥ amount` (≥, never ==). At most one `feed` per transaction (M1 A4) | — |
| H5 | One intake attestation per transaction, with `now ≤ expiry ≤ now + 120 s` and a nonce not yet used in the Binder's 16-slot window (M1 A3) | `ATTESTATIONS.feedTtlSeconds` = 120 |
| H6 | `binder.fresh_in_deck < 25`, then `+= 1` | `FEED_RULES.freshCapPerWallet` = 25 |
| H7 | `deck.len < 120,000`; phase StockUp, PoweredOn or OnAir, and `now < end_ts` | `COVERAGE.deckMax` |
| H8 | The depositor pays the Deck entry, and for a first-of-mint card the vault ATA and the MintLedger | §16.2 |

### 6.2 Keys

| Key | Type | Unit | Value | Where | Source / rationale |
|---|---|---|---|---|---|
| `FEED_RULES.launchpads` | string[] | — | `['pump.fun']` | CONST (H1) | MODEL §1 |
| `FEED_RULES.holdRule` | string | — | `'snapshot'` | OFF (intake attester) + CONFIG (`S`) | [C1] Replaces "held ≥ 3 days". The wallet held the mint at the published snapshot slot `S` and still holds it (S1); the first inflow before `S` was a swap the wallet signed (S2); one transfer hop allowed (S3) |
| `Config.snapshot_slot` / `snapshot_ts` | u64 / i64 | slot / s | `S` is the slot at which the Feed rules are first published, no later than X-ray Week start. The admin writes it on-chain once, before StockUp | CONFIG | [C1] SPEC §3.2, §7.1 |
| `FEED_RULES.oneCardPerWalletPerMint` | boolean | — | true, for fresh cards only | OFF (attester S4, re-checked against chain state at signing) | MODEL §1. Re-fed cards are exempt |
| `FEED_RULES.freshCapPerWallet` | u16 | fresh cards per wallet in the Deck at a time | 25 | CONST (H6) | [C1] Fits a 20-bag trencher; 50 roughly doubles the residual farming leak. Decremented when the card leaves the Deck (pull or take-back) |
| `FEED_RULES.maxMintDecimals` | u8 | — | 9 | CONST | SPEC §3.1 |
| `FEED_RULES.allowedToken2022Extensions` | string[] | — | MetadataPointer, TokenMetadata | CONST | SPEC §3.1. Everything else is rejected (TransferHook, PermanentDelegate, Pausable, DefaultAccountState, TransferFeeConfig, NonTransferable, ConfidentialTransfer*, MintCloseAuthority, InterestBearing, ScaledUiAmount, PermissionedBurn, group and member). Spike 7 checks pump.fun holder-reward and Mayhem coins |
| `FEED_RULES.sellDefaultAboveLamports` | u64 | lamports | 2_000_000 | OFF | SPEC §2.2: Sell is the default when a bag's quote is above 0.002 SOL (= the OG royalty) |
| `FEED_RULES.confirmAboveLamports` | u64 | lamports | 20_000_000 | OFF | SPEC §2.2: explicit confirmation to Feed a bag or a hit quoted above 0.02 SOL (= the AH royalty) |
| Team wallets | — | — | Never Feed (S5) | OFF (attester) | SPEC §3.2 |
| `INTAKE.rateLimitPerMinutePerWallet` / `rateLimitPerMinutePerIp` | number | requests per minute | 30 / 60 | OFF (API: FEED and HOLD attestation requests, the Feed Blink included) | [A] A wallet can attest its full 25-card cap within a minute at one bag per transaction. Per IP as for X-ray |

**Attestations have no side effect.** The intake service records S3's (sender, mint) consumption and S4's live fresh card only from landed `BagFed` events, read by the indexer, never when it signs. The attest routes and the Feed Blink accept any account, so if signing consumed anything, anyone could request attestations for a victim's wallet and use up its one-hop eligibility before the victim feeds.

**Re-feed (`feed_back`)** from My cards: Dust and Silver to Black hits only. It needs no attestation, no snapshot, no cap and no 1-per-mint rule, because a pack already paid for the card. No tokens move; the card becomes a Deck entry with `depositor = owner` and the `REFED` flag. The slot deposit is refunded and the entry deposit charged.

### 6.3 Attestations (Ed25519 precompile; CONST domains and TTLs)

| Key | Value | Signed by | Message (built byte for byte on-chain) |
|---|---|---|---|
| `ATTESTATIONS.feedDomain`, `feedTtlSeconds` | `1PCT-FEED-v1`, 120 s | `Config.intake_signer` | `"1PCT-FEED-v1" ‖ program_id ‖ wallet ‖ nonce u32 ‖ expiry i64 ‖ n u8 ‖ bags_hash`, where `bags_hash = sha256((mint ‖ amount u64)×n)` in the instruction's bag order: 121 B (M1 A2; the program recomputes the hash) |
| `ATTESTATIONS.holdDomain`, `holdTtlSeconds` | `1PCT-HOLD-v1`, 600 s | `Config.intake_signer` | `"1PCT-HOLD-v1" ‖ program_id ‖ wallet ‖ expiry i64` |
| `ATTESTATIONS.sellBackDomain`, `SELL_BACK.quoteTtlSeconds` | `1PCT-SB-v1`, 60 s MAJOR / 20 s TRENDING [C26] | `Config.quote_signer` | `"1PCT-SB-v1" ‖ program_id ‖ owner ‖ mint ‖ n ‖ [card_index u16, amount u64]×n ‖ total_amount ‖ quote_lamports ‖ expiry_ts ‖ nonce` (n `u8`, totals `u64`, expiry `i64`, nonce `u32` = `binder.sb_nonce` [A]). `card_index` values are **strictly descending**, checked on-chain: `sell_back` removes the cards with swap-remove in that order, so no removal moves a later target (the same order as Redeem batches, M1 §15.4). M2 tests an 8-card batch, and a batch in any other order is rejected |

Verification: load the Ed25519 instruction at the index passed as an argument; require exactly one signature; every offset's `instruction_index == u16::MAX`; bounds-check every offset; the public key equals the Config role; the message bytes equal the expected bytes; then check expiry and nonce.

---

## 7. On-chain Config and Machine state (deployment values)

### 7.1 `Config` fields (CONFIG)

| Field | Type | Set by | Notes |
|---|---|---|---|
| `admin` | Pubkey | init; admin rotates | The founder wallet (D31; Ledger recommended), after verified Config-admin transfer from the deployer |
| `guardians` | Pubkey × 2 | admin | Two people in two time zones |
| `keeper`, `executor`, `intake_signer`, `quote_signer` | Pubkey | admin | Separate hot keys and hosts. The guardian can disable any of them |
| `launch_wallet` | Pubkey | admin | Calls `power_on` once |
| `team_wallet` | Pubkey | admin | The public team wallet selected at init, the only destination of `team_withdraw`; no Squads requirement (D31) |
| `team_wallets` | Pubkey × up to 8 (`GOVERNANCE.maxTeamWallets`) | admin | Published. `buy_packs` rejects them; they never Feed |
| `token_mint` | Pubkey | admin, before Power-On | The pre-generated vanity mint: the only $1PCT |
| `vrf_program` | Pubkey | init | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`. Stored for the Verify page; no instruction changes it [A] |
| `vrf_queues` + active index | Pubkey × up to 4 (`VRF.maxQueues`) + u8 | admin adds; guardian switches | Each queue must be owned by the VRF program |
| `snapshot_slot`, `snapshot_ts` | u64, i64 | admin, once, before StockUp | [C1] |
| `stock_up_ts` | i64 | admin, once, together with `S` [A] | Lets `advance_phase` move Setup → StockUp from a timestamp (SPEC §7.1) |
| `paused` | u8 bits (`PAUSE_BITS`) | guardian or admin | Only RIP, FEED, SELLBACK, STOCKBUY and BURN exist. STOCKBUY pauses every keeper stock trade (StockBuy and StockSell); BURN pauses both $1PCT buys (Burn and JackpotBuy) [A]. A guardian cannot clear a bit the admin set |
| `disabled_roles` | u8 bits | guardian disables; admin re-enables by rotating | — |

### 7.2 `Machine` state that behaves like a parameter (STATE)

| Field | Written by | Bounds |
|---|---|---|
| `buckets[16]`: mint, class (MAJOR or TRENDING), enabled, `cap_lamports`, oracle reference (Pyth feed id for MAJOR; canonical PumpSwap pool for TRENDING) | Admin adds a mint (D31: no timelock; `mint_is_safe` runs on-chain; class required) and raises caps. Guardian disables a bucket or lowers a cap | `STOCK.maxBuckets` = 16; `STOCK.trendingMaxCount` = 4 |
| `spotlight` slot: mint, sponsor, window start, amount | Nobody in Season 1 [D1]: the bytes stay in the layout, no instruction writes them | §12 |
| `onepct[4]`: amount, state (Locked, Live, Pulled, Final) | `power_on` | §11.2 |
| `power_on_ts`, `on_air_ts`, `end_ts`, `final_ts` | `power_on` sets the first three: `on_air_ts = power_on_ts + 900`, `end_ts = on_air_ts + 604,800`. `start_final_pull` sets `final_ts` | §14 |

---

## 8. Stock, hit list and keeper

### 8.1 On-chain bounds (`STOCK`, CONST)

| Key | Type | Unit | Value | Source / rationale |
|---|---|---|---|---|
| `STOCK.maxBuckets` | u8 | buckets | 16 | SPEC §5.1 |
| `STOCK.targetBaseLamports` | u64 | lamports | 30_000_000_000 | [C7] Fill-first target = 30 SOL (2 × AH Black Foil) + `hit_out_last_hour` (book value carved in the previous clock hour). Below target, the Sell back margin stays in the stock. Creator fees use their separate D27 floor. S-1 may raise it |
| `STOCK.creatorFeeFloorLamports` | u64 | lamports | 2_000_000_000 | [D27] Creator-fee floor in PoweredOn and OnAir; independent of the Sell back target |
| `STOCK.majorTrancheMaxLamports` | u64 | lamports per tx | 5_000_000_000 | SPEC §5.2: 15 SOL of WIF moves price ≈0.03% |
| `STOCK.majorMinOutSlipBps` | u16 | bps | 150 | `min_out = L × sol_usd / token_usd × (10_000 − 150) / 10_000`, from Pyth |
| `STOCK.pythMaxAgeSeconds` | i64 | s | 60 | Fresh prices only, on both feeds |
| `STOCK.pythMaxConfBps` | u16 | bps of price | 100 | Tight prices only |
| `STOCK.trendingTrancheMaxLamports` | u64 | lamports per tx | 1_500_000_000 | Thin pools |
| `STOCK.trendingHourlyMaxLamports` | u64 | lamports per mint per hour | 10_000_000_000 | SPEC §5.2 ("rolling hour"; clock hour here [A]). Counted separately for buys (`L`) and, from this issue, for sells (book value removed, §24 A11) [C25] |
| `STOCK.trendingShareMaxBps` | u16 | bps of stock book value, after the buy | 1_500 | [C5] |
| `STOCK.trendingMaxCount` | u8 | mints | 4 | [C5] |
| `STOCK.trendingPoolFeeAllowanceBps` | u16 | bps | 125 | Maximum PumpSwap pool fee: `L_eff = L × (10_000 − 125) / 10_000` |
| `STOCK.trendingMinOutSlipBps` | u16 | bps | 100 | `expected = base_reserve × L_eff / (quote_eff + L_eff)`, then `× (10_000 − 100) / 10_000`. `quote_eff` = quote vault balance + `virtual_quote_reserves` (i128, may be negative) |
| `STOCK.tradeMinSpacingSeconds` | i64 | s | 20 | [C25] One `last_stock_trade_ts`, shared by StockBuy and StockSell: `last_stock_trade_ts + 20 ≤ now`, then `last_stock_trade_ts = now`. At most 180 stock trades per hour |
| `STOCK.hourlyFloorLamports` | u64 | lamports per clock hour | 30_000_000_000 | [C25] Floor of the gross hourly caps below. Equal to `targetBaseLamports` (2 × AH Black Foil), so a cold start can buy full After Hours coverage within one hour. If S-1 raises `targetBaseLamports`, this floor follows it (§22.5 check 17) |
| `STOCK.hourlyHitOutMultiple` | u32 | × | 2 | [C25] Multiple of the book value packs carved, in the previous clock hour or the current one, whichever is larger. Only real pack purchases raise it |
| Bucket cap | u64 | lamports of book | `C(b) + L ≤ cap(b)` on every buy | STATE, set at listing (§8.2) |

Book value = `stock_sol + Σ C(b)`. A bucket's free capacity = `C(b) − reserved(b)`. Nothing in the stock is ever marked to market on-chain. A stock sell must keep `free(b) ≥ 0`.

**Hot-key bounds, checked in `exec_begin` (M2) [C25].** Each trade's `min_out` bounds one trade only. A stolen keeper key could otherwise pair buys and sells through its own counterparty program, keep the `min_out` gap on each (about 1.5–3% per MAJOR trade, with a Pyth update up to 60 s old) and empty the stock in minutes, faster than a guardian can react. The spacing and the hourly caps bound the rate:

```
h_out = max(hit_out_last_hour, hit_out_this_hour)    // book value carved by packs; rolled to the current hour first (M1 §11.8 rule)
cap   = max(STOCK.hourlyFloorLamports, STOCK.hourlyHitOutMultiple × h_out)
every stock trade:  require last_stock_trade_ts + STOCK.tradeMinSpacingSeconds ≤ now; last_stock_trade_ts = now
StockBuy:           require stock_bought_hour + L ≤ cap;            stock_bought_hour += L
StockSell:          require stock_sold_hour + book ≤ cap;           stock_sold_hour += book     // skipped for MAJOR buckets in BuysClosed
TRENDING buy:       also require trend_bought_hour(b) + L ≤ STOCK.trendingHourlyMaxLamports
TRENDING sell:      also require trend_sold_hour(b) + book ≤ STOCK.trendingHourlyMaxLamports    // in every phase
```

`book = floor(Δ × C(b) / A(b))` is the book value a sell removes (§24 A11). The new counters (`last_stock_trade_ts`, `stock_hour_index`, `stock_bought_hour`, `stock_sold_hour`, and `trend_sold_hour` per bucket) are carved from `Machine._reserved` and `Bucket._reserved` by the M2 brief; M1's layouts do not change.

| Kind | Signer | Pause bit | Phases | Tranche | Spacing | Hourly caps | `min_out` from |
|---|---|---|---|---|---|---|---|
| StockBuy, MAJOR | keeper | `stockBuy` | PoweredOn, OnAir | ≤ 5 SOL | 20 s, shared by every stock trade | gross StockBuy cap | Pyth (age ≤ 60 s, confidence ≤ 1%), −150 bps |
| StockBuy, TRENDING | keeper | `stockBuy` | PoweredOn, OnAir | ≤ 1.5 SOL | same | gross StockBuy cap; 10 SOL per mint; TRENDING book ≤ 15% after the buy | canonical PumpSwap pool, −100 bps after the fee allowance |
| StockSell, MAJOR | keeper | `stockBuy` | OnAir, BuysClosed | ≤ 5 SOL of book | same | gross StockSell cap, except in BuysClosed | Pyth, −150 bps |
| StockSell, TRENDING | keeper | `stockBuy` | OnAir, BuysClosed | ≤ 1.5 SOL of book | same | gross StockSell cap, in every phase; 10 SOL of book per mint | canonical PumpSwap pool, −100 bps |
| Burn | executor; anyone after Done | `burn` | §13.1 | ≤ min(1 SOL, `burn_sol`, 0.25% of effective quote reserves) | 20 s (`last_burn_ts`) | 10 SOL | canonical DBC or DAMM v2 `sqrt_price`, after `METEORA.feeAllowBps` (300), then −150 bps [D29 §3b, M2 P1] |
| JackpotBuy | executor | `burn` | OnAir | ≤ min(2 SOL, `jackpot_sol`, 1% of effective quote reserves) | 20 s (`last_jackpot_buy_ts`) | none; bounded by `jackpot_sol` | canonical DBC or DAMM v2 `sqrt_price`, after `METEORA.feeAllowBps` (300), then −100 bps [D29 §3b, M2 P1] |

- **$1PCT reference and fee allowance [D29 §3b, M2 P1] (§24 A17).** M2 P1 owns the new CONST `METEORA.feeAllowBps = 300` and its compiled mirror; M4.1 does not add or implement it. Burn and JackpotBuy read only the canonical DBC VirtualPool while `is_migrated == 0`, or the canonical DAMM v2 migration pool when `is_migrated == 1`, as pinned in D29 §3b. Other pools fail `AccountMismatch` as price references, even when used as swap routes. For Q64.64 `sqrt_price`, compute `L_eff = floor(L × (10_000 − METEORA.feeAllowBps) / 10_000)`, `expected = floor(L_eff × 2^128 / sqrt_price²)`, then `min_out = floor(expected × (10_000 − slip) / 10_000)`, with u128/U256-safe integer arithmetic. `slip` remains `BURN.minOutSlipBps` or `JACKPOT.minOutSlipBps`. Spot price omits impact, so oversized tranches fail closed and are replanned smaller. This replaces B5's 125 bps $1PCT assumption; Feed and TRENDING PumpSwap settings stay unchanged.
- **$1PCT tranche reserves [architect approval after M4.1].** For the reserve bound above, `quote_eff` is the recorded `quote_reserve u64 @240` of the canonical DBC VirtualPool before migration, or `token_b_amount u64 @688` of the canonical DAMM v2 pool after migration. These recorded reserves exclude accrued fees and vault donations. Compute the bound as `floor(quote_eff × trancheMaxBpsOfQuoteReserves / 10_000)`; do not substitute the quote vault balance. With 30,000,000,000 recorded lamports, the reserve bounds are 75,000,000 for Burn and 300,000,000 for JackpotBuy, even if the quote vault contains more lamports.
- **Worst case.** On MAJOR trades, a stolen keeper key loses at most about 3% of the gross caps per clock hour: about 1.8 SOL at the 30 SOL floor (twice that across an hour boundary, §24 A1). For TRENDING coins and $1PCT, `min_out` reads pool reserves that the same key can move inside its own bundle, so only the tranche and the caps bound the loss. Either way it lasts until the guardian disables the role; the monitor pages on executor slippage against `min_out` (§18).
- **Why `h_out` includes the current hour.** At On Air the previous hour carved nothing. With the previous hour alone, launch-hour buys would stop at 30 SOL, about 42 SOL of packs, and editions would close for lack of coverage.
- **Why BuysClosed skips the gross cap for MAJOR sells.** No StockBuy runs then, so no buy-and-sell round trip is possible: the worst case is one pass of `min_out` slippage over what is left. The spacing still applies, so the keeper converts up to 150 SOL (30 sells of 5 SOL) in the 10 minutes before the Final Pull can start. TRENDING sells keep every cap.

### 8.2 Hit list (`HIT_LIST`, OFF in config; enters the chain only through `admin_*`, signed by the founder admin wallet under D31)

| Key | Value | Source / rationale |
|---|---|---|
| `HIT_LIST.launchMajors` | WIF, BONK, POPCAT, FARTCOIN, PNUT. Mints, decimals and Pyth feed ids in §21 | [C4] SPEC §3.4 |
| `HIT_LIST.neverListed` | PUMP, 1PCT | [C4] PUMP's transfer-hook authority (an upgradeable program) could block Redeem forever. $1PCT is never a hit |
| `HIT_LIST.majorBar` | `mint_is_safe`; Pyth feed (age ≤ 60 s, confidence ≤ 1%); token ≥ 90 days old; ≥ $1M liquidity; a 150 SOL Jupiter sell recovers ≥ 97% (`9_700` bps); 7-day realized daily σ ≤ 15% (`1_500` bps) | SPEC §3.4. MAJOR may back every tier |
| `HIT_LIST.trendingBar` | Pump.fun origin (H1); `mint_is_safe`; graduated ≥ 7 days to its canonical PumpSwap pool; ≥ 300 SOL real quote reserves there; ≥ 5,000 holders; top-10 holders ≤ 25% (excluding pools and burn); Jupiter organicScore ≥ 50 and not `isSus`; not Mayhem; SOL quote | [C5] TRENDING backs Silver and Blue only. Silver or Blue ≤ 1.5 SOL against a pool ≥ 300 SOL keeps a card ≤ 0.5% of the pool |
| `HIT_LIST.dailyRecheckUtc` | `12:00` | Published script, run daily. A failure disables the bucket; the keeper sells it down; existing cards keep Redeem and Sell at market |
| `HIT_LIST.trendingNoticeSeconds` | 86_400 | A TRENDING addition is announced ≥ 24 h before its first buy. Never added automatically from a trending feed |
| `HIT_LIST.capMaxPriceImpactBps` | 200 | A bucket's `cap_lamports` is set at listing to the size sellable at ≤ 2% price impact. The guardian may lower it; only the admin raises it |

### 8.3 Keeper policy (`KEEPER_POLICY`, OFF)

| Key | Value | Source / rationale |
|---|---|---|
| `cycleSecondsMin` / `cycleSecondsMax` | 60 / 120 | SPEC §5.2 |
| `anchorMultipleOfTopBlack` | 2 | Keep the largest-free MAJOR bucket at ≥ 2 × 15 × price(largest edition the stock can open): 30 SOL once After Hours is open. With no other Pull pending, that covers one Rip of AH ×2, SG ×4, BS ×8 or OG ×10. S-1 may raise it |
| `inventoryTargetMinutes` | 30 | Spread remaining buys across majors (equal weights) and trending (≤ 15% in total) to hold ≈30 min of net hit need |
| `solReserveExtraMinutes` | 15 | Keep `stock_sol ≥ SELL_BACK.solFloorLamports + 15 min of recent Sell back outflow`, selling surplus tokens with `stock_sell` if needed |
| `revealDelaySecondsMin` / `Max` | 30 / 120 | Random wait after reveals before buying |
| `maxQuotedImpactBps` | 50 | Chunk size so the quoted impact is ≤ 0.5%. Land privately (Jito with `jitodontfront`, Helius Sender or Jupiter Beam) |
| `creatorFeeCollectSecondsMin` / `Max` | 120 / 300 | Creator-fee collection cadence (§13.4). The keeper also collects right before it calls `advance_phase` PoweredOn→OnAir, and in the last minute before `end_ts` |

**From Last Call,** the keeper buys only what coverage and `inventoryTargetMinutes` need, and sells the surplus within the hourly cap, so that little is left to sell after `end_ts`.

### P3 addendum — StockBuy admission (architect, 2026-10-11)

This issue adds the following StockBuy checks and refreshes one measured CU
limit under §17. All other keys and values remain frozen.

| Key | Value | On-chain effect |
|---|---|---|
| `POST_REVEAL_BUY_DELAY` | 30 s | New compiled minimum after the last reveal. `KEEPER_POLICY.revealDelaySecondsMin` references this same constant; K1 retains its random 30–120 s total wait |
| `HIT_LIST.trendingNoticeSeconds` | 86_400 s, unchanged | Also compiled into the program; a TRENDING StockBuy waits until `listed_ts + 86_400` |
| `KEEPER_POLICY.solReserveExtraMinutes` | 15 min, unchanged | Also compiled into the program; after StockBuy, tracked stock SOL covers `SELL_BACK.solFloorLamports` plus the conservative retained-hour payout bound on this trailing window |
| `CU_LIMITS.settle[1]` | 83_000 CU, previously 82_000 | Off-chain transaction budget remeasured after the final-settlement counter write; maximum × 1.25 rounded up to 1,000, per §17. No economic change |

The program also refuses StockBuy while a Pull is pending or a revealed Pull is
not fully settled. The reveal/settlement observation counter must preserve VRF
callback totality and all existing exit conditions and economic effects.

---

## 9. Sell back and Sell at market

### 9.1 Keys

| Key | Type | Unit | Value | Where | Source / rationale |
|---|---|---|---|---|---|
| `SELL_BACK.payoutBps` | u16 | bps | 8_700 | CONST | [C2] MODEL "~87%": payout = 87% × min(Σ card.value, quote). sim2: +1 pt costs the team ≈0.45% of volume |
| `SELL_BACK.quoteTtlSeconds.major` | i64 | s | 60 | CONST | MODEL "quote valid 60 s"; free-put value 0.07–0.22% |
| `SELL_BACK.quoteTtlSeconds.trending` | i64 | s | 20 | CONST | [C26] kept by the founder on 2026-10-08 [D5]; MODEL says 60 s. SPEC §5.4: on thin coins a 60 s quote is a free option worth 0.3–2.1% of the card. TRENDING coins only |
| `SELL_BACK.solFloorLamports` | u64 | lamports | 1_000_000_000 | CONST | Keeps SOL for restocking: `stock_sol − payout − to_team ≥ 1 SOL` |
| `SELL_BACK.hourlyBudgetMinLamports` | u64 | lamports per hour | 5_000_000_000 | CONST | Budget = max(5 SOL, 25% of `stock_sol` at the start of the hour) |
| `SELL_BACK.hourlyBudgetBpsOfStockSol` | u16 | bps | 2_500 | CONST | Bounds bursts and a leaked quote key |
| `SELL_BACK.eligibleKinds` | list | — | silver, blue, holo, black | CONST | [C3] |
| Phase | — | — | OnAir only, `now < end_ts` | CONST | [C17] Sell back closes at `end_ts` |
| Planning assumption | — | — | Sell back take rate 20–40% | OFF | Not Collector Crypt's 68%. Team revenue plans use 20–40% |

D30 and cleanup #47 retire the OFF market-sale parameters and the API action fallback. No active Sell formula or bound changes.

### 9.2 On-chain formula (`sell_back`, SPEC §5.4)

```
require phase == OnAir and now < end_ts; every card ∈ {silver, blue, holo, black}; card.mint == mint;
        card indices strictly descending; bucket(mint) enabled; mint_is_safe(mint); quote attestation valid (§6.3)
v       = min(Σ card.value, quote_lamports)             // quote_lamports: one Jupiter exact-in quote for the whole batch
payout  = floor(v × 8_700 / 10_000)
margin  = v − payout
to_team = below_target() ? 0 : margin                   // §8.1 fill-first [C7]
require stock_sol − payout − to_team ≥ 1 SOL
require sb_paid_hour + payout ≤ max(5 SOL, stock_sol_at_hour_start × 2_500 / 10_000)
require C(b) + v ≤ cap(b)
stock_sol −= payout + to_team; team_sol += to_team; pay payout → owner
A(b) += Σ card.amount; C(b) += v; remove the cards (slot deposits refunded)
```

When any limit fails (hourly budget, SOL floor, coin cap, mint re-check), the button becomes **Sell at market**. There is no partial fill.

---

## 10. Jackpot: continuous pre-buy (`JACKPOT`, CONST unless tagged)

Founder decision of 2026-10-08 (SPEC §13 C12, option J-B; MODEL §4–§5): the 5% Jackpot share is converted into $1PCT continuously by the bounded executor, the pot is held in $1PCT, and the winner receives the whole pot at once. There is no "bought at the win" path, no order queue and no SOL fallback.

| Key | Type | Unit | Value | Source / rationale |
|---|---|---|---|---|
| `PACK_SPLIT_BPS.jackpot` | u16 | bps | 500 | MODEL §4. Credited to `Machine.jackpot_sol` in the callback |
| `HIT_ODDS.jackpotPriceDivisor` | u32 | — | 400 | §4.2 |
| `JACKPOT.minPotPriceMultiple` | u32 | × price | 15 | Live in edition E iff `jackpot_cost ≥ 15 × price(E)`: 1.5 / 3.75 / 7.5 / 15 SOL of converted SOL for OG / BS / SG / AH |
| `JACKPOT.trancheMaxLamports` | u64 | lamports | 2_000_000_000 | `exec_begin(JackpotBuy, L)` with L ≤ min(`jackpot_sol`, 2 SOL, 1% of $1PCT effective quote reserves) |
| `JACKPOT.trancheMaxBpsOfQuoteReserves` | u16 | bps | 100 | Keeps price impact at about 2% or less per tranche |
| `JACKPOT.trancheMinSpacingSeconds` | i64 | s | 20 | On-chain minimum between tranches |
| `EXECUTOR_POLICY.jackpotTrancheSpacingSecondsMin` / `Max` | number | s | 20 / 60 | OFF. Random spacing, private landing |
| `JACKPOT.minOutSlipBps` | u16 | bps | 100 | Canonical Meteora `sqrt_price` read in `exec_begin`, after `METEORA.feeAllowBps` (300), per §8.1 [D29 §3b, M2 P1] |

- **Buy** (atomic executor pattern, SPEC §8.5): `exec_begin(JackpotBuy, L)` takes L from `jackpot_sol`; the swap lands in the $1PCT vault; `exec_end` requires `Δ ≥ min_out`, then `jackpot_tokens += Δ`, `jackpot_cost += L` and `ledger($1PCT).accounted += Δ`. JackpotBuy runs during OnAir only [A]. It reads the `burn` pause bit, like Burn, the other $1PCT buy (§8.1, §24 A12).
- **Win** (callback): the winner's card is `{kind jackpot, mint $1PCT, amount jackpot_tokens, value jackpot_cost}`, then `jackpot_tokens = 0` and `jackpot_cost = 0`. No token moves and the ledger is unchanged. Unconverted `jackpot_sol` stays for the next pot [A].
- **Display:** the pot reads "Jackpot 4.2M $1PCT ≈ 38 SOL" and floats with $1PCT. A win reads "Jackpot ✳ {tokens} $1PCT ✳ bought with {jackpot_cost} SOL ✳ ≈{value_now} if sold now". Disclosure on the odds page: "The machine buys the Jackpot in $1PCT as packs sell. Its SOL value moves with the $1PCT price."
- **Buy pressure:** burn 5% + Jackpot 5% = 10% of every pack buys $1PCT.
- **End of season:** `jackpot_tokens` join the Final Pull's $1PCT pool and unconverted `jackpot_sol` joins its SOL pool (§14).
- **Removed by J-B:** `jp_orders`, `jp_deliver`, the 30-minute timeout and its SOL fallback. The SPEC invariants become `Machine.lamports ≥ rent + stock_sol + jackpot_sol + burn_sol + team_sol + final_pool_sol` (I2) and `ledger($1PCT).accounted ≥ 10M × (The 1% slots Locked, Live or Final) + jackpot_tokens + $1PCT cards in Binders` (I14).

---

## 11. $1PCT, The 1%, holder boost and Power-On

### 11.1 Token (`TOKEN_1PCT`)

| Key | Type | Unit | Value | Where | Source / rationale |
|---|---|---|---|---|---|
| `TOKEN_1PCT.name` / `symbol` | string | — | `Onepercent` / `1PCT` | OFF | D29 §2, Meteora DBC metadata |
| `TOKEN_1PCT.tokenProgram` | string | token program | `spl-token` | EXT (Meteora) | D29 §2: DBC `initialize_virtual_pool_with_spl_token` |
| `TOKEN_1PCT.decimals` | u8 | decimals | 6 | CONST | D29 §2 |
| `TOKEN_1PCT.totalSupply` | u64 | base units | 1_000_000_000_000_000 (1B × 10⁶) | OFF (tests, display) | D29 §2: fixed supply before and after migration |
| `TOKEN_1PCT.devBuyBps` | u16 | bps of supply | 400 | OFF (test) | MODEL §5: disclosed 4% dev buy |
| `TOKEN_1PCT.devBuyAmount` | u64 | base units | 40_000_000_000_000 (40M × 10⁶) | CONST | `power_on` requires `vault.amount − ledger.accounted ≥ 40M` (≥, never ==) |
| Dev buy cost | u64 | lamports | **1_192_328_122**, including 29_808_204 total trading fee at the default 85 SOL threshold; quoted maximum input equals the integer gross quote for the untouched pool in the atomic launch | EXT (Meteora) | D29 exact-output mirror; unsigned mainnet simulation slot 454848440 |
| `TOKEN_1PCT.teamAllocation` | u64 | base units | 0 | OFF (test) | MODEL §9: team tokens 0 |
| Launch settings | enum | venue | Meteora DBC; SOL quote, FeeIn partner fee claimer and leftover receiver, immutable SPL mint, no creator trading fee | EXT (Meteora) | D29 §2 and §3.1 replace the pump launch checks |
| `METEORA.dbcConfig` | Pubkey | cluster pin | localnet/devnet: `AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k`; mainnet: supplied `dbcConfig` in §11.1.2 | CONST, `ONCHAIN_KEYS`; resolves from `METEORA_BY_CLUSTER` | Architect clarification to D29 §3.1, 2026-10-09 |
| `SEASON.onAirDelaySeconds` | i64 | s | 900 | CONST | [C18] On Air 15 min after Power-On |

### 11.1.1 D29 Meteora launch parameters

These external venue parameters replace the launch-specific pump values. The Feed and X-ray still use the pump adapters. The localnet/devnet `METEORA.dbcConfig` pin is the public test signer above. `METEORA_BY_CLUSTER.mainnet.dbcConfig` is supplied through the public release input below before the build; the account is created and verified after program initialization. This track creates no mainnet account.

| Key | Value | Where | Derivation / source |
|---|---|---|---|
| `PROGRAM_IDS.meteoraDbc` | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | EXT (Meteora) | D29, source `f552f20aa3c1c7631427c3827aeea7c58b902813` |
| `PROGRAM_IDS.meteoraDammV2` | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | EXT (Meteora) | D29, source `a85c926607433f23f0ea60f4ca7b1ae92f4156cb` |
| DAMM customizable config | `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` | EXT (Meteora) | D29 §2; migration option 1, migration fee option 6 (Customizable) |
| Quote / fee destinations | wSOL; fee claimer and leftover receiver = FeeIn | EXT (Meteora) | D29 §2 |
| `collect_fee_mode` / migrated collect mode | 0 / 0 in DBC, translated to DAMM OnlyB = 1 | EXT (Meteora) | Quote only; no compounding |
| Base / migrated pool fee | 25_000_000 / 1_000_000_000; 250 bps | EXT (Meteora) | Base mode 0, all scheduler factors 0, dynamic fees disabled |
| Token settings | SPL Token, decimals 6, fixed pre/post supply 1_000_000_000_000_000; update authority 1 (Immutable) | EXT (Meteora) | Mint and freeze authority null |
| LP shares | Partner permanently locked 100%; every other share and vesting field 0 | EXT (Meteora) | Position NFT held by FeeIn |
| Creator share / migration fee / pool creation fee | 0 / 0 / 0 | EXT (Meteora) | Lowest optional fee; enum 6 is required for customizable 250 bps, not an extra migration charge |
| Mandatory protocol migration fee | 20 bps (0.2%) of both migration token amounts: 414_000_004_754 base units and 170_000_000 lamports at the default threshold | EXT (Meteora) | Deployed DBC protocol fee, not a config fee or selectable surcharge; local migration deposits 206_586_002_372_721 base units and 84_830_000_000 lamports into DAMM v2 |
| `migration_quote_threshold` | 85_000_000_000 lamports by default | EXT (Meteora) | `--migration-threshold-sol` can change this before creation |
| Target migration supply | 207_000_000_000_000 base units (20.7%) | EXT (Meteora) | 79.3% sold target from D29 §2 |
| `sqrt_start_price` | 97_575_587_997_945_580 | EXT (Meteora) | Q64.64; default initial cap approximately 27.979690688 SOL |
| `migration_sqrt_price` | 373_804_058_752_063_036 | EXT (Meteora) | Q64.64; default migration cap approximately 410.6280193 SOL |
| `migration_base_threshold` | 207_000_002_377_476 base units | EXT (Meteora) | DAMM bounded full-range liquidity, rounded up |
| `swap_base_amount` | 792_999_988_514_609 base units | EXT (Meteora) | 79.2999988514609% of supply, rounded up |
| Curve point 0 | sqrt price 373_804_058_752_063_036; liquidity 104_710_427_239_146_668_654_858_249_241_374 | EXT (Meteora) | DBC `getFirstCurve`, minimum of base and quote liquidity |
| Curve point 1 | sqrt price 79_226_673_521_066_979_257_578_248_091; liquidity 3_404_575_593_784_859_536_198_155 | EXT (Meteora) | Remainder curve preserves the exact fixed token supply |

**Integer derivation.** Let `S = 10^15`, `Q = migration_quote_threshold`, `Q128 = 2^128`, `a = 4_295_048_016` and `z = 79_226_673_521_066_979_257_578_248_091`, DBC's supported bounds. Set `m = floor(sqrt(Q × Q128 / (S × 2070 / 10000)))`. Migration liquidity is `floor(Q × Q128 / (m − a))`; migration base is `ceil(Lmigration × (z − m) / (m × z))`. Start sqrt price is `floor(m × migrationBase / (S − migrationBase))`. The first segment liquidity is the minimum of `floor((S − migrationBase) × start × m / (m − start))` and `floor(Q × Q128 / (m − start))`. DBC base delta rounds up; the remaining exact supply receives a final segment ending at `z`, as in Meteora's builder. All arithmetic in the SDK mirror is integer arithmetic. A changed threshold recomputes every derived value; the 20.7% migration allocation stays fixed.

**Exact dev-buy quote.** For 40_000_000_000_000 base units, next sqrt is `ceil(L × start / (L − amountOut × start)) = 101_353_483_280_186_128`. Excluded-fee input is `ceil(L × (next − start) / Q128) = 1_162_519_918`. Gross input is `ceil(excluded × 1_000_000_000 / 975_000_000) = 1_192_328_122`. The 29_808_204 lamport fee splits to protocol `floor(fee × 20 / 100) = 5_961_640` and partner 23_846_564. The unsigned mainnet capture `app/fixtures/meteora/mainnet-launch-simulation.json` reproduces every amount and the decoded config with no mismatches.

**Config pin and release order (D31/D32, 2026-10-12).** The production DBC
signer is generated offline and retained outside the repository. Its public key
is known before its account exists: supply it in `app/release/mainnet.json`,
apply the release input, build and deploy the program, initialize Config, then
create the DBC config with `onepct-ops launch config`. The config creation
verifies FeeIn and the authorized team payer after init; the Proxima launch must
use that config and the prepared vanity mint. The launch wallet is the friend's
Proxima Deployer wallet; its exact dev buy goes directly to that wallet, then to
the vault before its separate `power_on` signature. There is no intermediate
wallet transfer. D32 supersedes D28's atomic mainnet launch.

Localnet/devnet keep their existing public test pin. Mainnet refuses these test
identities. No private key file is a build input. `release:mainnet:apply` validates
all four public values, generates the cluster program IDs, Rust cfg identity and
DBC pin, Anchor deployment entry and this release table. `params:rs --check`,
Anchor builds and `program:release:check --cluster mainnet` reject missing or stale
inputs. SDK IDL/event artifacts stay canonically localnet; runtime deployment
selection uses `ONEPERCENT_PROGRAM_IDS`, with no mainnet fallback.

### 11.1.2 Mainnet release input (issue 5, 2026-10-12)

This issue authorizes exactly these supplied keys: `ONEPERCENT_PROGRAM_IDS.mainnet`
(P6), `METEORA_BY_CLUSTER.mainnet.dbcConfig` / compiled `METEORA_DBC_CONFIG` (P3),
`SERVICES.landing.tipLamports` (P1) and
`SERVICES.landing.maxComputeUnitPriceMicroLamports` (P2). Their values are supplied,
never measured or inferred by the build. The two measurements retain §26.3's
observation and rounding requirements. `null` means no mainnet release: it is
not a usable default. The provisional development tip remains 1,000,000 until
all values are adopted. The generated table below supersedes PENDING mentions
elsewhere in this document only when every value is present. Measured raw data
and the observation report must accompany release review; this file records
adopted numeric values, not proof of measurement.

```sh
cd app
pnpm release:mainnet:apply --input release/mainnet.json
pnpm release:mainnet:check
pnpm build:libs
pnpm program:release:check --cluster mainnet
```

<!-- BEGIN MAINNET RELEASE INPUT -->
| Release key | Supplied value |
|---|---|
| `programId` | **PENDING** |
| `dbcConfig` | **PENDING** |
| `landing.tipLamports` | **PENDING** |
| `landing.maxComputeUnitPriceMicroLamports` | **PENDING** |
<!-- END MAINNET RELEASE INPUT -->

D31 also replaces the off-chain governance defaults in §17/§22:
`GOVERNANCE.multisigThreshold` 2 → 1, `GOVERNANCE.multisigMembers` 3 → 1,
`GOVERNANCE.timelockSeconds` 43,200 → 0. One founder wallet holds Config admin and
upgrade authority after the friend's deployment and verified transfers. The
existing two-slot guardian ABI is unchanged; guardians remain separate from the
admin and hot operator roles. No on-chain economics changes in this issue.

The exact curve values above are checked by launch tooling. The on-chain
`power_on` checks remain the fields required by D29 §3.1.

**Registre devnet (2026-10-10, sans changement économique).** Identité du programme
de répétition : `DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr`.
Les PDA, le mint créé, les rôles et leur état de création sont dans
[`ONCHAIN_KEYS.md`](ONCHAIN_KEYS.md) et `app/fixtures/devnet/provisioning.json`.
Programme déployé (`max-len 1966080`), Config/Machine initialisées, launch finalisé.
54 cartes Feed déposées ; LUT protocole figée
`81AcVRQcvUfPgNAcDgcAAJNT3RtWsG2hbjW5xrmjL5Um` (106 entrées).
Snapshot saison : `509605276`. Config DBC devnet
`AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k`, version 1 admise uniquement
par le profil explicite devnet ci-dessous.
Mint SPL `5UTKhyEem2niArN56XGDuCjeYXwGCHMy4typ2YrE5bVQ` ; pool DBC
`iyGGHFujSRRekqsc5PENBb5cwPL16jftyXKJ71n5Dvx` ; LUT launch figée
`EWr5gTsf7Dc9NkF7fdNCAPfG6Q5E7dr9CXCSKctt4jK1` (17 entrées).
À la date de cette preuve devnet, mainnet restait PENDING (statut courant : §11.1.2). Migration validée localement avec les binaires devnet,
les vecteurs économiques restent identiques à la référence v0.
Ce registre ne modifie pas la liste des constantes économiques compilées.

**Profil de transport devnet (décision architecte 2026-10-10).**
`devnet-rpc-p75-v1`, uniquement pour `cluster=devnet` : RPC standard, tip = 0 ;
`getRecentPrioritizationFees` à chaque nouvelle transaction sur les comptes écrits,
triés et dédupliqués (maximum 128), percentile 75 au rang `ceil(0,75 × N)`,
zéro si aucun échantillon, plafond **1 000 000 microlamports/CU**.
Les retransmissions utilisent les mêmes octets signés ; elles ne modifient pas le prix.
Le bootstrap et le dry run de l’executor M4.2 utilisent également ce profil sur
devnet ; la composition y omet entièrement le transfert Sender et refuse un tip non nul.
Le profil est refusé pour mainnet. Il ne constitue aucune mesure mainnet P1/P2 (§11.1.2/§26.3) et ne change
pas leur exigence de 24 h de mesures (§26.3). Détails et preuves dans
[`DEVNET.md`](DEVNET.md). Aucun chiffre économique compilé ne change.



**Fixture MAJOR devnet (décision architecte 2026-10-10).** Profil off-chain
`devnet-major-sol-fixture-v1`, accepté uniquement pour `cluster=devnet` : mint pump
`8qHh54rJXmwegYvCz7369akQUnx1DTj3G3amoYzmYdFV`, compte Pyth SOL/USD devnet
`7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE`, couverture fictive 1,5 SOL,
1500000 unités de base à 6 décimales. Ce mapping est réservé au smoke, sans
signification de prix du coin. Il ne modifie ni `HIT_LIST`, ni les constantes
on-chain. Sélection par `ClusterDeployment`, refus mainnet/mainnet-beta testé.
Le profil MAJOR est approuvé pour cette répétition uniquement. La dérogation de
provenance Meteora du 2026-10-10 autorise le profil `devnet-dbc-v1-zero-transfer-fee-v1` :
cluster devnet, config v1 avec octets 216 à 220 strictement nuls, tous les paramètres
D29 inchangés. Mainnet refuse v1 ; ce profil ne remplace pas les mesures P1/P2 de §26.3, dont les valeurs adoptées sont en §11.1.2. Validation
empirique requise : frais Curve 250 bps, claims, métadonnées immuables ; migration
85 SOL et LP permanent vers FeeIn sur validator local avec les binaires devnet
si le budget devnet ne suffit pas. Voir `DEVNET-METEORA-AUDIT.md`.

### 11.2 The 1% cards (CONST)

| Key | Type | Unit | Value | Source / rationale |
|---|---|---|---|---|
| `TOKEN_1PCT.onePctCardCount` | u8 | cards | 4 | MODEL §4 |
| `TOKEN_1PCT.onePctCardAmount` | u64 | base units | 10_000_000_000_000 (10M × 10⁶) | MODEL §4: 1% of supply each |
| `TOKEN_1PCT.onePctReleaseOffsetsSeconds` | i64[4] | s after `on_air_ts` | 0, 151_200, 302_400, 453_600 (0 / 42 / 84 / 126 h) | [C14] Card k is Live iff cards 0..k−1 are Pulled and `now ≥ on_air_ts + offset[k]`. One card live at a time. Program-enforced from timestamps only |
| `HIT_ODDS.onePctPriceDivisor` | u32 | — | 1_000 | §4.2 |
| Delivery | — | — | 10M $1PCT at once, no vesting; Redeem, Keep or Sell at market; no Sell back, no Feed | [C3], [C14] |
| Unpulled at `end_ts` | — | — | Become the $1PCT pool of the Final Pull | [C14] |

sim2 at 5,000 SOL of packs: card #1 is pulled at a median of 6.5 h; cards #2, #3 and #4 in 95%, 77% and 45% of seasons. Card value ≈22.6 SOL executable at a $300k market cap, ≈69–72 SOL at $1M, ≈183–193 SOL at $3M. The UI always shows "≈X if sold now".

### 11.3 Holder boost

| Key | Type | Unit | Value | Where | Source / rationale |
|---|---|---|---|---|---|
| `TOKEN_1PCT.holderTier.minBalance` | u64 | base units | 1_000_000_000_000 (1M $1PCT) | OFF (attester) | MODEL §5 |
| `TOKEN_1PCT.holderTier.continuousHoldSeconds` | number | s | 86_400 | OFF (attester) | [C15] Held continuously for 24 h, from indexed transfers. Never a raw balance check |
| `TOKEN_1PCT.holderTier.onePctOddsMultiplierBps` | u32 | bps | 15_000 | CONST | MODEL §5 ×1.5, The 1% segment only |
| `ATTESTATIONS.holdTtlSeconds` | i64 | s | 600 | CONST | The attestation is valid ≤ 10 min. Cards always go to the payer's Binder |

---

## 12. Spotlight Drops (flag; `SPOTLIGHT`)

> **Not in Season 1 [D1].** The founder delegated Q1 and the architect skipped Spotlight (C20's simplest alternative). The RC implements no `spotlight_deposit`, no `spotlight_take_back`, no Spotlight admin slot and no live Spotlight segment: M1's stubs keep returning `NotImplemented`, the live flag is never set, and the `SPOTLIGHT` web flag stays off and unread. The keys below stay because the draw, the layouts and `params.rs` are frozen; they describe a later season.

| Key | Type | Unit | Value | Where | Source / rationale |
|---|---|---|---|---|---|
| `SPOTLIGHT.enabledAtLaunch` | boolean | — | false | OFF | [C20] Built last, behind a flag. Season 1: never enabled [D1] |
| `HIT_ODDS.spotlightPriceDivisor` | u32 | — | 500 | CONST | N_S = 500 SOL |
| `SPOTLIGHT.windowSeconds` | i64 | s | 86_400 | CONST | 24 h per drop; one slot at a time. No drop in Season 1 [D1] |
| `SPOTLIGHT.minDepositBpsOfSupply` | u16 | bps of the mint's supply | 100 | CONST | MODEL §4: ≥ 1% of the supply, measured as a vault delta |
| `SPOTLIGHT.lineupNoticeSeconds` | number | s | 86_400 | OFF | The Lineup notice stays ≥ 24 h; D31 removes the former timelock rationale |
| Eligibility | — | — | `mint_is_safe` on-chain and the TRENDING bar off-chain | CONST + OFF | [C20] |

A pulled Spotlight card supports Redeem, Keep and Sell at market. Unpulled tokens go back only to the sponsor (`spotlight_take_back`), never to the Final Pull. Copy: "Spotlight ✳ 1% of $COIN ✳ ≈4.1 SOL if sold now", never "1% of supply" alone.

---

## 13. Burn, referral, team and trading fees

### 13.1 Buy & burn (`BURN`, CONST)

| Key | Type | Unit | Value | Source / rationale |
|---|---|---|---|---|
| `PACK_SPLIT_BPS.burn1pct` | u16 | bps | 500 | MODEL §5 |
| `BURN.trancheMaxLamports` | u64 | lamports | 1_000_000_000 | Tranche ≤ min(1 SOL, `burn_sol`, 0.25% of effective quote reserves) |
| `BURN.trancheMaxBpsOfQuoteReserves` | u16 | bps | 25 | v1 §7.5 pattern, red-team fix |
| `BURN.minSpacingSeconds` | i64 | s | 20 | `last_burn_ts + 20 ≤ now` |
| `BURN.hourlyMaxLamports` | u64 | lamports per hour | 10_000_000_000 | See §24 note N2 |
| `BURN.minOutSlipBps` | u16 | bps | 150 | Canonical Meteora `sqrt_price` read in `exec_begin`, after `METEORA.feeAllowBps` (300), per §8.1 [D29 §3b, M2 P1] |

The swap lands in the $1PCT vault; the vault authority then runs `burn_checked(Δ)` and `burned_total += Δ`. After Done, `Burn` is permissionless with the same checks. This is a future upgrade: the P1 audit amendment enforces D18 by rejecting Burn in Done in the current delivery. 1% TV counts only these burns. D29 locks the Meteora LP permanently; it does not add a graduation burn.

### 13.2 Referral (CONST rules)

`Binder.referrer` is set once, while `season_spend == 0` (at Binder creation or the first Rip), must differ from the owner, and is immutable for the season [C16]. Links, Blinks and bot deep links never overwrite it. The 2% is paid at `settle`; with no referrer, or one that can't be credited, it goes to `team_sol`. Self-referral through a second wallet is a disclosed 2% rebate.

**Codes in share links** (SPEC §2.1, §6.7). A code is a wallet address, or an alias that resolves to one (format in `X3-BOT-BLINKS-BRIEF.md` §3.4). From X-ray Week on, every share link and share image carries the sharer's code as `ref=<code>`. An X-ray share link carries `ref=<scanned address>`, unless the request already carried a valid `ref`, which it keeps. The web app keeps an incoming `ref` for the browser session and passes it to the wallet's first `buy_packs`, which binds it once. Links shared during X-ray Week cannot be fixed later, so this holds from the first X-ray release.

### 13.3 Team

`team_sol` receives 8% of packs, the unreferred 2%, the Sell back margin while the stock is at or above target, and the creator-fee team share (§13.4). `team_withdraw` is permissionless and pays only `Config.team_wallet`. Team wallets are published, never Feed or Rip, and never trade $1PCT during the season.

### 13.4 Trading fees (`CREATOR_FEE_SPLIT_BPS`, CONST)

D27 and D29 (founder, 2026-10-09) replace the earlier split and venue. `$1PCT` launches on Meteora DBC and migrates to DAMM v2. The flat trading fee is 2.5% per buy and sell; Meteora receives 20% of that fee (0.5% of the trade), and Onepercent receives 2.0%, in SOL. No scheduler, dynamic fee or compounding applies. The partner is FeeIn; the launch wallet receives no creator trading fee.

| Regime | Stock | Burn | Team | Source |
|---|---|---|---|---|
| `belowFloor` (PoweredOn or OnAir, book < `STOCK.creatorFeeFloorLamports`) | 10_000 | 0 | 0 | [D27] All to stock below 2 SOL |
| `season` (PoweredOn or OnAir, book ≥ `STOCK.creatorFeeFloorLamports`) | 5_000 | 0 | 5_000 | [D27] No cap on the stock share, including above the 30 SOL target |
| `afterEnd` (phase ≥ BuysClosed) | 0 | 0 | 10_000 | [D27] All to team while someone runs the collection chain |

`book = stock_sol + Σ C(b)`, including every bucket. The phase and book are read once at the start of a collection, before any proceeds are credited. The target still controls other stock rules, including Sell back; it never selects a creator-fee regime. Creator fees never fund burn. The 5% pack burn is unchanged.

**Rounding.** Team is floored; stock receives the remainder through `credit_stock`. In `afterEnd`, the whole amount goes to team and `credit_stock` is not called.

**Split timing.** A collection splits what it moves by the regime in force when it runs, whenever those fees accrued, and anyone can choose when to collect. A collection that starts below the floor puts its whole amount into stock, even if it crosses the floor. BuysClosed, set by `advance_phase` at `end_ts`, selects `afterEnd`; collection itself never reads `end_ts`. The stats page shows each collection's regime. The disclosure stays: "Trading fees are split by the rule in force when they are collected."

**Seeding the stock.** Transfer SOL directly to FeeIn, then call `collect_creator_fees`. The transfer is collected under the same regime as creator fees. It creates no depositor claim. Below the floor it all enters stock; at or above the floor during the season, 50% enters stock and 50% goes to team; from BuysClosed it all goes to team.

| Key | Value | Where | Source |
|---|---|---|---|
| `FeeIn` PDA | Seeds `["fee_in"]`, system-owned, pre-funded with the rent-exempt minimum of a 0-byte account (650,240 lamports at 5,080) | CONST seeds; amount read from Rent | [C21] SPEC §6.9 |
| Fee collection chain | `claim_launch_fees(Curve)` before migration or `claim_launch_fees(Pool)` after migration, plus `Surplus` once; then `collect_creator_fees` in the same transaction, every 2–5 min. The keeper also cranks permissionless DBC migration when needed | OFF (keeper); EXT (Meteora) | D29 §3–§4 |
| Trading-fee rates | Flat 250 bps on DBC and DAMM v2; 20% of each fee to Meteora and 80% to Onepercent, equivalent to 50 bps and 200 bps before integer rounding. Only a Meteora operator can change the post-migration pool fee later | EXT (Meteora) | D29 §1–§2 |

---

## 14. Season timeline (`SEASON`)

| Key | Type | Unit | Value | Where | Source / rationale |
|---|---|---|---|---|---|
| `SEASON.durationDays` | number | days | 7 | OFF (copy, tests) | MODEL §9 |
| `SEASON.durationSeconds` | i64 | s | 604_800 | CONST | `end_ts = on_air_ts + 604,800` |
| `SEASON.onAirDelaySeconds` | i64 | s | 900 | CONST | [C18] |
| `SEASON.lastCallSeconds` | number | s | 86_400 | OFF | A countdown only: no odds or payout change at any published time |
| `SEASON.finalPullDelaySeconds` | i64 | s | 600 | CONST | `start_final_pull` needs `now ≥ end_ts + 600` and `pending_pulls == 0` |
| `SEASON.sealDelaySeconds` | i64 | s | 259_200 | CONST | Done (Sealed) at `final_ts + 72 h`; then the founder wallet sets the upgrade authority to None [C23, admin amended by D31] |

| Beat | When | On-chain phase | What opens |
|---|---|---|---|
| Domain reviews (Phantom/Blowfish, Blockaid) | T−14 d | — | — |
| Deploy | After the RC audit, ≈T−5 d (Sat–Sun before Stock-Up). The RC is the first mainnet deploy; the M1 build is never deployed to mainnet [D4] | `Setup` | Nothing. Verified-build hash published; `S` and `stock_up_ts` written once with `SetSeason` (any past slot is valid) |
| X-ray Week | T−7 d | `Setup` | X-ray (off-chain). `S` and the Feed rules published at the latest now |
| Stock-Up | T−3 d (`stock_up_ts`) | `StockUp` | Feed, take-back, Redeem. KPI: Deck ≥ 4 × the packs expected in the first 6 h (≈15–20k cards at mid scale); alarm below 5k |
| Power-On | T0 (`power_on_ts`) | `PoweredOn` | Creator fees use the D27 floor; stock buys |
| On Air | T0 + 900 s (`on_air_ts`) | `OnAir` | Rip, Sell back. Editions open as coverage allows. The 1% card #1 eligible |
| The 1% #2 / #3 / #4 eligible | On Air + 42 / 84 / 126 h | `OnAir` | Only once the previous card is pulled |
| Spotlight Drops | Not in Season 1 [D1] | — | — |
| Last Call | `end_ts − 24 h` | `OnAir` | Countdown only |
| Buys closed | `end_ts` | `BuysClosed` | Rip, Feed, `feed_back` and Sell back close; pending Pulls resolve; the keeper sells the buckets to SOL (MAJOR sells skip the gross hourly cap here, §8.1). Tokens still unsold at the Final Pull are shared in kind |
| The Final Pull | ≥ `end_ts + 600 s` with no pending Pull (`final_ts`) | `FinalPull` | `claim_final_*` |
| Sealed | `final_ts + 72 h` | `Done` | Exits only, forever |

Example (the founder fixes T0): T0 = Thu 2026-10-29 16:00:00 UTC. X-ray Week opens Thu 10-22; Stock-Up Mon 10-26; On Air 16:15 on 10-29; The 1% #2 eligible Sat 10-31 10:15, #3 Mon 11-02 04:15, #4 Tue 11-03 22:15; Last Call Wed 11-04 16:15; buys close Thu 11-05 16:15; Final Pull from 16:25; Sealed from Sun 11-08 16:25.

**Final Pull** (CONST rules, [C17]): `pool_sol = stock_sol + jackpot_sol`; `pool_tok[b] = A(b)` for any bucket still holding tokens; `pool_1pct` = unpulled The 1% amounts + `jackpot_tokens` (J-B). Each buyer's share is `floor(pool × season_spend / total_spend)`, where `season_spend` adds `qty × price` at each reveal (refunded Pulls never count). Claims never expire. Spotlight leftovers, `burn_sol`, `team_sol` and Dust Cards are not in it.

---

## 15. VRF (MagicBlock)

| Key | Type | Unit | Value | Where | Source / rationale |
|---|---|---|---|---|---|
| `VRF.timeoutSeconds` | i64 | s | 300 | CONST | [C22] The callback is a no-op after 300 s; `refund_pull` then returns the full price. Never re-requested. No automatic pause |
| MagicBlock request TTL | — | s | 120 | EXT | Below our 300 s |
| `VRF.feeLamports` | u64 | lamports | 500_000 | EXT | MagicBlock base-layer fee (`VRF_LAMPORTS_COST`). The buyer pays it once per Rip; it is not refunded on timeout (disclosed on /fairness) [C19], [C22] |
| `VRF.maxQueues` | u8 | queues | 4 | CONFIG | `Config.vrf_queues` allow-list (no hard pin of a single queue). Initial: MagicBlock's shared mainnet queue `Cuj97…` only, listed before Stock-Up. **No dedicated queue and no MagicBlock outreach [D6]**; C27 is moot. Anyone can post requests to a queue, and a request whose callback reverts holds its slot for 120 s: keeping the shared queue's ≈120 items full costs ≈ 120 × 30 per hour × 0.0005 SOL ≈ 1.8 SOL/h. A full queue stops Rip ("Machine busy"); funds are never at risk. The occupancy reader, the alert and the client guard (below, M2 §11.7) are launch-critical |
| `MONITOR.vrfQueueOccupancyAlertBps` | number | bps | 5_000 | OFF | [A] Alert above 50% occupancy of any listed queue, before the client's 80% "Machine busy" threshold |
| Callback accounts | — | — | 4: Pull, Machine, Deck, Binder (all writable); args `seq` | CONST | Every account is re-derived in the callback; mismatch → Ok |
| Requests per Rip | — | — | 1, at most 5 SOL of list | CONST | §2.1 |
| `VRF.busyOccupancyBps` | number | bps | 8_000 | OFF | The client disables Rip when the queue is > 80% full… |
| `VRF.busyOldestItemSeconds` | number | s | 20 | OFF | …or its oldest item is older than 20 s ("Machine busy") |
| `MONITOR.vrfExpiriesPerThousandRipsAlert` | number | per 1,000 Rips | 1 | OFF | Alert above 1 expiry per 1,000 Rips, or when clustered on one wallet; the guardian decides whether to pause RIP |
| Burst test | — | requests | 300 on mainnet at T−3 | OFF (ops) | SPEC §8.4 |
| Shared queue capacity | — | — | 30,000 B; ≈248 B per 4-account item → ≈120 pending requests for all apps | EXT | Verified on 2026-10-08: `Cuj97…` is owned by the VRF program, 30,000 B |

---

## 16. Accounts, deposits, batching and rounding

### 16.1 Sizes (`ACCOUNT_SIZES`, CONST unless tagged)

| Key | Bytes | Account |
|---|---|---|
| `deckHeader` / `deckEntry` | 64 / 80 | Deck `["deck"]`: header `{len}`; entry `{depositor 32, mint 32, amount u64, deposit u32, flags u8 (FRESH / REFED), pad 3}` |
| `binderHeader` / `cardSlot` | 112 / 56 | Binder `["binder", owner]`; card `{mint 32, amount u64, value u64, kind u8, edition u8, flags u8, seq_lo u32, pad}` |
| `pullHeader` / `pullPerPack` | 176 / 200 | Pull `["pull", buyer, pull_nonce u32 LE]` (M1 A1; the global `seq` is stored in the Pull), 176 + 200 × qty |
| `mintLedger` | 80 | MintLedger `["ledger", mint]` |
| `vaultSpl` / `vaultToken2022` | 165 / 170 | EXT. Vault ATA of `["vault_auth"]` |
| Binder capacity | `len` and `cap` are u16 → at most 65,535 cards | [A] `buy_packs` refuses a Rip that would exceed it (§24 A6) |

### 16.2 User deposits (refundable; lamports at 5,080 per byte, computed from the Rent sysvar in code) [C19]

| Deposit | Bytes charged | Lamports at 5,080 | Paid by | Back when |
|---|---|---|---|---|
| Deck entry | 80 (growth) | 406,400 | depositor | The card leaves the Deck (pull → with the royalty at settle; take-back) |
| Vault ATA, first card of a mint | 128 + 170 (Token-2022) / 128 + 165 (SPL) | 1,513,840 / 1,488,440 | first depositor or lister | `close_vault` once empty and `accounted == 0` (to the ledger's payer) |
| MintLedger, first card of a mint | 128 + 80 | 1,056,640 | first depositor or lister | `close_vault` |
| First-of-mint total (Token-2022) | — | 2,976,880 | — | — |
| Binder header, first Rip or Feed | 128 + 112 | 1,219,200 | owner | `close_binder`, once the Binder holds no card, has no pending Pull (`reserved == 0`), `fresh_in_deck == 0` and `sol_owed == 0`, and its Final Pull share is claimed or it has no spend: `season_spend == 0 ∨ (flags & 0b11) == 0b11` (M2 B8). Both Final Pull claims are callable with a zero share and set their claimed bit (M4) |
| Card slot | 56 (growth) per card | 284,480 per card; 1,422,400 per pack | buyer | The card leaves My cards (refunded from the Binder's lamports above its rent-exempt minimum, M1 A9) |
| Pull | 128 + 176 + 200 × qty | ×1: 2,560,320 · ×5: 6,624,320 · ×10: 11,704,320 | buyer | The last `settle`, or `refund_pull` |
| Draw fee | — | 500,000 | buyer | Not refunded (§15) |

Signed totals at 5,080: OG ×1 = 104,482,720 lamports (0.10448272 SOL); OG ×10 = 1,026,428,320; AH ×1 = 1,004,482,720. A first Rip adds the Binder header (1,219,200).

Rent back on closed user token accounts is the account's actual lamports (EXT): 2,039,280 legacy SPL, 2,074,080 legacy Token-2022, 1,488,440 / 1,513,840 for accounts opened at the current rate.

**Why `close_binder` needs `reserved == 0`.** A first-time buyer whose Pull is still Pending has no card, no fresh card, no owed SOL and no spend yet. Closing the Binder then would make the callback skip (`BinderInvalid`) and the Pull refund at 300 s. One transaction, `[buy_packs AH ×5][close_binder]`, would lock 75 SOL of MAJOR coverage for 300 s at the cost of the 0.0005 SOL draw fee, and a block leader that sees the draw first could turn a bad draw into a refund. M2 tests `close_binder` with a Pending Pull (rejected) and adds `close_binder` to the P2 operation set.

### 16.3 Batching (`TX_LIMITS`, OFF)

| Key | Value | Source / rationale |
|---|---|---|
| `TX_LIMITS.maxTxBytes` | 1,232 | EXT. Web wallets sign legacy or v0 only |
| `TX_LIMITS.feedBagsPerTx` / `feedBagsPerTxWithLookupTable` | **PENDING M1 measurement** (expected 2 / 3) | One attestation and one `feed` per transaction; per bag 5 unique accounts and three instructions, within the 1,047-byte budget. M1 A7 and M1 §15.4 show that SPEC's 4 / ≈6 cannot fit. M1 writes the measured values into `packages/config` and reports them in its PR; the next issue of this file adopts them. Until then these two keys, `CU_LIMITS` (below) and the two release measurement inputs of §26.3 (adopted in §11.1.2) are the only ones where `packages/config` may differ from this file |
| `TX_LIMITS.redeemPerTx` / `takeBackPerTx` | 8 / 8 | SPEC §8.8 |
| `TX_LIMITS.settlePacksPerTx` | 2 | 8 depositors plus their Binders |
| `TX_LIMITS.txPerSignAll` | 8 | Per `signAndSendAllTransactions`: one wallet approval per batch of up to 8 transactions. A Feed needs `ceil(transactions / 8)` approvals (§19) |
| `TX_LIMITS.byteHeadroomBps` | 1,500 | ≥ 15% byte headroom for Phantom's Lighthouse assertions on Feed transactions |
| Sell back cards per transaction | ≤ 8 [A], `card_index` strictly descending | Same bound and order as Redeem (§6.3, §24 A7) |
| `CU_LIMITS` (`[OFF]`, shape in `01-M1-BRIEF.md` §16.3; M2 P1 and P2 append their keys; M4.1 adds `powerOn`, `collectCreatorFees`, `claimLaunchFees.{curve,pool,surplus}` and `feeChainTx.{curve,pool,surplus}`) | **PENDING measurement in each owning milestone**: worst whole-transaction CU × 1.25, rounded up to the next 1,000 | Each milestone writes its measured keys into `packages/config` and reports them; the next issue of this file mirrors the values |

M4.1 measurements (OFF), refreshed for the P1 B4 audit on 2026-10-10: 32 samples per native variant, plus the real DBC/DAMM validator flow. Limits use the greater native or validator measurement, add 25%, then round up to 1,000 CU. Reports: `m4-cu.json` and `m4-meteora-season.json`.

| Key | Measured maximum CU | CU limit | Largest measured transaction bytes |
|---|---|---|---|
| `powerOn` | 40,150 | 51,000 | 593 |
| `collectCreatorFees` | 17,414 | 22,000 | 395 |
| `claimLaunchFees.curve` | 114,479 | 144,000 | 763 |
| `claimLaunchFees.pool` | 113,628 | 143,000 | 827 |
| `claimLaunchFees.surplus` | 66,707 | 84,000 | 731 |
| `feeChainTx.curve` | 121,650 | 153,000 | 778 |
| `feeChainTx.pool` | 134,299 | 168,000 | 842 |
| `feeChainTx.surplus` | 81,378 | 102,000 | 746 |

The fee-chain rows include `collect_creator_fees`. Each measured transaction has both compute-budget instructions. `buyPacks` was also remeasured with the real MagicBlock binary and the M4.1 artifact over 3,072 local simulations: maxima 84,979 / 86,869 CU, limits `x1` 107,000 and `x10` 109,000 (`real-vrf.json`). Whole atomic launch sizing is owned by M4.2 under D28; Final Pull and Burn-after-Done measurements remain outside D18's launch scope.

P1 B4 audit remeasurement (2026-10-09, OFF): adding the readonly Machine account and exec lock to Redeem and Take back gives native maxima of 73,435 / 400,880 CU for Redeem x1/x8 and 71,000 CU for Take back. Their SDK limits are 92,000 / 502,000 and 89,000 CU, respectively, with the same 25% margin and upward rounding. The refreshed native and callback reports cover the B4 guards. The real MagicBlock baseline above retains its recorded M4.1 provenance.

P1 executor measurements after the B4/B7 audit (2026-10-10, OFF): per-path maxima from two runs of the 16 T12.16 cases and two runs of six local validator swaps set `execBegin = 77,000` (61,524 measured) and `execEnd = 55,000` (43,876 measured), using the same 25% and upward rounding rule. `fixtures/reports/m2-exec.json` records every case and the binary hash. Fixed exec pairs with the protocol LUT occupy 369 to 381 bytes before swap instructions; complete validator transactions occupy 435 to 625 bytes. The validator uses the TRENDING stub and real DBC/DAMM programs for Burn and JackpotBuy, including migration.

### 16.4 Rounding (CONST rules, SPEC §4.7)

| Quantity | Formula | Direction |
|---|---|---|
| Split | bps of price; the stock takes the remainder | exact |
| Tier and Dust index | `(u64 × n) >> 64` | bias ≤ n / 2⁶⁴ |
| Carved tokens | `x = (V == C) ? A : floor(V × A / C)` (u128) | toward the machine |
| Sell back payout | `floor(min(value, quote) × 8_700 / 10_000)` | toward the machine |
| Final Pull share | `floor(pool × spend / total_spend)` | toward the machine; remainders stay and are disclosed |
| Rent refunds | `min(stored deposit, lamports − rent_min(new size) − tracked)`; a card slot has no stored deposit and refunds the Binder's excess over its rent-exempt minimum (M1 A9) | never below rent-exempt; never reverts |
| `min_out` | `floor(expected × (10_000 − slip_bps) / 10_000)` | protects the machine |

---

## 17. Governance and operations

| Key | Type | Value | Where | Source / rationale |
|---|---|---|---|---|
| `PAUSE_BITS` | u8 bits | `rip 1`, `feed 2`, `sellBack 4`, `stockBuy 8`, `burn 16` [A] | CONST encoding; CONFIG value | [C23] Nothing else is pausable. No exit reads a pause bit. `stockBuy` pauses StockBuy and StockSell; `burn` pauses Burn and JackpotBuy (§24 A12) |
| `GOVERNANCE.multisigThreshold` / `multisigMembers` | number | 1 / 1 | OFF (D31: one founder wallet) | D31, supersedes [C23] |
| `GOVERNANCE.timelockSeconds` | number | 0 | OFF (D31: no timelock) | Founder admin wallet; no Squads |
| `GOVERNANCE.guardianCount` | number | 2 | CONFIG | Two time zones |
| `GOVERNANCE.maxTeamWallets` | number | 8 | CONFIG | §7.1 |
| Upgrade authority | — | Set to None at `final_ts + 72 h` once nothing is pending | OPS | [C23] |
| Admin powers | — | Upgrade (until Sealed); rotate roles; add a hit-list mint and raise caps; allow-list VRF queues; set `S` (and `stock_up_ts`) once. No Spotlight slot in Season 1 [D1] | CONFIG | Never odds, splits or prices (compiled) |
| Guardian powers | — | Set or clear the five pause bits; disable a bucket; lower a cap; disable a role key; switch among allow-listed VRF queues | CONFIG | Can never touch an exit or grant anything |
| Admin upgrade reserve | — | ≥ 3 SOL available to the founder admin wallet for an emergency upgrade; recompute the release budget from RPC rent | OPS | SPEC §6.8 amount retained; D31 replaces custody, D18 removes calendar gates |
| Up-front cash | — | ≈10–11 SOL before the first pack (≈3–4 recoverable: the deploy buffer and unspent fee-payer SOL): program rent ≈2.6 SOL for ≈500 KB plus an equal temporary buffer; dev buy 1.176; keeper and executor fee payers 1–2; rehearsal ≈0.05; DexScreener profile ≈2.6; services $0.4–2k for the month. No dedicated VRF queue rent [D6]. **Plus the mainnet canary** (master §5.1, F14): ≈3.9 SOL locked (≈2.6 program rent, the ≈1.2 rehearsal dev buy, account rent) and ≈2.6 SOL of temporary deploy buffer plus fees, recovered after the canary's season by closing its program and redeeming and selling its tokens. Peak ≈16.5–17.5 SOL if both deploy buffers are out at once | OPS | SPEC §6.8; master §5.1, F14 |
| Team seed of the stock | — | 0 SOL | OPS | Founder decision 2026-10-08 (§23). sim2: a 2.5–6% chance that a flop never opens The Original |
| Go / no-go | — | T−24 h and T−10 min: pump program versions, `Global.create_v2_enabled`, MagicBlock queue health, no Solana feature activation within ±24 h | OPS | SPEC §6.10, §9.4 |
| Rehearsal | — | T−1: mainnet run with a throwaway coin, ≈0.05 SOL | OPS | SPEC §6.10 |
| Support | — | Rota D0–D3; pinned "Admins never DM first" | OPS | SPEC §9.4 |

---

## 18. Off-chain services and UI (OFF)

| Key | Value | Source / rationale |
|---|---|---|
| `XRAY.cacheSeconds` | 86_400 | Results cached 24 h per address |
| `XRAY.rateLimitPerMinutePerIp` | 60 | SPEC §2.1 |
| `XRAY.turnstileAfterRequests` | 10 | Turnstile from the 11th request per IP within the same minute [A] |
| `XRAY.accountsPerBatch` | 100 | `getMultipleAccounts` for BondingCurve PDAs |
| `XRAY.priceIdsPerCall` | 50 | Jupiter Price v3 |
| `XRAY.sellMinLamports` | 2_000_000 | A bag is in the "Sell" bucket when its value (an estimate, in X-ray) ≥ 0.002 SOL |
| `XRAY.priceMaxAgeSlots` | 54_000 | [D7] For X-ray display estimates only ("≈ … SOL est." in the X-ray, its share card, the bot's X-ray reply and the X-ray Blink). An older Price v3 price gives no estimate. ≈4.1 h at the ≈0.274 s per slot measured on 2026-10-08 (D7's "≈6 h" assumed 0.4 s, §24 N7). Every other estimate (Feed panel, My cards and other lists, `/api/values` in `est` mode) keeps X2's `MARKET.price.maxAgeSlots` 13,500 (≈1 h), and executable values never use a Price v3 price |
| `XRAY.maxTokenAccounts` | 2_000 | [A] X1's proposal: a wallet with more token accounts gets `wallet_too_large` |
| `XRAY.cacheMaxEntries` | 5_000 | [A] X1's proposal: in-memory cache of scan results |
| Value function | Jupiter Swap V2 `/order` exact-in quote, token → SOL, for the exact amount; capped at real quote reserves × (1 − fee) for curve coins and PumpSwap pools; "—" when it fails. Labelled "≈{x} if sold now" | SPEC §5.3 |
| Estimates (lists and X-ray only) | Price v3 `usdPrice × amount ÷ SOL/USD`, no older than `XRAY.priceMaxAgeSlots` in the X-ray and what reuses its results, or `MARKET.price.maxAgeSlots` in every other list [D7], then capped at `floor(real quote reserves × (10_000 − fee bps) / 10_000)` of the coin's live bonding curve **or** canonical PumpSwap pool (X2 `getExitCap`). No estimate when no cap can be read. Labelled "≈{x} SOL est.", never "if sold now", which is reserved for value-function quotes. **Never an uncapped price × amount, never Jupiter's "liquidity" figure.** Otherwise a bag with no real bid is overstated by orders of magnitude, and these numbers become the X-ray card headline, the bot message and the Blink description | SPEC §5.3 |
| Quote signer | Jupiter Swap V2 `/order`, Developer plan ≥ 10 RPS, separate host and key | SPEC §8.7 |
| Intake evidence: Helius `getTransactionsForAddress` | Helius RPC only (not standard Solana RPC); filters `tokenTransfer: {mint}`, slot bounds, `transactionDetails: "full"` (M2 §11.4). **Plan, as of 2026-10-08:** Helius's English docs (method page, credits page, plans page) state no plan restriction for this method; one localized copy of the method page still says "Developer plan or higher". Metering: 10 credits per 100 full transactions returned (10 minimum), 10 flat for signatures only, failed responses free. **Impact:** the Free plan's 10 RPC requests/s and 1M credits a month cannot carry Stock-Up's Feed traffic (one Feed request can need two lookups per mint), so the intake signer's own Helius key is on Developer ($49/month, 50 requests/s, 10M credits) or higher: master F10. Without the method the signer answers `evidence_unavailable` and Feed is closed in practice (M2 Appendix 4). S6 measures cost and latency | [EXT] helius.dev/docs (`rpc/gettransactionsforaddress`, `billing/credits`, `billing/plans`), read 2026-10-08 |
| Service timings, limits and landing | `SERVICES` block, §26.1 (M2) | [A] |
| Web timings, limits, logo hosts, swap allow-list | `WEB` block, §26.2 (M3) | [A], [EXT] |
| "Machine today" estimate | `p_day = pulls_24h ÷ deck_len`; expected royalty = `n_cards × p_day × avg_royalty_24h`, with `avg_royalty_24h` = 2% × count-weighted mean pack price of the last 24 h. Copy says "if pulled", never "earn", "yield" or "guaranteed" | SPEC §2.2 |
| `UI.keepBalanceWarningLamports` | 10_000_000 | "Keep 0.01 SOL to redeem or sell later." |
| `UI.stillCrankingAfterSeconds` | 5 | Reveal: "Still cranking. The draw is on-chain." The refund offer appears at `VRF.timeoutSeconds` (300) |
| `UI.tickerMaxChars` | 10 | 1% TV tickers sanitized to `[A-Z0-9]` |
| `BOT.sessionTtlSeconds` | 600 | Deep-link sessions: single use, carry the intended action only |
| `BOT.maxMessagesPerSecond` | 25 | Telegram caps bulk at about 30/s |
| `BOT.hitPostMinKind` | `holo` | Hit posts only for Holo Foil and up |
| `BOT.maxMessageLines` | 6 | DA §12 format |
| `BLINKS.liveNumbersMaxAgeSeconds` | 60 | Images show "as of HH:MM UTC" |
| `BLINKS.ripQuantities` | 1, 5 | `/api/actions/rip/{edition}?n=1\|5`. No holder attestation in Blinks |
| `BLINKS.imagePx` | 1080 | 1080 × 1080 |
| `MONITOR.feeInSilenceAlertSeconds` | 600 | Alert if FeeIn receives nothing for 10 min while $1PCT volume > 0 |
| Invariant monitor | Per mint `vault ≥ accounted`; tracked SOL ≤ Machine lamports − rent; Deck length vs reservations; VRF p50/p95, expiries and queue occupancy (§15); settle backlog; executor slippage vs `min_out`, and stock trades against the hourly caps (§8.1). Pages the guardian | SPEC §8.7 |

---

## 19. Public figures (computed from config, never typed)

| Figure shown | Computation | Value |
|---|---|---|
| "Value back ≈77% at stocked value" | `PACK_SPLIT_BPS.stock + PACK_SPLIT_BPS.jackpot` | 7,700 bps |
| "≈62.5% in SOL if you sell back every foil hit ✳ plus the Jackpot in $1PCT" [C28] | `floor(SELL_BACK.payoutBps × PACK_SPLIT_BPS.stock / 10_000)` = 6,264 bps, **rounded down to 0.5 pt** for display [A] | 62.5% (6,250 bps). The Jackpot is not in it: it is paid in $1PCT, cannot be sold back, and its SOL value floats. Sell back pays 87% of min(stocked value, quote), so a lower quote pays less |
| "Holo 1 in 50 ✳ Black 1 in 400 ✳ Blue ≈1 in 8.8" | `10⁹ / ppb` | §4.3 |
| "A win every ≈7 packs" | `10⁹ / (blue + holo + black + jackpot + onepct)` | 7.07–7.31 (§4.5) |
| "Jackpot: price ÷ 400 SOL ✳ The 1%: price ÷ 1,000 SOL, ×1.5 for holders" | divisors | §4.2 |
| "Feedable ✳ 0.002–0.02 SOL when it's pulled" | OG and AH royalties. A Dust Card pays its depositor once, when it is pulled | 2,000,000 – 20,000,000 lamports |
| X-ray card: "{n} feedable ✳ {m} to check at Feed ✳ {k} have a bid ≈{x} SOL est." | `n`: bags that pass the hard checks and were held at `S`. `m`: `XrayResult.counts.checkAtFeed` [D8], the bags that pass the hard checks but whose snapshot status is unknown or unchecked, shown only when `m > 0` (per bag: "Final check when you Feed"). `x`: the sum of capped estimates, each no older than `XRAY.priceMaxAgeSlots` [D7] (§18). Zero segments are omitted. Schema [D8]: every bag carries `bags[].reasonCode`, a public and stable code; `amountUi` and `decimals` are null only for a not-in-set bag whose `reasonCode` is `mint_missing`, `mint_unparseable` or a failed mint-safety code. X3 and the web mirror X1's schema | per scan |
| Feed pre-sign, first card of a new coin: "The first card of a new coin also pays ≈{x} SOL for that coin's vault; it comes back to you when that coin's vault is empty." (COPY `feed.deposits.newCoin.*`) | `x` = `rent(ACCOUNT_SIZES.vaultToken2022` or `vaultSpl) + rent(ACCOUNT_SIZES.mintLedger)`, from `getMinimumBalanceForRentExemption` at tap time, shown with `solCost` (master §11.4 M3.2). Back to the ledger's payer at `close_vault` (§16.2) | 2,570,480 (Token-2022) / 2,545,080 (SPL) lamports at 5,080 per byte, ≈0.0026 SOL |
| Feed button: "Feed {b} bags · {t} transactions, {a} approval(s)" | `t` from the transaction builder (§16.3); `a = ceil(t / TX_LIMITS.txPerSignAll)`. Never "1 approval" for more than 8 transactions | per Feed |
| Live The 1% EV per pack, "+6.9 pts at today's $1PCT liquidity" | card executable value ÷ 1,000 SOL | live |
| Sell back line | "Sell back pays 87% of the card's value, never more than 87% of what the machine paid for it." | `payoutBps` |
| Realized RTP per edition | from events, on the Live page next to the design figures | live |

If a value ever changes (for example the Sell back rate), every figure above follows it, because none is typed by hand.

---

## 20. Cross-chain intake (post-launch track X4; its `CROSSCHAIN` block lives in `packages/config/src/crosschain.ts`)

| Parameter | Value | Source |
|---|---|---|
| Chains | Robinhood Chain (4663), BNB Chain (56), Base (8453) | SPEC §12 |
| Provider | Relay; fallbacks LI.FI (BSC, Base, `denyBridges=relaydepository`) and, for Robinhood Chain, KyberSwap → USDG then NEAR 1Click or LI.FI → Layerswap (v1.1, flag) | SPEC §12 |
| Our app fee (`CROSSCHAIN.appFeeBps`) | **50 bps** (founder approved C24 on 2026-10-08, see `DECISIONS.md` D2), to the team through Relay `appFees`, on its own fee line, paid in USDC to `CROSSCHAIN_APP_FEE_RECIPIENT`. Tests assert `fee == String(appFeeBps)`, never a literal. The X4 PR merges once its own gate passes [D2] | SPEC §12; [C24] |
| Slippage | 300–1,000 bps, never 3,500 | SPEC §12 |
| Excluded | Total sell tax > 5% (500 bps), honeypots, graduating curves, no-route tokens | SPEC §12 |
| Minimum bag | Robinhood Chain ≈$3 (greyed out under $1 net); BSC ≈$5 plus tax; Base ≈$3 | SPEC §12 |
| Default selection | Bags with net ≥ $3, up to 10 | SPEC §12 |
| Relay quota | Default 50 quotes/min; request 10/s before launch | SPEC §12 |
| Approvals | Exact amounts only, never infinite | SPEC §12 |

Foreign bags are sold and bridged to SOL. They never become Dust Cards.

---

## 21. Addresses (verified on 2026-10-08)

| Key | Value | Verified |
|---|---|---|
| `PROGRAM_IDS.pumpFun` | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Mainnet RPC: upgradeable program |
| `PUMP_LAYOUTS.bondingCurveSeed` / `bondingCurveDiscriminatorHex` | `bonding-curve` / `17b7f83760d8ac60` | SPEC §3.2; spike 1 re-checks |
| `PROGRAM_IDS.pumpSwap` | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | Mainnet RPC: upgradeable program |
| `PUMP_LAYOUTS.poolSeed` / `poolDiscriminatorHex` | `pool` (PDA `["pool", 0u16, pool_authority(mint), mint, wSOL]`) / `f19a6d0411b16dbc` | SPEC §5.2; spike 4 re-checks |
| `PROGRAM_IDS.magicblockVrf` | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` | Mainnet RPC: upgradeable program. Pin the program id only, never its ProgramData deploy slot (redeployed 2026-09-19) |
| `VRF_QUEUES.mainnetShared` | `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` | Mainnet and devnet: owned by the VRF program, 30,000 B |
| `VRF_QUEUES.devnetTest` | `GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb` | Devnet: owned by the VRF program, 9,500 B (absent on mainnet) |
| `PROGRAM_IDS.splToken` / `token2022` | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` / `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Mainnet RPC |
| `PROGRAM_IDS.associatedToken` | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | Mainnet RPC |
| `PROGRAM_IDS.ed25519` / `memo` / `computeBudget` | `Ed25519SigVerify111111111111111111111111111` / `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` / `ComputeBudget111111111111111111111111111111` | Mainnet RPC |
| `PROGRAM_IDS.squadsV4` | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` | Historical tooling constant; not part of the D31 mainnet deployment |
| `WSOL_MINT` | `So11111111111111111111111111111111111111112` | Mainnet RPC: SPL mint |
| `PROGRAM_IDS.pythReceiver` (CONST, `ONCHAIN_KEYS`, M2 B10) | `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`, the upgraded ("pro-compatible") Pyth Solana Receiver. The legacy receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` is not used | Pyth docs "Upgraded contracts → Solana" (docs.pyth.network/price-feeds/core/upgrade/contracts, read 2026-10-08): Core upgrade completed 2026-08-26, and Pyth recommends the upgraded contracts for new integrations. Same id as `PRO_COMPATIBLE_RECEIVER_PROGRAM_ID` in pyth-crosschain `target_chains/solana/sdk/js/pyth_solana_receiver/src/address.ts`, and the `declare_id!` of `pyth_solana_receiver_sdk` 1.2.0 under feature `pro-compatible`. Mainnet read 2026-10-08 20:08 UTC: owner of the six sponsored accounts of §21.1 |
| `PROGRAM_IDS.pythPushOracle` (EXT, off-chain only) | `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou` (upgraded "price feed" program; legacy `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` not used) | Same sources. Derives the sponsored accounts (§21.1) |
| `PROGRAM_IDS.pythWormholeReceiver` (EXT, off-chain only) | `HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL` (upgraded; legacy `HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ` not used) | Same sources. The keeper's poster verifies VAAs with it (§21.1) |
| `HIT_LIST.solUsdPythFeedId` | `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | Pyth Hermes. Sponsored account under the upgraded push oracle: `7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE` (§21.1). Issue 2's `7UVimff…` is the legacy one |
| `WEB.jupiterProgramIds` (EXT, §26.2) | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`, Jupiter Aggregator v6 | Jupiter's own docs repo (jup-ag/docs, read 2026-10-08; it is the source of developers.jup.ag): `openapi-spec/swap/v2/swap.yaml` says Swap API V2 `/build` "Routing is Metis only"; `swap/routing/rfq/v2/streaming.mdx` says Metis routes execute "through the Jupiter v6 swap aggregator program (`JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`)"; the docs link that program's IDL. V2 `/build` uses its V2 routing instructions in the same program. `/order` can also route through JupiterZ, Dflow or OKX, so only `/build` swaps pass the allow-list |

Launch MAJOR set (`HIT_LIST.launchMajors`). All five are SPL Token mints with mint and freeze authority disabled and are verified on Jupiter (Tokens API v2, 2026-10-08). Feed ids are from Pyth Hermes.

| Symbol | Mint | Decimals | Pyth feed id | Jupiter liquidity on 2026-10-08 |
|---|---|---|---|---|
| WIF | `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm` | 6 | `4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc` | ≈$6.3M |
| BONK | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | 5 | `72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419` | ≈$5.2M |
| POPCAT | `7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr` | 9 | `b9312a7ee50e189ef045aa3c7842e099b061bd9bdc99ac645956c3b660dc8cce` | ≈$4.3M |
| FARTCOIN | `9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump` | 6 | `58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608` | ≈$6.0M |
| PNUT | `2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump` | 6 | `116da895807f81f6b5c5f01b109376e7f6834dc8b51365ab7cdfa66634340e54` | ≈$3.3M |

The listing script re-checks every bar (§8.2) at listing and daily. These addresses are inputs to `admin_*` instructions; the program never trusts them from config at runtime.

### 21.1 Pyth price accounts and the posting rule (web and mainnet check, 2026-10-08)

**Conventions** (pyth-crosschain `getPriceFeedAccountForProgram`; Pyth docs: sponsored addresses are "the price feed account for shard 0"):
- A push-feed account is the PDA `[shard_id u16 LE, feed_id (32 B)]` of `PROGRAM_IDS.pythPushOracle`. Sponsored feeds use shard 0. Its data is a `PriceUpdateV2` owned by `PROGRAM_IDS.pythReceiver`: 134 B, discriminator `22f123639d7ef4cd`, verification tag @40 = 1 (Full), `feed_id` @41, `price` @73, `conf` @81, `exponent` @89, `publish_time` @93. These are the offsets of `02-M2-BRIEF.md` §6.4; they decoded all six accounts below.
- Pyth's sponsored update parameters (docs, read 2026-10-08): 55 s heartbeat and 0.5% deviation for 61 feeds, 30 s for two, 3 min for one. A 55 s heartbeat sits just under the program's 60 s bound (`STOCK.pythMaxAgeSeconds`).

**The six launch feeds** (shard 0, upgraded push oracle; two mainnet reads, 2026-10-08 20:08 and 20:12 UTC; all Full-verified, confidence 1.8–8.1 bps):

| Feed | Sponsored account | Age at the two reads | Usable for the 60 s bound |
|---|---|---|---|
| SOL/USD | `7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE` | 7 s, 5 s | yes |
| WIF/USD | `9Sn9FVu6WpufA8yZFSRuxYyFgpBrhc5PpTgB3mq2DcsG` | 8 s, 34 s | yes |
| BONK/USD | `3nMpgBXnjBSDYupQQEVR7DZM65zkJCdKy1Up7nkqp99w` | 34 s, 8 s | yes |
| POPCAT/USD | `AyAMTHfsQVnXvNnHMqpaQo5sEpWSszoeqjEmdoEv1U9a` | 149 s, 118 s | no: about a 3-minute cadence |
| FARTCOIN/USD | `65g8gPGkHH5Ss5YPJNCxRAa9dnvp37khzeY7tbbe3ntw` | 13 s, 40 s | yes |
| PNUT/USD | `4Ah59WNbes7N6U8g9auxBCuRWVvwtybnxaTj3yMPwxEQ` | ≈21 h | no: not maintained |

The legacy (`pythWSnsw…`) accounts of POPCAT and PNUT were 51 and 192 days old; the other four legacy accounts were still updated.

**The architect's rule (binding from this issue):**
1. Use the sponsored accounts. Pass a MAJOR trade's two accounts only when each is Full-verified and no older than `SERVICES.stock.pythSkipAgeSeconds` (45 s).
2. When a sponsored account is older, or not maintained (POPCAT and PNUT today), the keeper posts its own update with a **hand-built poster**, then trades against it: Hermes `v2/updates/price/latest` for the feed (REST with zod-typed `fetch`, `MARKET.pyth`, the Hermes API key) → the Wormhole receiver's encoded-VAA path (`init_encoded_vaa`, `write_encoded_vaa`, `verify_encoded_vaa_v1`) → the receiver's `post_update` into a keeper-owned `PriceUpdateV2` account (Full) → the exec transaction passes that account → `reclaim_rent`. The program check is unchanged: owner `PROGRAM_IDS.pythReceiver`, the bucket's `feed_id`, Full, age ≤ 60 s, confidence ≤ 1%. `post_update_atomic` with a trimmed VAA yields `Partial`, which `02-M2-BRIEF.md` §6.4 rejects.
3. **No exception for `@pythnetwork/pyth-solana-receiver`.** Version 0.16.0 depends on `@coral-xyz/anchor ^0.29`, which master §0.3 B excludes. This supersedes the exception path of `02-M2-BRIEF.md` §3, §12.3 and its Appendix question 1.
4. S4 still records the fixtures (one sponsored and one keeper-posted account per feed) and the instruction layouts of the encoded-VAA path; a layout it cannot confirm is a stop-and-report.

---

## 22. Changes vs 00-M0-SCAFFOLD.md §6

Codex applies this section at the start of M1, in the same PR as the first M1 change.

### 22.1 Values that change

| M0 key | M0 provisional value | M1 value | Why |
|---|---|---|---|
| `HIT_ODDS` | `null` (TODO M1) | The calibrated object in §22.4 (Black 2_500_000; Holo 20_000_000; Blue per edition 113_925_000 / 114_187_500 / 114_625_000 / 115_500_000; divisors 400 / 1_000 / 500) | §4 |
| `SELL_BACK.quoteTtlSeconds` | `60` | `{ major: 60, trending: 20 }` | §9: TRENDING quotes expire after 20 s [C26], kept by the founder [D5] |
| `FEED_RULES.minHoldSeconds` | `72 * 3600` | **Removed**, replaced by `holdRule: 'snapshot'` (snapshot slot `S` in Config) | [C1] §6 |
| `FEED_RULES.maxCardsPerWallet` | `null` (TODO M1) | **Renamed** `freshCapPerWallet: 25` (fresh cards per wallet in the Deck at a time; re-fed cards exempt) | [C1] §6 |
| Block comments | `// PROVISIONAL — from MODEL.md 2026-10-08` | `// CALIBRATED — docs/codex/PARAMS.md 2026-10-08`, plus the `[C#]` tag where §23 applies | — |

### 22.2 Unchanged (do not touch)

`PACK_EDITIONS` ids, names and `priceLamports`; `CARDS_PER_PACK`; every `PACK_SPLIT_BPS` value; `HIT_TIERS` ids, labels and `valueBps`; `SELL_BACK.payoutBps` 8_700; `SEASON.durationDays` 7; every M0 field of `TOKEN_1PCT` (decimals 6, totalSupply, devBuyBps 400, onePctCardAmount, onePctCardCount 4, teamAllocation 0n, holderTier.minBalance, holderTier.onePctOddsMultiplierBps 15_000); `FEED_RULES.launchpads`; `FEED_RULES.oneCardPerWalletPerMint` (comment it: fresh cards only).

### 22.3 Fields and blocks added

- Fields added to M0 blocks: `PACK_EDITIONS[].index`, `.code`, `.maxPerRip`; `HIT_TIERS[].majorOnly`, `.sellBack`; `SELL_BACK.solFloorLamports`, `.hourlyBudgetMinLamports`, `.hourlyBudgetBpsOfStockSol`, `.eligibleKinds`; `SEASON.durationSeconds`, `.onAirDelaySeconds`, `.lastCallSeconds`, `.finalPullDelaySeconds`, `.sealDelaySeconds`; `TOKEN_1PCT.name`, `.symbol`, `.tokenProgram`, `.devBuyAmount`, `.onePctReleaseOffsetsSeconds`, `.holderTier.continuousHoldSeconds`; `FEED_RULES.holdRule`, `.maxMintDecimals`, `.allowedToken2022Extensions`, `.sellDefaultAboveLamports`, `.confirmAboveLamports`.
- New blocks: units and rent, `MAX_LIST_PER_RIP_LAMPORTS`, `CARD_KINDS`, `DRAW_TAGS`, `COVERAGE`, `ATTESTATIONS`, `STOCK`, `JACKPOT`, `SPOTLIGHT`, `BURN`, `CREATOR_FEE_SPLIT_BPS`, `VRF`, `ACCOUNT_SIZES`, `PAUSE_BITS`, `GOVERNANCE`, `KEEPER_POLICY`, `EXECUTOR_POLICY`, `TX_LIMITS`, `HIT_LIST`, `XRAY`, `INTAKE`, `BOT`, `BLINKS`, `UI`, `MONITOR`, `PROGRAM_IDS`, `WSOL_MINT`, `VRF_QUEUES`, `PUMP_LAYOUTS`.
- Issue 3 adds `PROGRAM_IDS.pythReceiver`, `.pythPushOracle` and `.pythWormholeReceiver` (§21). There is no dedicated VRF queue [D6]. Cross-chain values (§20) belong to X4's own file. The `SERVICES` and `WEB` blocks and their checks are in §26.
- Extend the zod schema to every new block. Add the `pnpm params:rs` generator and its CI drift check (§0.3).
- **Clean checkout.** Give `@onepercent/config` the same export map as `@onepercent/sdk`: `"types": "./src/index.ts"`, `"development": "./src/index.ts"`, `"import": "./dist/index.js"`. Run the `params:rs` generator through `tsx` on `packages/config/src`. Then `pnpm params:rs --check` and `pnpm typecheck` pass on a clean checkout before any `pnpm build`.
- **Word lists.** Add `src/vocabulary.ts`, exporting the word lists of `AGENTS.md` once. `pnpm lint:words` excludes only that file (with lockfiles and `target/`), and every vocabulary test imports the lists from it instead of retyping them.

### 22.4 Target content of the parameters module in `app/packages/config`

This replaces the M0 §6 constants in whichever file M0 put them. Apply it as written. If strict TypeScript needs a type annotation, add it without changing a value. The tag after each block is its "Where". The block passes `pnpm lint:words` as written: no comment uses a word from the `AGENTS.md` lists.

```ts
// CALIBRATED — docs/codex/PARAMS.md (2026-10-08). Tags: [CONST] compiled into the program
// (generated params.rs) · [CONFIG] on-chain Config field · [STATE] on-chain Machine state
// · [OFF] off-chain only · [EXT] external fact. Untagged keys inherit their block's tag.

// ── Units ─────────────────────────────────────────────────────────── [CONST]
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const BPS_DENOMINATOR = 10_000;
export const PPB_DENOMINATOR = 1_000_000_000;
// [OFF] examples and tests only. Code reads the Rent sysvar / getMinimumBalanceForRentExemption.
export const RENT_EXAMPLE_LAMPORTS_PER_BYTE = 5_080;
export const RENT_TEST_RATES_LAMPORTS_PER_BYTE = [5_080, 2_575, 1_322, 696, 6_960] as const;

// ── Editions ─────────────────────────────────────────────────────── [CONST]
// M0 values unchanged; index, code, maxPerRip added.
export const PACK_EDITIONS = [
  { index: 0, id: 'original', code: 'OG', name: 'The Original', priceLamports: 100_000_000n, maxPerRip: 10 },
  { index: 1, id: 'blue_shift', code: 'BS', name: 'Blue Shift', priceLamports: 250_000_000n, maxPerRip: 10 },
  { index: 2, id: 'signature', code: 'SG', name: 'Signature', priceLamports: 500_000_000n, maxPerRip: 10 },
  { index: 3, id: 'after_hours', code: 'AH', name: 'After Hours', priceLamports: 1_000_000_000n, maxPerRip: 5 },
] as const;
export type EditionId = (typeof PACK_EDITIONS)[number]['id'];
export const MAX_LIST_PER_RIP_LAMPORTS = 5_000_000_000n; // maxPerRip × price ≤ this (one VRF request)

export const CARDS_PER_PACK = { dust: 4, hit: 1 } as const;

// Split of every pack price, in bps. Sums to 10_000. On-chain, stock = price − all other lines.
export const PACK_SPLIT_BPS = {
  stock: 7_200,
  royaltyPerDustCard: 200, // ×4; a House Card's 2% goes to the stock [C10]
  jackpot: 500, // → jackpot_sol, converted continuously into the $1PCT pot [C12, J-B]
  burn1pct: 500,
  referral: 200, // to the team if no referrer or the referrer can't be credited [C16]
  team: 800,
} as const;

// ── Hits and card kinds ──────────────────────────────────────────── [CONST]
export const HIT_TIERS = [
  { id: 'silver', label: 'Silver Foil', valueBps: 5_000, majorOnly: false, sellBack: true },
  { id: 'blue', label: 'Blue Foil', valueBps: 15_000, majorOnly: false, sellBack: true },
  { id: 'holo', label: 'Holo Foil', valueBps: 40_000, majorOnly: true, sellBack: true }, // [C5]
  { id: 'black', label: 'Black Foil', valueBps: 150_000, majorOnly: true, sellBack: true }, // [C5]
] as const;
// On-chain card kind = index in this array (u8).
export const CARD_KINDS = ['dust', 'silver', 'blue', 'holo', 'black', 'jackpot', 'one_pct', 'spotlight', 'final'] as const;

// ── Odds (ppb of t ∈ [0, 1e9)) ───────────────────────────────────── [CONST]
export const HIT_ODDS = {
  blackPpb: 2_500_000, // 1 in 400, every edition
  holoPpb: 20_000_000, // 1 in 50, every edition
  bluePpb: { original: 113_925_000, blue_shift: 114_187_500, signature: 114_625_000, after_hours: 115_500_000 },
  jackpotPriceDivisor: 400, // jackpot_ppb = priceLamports / 400, only while live [C13]
  onePctPriceDivisor: 1_000, // onepct_ppb = priceLamports / 1_000, only while a card is live [C13]
  spotlightPriceDivisor: 500, // spotlight_ppb = priceLamports / 500, only during a live drop [C20]; never live in Season 1 [D1]
  // Walk order; Silver = 1e9 − Σ live segments.
  walkOrder: ['one_pct', 'spotlight', 'jackpot', 'black', 'holo', 'blue'],
  calibratedStockEvBps: 7_200, // Σ valueBps·ppb == 7_200·1e9 with Jackpot and The 1% live, non-holder
} as const;

export const DRAW_TAGS = {
  tier: '1pct:tier:v1',
  dust: '1pct:dust:v1',
  bucket: '1pct:bucket:v1',
  vrfSeed: '1pct:vrf:v1',
  royaltyMemoPrefix: '1pct:roy:',
} as const;

// ── Coverage and Deck ────────────────────────────────────────────── [CONST]
export const COVERAGE = {
  perPackValueBps: 150_000, // free MAJOR book reserved per pending pack = 15 × price (Black Foil) [C8]
  dustBuffer: 50, // buy_packs needs deck.len − reserved_dust ≥ 4·qty + 50 [C10]
  deckMax: 120_000, // Deck entries
} as const;

// ── Feed ─────────────────────────────────────────────────────────── [CONST] unless tagged
export const FEED_RULES = {
  launchpads: ['pump.fun'],
  holdRule: 'snapshot', // [C1] was minHoldSeconds: 72 * 3600 — snapshot slot S lives in Config (PARAMS §6–§7)
  oneCardPerWalletPerMint: true, // fresh cards only; re-fed cards are exempt
  freshCapPerWallet: 25, // [C1] was maxCardsPerWallet: null
  maxMintDecimals: 9,
  allowedToken2022Extensions: ['MetadataPointer', 'TokenMetadata'],
  sellDefaultAboveLamports: 2_000_000n, // [OFF] Sell is the default above 0.002 SOL
  confirmAboveLamports: 20_000_000n, // [OFF] explicit confirmation above 0.02 SOL (bags and hits)
} as const;

export const ATTESTATIONS = {
  feedTtlSeconds: 120,
  holdTtlSeconds: 600, // [C15]
  feedDomain: '1PCT-FEED-v1',
  holdDomain: '1PCT-HOLD-v1',
  sellBackDomain: '1PCT-SB-v1',
} as const;

// ── Stock (on-chain bounds) ──────────────────────────────────────── [CONST]
export const STOCK = {
  maxBuckets: 16,
  targetBaseLamports: 30_000_000_000n, // [C7] Sell back target = this + hit_out_last_hour
  creatorFeeFloorLamports: 2_000_000_000n, // [D27] independent of the Sell back target
  majorTrancheMaxLamports: 5_000_000_000n,
  majorMinOutSlipBps: 150, // vs Pyth
  trendingTrancheMaxLamports: 1_500_000_000n,
  trendingHourlyMaxLamports: 10_000_000_000n, // per mint per clock hour; buys and sells counted separately [C25]
  trendingShareMaxBps: 1_500, // [C5] of stock book value, after the buy
  trendingMaxCount: 4, // [C5]
  trendingPoolFeeAllowanceBps: 125,
  trendingMinOutSlipBps: 100, // after the fee allowance
  pythMaxAgeSeconds: 60,
  pythMaxConfBps: 100,
  tradeMinSpacingSeconds: 20, // [C25] one last_stock_trade_ts shared by StockBuy and StockSell
  hourlyFloorLamports: 30_000_000_000n, // [C25] per clock hour, StockBuy and StockSell each: cap = max(this, multiple × carved)
  hourlyHitOutMultiple: 2, // [C25] carved = max(hit_out_last_hour, hit_out_this_hour); MAJOR sells skip the cap in BuysClosed
} as const;

// ── Sell back / Sell at market ───────────────────────────────────── [CONST] / [OFF]
export const SELL_BACK = {
  payoutBps: 8_700, // [C2] of min(Σ card.value, quote)
  quoteTtlSeconds: { major: 60, trending: 20 }, // [C26] was quoteTtlSeconds: 60
  solFloorLamports: 1_000_000_000n, // [C2]
  hourlyBudgetMinLamports: 5_000_000_000n, // [C2]
  hourlyBudgetBpsOfStockSol: 2_500, // [C2] of stock_sol at the start of the clock hour
  eligibleKinds: ['silver', 'blue', 'holo', 'black'], // [C3]
} as const;


// ── Jackpot: continuous pre-buy ──────────────────────────────────── [CONST] [C12, J-B]
export const JACKPOT = {
  minPotPriceMultiple: 15, // live in edition E iff jackpot_cost ≥ 15 × price(E)
  trancheMaxLamports: 2_000_000_000n, // JackpotBuy tranche ≤ min(jackpot_sol, this, 1% of quote reserves)
  trancheMaxBpsOfQuoteReserves: 100,
  trancheMinSpacingSeconds: 20,
  minOutSlipBps: 100,
} as const;

// ── Token $1PCT and The 1% ───────────────────────────────────────── [CONST] unless tagged
export const TOKEN_1PCT = {
  name: 'Onepercent', // [OFF] D29 Meteora DBC metadata
  symbol: '1PCT', // [OFF]
  tokenProgram: 'spl-token', // [OFF] D29
  decimals: 6,
  totalSupply: 1_000_000_000_000_000n, // [OFF] 1B × 10^6
  devBuyBps: 400, // [OFF]
  devBuyAmount: 40_000_000_000_000n, // 40M × 10^6, all to The 1% cards
  onePctCardAmount: 10_000_000_000_000n, // 10M × 10^6
  onePctCardCount: 4,
  onePctReleaseOffsetsSeconds: [0, 151_200, 302_400, 453_600], // [C14] after on_air_ts: 0 / 42 / 84 / 126 h
  teamAllocation: 0n, // [OFF]
  holderTier: {
    minBalance: 1_000_000_000_000n, // [OFF] attester: ≥ 1M $1PCT
    continuousHoldSeconds: 86_400, // [OFF] [C15] attester: held continuously for 24 h
    onePctOddsMultiplierBps: 15_000, // ×1.5 on the The 1% segment
  },
} as const;

// ── Spotlight (flag) ─────────────────────────────────────────────── [CONST] unless tagged [C20]
export const SPOTLIGHT = {
  enabledAtLaunch: false, // [OFF] not in Season 1 [D1]: no slot, no deposit, the segment is never live
  windowSeconds: 86_400,
  minDepositBpsOfSupply: 100, // ≥ 1% of the mint's supply, measured as a vault delta
  lineupNoticeSeconds: 86_400, // [OFF]
} as const;

// ── Buy & burn ───────────────────────────────────────────────────── [CONST]
export const BURN = {
  trancheMaxLamports: 1_000_000_000n,
  trancheMaxBpsOfQuoteReserves: 25,
  minSpacingSeconds: 20,
  hourlyMaxLamports: 10_000_000_000n, // per clock hour
  minOutSlipBps: 150,
} as const;

// ── Creator fees (bps of each creator-fee collection) ────────────── [CONST] [C7] [C21]
export const CREATOR_FEE_SPLIT_BPS = {
  belowFloor: { stock: 10_000, burn: 0, team: 0 },
  season: { stock: 5_000, burn: 0, team: 5_000 },
  afterEnd: { stock: 0, burn: 0, team: 10_000 },
} as const;

// ── Season ───────────────────────────────────────────────────────── [CONST] unless tagged
export const SEASON = {
  durationDays: 7, // [OFF]
  durationSeconds: 604_800,
  onAirDelaySeconds: 900, // [C18]
  lastCallSeconds: 86_400, // [OFF] countdown only
  finalPullDelaySeconds: 600,
  sealDelaySeconds: 259_200, // [C23]
} as const;

// ── VRF ──────────────────────────────────────────────────────────── tagged per key
export const VRF = {
  timeoutSeconds: 300, // [CONST] [C22]
  feeLamports: 500_000n, // [EXT] MagicBlock base-layer fee; buyer pays once per Rip; not refunded
  maxQueues: 4, // [CONFIG] allow-list length
  busyOccupancyBps: 8_000, // [OFF] client disables Rip above 80% occupancy
  busyOldestItemSeconds: 20, // [OFF] or when the oldest item is older than this
} as const;

// ── Accounts (data bytes; rent = (128 + n) × Rent sysvar rate) ───── [CONST]
export const ACCOUNT_SIZES = {
  deckHeader: 64,
  deckEntry: 80,
  binderHeader: 112,
  cardSlot: 56,
  pullHeader: 176,
  pullPerPack: 200,
  mintLedger: 80,
  accountOverhead: 128, // [EXT] added to every account for rent
  vaultSpl: 165, // [EXT] SPL token account
  vaultToken2022: 170, // [EXT] Token-2022 ATA (ImmutableOwner)
} as const;

// ── Governance ───────────────────────────────────────────────────── [CONST] encodings, [CONFIG] values [C23]
// stockBuy pauses StockBuy and StockSell; burn pauses Burn and JackpotBuy. No exit reads a bit.
export const PAUSE_BITS = { rip: 1, feed: 2, sellBack: 4, stockBuy: 8, burn: 16 } as const;
export const GOVERNANCE = {
  maxTeamWallets: 8, // [CONFIG] Config.team_wallets length
  guardianCount: 2, // [CONFIG]
  multisigThreshold: 1, // [OFF] D31: one founder wallet
  multisigMembers: 1, // [OFF] D31
  timelockSeconds: 0, // [OFF] D31: no timelock
} as const;

// ── Off-chain policy ─────────────────────────────────────────────── [OFF]
export const KEEPER_POLICY = {
  cycleSecondsMin: 60,
  cycleSecondsMax: 120,
  anchorMultipleOfTopBlack: 2, // largest-free MAJOR keeps ≥ 2 × 15 × price(largest edition the stock can open)
  inventoryTargetMinutes: 30,
  solReserveExtraMinutes: 15, // stock_sol ≥ SELL_BACK.solFloorLamports + 15 min of recent Sell back outflow
  revealDelaySecondsMin: 30,
  revealDelaySecondsMax: 120,
  maxQuotedImpactBps: 50,
  creatorFeeCollectSecondsMin: 120, // also right before PoweredOn→OnAir and in the last minute before end_ts
  creatorFeeCollectSecondsMax: 300,
} as const;
export const EXECUTOR_POLICY = { jackpotTrancheSpacingSecondsMin: 20, jackpotTrancheSpacingSecondsMax: 60 } as const;

export const TX_LIMITS = {
  feedBagsPerTx: 2, // PENDING M1 measurement (PARAMS §16.3): M1 writes the measured value
  feedBagsPerTxWithLookupTable: 3, // PENDING M1 measurement (PARAMS §16.3): M1 writes the measured value
  redeemPerTx: 8,
  takeBackPerTx: 8,
  settlePacksPerTx: 2,
  txPerSignAll: 8,
  byteHeadroomBps: 1_500,
  maxTxBytes: 1_232,
} as const;

export const HIT_LIST = {
  launchMajors: [
    { symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6, pythFeedId: '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc' },
    { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, pythFeedId: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419' },
    { symbol: 'POPCAT', mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', decimals: 9, pythFeedId: 'b9312a7ee50e189ef045aa3c7842e099b061bd9bdc99ac645956c3b660dc8cce' },
    { symbol: 'FARTCOIN', mint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', decimals: 6, pythFeedId: '58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608' },
    { symbol: 'PNUT', mint: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', decimals: 6, pythFeedId: '116da895807f81f6b5c5f01b109376e7f6834dc8b51365ab7cdfa66634340e54' },
  ],
  solUsdPythFeedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  neverListed: ['PUMP', '1PCT'], // [C4]
  majorBar: { minAgeDays: 90, minLiquidityUsd: 1_000_000, sell150SolMinRecoveryBps: 9_700, maxDailySigmaBps: 1_500 },
  trendingBar: { minGraduatedDays: 7, minPoolQuoteLamports: 300_000_000_000n, minHolders: 5_000, maxTop10Bps: 2_500, minOrganicScore: 50 }, // [C5]
  dailyRecheckUtc: '12:00',
  trendingNoticeSeconds: 86_400,
  capMaxPriceImpactBps: 200,
} as const;

export const XRAY = {
  cacheSeconds: 86_400,
  rateLimitPerMinutePerIp: 60,
  turnstileAfterRequests: 10,
  accountsPerBatch: 100,
  priceIdsPerCall: 50,
  sellMinLamports: 2_000_000n,
  priceMaxAgeSlots: 54_000, // [D7] ≈4 h at ≈0.27 s per slot; X-ray display estimates only (other lists keep MARKET.price.maxAgeSlots)
  maxTokenAccounts: 2_000, // more → wallet_too_large
  cacheMaxEntries: 5_000, // in-memory scan results
} as const;

// FEED and HOLD attestation requests, Feed Blink included. Signing has no side effect (PARAMS §6.2).
export const INTAKE = { rateLimitPerMinutePerWallet: 30, rateLimitPerMinutePerIp: 60 } as const;

export const BOT = { sessionTtlSeconds: 600, maxMessagesPerSecond: 25, hitPostMinKind: 'holo', maxMessageLines: 6 } as const;
export const BLINKS = { liveNumbersMaxAgeSeconds: 60, ripQuantities: [1, 5], imagePx: 1_080 } as const;
export const UI = {
  keepBalanceWarningLamports: 10_000_000n,
  stillCrankingAfterSeconds: 5,
  tickerMaxChars: 10,
} as const;
export const MONITOR = {
  feeInSilenceAlertSeconds: 600,
  vrfExpiriesPerThousandRipsAlert: 1,
  vrfQueueOccupancyAlertBps: 5_000, // alert above 50%, before the client's 80% "Machine busy"
} as const;

// ── Addresses (verified on mainnet 2026-10-08) ───────────────────── [CONST]/[EXT]
export const PROGRAM_IDS = {
  pumpFun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  pumpSwap: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  magicblockVrf: 'Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz',
  splToken: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  associatedToken: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  ed25519: 'Ed25519SigVerify111111111111111111111111111',
  memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
  squadsV4: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
  pythReceiver: 'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp', // upgraded receiver; in ONCHAIN_KEYS (M2 B10)
  pythPushOracle: 'pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou', // [EXT] off-chain only: sponsored-feed PDAs
  pythWormholeReceiver: 'HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL', // [EXT] off-chain only: the keeper's poster
} as const;
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const VRF_QUEUES = {
  mainnetShared: 'Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh',
  devnetTest: 'GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb',
} as const;
export const PUMP_LAYOUTS = {
  bondingCurveSeed: 'bonding-curve',
  bondingCurveDiscriminatorHex: '17b7f83760d8ac60',
  poolSeed: 'pool',
  poolDiscriminatorHex: 'f19a6d0411b16dbc',
} as const;
```

### 22.5 `validateParams()` additions (keep every M0 test)

1. For every edition: `price % 400 == 0`, `price % 1_000 == 0`, `price % 500 == 0`, and `(price / 1_000) × 15_000 % 10_000 == 0`, so every special segment is an exact integer.
2. Blue: `(price/400 + price/1_000)` is even and `bluePpb[e] == 113_750_000 + (price/400 + price/1_000) / 2`.
3. EV identity, exact in integers: with `silver = 10⁹ − price/1_000 − price/400 − blackPpb − holoPpb − bluePpb[e]`, `5_000·silver + 15_000·blue + 40_000·holo + 150_000·black == 7_200 × 10⁹`.
4. Silver > 0 with every special live for a holder (The 1% ×1.5, Spotlight, Jackpot).
5. `maxPerRip × price ≤ MAX_LIST_PER_RIP_LAMPORTS`; every tier value and royalty is an exact lamport amount for every price.
6. `COVERAGE.perPackValueBps == HIT_TIERS.black.valueBps`; `JACKPOT.minPotPriceMultiple × 10_000 ≥ HIT_TIERS.black.valueBps`.
7. `STOCK.targetBaseLamports == 2 × AH price × black valueBps / 10_000` (30 SOL).
8. Each `CREATOR_FEE_SPLIT_BPS` row sums to 10_000.
9. Release offsets: length 4, first 0, strictly increasing, last < `SEASON.durationSeconds`; `durationSeconds == durationDays × 86_400`.
10. `devBuyAmount == totalSupply × devBuyBps / 10_000 == onePctCardCount × onePctCardAmount`.
11. `FEED_RULES.sellDefaultAboveLamports` and `XRAY.sellMinLamports` equal the OG royalty; `FEED_RULES.confirmAboveLamports` equals the AH royalty.
12. `deckMax × deckEntry + deckHeader ≤ 10_485_760`; `pullHeader + pullPerPack × max(maxPerRip) ≤ 10_240`.
13. `SELL_BACK.payoutBps < 10_000`; `quoteTtlSeconds.trending ≤ quoteTtlSeconds.major`; `eligibleKinds` ⊆ tiers with `sellBack`.
14. `PAUSE_BITS` are distinct powers of two; `launchMajors.length ≤ maxBuckets − trendingMaxCount`.
15. Public figures (§19): value back == 7_700 bps; the displayed cash figure, `floor(payoutBps × stock / 10_000)` rounded down to a multiple of 50 bps, == 6_250 bps [C28].
16. `params.rs` matches a fresh generation (CI).
17. Stock trade bounds [C25]: `tradeMinSpacingSeconds > 0`; `hourlyHitOutMultiple ≥ 1`; `hourlyFloorLamports ≥ targetBaseLamports`; `hourlyFloorLamports ≥ majorTrancheMaxLamports`; `trendingHourlyMaxLamports ≥ trendingTrancheMaxLamports`.
18. Off-chain bounds: `1 ≤ TX_LIMITS.feedBagsPerTx ≤ TX_LIMITS.feedBagsPerTxWithLookupTable`; `INTAKE.rateLimitPerMinutePerWallet ≥ FEED_RULES.freshCapPerWallet`; `INTAKE.rateLimitPerMinutePerIp ≥ INTAKE.rateLimitPerMinutePerWallet`; `MONITOR.vrfQueueOccupancyAlertBps < VRF.busyOccupancyBps`.

The architect ran checks 1–15, 17 and 18 against §22.4 on 2026-10-08: all pass. Issue 3 adds checks 19–22 (§26.5).

---

## 23. Founder decisions (2026-10-08) and the keys they fix

### 23.1 Approved (C1–C23)

The founder approved every SPEC §13 change (C1–C23), decided C12 as option J-B, and kept the recommended default for every open parameter. This table maps each item to the keys it fixes, for audits.

| Item | Decision | Keys in this file |
|---|---|---|
| C1 Snapshot rule and fresh cap | Approved: held at snapshot `S` (swap provenance, one hop); 25 fresh cards per wallet in the Deck | `FEED_RULES.holdRule`, `.freshCapPerWallet`, `Config.snapshot_slot` |
| C2 Sell back value | Approved: 87% × min(stocked value, quote); hourly budget; 1 SOL floor; coin caps; Sell at market otherwise | `SELL_BACK.*` |
| C3 Sell back scope | Approved: Silver to Black only; Jackpot, The 1% and Spotlight cards are never fed | `SELL_BACK.eligibleKinds`, §3.3 |
| C4 Hit list | Approved: WIF, BONK, POPCAT, FARTCOIN, PNUT; PUMP excluded until its transfer-hook authority is renounced | `HIT_LIST.launchMajors`, `.neverListed` |
| C5 Trending coins | Approved: at most 4, Silver and Blue only, ≤ 15% of book, published daily rule | `HIT_TIERS[].majorOnly`, `STOCK.trending*`, `HIT_LIST.trendingBar` |
| C6 Cost-basis value | Approved: a hit's value is what the machine paid; "≈77% at stocked value" | §3.1, §19 |
| C7 Fill-first | Sell back margin stays in stock below target; D27 supersedes the creator-fee rule with a separate 2 SOL floor | `STOCK.targetBaseLamports`, `CREATOR_FEE_SPLIT_BPS`, Sell back margin routing |
| C8 Coverage | Approved: 15 × price reserved per pending pack | `COVERAGE.perPackValueBps` |
| C9 Dust picked in the callback | Approved: a picked card is out | — |
| C10 Short Deck | Approved: 50-card buffer; House Card 2% → stock | `COVERAGE.dustBuffer` |
| C11 Permissionless settle | Approved: a non-creditable payee's 2% → stock | settle rules |
| C12 Jackpot | **Option J-B**: continuous pre-buy in $1PCT, the whole pot delivered at once | `JACKPOT.*` (§10) |
| C13 Per-SOL odds | Approved: price ÷ 400 SOL (Jackpot), price ÷ 1,000 SOL (The 1%) | `HIT_ODDS.jackpotPriceDivisor`, `.onePctPriceDivisor` |
| C14 The 1% release | Approved: 0 / 42 / 84 / 126 h, one at a time, delivered at once; unpulled cards go to the Final Pull | `TOKEN_1PCT.onePctReleaseOffsetsSeconds` |
| C15 Holder ×1.5 | Approved: 24 h continuous hold, signed attestation | `holderTier.continuousHoldSeconds`, `ATTESTATIONS.holdTtlSeconds` |
| C16 Referral | Approved: bound once; unreferred 2% → team | referral binding (§13.2) |
| C17 Final Pull | Approved: pro rata to season spend; Sell back closes at `end_ts` | §14 |
| C18 On Air delay | Approved: 15 min | `SEASON.onAirDelaySeconds` |
| C19 User deposits | Approved: refundable deposits and the 0.0005 SOL draw fee | §16.2, `VRF.feeLamports` |
| C20 Spotlight | Approved: behind a flag, from D3. Then skipped for Season 1 [D1] | `SPOTLIGHT.*`, `HIT_ODDS.spotlightPriceDivisor` |
| C21 Creator fees | FeeIn PDA, no fee sharing; D27 replaces the split with 100% team from BuysClosed | `CREATOR_FEE_SPLIT_BPS`, FeeIn |
| C22 VRF timeout | Approved: full refund after 300 s; never re-requested; no automatic pause | `VRF.timeoutSeconds` |
| C23 Governance | Exits never pausable; upgrade authority removed at Final Pull + 72 h. Historical 12 h timelock and multisig superseded by D31: one founder wallet, no timelock | `PAUSE_BITS`, `GOVERNANCE.*`, `SEASON.sealDelaySeconds` |

**Open parameters, kept at the recommended default:** Sell back 87% for every tier (`SELL_BACK.payoutBps` 8_700), team seed of the stock 0 SOL, `FEED_RULES.freshCapPerWallet` 25, `SEASON.onAirDelaySeconds` 900, The 1% divisor 1,000 SOL (`HIT_ODDS.onePctPriceDivisor`).

The founder also split the `apps/web` work: the architect builds the experience layer as self-contained components with typed props and events and mock data, and Codex builds the plumbing and wires those components to real data. That decision changes no parameter.

### 23.2 Decided on 2026-10-08, evening (C24–C28; `DECISIONS.md` D2, D5, D6)

None of these adds or removes a mechanic.

| Item | Decision | Keys in this file |
|---|---|---|
| C24 | **50 bps** to the team through Relay `appFees` [D2]. The X4 PR merges once its own gate passes | `CROSSCHAIN.appFeeBps` (§20) |
| C25 | Default stands [D5] | `STOCK.tradeMinSpacingSeconds`, `.hourlyFloorLamports`, `.hourlyHitOutMultiple` (§8.1) |
| C26 | Default stands [D5]: TRENDING quotes 20 s, MAJOR 60 s | `SELL_BACK.quoteTtlSeconds` |
| C27 | Moot: no dedicated queue; Onepercent stays on MagicBlock's shared queue [D6] | `VRF.maxQueues` (§15), up-front cash (§17) |
| C28 | Default stands [D5]: "≈62.5% in SOL if you sell back every foil hit ✳ plus the Jackpot in $1PCT" | §19 |

The table below is the record that the founder decided from (issue 2's defaults and alternatives).

| Item | Default in issue 2 | Simplest alternative | Why |
|---|---|---|---|
| **C24 Cross-chain app fee** | 0 bps. The X4 plumbing stays and its fee line shows 0%. The X4 PR does not merge before the decision | 50 bps to the team (SPEC §12), on its own fee line (**chosen**, D2) | A new team revenue line. MODEL §6 lists only 8% of packs, the Sell back margin and a share of creator fees, and MODEL §1 describes cross-chain as "sell and bridge to SOL" |
| **C25 Stock trade limits** (fixes a critical flaw) | Each keeper stock trade waits 20 s after the last one. Per clock hour, StockBuy and StockSell are each capped at max(30 SOL, 2 × the book value packs carved in the last or the current hour). TRENDING sells get the TRENDING per-mint cap (10 SOL/h), like buys. In BuysClosed, MAJOR sells skip the hourly cap. The Pyth age limit stays 60 s (`STOCK.tradeMinSpacingSeconds`, `.hourlyFloorLamports`, `.hourlyHitOutMultiple`, §8.1) | Count only the last hour's carve and keep the cap in BuysClosed. Simpler, but the launch hour could restock only 30 SOL (≈42 SOL of packs), and most of the end-of-season stock would reach the Final Pull as tokens. Optionally, a 20 s Pyth age limit for trades | Without limits, a stolen keeper key can pair buys and sells at its own prices and empty the stock in minutes. With them, it loses at most ≈3% of the hourly caps per hour (≈1.8 SOL at the 30 SOL floor) until the guardian disables it. At sim2's 50,000-SOL scale, launch-hour restocking could approach the spacing limit (5 SOL every 20 s, 900 SOL/h); S-1 checks it and may propose 10 s |
| **C26 Sell back quote life for TRENDING coins** | 20 s; MAJOR coins keep 60 s (`SELL_BACK.quoteTtlSeconds.trending`) | 60 s for every coin, as MODEL §2 says | On thin coins a 60 s quote is a free option worth 0.3–2.1% of the card (SPEC §5.4) |
| **C27 Dedicated VRF queue size** | 512 KiB (≈2.66 SOL of rent), unless MagicBlock can restrict the queue to our identity; then 100 KiB | 100 KiB (≈0.52 SOL) | Anyone can fill a queue, which stops every Rip ("Machine busy") without risking funds. Keeping 100 KiB full costs ≈6 SOL/h; 512 KiB raises that to ≈30 SOL/h |
| **C28 Cash figure on the pack page** | "≈62.5% in SOL if you sell back every foil hit ✳ plus the Jackpot in $1PCT" | Keep "≈67.5%" with "if you sell back every foil hit and the Jackpot sells at its cost" | The Jackpot is paid in $1PCT, cannot be sold back, and its SOL value floats, so "≈67.5% in cash if you sell back every hit" is not literally true |

---

## 24. Architect notes: defaults [A], inconsistencies and new facts

**Defaults for details SPEC leaves open (non-economic; no founder decision needed unless he objects):**

- **A1 Hour windows.** Every hourly limit (Sell back budget, the gross stock-trade caps, TRENDING buys and sells, burn) uses the UTC clock hour. SPEC calls the trending limit a "rolling hour"; a clock hour allows up to 2× within minutes across a boundary. That is accepted: these limits bound how fast a stolen hot key can lose money, the spacing still holds every trade to one per 20 s, and every trade still needs its on-chain `min_out`.
- **A2 `Config.stock_up_ts`.** SPEC §7.1 moves Setup → StockUp by timestamp, and §8.2 stores "the season timestamps" in Config without naming this one. The admin sets it once, together with `S`.
- **A3 Encodings.** Edition index 0–3, card kinds 0–8 in SPEC order, pause bits 1/2/4/8/16, Sell back message `n` as `u8` and nonce as `u32`.
- **A4 Pyth program id (decided in issue 3, §21, §21.1).** Pyth's Core upgrade (completed 2026-08-26) deployed new Solana programs: receiver `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`, push oracle `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou` and Wormhole receiver `HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL`, next to the legacy `rec5EKMG…`, `pythWSnsw…` and `HDwcJBJX…`. Pyth recommends the upgraded contracts for new integrations, the Rust `pyth-solana-receiver-sdk` 1.2.0 targets them with the `pro-compatible` feature, and on 2026-10-08 the upgraded sponsored accounts were the fresher ones (§21.1). `PROGRAM_IDS.pythReceiver` is therefore the upgraded receiver. Hermes requires an API key. The program checks the `PriceUpdateV2` owner against it, the `feed_id` against the bucket's feed, `Full` verification, age ≤ 60 s and confidence ≤ 1%. Sponsored accounts first; a stale or unmaintained feed is posted by the keeper with a hand-built poster, never through `@pythnetwork/pyth-solana-receiver` (§21.1).
- **A5 X-ray Turnstile.** "Turnstile after 10" is read as: from the 11th request per IP within the same minute.
- **A6 Binder capacity.** SPEC's `len`/`cap` fields are `u16`, so a Binder holds at most 65,535 cards. `buy_packs` refuses a Rip that would exceed it, with the copy "My cards is full ✳ Redeem, sell or feed some cards". A ×10 Rip grows the Binder by 2,800 B, within the 10 KiB realloc limit per instruction.
- **A7 Sell back batch.** SPEC fixes no number of cards per `sell_back`; the builder uses ≤ 8, like Redeem, with `card_index` strictly descending (checked on-chain, §6.3).
- **A8 Cash figure.** `floor(8,700 × 7,200 / 10,000)` = 6,264 bps, rounded down to 0.5 pt for display: 62.5% (§19, [C28]). Rounding down keeps it literally true. The Jackpot is left out because it is paid in $1PCT.
- **A9 JackpotBuy phase.** SPEC §7.2 gives no phase for the J-B continuous buy. It runs during OnAir only, the only phase with Jackpot inflow; whatever is still unconverted at `end_ts` goes to the Final Pull SOL pool.
- **A10 Unconverted Jackpot SOL at a win.** J-B moves only `jackpot_tokens` into the winner's card. SOL not yet converted stays in `jackpot_sol` and starts the next pot.
- **A11 Stock-sell amounts.** A sell moves tokens. Its tranche limit and its hourly counters use the book value it removes, `floor(Δ × C(b) / A(b))` (SPEC §5.6): the only on-chain value of a token amount, and one that pool moves cannot shrink.
- **A12 Pause bits per executor kind.** `stockBuy` pauses StockBuy and StockSell; `burn` pauses Burn and JackpotBuy, the two $1PCT buys. The guardian can also disable the keeper or executor role at once. No exit depends on either kind: tokens left unsold at the Final Pull are shared in kind.
- **A13 Intake rate limits.** 30 attestation requests per minute per wallet and 60 per IP (§6.2). Since signing has no side effect, a third party's requests can at most delay a wallet's own requests, never use up its eligibility.
- **A14 X-ray operational values.** `XRAY.priceMaxAgeSlots` 54,000 for X-ray display estimates only, by founder decision D7 (issue 2 had 13,500, aligned with X2; X1 had proposed 54,000). `XRAY.maxTokenAccounts` 2,000 and `XRAY.cacheMaxEntries` 5,000 (X1's proposals).
- **A15 VRF queue alert** at 50% occupancy (`MONITOR.vrfQueueOccupancyAlertBps`). With D6 it watches the shared queue, the only one listed.
- **A16 Feed bags per transaction.** 2 / 3 are expectations (M1 A7); M1 measures the real values and writes them (§16.3).
- **A17 $1PCT executor reads (M2 B5), replaced by D29 §3b for M2 P1.** M2 P1 adds `METEORA.feeAllowBps = 300` (CONST) for $1PCT only, covering the flat 250 bps trading fee plus a margin. The canonical DBC/DAMM v2 `sqrt_price` supplies the spot reference; §8.1 records the integer-floor formula and D29 §3b pins the venue selection and PDA checks. M2 P1 owns the program implementation, compiled constant, SDK mirror and fixture-backed check values. M4.1 retains its existing launch and fee-collection scope. Feed and TRENDING pump settings, including their 125 bps allowance, remain unchanged.
- **A18 `ONCHAIN_KEYS` appends (M2 B10).** `STOCK.tradeMinSpacingSeconds`, `.hourlyFloorLamports`, `.hourlyHitOutMultiple` (if M1 did not add them), `HIT_LIST.solUsdPythFeedId` (new generator type `hex32` → `[u8; 32]`) and `PROGRAM_IDS.pythReceiver`. `PROGRAM_IDS.pythPushOracle` and `.pythWormholeReceiver` stay off-chain and out of `ONCHAIN_KEYS`.
- **A19 Operational blocks.** `SERVICES` (§26.1) restates `02-M2-BRIEF.md` §4.3 with its values unchanged. `WEB` (§26.2) restates `03-M3-BRIEF.md` §5.3 with two changes: `WEB.liveStaleAfterMs` 30,000 → 45,000, because 30,000 ms fails M3's own check "> 2 × `SERVICES.api.ssePingSeconds`" (exactly 30,000 ms); and `WEB.blockhashValidBlocks` removed, because its only use was the block-height fallback that D11 made unnecessary.
- **A20 Experience pins (§26.4).** `three` 0.180.0 (the landing's version), `@types/three` 0.180.0 and `gsap` 3.15.0, recorded here at M3's request. They are dependency pins, not parameters.

**Inconsistencies found in SPEC (no value changes):**

- **N1** SPEC §10 says The 1% card #1 is pulled in "41%" of 500-SOL seasons; SPEC §6.4 and sim2 exp6 say 50%. This file uses 50%. It is rationale only.
- **N2** The burn's 10 SOL/hour cap binds above about 33,600 SOL of packs per week (5% inflow spread evenly; earlier at peaks). sim2 modelled no hourly cap, so at high scale less is burned during the season than sim2's 6.3% of supply. The rest stays in `burn_sol` and keeps burning after the season (permissionless after Done). No change.
- **N3** SPEC's body (§6.3, §7.3, §7.4, §8.2, §9.1) still describes the Jackpot "bought at the win" with orders and a 30-minute timeout. The founder's J-B decision recorded at the top of SPEC and in `MODEL.md` overrides it; §10 here is the J-B version.
- **N4** sim2 priced SOL at $117. Pyth SOL/USD read $109.01 on 2026-10-08 at 16:20 UTC. No parameter depends on it; display values come from live quotes.
- **N5** SPEC §7.4 lets `close_binder` run while its owner's Pull is Pending, and SPEC §3.2 S3 records one-hop consumption when the attestation is signed. This file adds `reserved == 0` to `close_binder` (§16.2) and records consumption only from landed `BagFed` events (§6.2). Both are security fixes; no value changes.
- **N6** SPEC §2.1 says "Feedable ✳ 0.002–0.02 SOL each time it's pulled", and SPEC §2.3, §4.8 and §9.2 say "≈67.5% in cash if you sell back every hit". Neither is literally true: a Dust Card pays once, and the Jackpot is paid in $1PCT. §19 corrects both (the second as [C28]).
- **N7 Slot time.** Two mainnet reads 239 s apart on 2026-10-08 advanced 871 slots: ≈0.274 s per slot, the rate this file uses. So 13,500 slots ≈ 1 h, and D7's 54,000 slots ≈ 4.1 h, not the "≈6 h" D7 quotes (that figure assumed 0.4 s per slot, as X1 did). The decided value is the slot count; no value changes.

**Toolchain** (not a parameter): `app/VERSIONS.md`, master §0.3 A and master §4.2 own it. The one exception is §26.4, the experience-layer pins recorded here at M3's request; master §4.2 carries the same rows. Solana CLI (Agave) 4.3.0, Anchor 0.32.2, sBPFv3 output, `ephemeral-vrf-sdk =0.17.3` with feature `anchor-compat`, and no `ephemeral-rollups-sdk`.

---

## 25. Changes in this issue (against the 2026-10-08 19:20 draft)

X1–X3 copied values from the draft. This is every changed or added key and rule; nothing else changed.

| Where | Change | Why |
|---|---|---|
| Header | Frozen for M1; tags [C24]–[C28] | Freeze before X1–X3 merge |
| §6.1 H4–H5, §6.3 FEED message, §16.1 Pull seeds, §16.2 card slots, §13.4 instruction name | Restated as amended by M1 A1–A4, A9 and A11. No value changes | One rule everywhere |
| §6.2, §22.4 | Attestations have no side effect. New `INTAKE.rateLimitPerMinutePerWallet` 30 and `INTAKE.rateLimitPerMinutePerIp` 60 [A] | A third party could use up a wallet's one-hop eligibility |
| §6.3, §9.2, §16.3 | Sell back message: `card_index` strictly descending, checked on-chain | Swap-remove order |
| §7.1, §10, §17, §22.4 | Pause bits per executor kind: `stockBuy` covers StockBuy and StockSell, `burn` covers Burn and JackpotBuy [A] | Explicit mapping |
| §8.1, §22.4 | New `STOCK.tradeMinSpacingSeconds` 20, `STOCK.hourlyFloorLamports` 30_000_000_000, `STOCK.hourlyHitOutMultiple` 2. The TRENDING per-mint hourly cap now also counts sells. Per-kind bounds table [C25] | A stolen keeper key could empty the stock in minutes |
| §8.3, §22.4 | `KEEPER_POLICY.creatorFeeSweepSecondsMin` / `Max` renamed `creatorFeeCollectSecondsMin` / `Max`, same values. Collection before PoweredOn→OnAir and before `end_ts`; Last Call sell-down | DA §3.4 word; split timing; end-of-season conversion |
| §9.1, §22.1, §22.4 | `SELL_BACK.quoteTtlSeconds.trending` stays 20, now listed for the founder [C26] | An unlisted change to a MODEL number |
| §13.2 | Referral codes in every share link from X-ray Week on | SPEC §6.7 |
| §13.4 | "Fee collection chain"; split timing and its disclosure | The split applies when fees are collected |
| §14 | BuysClosed conversion note | §8.1 |
| §15, §17, §22.4 | Dedicated VRF queue 512 KiB unless restricted [C27]. New `MONITOR.vrfQueueOccupancyAlertBps` 5_000 [A]. Up-front cash note | Queue filling stops Rip |
| §16.2 | `close_binder` also needs no pending Pull (`reserved == 0`) | Coverage lock and a free reroll |
| §16.3, §22.4 | `TX_LIMITS.feedBagsPerTx` 4 → 2 and `feedBagsPerTxWithLookupTable` 6 → 3, both PENDING M1 measurement | M1 A7: 4 / ≈6 cannot fit |
| §18, §22.4 | Estimate rule for lists and X-ray. New `XRAY.priceMaxAgeSlots` 13_500, `XRAY.maxTokenAccounts` 2_000, `XRAY.cacheMaxEntries` 5_000 [A] | Uncapped Price v3 values; X1's pending values |
| §19, §22.5 | Cash figure 67.5% → 62.5% (check 15: 6_750 → 6_250) [C28]. "Feedable … when it's pulled". X-ray card counts. Feed approvals `ceil(t / 8)` | Literal truth |
| §20 | Cross-chain app fee 0 bps until the founder decides [C24] | An unapproved revenue line |
| §22.3 | `@onepercent/config` export map and generator through `tsx`; `src/vocabulary.ts` | Clean-checkout commands; one word list |
| §22.4 | The creator-fee comment no longer uses a DA §3.4 word | `pnpm lint:words` |
| §22.5 | Checks 17 and 18 | New keys |
| §23.2 | C24–C28 for the founder | — |
| §24 | A1, A7 and A8 updated; A11–A16, N5 and N6 added; the toolchain note now defers to the master brief | Authority order |

---

## 26. Operational blocks, experience pins and measurements (issue 3)

These blocks carry no economic value. Every key is `[OFF]` and an architect default `[A]`, unless it is tagged `[EXT]` (a third-party fact, with its source) or supplied through the release measurement input (§11.1.2/§26.3). They live in `app/packages/config` like every other key, under the rules of §0, and `validateParams()` covers them (§26.5).

**Who applies what.** M1 applies §22.4 as amended by this issue (the `XRAY`, `PROGRAM_IDS`, `HIT_ODDS` and `SPOTLIGHT` lines of §27) with check 22; if M1 has already merged when this issue lands, M2's P0 applies them. M2's P0 adds `SERVICES` (§26.1), the `ONCHAIN_KEYS` appends of §24 A18 and check 19. M3.1 writes `WEB` (§26.2) between its markers, with checks 20 and 21. The architect's wave PRs add the pins of §26.4.

### 26.1 `SERVICES` (from `02-M2-BRIEF.md` §4.3, values unchanged)

M2's P0 adds this block, headed `// PARAMS issue 3 §26.1` instead of M2's "pending" header. Where each key is used: M2 §11 and §12.

```ts
// [OFF] [A] PARAMS issue 3 §26.1, updated by issue 5: two measured release values come from §11.1.2/§26.3.
export const SERVICES = {
  indexer: { pollMs: 2_000, accountReconcileSeconds: 300, deckReconcileSeconds: 600, deckChunkBytes: 262_144,
             fallbackAfterFailures: 5, fallbackRecoverSeconds: 600, maxLagSecondsForIntake: 30, lagAlertSeconds: 60 },
  keeper: { scanSeconds: 10, closeVaultPassSeconds: 3_600, teamWithdrawSeconds: 3_600, sendMaxAttempts: 5, backoffBaseMs: 500,
            backoffMaxMs: 30_000, followerRetrySeconds: 5, leaderFailoverSeconds: 60, settleP95TargetSeconds: 5,
            settleBacklogAlertSeconds: 60 },
  api: { machineMaxAgeMs: 2_000, meCacheMs: 2_000, rpcPerMinutePerIp: 600, rpcMaxDataSliceBytes: 65_536, valuePerMinutePerIp: 60,
         ssePingSeconds: 15, sseReplayEvents: 500 },
  quote: { rateLimitPerMinutePerWallet: 30, rateLimitPerMinutePerIp: 60 },
  signers: { roleRecheckSeconds: 60, evidenceCacheSeconds: 86_400 },
  stock: { hitlistReportMaxAgeSeconds: 86_400, pythSkipAgeSeconds: 45 },
  monitor: { alertDedupeSeconds: 600, vrfExpiryClusterPerWallet24h: 3, stockCapUsageAlertBps: 8_000, stockConditionAlertSeconds: 900 },
  landing: {
    cuMarginBps: 2_000,
    // MAINNET_RELEASE is generated from the public input in §11.1.2.
    // The provisional tip fallback is for development only; mainnet requires all inputs.
    tipLamports: MAINNET_RELEASE.landing.tipLamports ?? 1_000_000,
    maxComputeUnitPriceMicroLamports: MAINNET_RELEASE.landing.maxComputeUnitPriceMicroLamports,
  },
} as const;
```

| Keys | Value | Use |
|---|---|---|
| `indexer.pollMs` | 2,000 ms | Signature-cursor poll (M2 §11.3) |
| `indexer.accountReconcileSeconds`; `deckReconcileSeconds` / `deckChunkBytes` | 300; 600 / 262,144 | Account re-reads; Deck mirror reconcile in `dataSlice` chunks |
| `indexer.fallbackAfterFailures` / `fallbackRecoverSeconds` | 5 / 600 | Switch to the Triton fallback and back |
| `indexer.maxLagSecondsForIntake` / `lagAlertSeconds` | 30 / 60 | The intake signer answers 503 `indexer_lag` above the first; alert above the second |
| `keeper.scanSeconds` | 10 | Settle, refund and phase scan |
| `keeper.closeVaultPassSeconds` / `teamWithdrawSeconds` | 3,600 / 3,600 | Close-vault pass (≤ 1 h, master §11.4 M2.2); `team_withdraw` |
| `keeper.sendMaxAttempts`, `backoffBaseMs`, `backoffMaxMs` | 5, 500, 30,000 | `TxSender` retries |
| `keeper.followerRetrySeconds` / `leaderFailoverSeconds` | 5 / 60 | Leader lock; failover ≤ 60 s (M6.4) |
| `keeper.settleP95TargetSeconds` / `settleBacklogAlertSeconds` | 5 / 60 | Settle latency target (master §11.4 M2, criterion 10); backlog alert |
| `api.machineMaxAgeMs` / `meCacheMs` | 2,000 / 2,000 | `/api/machine` at most 2 s old; `/api/me` cache |
| `api.rpcPerMinutePerIp` / `rpcMaxDataSliceBytes` | 600 / 65,536 | `/api/rpc` limits (never applied to building an exit locally) |
| `api.valuePerMinutePerIp` | 60 | `/api/value` |
| `api.ssePingSeconds` / `sseReplayEvents` | 15 / 500 | SSE ping; Redis Stream replay length |
| `quote.rateLimitPerMinutePerWallet` / `PerIp` | 30 / 60 | Quote signer |
| `signers.roleRecheckSeconds` / `evidenceCacheSeconds` | 60 / 86,400 | On-chain role check; cache of evidence about history at or before `S` (live facts are never cached) |
| `stock.hitlistReportMaxAgeSeconds` | 86,400 | `onepct-ops hitlist add` needs a report younger than this |
| `stock.pythSkipAgeSeconds` | 45 | A MAJOR trade uses a sponsored Pyth account only up to this age; older, the keeper posts its own update (§21.1) |
| `monitor.alertDedupeSeconds`, `vrfExpiryClusterPerWallet24h`, `stockCapUsageAlertBps`, `stockConditionAlertSeconds` | 600, 3, 8,000, 900 | Alerts (M2 §11.7, §12.5) |
| `landing.cuMarginBps` | 2,000 | CU limit = simulated CU × 1.2 |
| `landing.tipLamports` | Supplied P1 value in §11.1.2; measurement method §26.3 | Helius Sender tip on keeper trades |
| `landing.maxComputeUnitPriceMicroLamports` | Supplied P2 value in §11.1.2; measurement method §26.3 | Cap on the services' priority price (p75 of `getRecentPrioritizationFees`) |

#### Operational amendment: RPC node lag (2026-10-11)

The requested indexer RPC lag fix adds exactly these three `[OFF]` transport
keys to `SERVICES.transport`. They change no economic value or on-chain constant.

| Added key | Value | Use |
|---|---|---|
| `rpcNodeLagMaxAttempts` | 3 | Total attempts per read, including the initial request, for RPC codes `-32004`, `-32016`, `-32007` and `-32009` |
| `rpcNodeLagBackoffBaseMs` | 100 ms | Initial exponential backoff ceiling; equal jitter waits between half and all of the ceiling |
| `rpcNodeLagBackoffMaxMs` | 400 ms | Maximum backoff ceiling, including jitter |

The default read waits 50–100 ms, then 100–200 ms before its last attempt.
Exhausted node lag can use the configured indexer fallback immediately; if it
persists, the next poll resumes the same unconfirmed work. It does not count
toward the transport circuit breaker. Submissions are never replayed by this
read policy. An unavailable current block time may use the finalized head;
without a confirmed timestamp the consumer waits for a later pass.

#### Operational amendment: public RPC capacity (2026-10-11)

The requested public RPC capacity fix moves the admission and response bounds
into `SERVICES.api` and adds bounded browser read scheduling under `WEB`.
All eight added keys are `[OFF]`; no economic number changes.

| Added key | Value | Use |
|---|---|---|
| `SERVICES.api.rpcMaxConcurrent` | 64 | Active public RPC requests per API process (previous fixed limit: 8) |
| `SERVICES.api.rpcMaxConcurrentPerIp` | 16 | Active public RPC requests per salted client IP (previous fixed limit: 2); cannot exceed process capacity |
| `SERVICES.api.rpcMaxResponseBytes` | 4,194,304 | Streamed upstream response ceiling, unchanged from the former 4 MiB fixed limit |
| `SERVICES.api.rpcCapacityRetryAfterSeconds` | 1 | `Retry-After` for concurrency saturation, unchanged from the former fixed value |
| `WEB.rpcConcurrency` | 4 | Active browser RPC reads per RPC endpoint; additional page reads wait locally |
| `WEB.rpcCapacityMaxAttempts` | 3 | Total safe-read attempts, including the first, for HTTP 503 capacity responses |
| `WEB.rpcCapacityBackoffBaseMs` | 250 ms | Initial exponential backoff ceiling with jitter; `Retry-After` is a minimum delay |
| `WEB.rpcCapacityBackoffMaxMs` | 2,000 ms | Maximum jittered backoff added to `Retry-After`; the combined delay and all attempts must fit within the existing HTTP deadline |

`SERVICES.api.rpcPerMinutePerIp` remains 600. Six parallel reads from one page,
or ten such page loads from distinct IPs, fit within the server limits. Excess
traffic remains bounded rather than consuming an unbounded server queue. At
64 requests, maximum-size response bodies alone can occupy 256 MiB before
assembly and JSON parsing; a larger process limit needs a memory budget review.
Browser retries share the existing `WEB.httpTimeoutMs` deadline (5,000 ms),
respect cancellation and never repeat a submission. These bounds cover normal
page bursts, not unlimited simultaneous load or upstream-provider outages.

### 26.2 `WEB` (from `03-M3-BRIEF.md` §5.3)

Values as in M3 §5.3 except `liveStaleAfterMs` (30,000 → 45,000) and the removed `blockhashValidBlocks` (§24 A19). Uses: M3 §5.3.

```ts
// ===== BEGIN M3 WEB SECTION — owner: M3 (03-M3-BRIEF.md §5.3). [OFF] [A] PARAMS issue 3 §26.2; [EXT] verified 2026-10-08
export const WEB = {
  configRefreshMs: 60_000,
  machinePollMs: 5_000,
  machinePollHiddenMs: 30_000,
  liveStaleAfterMs: 45_000, // "On air" goes off after this long without an event or ping; > 2 × SERVICES.api.ssePingSeconds
  sseFailuresBeforePoll: 3,
  eventsPollMs: 5_000,
  pullPollFastMs: 400,
  pullPollFastForMs: 10_000,
  pullPollSlowMs: 2_000,
  revealDataDeadlineMs: 1_200,
  confirmPollMs: 800,
  settlePrependAfterSeconds: 30,
  priorityFeeCapMicroLamports: 500_000, // cap on p50 of getRecentPrioritizationFees([machine])
  walletDetectMs: 1_000,
  valuesBatchMax: 50, // items per /api/values call
  valuesNowPerMinutePerIp: 240, // 'now' items per minute per IP
  logoMaxBytes: 262_144,
  logoTimeoutMs: 3_000,
  // https only, no redirect off the list; '*.' allows any subdomain of that host
  // [A] ipfs.filebase.io decided 2026-10-09: first IPFS fallback gateway of the logo proxy (ipfs.io answers 429 to busy egress)
  logoHosts: ['ipfs.io', 'arweave.net', 'cf-ipfs.com', 'gateway.pinata.cloud', '*.mypinata.cloud', '*.arweave.net', 'ipfs.filebase.io'],
  sellMaxAccounts: 24, // Jupiter maxAccounts for user sells: redeem + swap fit one v0 transaction
  jupiterProgramIds: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'], // [EXT] Jupiter Aggregator v6, what /build's Metis routes run (§21)
  beaconPerMinutePerIp: 60,
} as const;
// ===== END M3 WEB SECTION
```

- **Logo hosts.** The list is the starting allow-list of M3's logo proxy (`GET /api/logo/:mint`). A logo on any other host renders as a monogram; M3 reports the misses it sees in its PR, and the next issue of this file extends the list.
- **Swap allow-list.** A swap transaction may contain only Compute Budget, System, SPL Token, Token-2022, ATA, `onepercent` (`redeem` only) and `WEB.jupiterProgramIds` at the top level (M3 §9 step 3). The AMMs a route uses are CPIs of the aggregator, so they are not listed.

### 26.3 Measurement requirements for release inputs P1 and P2

K1 historical amendment (2026-10-10) introduced the provisional development Sender Max floor of 1,000,000 lamports. The current adopted P1/P2 values and their pending/complete status are exclusively in §11.1.2. The release command replaces the development values only from supplied measurements meeting the 24-hour requirements below. Sponsored Pyth prices only for K1: stale feeds wait and replan; the encoded-VAA poster in §21.1 is deferred. Persistent staleness alerts use `SERVICES.monitor.stockConditionAlertSeconds` (900 seconds).

Only these two keys may stay `null` in `packages/config` until measured (M1 measures `TX_LIMITS.feedBagsPerTx*` and `CU_LIMITS` the same way, §16.3). Each is written by the PR named, with the measurement in its report; the next issue of this file adopts it. Codex sends no mainnet transaction: every measurement below is a read.

| Key | Measured by | Plan |
|---|---|---|
| `SERVICES.landing.tipLamports` | K1 (M2.3) | Helius Sender requires a tip **and** a priority fee on every transaction. Its documented minimums (helius.dev/docs `sending-transactions/sender`, read 2026-10-08) are 1,000,000 lamports (0.001 SOL) for Sender Max, which routes through every path including Jito, and 5,000 lamports for SWQOS-only; a tip in between is accepted without priority. K1 lands through the Jito path (the `jitodontfront` account), so its floor is 1,000,000. K1 reads Jito's landed-tip percentiles (`bundles.jito.wtf/api/v1/bundles/tip_floor`) for at least 24 h and writes `tipLamports = max(1_000_000, the window's 50th percentile)`, rounded up to the next 10,000 lamports, with the window and the percentiles in the PR. D18 replaces the former mainnet canary with a devnet rehearsal; the supplied measurement still uses mainnet observations. Cost bound at the floor: each 20 s spacing allows at most 180 trades an hour (stock trades; and, once the executor lands the same way in M4.2, burns and Jackpot buys), so tips cost at most 0.18 SOL an hour per kind |
| `SERVICES.landing.maxComputeUnitPriceMicroLamports` | S3 (M2.2) | S3 samples `getRecentPrioritizationFees` (read-only) once a minute for at least 24 h on mainnet: without an account filter, and with the accounts the keeper's trades write that already exist (the launch majors' main pool accounts). It computes the p75 that `TxSender` would pick for each sample and writes the window's 99th percentile of those, rounded up to the next 10,000 micro-lamports, with the window and the percentiles in the PR. D18 removes the mainnet canary; retain raw measurement evidence with the release input |

### 26.4 Experience-layer dependency pins (requested by `03-M3-BRIEF.md` §3)

Checked on the npm registry on 2026-10-08. The architect's wave PRs add them to `apps/web/package.json` with the 14-day rule of master §0.3 C; Codex never adds, removes or bumps them (M3 §3). Master §4.2 carries the same rows, and `VERSIONS.md` records them when wave 1 lands.

| Package | Exact pin | Published | Notes |
|---|---|---|---|
| `three` | `0.180.0` | 2025-09-03 | The only 0.180.x release. The landing's lockfile resolves the same version (root `package-lock.json`), so the ported CRT behaves the same. Newest today: 0.186.1 (2026-09-24), not used |
| `@types/three` | `0.180.0` (dev) | 2025-09-03 | Types for the same release; `three` ships none |
| `gsap` | `3.15.0` | 2026-04-13 | The newest 3.x on npm (dist-tag `latest`) and older than 14 days. No dependencies. Licence: GSAP's Standard "no charge" licence, not MIT |

### 26.5 `validateParams()` additions (issue 3)

19. `SERVICES` (M2 §4.3): every value a positive integer, except the two release measurement keys, which may be `null` only while §11.1.2 is incomplete (mainnet remains blocked); `quote.rateLimitPerMinutePerIp ≥ quote.rateLimitPerMinutePerWallet`; `indexer.maxLagSecondsForIntake < indexer.lagAlertSeconds`; `stock.pythSkipAgeSeconds < STOCK.pythMaxAgeSeconds`; `keeper.followerRetrySeconds < keeper.leaderFailoverSeconds`.
20. `WEB` timings and limits: every number a positive integer; `liveStaleAfterMs > 2 × SERVICES.api.ssePingSeconds × 1_000`; `pullPollFastMs < pullPollSlowMs`; `machinePollMs < machinePollHiddenMs`; `valuesBatchMax ≤ valuesNowPerMinutePerIp`.
21. `WEB` lists: every `logoHosts` entry is a lowercase host name, optionally prefixed `*.`, with no scheme, path or port; every `jupiterProgramIds` entry decodes from base58 to 32 bytes.
22. Prices and ids: `XRAY.priceMaxAgeSlots ≥ MARKET.price.maxAgeSlots` (the X-ray display bound never applies to anything stricter [D7]); `PROGRAM_IDS.pythReceiver`, `.pythPushOracle` and `.pythWormholeReceiver` decode to 32 bytes and are distinct.

---

## 27. Changes in issue 3 (against issue 2)

Every changed or added key and rule; nothing else changed. No odds, split, price, payout or other validated number changed.

| Where | Change | Why |
|---|---|---|
| Header, intro | Issue 3; frozen for M1, M2 and M3; [D#] tags; C24–C28 decided | `DECISIONS.md` |
| §3.1, §4.1, §4.2, §4.3, §4.4, §7.2, §12, §14, §17, §22.4 (`HIT_ODDS`, `SPOTLIGHT` comments), §23.1 (C20) | Spotlight not in Season 1: no slot, no deposit, the segment never live. Keys kept (frozen draw and layouts); `SPOTLIGHT.enabledAtLaunch` stays `false` | D1 |
| §8.1, §10, §13.1 | Historical M2 B5 allowance was 125 bps; D29 §3b supersedes it for $1PCT with `METEORA.feeAllowBps` 300 and canonical Meteora spot-price reads, owned by M2 P1 | D29 §3b; §24 A17 |
| §9.1, §22.1, §23.2 | C26 (TRENDING quote 20 s) kept | D5 |
| §14 | Deploy beat: the RC is the first mainnet deploy, ≈T−5 d; `S` and `stock_up_ts` written with `SetSeason` after it. Spotlight beat removed | D4, D1 |
| §15 | `VRF.maxQueues`: shared queue `Cuj97…` only, allow-list kept, no dedicated queue; queue-filling cost restated for the shared queue | D6 |
| §16.2 | `close_binder`'s "Final Pull claimed" = `season_spend == 0 ∨ (flags & 0b11) == 0b11`; both claims callable with a zero share | M2 B8 |
| §16.3 | `CU_LIMITS` listed as PENDING M1 measurement | M1 §16.3 |
| §17 | Admin powers: no Spotlight slot. Up-front cash ≈11–14 → ≈10–11 SOL without the dedicated queue, plus the canary (≈3.9 SOL locked + ≈2.6 SOL buffer), peak ≈16.5–17.5 SOL | D1, D6; master F14 |
| §18, §22.4 | `XRAY.priceMaxAgeSlots` 13_500 → **54_000**, X-ray display estimates only; other lists keep `MARKET.price.maxAgeSlots` 13,500 | D7 |
| §18 | Helius `getTransactionsForAddress`: plan status, metering, impact (intake key on Developer or higher, master F10). Pointers to `SERVICES` and `WEB` | Task of this issue; M2 Appendix 4 |
| §19 | X-ray card: `counts.checkAtFeed`, `bags[].reasonCode`, nullable `amountUi` / `decimals` rule. New line: the first-of-coin deposit | D8; master §0.5, §11.4 M3.2 |
| §20 | X4 merges once its own gate passes | D2 |
| §21, §22.3, §22.4 | New `PROGRAM_IDS.pythReceiver` `rec2HHDD…` (on-chain), `.pythPushOracle` `pyt2F414…` and `.pythWormholeReceiver` `HDw2E7P8…` (off-chain). SOL/USD sponsored account now the upgraded one, `7AviUf9n…`. Jupiter Aggregator v6 id recorded | M2 B10; §21.1 |
| §21.1 (new) | Pyth account conventions, the six feeds' sponsored accounts and their measured ages, and the posting rule: sponsored first, a hand-built poster otherwise, no `@pythnetwork/pyth-solana-receiver` exception | Architect's rule; supersedes M2 §3, §12.3, Appendix 1 |
| §22.5, §26.5 | Checks 19–22 | New blocks |
| §23.2 | C24–C28 decided (C24 50 bps; C25, C26, C28 defaults; C27 moot) | D2, D5, D6 |
| §24 | A4 decided; A14 (D7), A15 updated; A17–A20 and N7 added; toolchain note points to §26.4 | — |
| §26.1 (new) | `SERVICES` block, M2 §4.3 values unchanged; `landing.tipLamports` and `landing.maxComputeUnitPriceMicroLamports` PENDING with measurement plans | M2 §4.3 |
| §26.2 (new) | `WEB` block from M3 §5.3; `liveStaleAfterMs` 30_000 → 45_000; `blockhashValidBlocks` removed; `jupiterProgramIds` verified | M3 §5.3; D11 |
| §26.3 (new) | Measurement plans for the two PENDING keys | — |
| §26.4 (new) | Pins: `three` 0.180.0, `@types/three` 0.180.0, `gsap` 3.15.0 | M3 §3 |

## 28. D29 executor amendment

Issued 2026-10-09 for M2 P1 by the architect. This amendment adds only the
following economic key; it does not change TRENDING trades or their 125 bps
fee provision.

| Key | Type | Unit | Value | Mutability | Use |
|---|---|---|---|---|---|
| `METEORA.feeAllowBps` | u32 | bps | 300 | CONST, `ONCHAIN_KEYS` | Fee provision for Burn and JackpotBuy on Meteora DBC and DAMM v2, replacing the 125 bps provision for these two kinds |
| `PROGRAM_IDS.meteoraDbc` | Pubkey | address | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | EXT, compiled through `ONCHAIN_KEYS` | D29 DBC program |
| `PROGRAM_IDS.meteoraDammV2` | Pubkey | address | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | EXT, compiled through `ONCHAIN_KEYS` | D29 DAMM v2 program |
| `METEORA.dammV2Config` | Pubkey | address | `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` | EXT, compiled through `ONCHAIN_KEYS` | D29 canonical DAMM v2 migration configuration |

The D29 amendment supersedes M2 B5 and this file's earlier statement that
Burn and JackpotBuy share `STOCK.trendingPoolFeeAllowanceBps`.
