# COPY.md · the v2 copy deck (issues 1 and 2)

Issued 2026-10-12 (D3) by the architect, with `03-M3-BRIEF.md`. **Issue 1** covers §1 shell and common, §2 X-ray and §3 Feed and take-back. **Issue 2** (D7) adds Rip, the reveal, My cards, Verify, fairness, live, token and 1% TV; §4 lists what it will cover; §6 is its first part (My cards actions and the Rip end, D30). Authority: master §0.1 row 6. These are the only strings that may ship.

**Correction to issue 1 (2026-10-08, evening), `DECISIONS.md` D9:** `.sol` names are out for now, so §0.5 `{who}`, `xray.field.label`, `xray.field.helper` and `xray.error.invalid_address` no longer mention them. M3.1 had not mirrored issue 1 yet; `en.ts` takes the corrected strings.

**Correction to issue 1 (2026-10-09), from the founder:** the tagline takes a comma, `Bags in, Packs out.`, in `meta.title`, `title.home`, `brand.lineIn` and `footer.line`.

**Correction to issue 1 and first part of issue 2 (2026-10-09), from the founder (D30):** My cards, the Rip end and the Feed page are simplified. §3: one Feed checkbox per bag (no Sell, no Keep in wallet), the Feed outlook (`feed.outlook.*`) and each bag's "when pulled" figures; §3.9 Sell at market and `feed.state.doneSales` are removed. §0.7: Sell is canonical. §6 is new: each card offers at most two actions, each with one clear number, and no market price stands next to the Sell price.

**Correction to issue 1 and first part of issue 2 (2026-10-09, later), from the founder (D30):** the tagline is `Dust in, Packs out.` in `meta.title`, `title.home`, `brand.lineIn` and `footer.line`. §3: the Feed outlook leads with the multiple when pulled (`feed.outlook.upTo`, gold, with `feed.outlook.whenPulled` and `feed.outlook.expected` under it) and keeps the sold-now stat small; `feed.outlook.rentBack`, `feed.button.feedOnly` and `feed.group.rentBack.*` are removed; the rent refund is one quiet line under the list (`feed.rentRefund`), the Feed button names the bags only and, with no bag checked, `feed.button.rentOnly` closes the empty accounts. §2: the X-ray names the same refund, `xray.rentBack`, in a plain chip. No string says "back now".

---

## 0. Rules

### 0.1 How this file is used

1. `app/packages/copy/src/en.ts` mirrors every issued table from §1 onward key for key and byte for byte, including the authorized B2 audit additions in §5 and the first part of issue 2 in §6 (D30). `parity.test.ts` parses every copy table (header `| Key | Text | Notes |`) and fails on any difference in keys, text or placeholders.
2. The **Text** column is the exact string, between backticks. The backticks are not part of it. A literal `\n` represents a newline.
3. A string changes only through a new issue of this file. Codex never edits it; a missing or wrong string is reported in the PR.
4. API log lines, test names and developer-only messages are not copy and are not listed here. API error **messages** shown to users are copy (§2.6).

### 0.2 Voice (DA §3.1)

- Short declaratives that end with a period. Labels, list rows and button texts take no period.
- Numbers first, exact, with units: "16 bags → 16 Dust Cards".
- Machine, broadcast and collector words: X-ray, Feed, Rip, pull, crank, hit, on air.
- Jokes are about the market and about collecting, never about the person.
- Show, don’t promise. Nothing here promises a gain.

### 0.3 Typography

| Mark | Rule |
|---|---|
| ✳ | U+2733, one space on each side, between segments |
| ≈ | U+2248, directly before the number, no space: `≈0.21 SOL` |
| − | U+2212 for every minus and every loss |
| × | U+00D7 for multipliers and for "count × each" |
| … | U+2026, one character |
| ’ “ ” | Typographic apostrophe and quotes in every string |
| · | U+00B7, one space on each side, in button counts |
| – | U+2013 for ranges: `0.002–0.02 SOL` |
| → | U+2192 for "becomes" and for links that continue a flow |

### 0.4 Value labels (master §7.2, PARAMS §18)

| Value | Shown as | Allowed where |
|---|---|---|
| Executable quote from the value function (`Value.kind === 'now'`) | `≈{sol} SOL if sold now` (`common.ifSoldNow`) | Everywhere a token amount is shown in SOL |
| Price v3 estimate capped at real exit reserves (`'est'`) | `≈{sol} SOL est.` (`common.est`) | Lists and X-ray only, and what reuses X-ray results |
| No value | `n/a` (`common.noValue`) | Everywhere |

Never both labels on one figure. Never "worth", "value now" or a bare SOL figure for a token amount.

### 0.5 Placeholders and formatters

Placeholders are `{name}`. A placeholder never receives a raw number: Codex formats every value with `@onepercent/copy` before interpolation.

| Placeholder | Formatter | Example |
|---|---|---|
| `{sol}`, `{min}`, `{max}`, `{each}`, `{rent}`, `{deposit}`, `{deposits}`, `{value}` | `sol` for amounts the user receives (floor); `solCost` for amounts the user pays (ceil) | `0.84`, `0.0061`, `412.6` |
| `{net}` | signed `sol`: `+1.00` or `−0.03` | `+1.00` |
| `{pct}` | `pct` (one decimal, U+2212) or the config share as a percent | `−96.4%`, `2%` |
| `{n}`, `{d}`, `{e}`, `{ok}`, `{t}`, `{c}`, `{cap}`, `{limit}`, `{deck}`, `{pulls}`, `{s}`, `{seq}` | `count` (en-US grouping; `{seq}` without grouping) | `61,240` |
| `{who}` | `short` (4+4) of the wallet the line is about (no `.sol` names for now, D9) | `7xKp…d2Qa` |
| `{short}` | `short` (4+4) | `7xKp…d2Qa` |
| `{ticker}` | `ticker`: `$` + uppercase `[A-Z0-9]`, at most `UI.tickerMaxChars` | `$WIFHAT` |
| `{amount}` | `amount` (exact token amount, en-US grouping) | `1,204,331` |
| `{date}`, `{time}` | `dateUtc`, `timeUtc` | `Oct 26`, `16:00 UTC` |
| `{program}` | full base58 program id, or `short` in Rip Details with the full address available to copy | `DoNH…abcd` |
| `{cluster}` | `mainnet` or `devnet` | - |
| `{bags}`, `{transactions}`, `{approvals}`, `{cards}`, `{accounts}` | the matching `count.*` fragment of §1.4 | `16 bags`, `1 approval` |
| `{segments}` | §2.2 segments, zero ones omitted, joined by ` ✳ ` | - |
| `{title}`, `{condition}` | another key of this file, already resolved | - |
| `{edition}` | `PACK_EDITIONS[].name` from config | `After Hours` |
| `{name}` | translated card-kind name | `Silver Foil` |
| `{mult}` | `mult` from config | `×2` |

Rip previews use `packPrice` (exactly two decimals), `solExact` for fee and deposit details, `depositCost` (ceil to six decimals) for grouped deposits, and `ripTotal` (ceil to three decimals) for the total. Transaction amounts stay exact.

### 0.6 Plurals

A key ending `.one` or `.other` is one of a pair. `t(key, { n })` picks `.one` when `n` is 1, else `.other`. Both forms always exist.

### 0.7 Names

Capitalised exactly as here: X-ray, Feed, Rip, Pull, Redeem, Sell, Feed back, Take back, My cards, Dust Card, House Card, the Deck, Silver Foil, Blue Foil, Holo Foil, Black Foil, Jackpot, The 1%, 1% TV, Stock-Up, Power-On, On Air, Last Call, The Final Pull, $1PCT, Onepercent.

**Sell** is the machine buying a hit back (the program instruction stays `sell_back`). "Sell back", "Sell at market" and a Keep action are retired (D30): `packages/config/src/vocabulary.ts` bans the first two in `packages/copy`.

### 0.8 Never

- **No em dash (U+2014) in any user-facing text** (founder, 2026-10-09): titles, tabs, OG/Twitter previews, share pages, bot, Blinks, alt texts. Use `·` in titles and previews; `:`, `,`, `.` or `✳` in sentences. En dashes in numeric ranges stay.

- Any word of `packages/config/src/vocabulary.ts` (AGENTS.md lists 1–3), in any string, alt text or label. Never "RIP" as rest in peace.
- No zero-knowledge wording until such a feature ships.
- No promise of gains; no "instant SOL prizes" or "paid in SOL" prize copy; no DA v1 concepts (SPEC §2.7).
- No person’s name or handle. Addresses only, shortened.

---

## 1. Shell and common

### 1.1 Meta and titles

| Key | Text | Notes |
|---|---|---|
| `meta.title` | `Onepercent · Dust in, Packs out.` | `<title>` of `/` |
| `meta.description` | `X-ray any Solana wallet. Feed your bags to the machine. Rip foil packs with real tokens inside. Go for the 1%.` | Default `description` and `og:description` |
| `title.home` | `Onepercent · Dust in, Packs out.` | - |
| `title.xray` | `X-ray ✳ Onepercent` | `/x` |
| `title.xrayAddress` | `X-ray ✳ {who} ✳ Onepercent` | `/x/:address` |
| `title.feed` | `Feed ✳ Onepercent` | - |
| `title.rip` | `Packs ✳ Onepercent` | - |
| `title.cards` | `My cards ✳ Onepercent` | - |
| `title.verify` | `Verify pull #{seq} ✳ Onepercent` | `{seq}` decimal |
| `title.fairness` | `Odds and verify ✳ Onepercent` | - |
| `title.live` | `Live ✳ Onepercent` | - |
| `title.token` | `$1PCT ✳ Onepercent` | - |
| `title.notFound` | `Not found ✳ Onepercent` | - |

### 1.2 Brand, navigation and footer

| Key | Text | Notes |
|---|---|---|
| `brand.mark` | `1%` | Wordmark |
| `brand.name` | `Onepercent.` | - |
| `brand.lineIn` | `Dust in, Packs out.` | Hero H1 |
| `brand.lineGo` | `Go for the 1%.` | Hero subline |
| `nav.label` | `Main` | `aria-label` of the nav |
| `nav.home` | `Home` | - |
| `nav.xray` | `X-ray` | - |
| `nav.feed` | `Feed` | - |
| `nav.rip` | `Packs` | Links to `/rip` |
| `nav.cards` | `My cards` | - |
| `nav.live` | `Live` | - |
| `nav.token` | `$1PCT` | - |
| `nav.fairness` | `Odds and verify` | - |
| `nav.menuOpen` | `Open menu` | `aria-label` |
| `nav.menuClose` | `Close menu` | `aria-label` |
| `footer.heading` | `Find your 1%.` | Footer H2 |
| `footer.cta` | `Pick a pack →` | Links to `/rip` |
| `footer.line` | `Dust in, Packs out.` | - |
| `footer.copyright` | `© 2026 Onepercent` | - |
| `footer.x` | `Follow on X ↗` | - |

### 1.3 Common

| Key | Text | Notes |
|---|---|---|
| `common.loading` | `Loading…` | - |
| `common.retry` | `Try again` | Button |
| `common.back` | `Back` | - |
| `common.close` | `Close` | - |
| `common.cancel` | `Cancel` | - |
| `common.confirm` | `Confirm` | - |
| `common.noValue` | `n/a` | §0.4 |
| `common.sol` | `{sol} SOL` | - |
| `common.solGain` | `+{sol} SOL` | SOL that reaches the user |
| `common.est` | `≈{sol} SOL est.` | §0.4: lists and X-ray only |
| `common.ifSoldNow` | `≈{sol} SOL if sold now` | §0.4: executable quotes only |
| `common.copyLink` | `Copy link` | - |
| `common.copied` | `Copied.` | Announced politely |
| `common.copyFailed` | `The link didn’t copy. Copy it from the address bar.` | - |
| `common.shareX` | `Share on X` | - |
| `common.verify` | `Verify` | - |
| `common.onSolscan` | `On Solscan ↗` | Proof link of a stat tile |
| `common.trustSign` | `You sign everything.` | - |
| `common.networkError` | `The machine didn’t answer. Try again.` | Any API or RPC failure without a better key |
| `common.notFound` | `Nothing here. The machine is this way.` | 404 body |
| `common.home` | `Back to the machine` | 404 link |
| `common.pause` | `Pause` | Ticker and moving content |
| `common.resume` | `Resume` | - |
| `common.soundOn` | `Sound on` | Toggle; sound is off by default |
| `common.soundOff` | `Sound off` | - |
| `common.motionReduced` | `Reduce motion` | Toggle |
| `common.motionFull` | `Full motion` | - |
| `common.offline` | `The machine’s data is offline. Your exits still work.` | `/api/config` unreachable |
| `common.rpcOffline` | `The machine can’t reach Solana right now. Exits also run from the rescue page with your own RPC.` | `/api/rpc` unreachable |
| `common.rescueLink` | `Rescue page ↗` | Never behind a flag |

### 1.4 Count fragments

| Key | Text | Notes |
|---|---|---|
| `count.bags.one` | `1 bag` | - |
| `count.bags.other` | `{n} bags` | - |
| `count.transactions.one` | `1 transaction` | - |
| `count.transactions.other` | `{n} transactions` | - |
| `count.approvals.one` | `1 approval` | Never used for more than `TX_LIMITS.txPerSignAll` transactions (PARAMS §19) |
| `count.approvals.other` | `{n} approvals` | - |
| `count.cards.one` | `1 card` | - |
| `count.cards.other` | `{n} cards` | - |
| `count.dustCards.one` | `1 Dust Card` | - |
| `count.dustCards.other` | `{n} Dust Cards` | - |
| `count.emptyAccounts.one` | `1 empty account` | - |
| `count.emptyAccounts.other` | `{n} empty accounts` | - |
| `count.newTokenAccounts.one` | `1 new token account` | - |
| `count.newTokenAccounts.other` | `{n} new token accounts` | - |

### 1.5 Wallet

| Key | Text | Notes |
|---|---|---|
| `wallet.connect` | `Connect wallet` | - |
| `wallet.connecting` | `Connecting…` | - |
| `wallet.pick` | `Pick a wallet` | Picker heading |
| `wallet.connected` | `Wallet {short}` | Header chip |
| `wallet.disconnect` | `Disconnect` | - |
| `wallet.disconnected` | `Wallet disconnected.` | - |
| `wallet.switched` | `Wallet switched to {short}.` | Account change; every plan was reset |
| `wallet.none` | `No Solana wallet in this browser.` | After `WEB.walletDetectMs` |
| `wallet.inAppHint` | `Open this page in your wallet app to sign.` | Mobile without a wallet |
| `wallet.telegramHint` | `Telegram can’t sign. Open this page in your wallet app.` | Telegram in-app browser |
| `wallet.openPhantom` | `Open in Phantom` | Universal link |
| `wallet.openSolflare` | `Open in Solflare` | Universal link |
| `wallet.noAccount` | `Your wallet shared no Solana account.` | - |
| `wallet.unsupported` | `This wallet can’t sign Solana transactions here.` | Missing features |
| `wallet.wrongNetwork` | `Your wallet is on another network. Switch it to Solana {cluster}.` | - |
| `wallet.check` | `Check your wallet.` | Prompt open |
| `wallet.noSecrets` | `We never ask for a seed phrase or a private key.` | Under the picker |

### 1.6 Errors

The SDK's error map (M1 §15.5, M2 §8) returns a `copyKey`; it resolves to `errors.<copyKey>`. Issue 2 adds the Rip and My cards ones (§4).

| Key | Text | Notes |
|---|---|---|
| `errors.walletNo` | `Wallet said no. Nothing was sent.` | SPEC §2.6 |
| `errors.tooLong` | `Took too long. Tap again.` | Blockhash or attestation expired; the next tap rebuilds |
| `errors.generic` | `That didn’t go through. Try again.` | Any unmapped landing error |
| `errors.simulation` | `The machine would refuse this, so nothing was sent.` | Simulation failed before the prompt, unmapped |
| `errors.cardMoved` | `That card just moved. Try again.` | Shown only after the silent retry failed |
| `errors.freshCap` | `{cap} fresh cards already in the machine; more when some are pulled` | `{cap}` = `FEED_RULES.freshCapPerWallet` |
| `errors.notInSet` | `Not in the set (not from pump.fun, or unsupported token extensions)` | `NotPumpFun`, `MintNotSafe`, `MintForbidden` |
| `errors.seasonOver` | `Season over ✳ Redeem and take-back stay open forever` | - |
| `errors.insufficientSol` | `Not enough SOL. This needs {sol} SOL more.` | `{sol}` with `solCost` |
| `errors.paused` | `Paused for now. Every exit still works.` | A guardian pause bit |
| `errors.rateLimited` | `Too many requests from here. Try again in {s} s.` | - |
| `errors.payeeBelowRent` | `Keep about 0.001 SOL in your wallet to receive this, then try again.` | `PayeeBelowRent` (D17): the owner would end below rent; nothing moved |
| `errors.computeBudgetExceeded` | `The machine needed more compute for this one. Try again.` | Compute exhaustion, mapped apart from `busy` (D20) |

---

## 2. X-ray

### 2.1 Field and scan

| Key | Text | Notes |
|---|---|---|
| `xray.field.label` | `Solana wallet address` | Visually hidden label (D9) |
| `xray.field.placeholder` | `Paste any wallet` | Mauve, never grey |
| `xray.field.submit` | `X-ray it` | - |
| `xray.field.helper` | `Any Solana wallet address. No connection needed.` | Ink (D9) |
| `xray.loading` | `X-raying…` | `role="status"` |
| `xray.counting.one` | `1 bag…` | Running count during the scan |
| `xray.counting.other` | `{n} bags…` | - |
| `xray.check` | `One quick check, then the X-ray runs.` | Above the Turnstile widget |

### 2.2 Result

| Key | Text | Notes |
|---|---|---|
| `xray.head` | `X-ray ✳ {who}` | - |
| `xray.bags.one` | `1 bag.` | In-set bags (`counts.bags`) |
| `xray.bags.other` | `{n} bags.` | - |
| `xray.worst` | `Worst: {ticker} {pct} from ATH` | Omitted when `worst` is null; never "Worst: -" |
| `xray.condition.mint` | `Mint` | 0 bags. The grade is in the result data only; the X-ray page, the share card and the bot don’t show it |
| `xray.condition.nearMint` | `Near Mint` | 1–3 |
| `xray.condition.lightlyPlayed` | `Lightly Played` | 4–10 |
| `xray.condition.played` | `Played` | 11–30 |
| `xray.condition.heavilyPlayed` | `Heavily Played` | 31–80 |
| `xray.condition.damaged` | `Damaged` | 81 or more |
| `xray.title.clean` | `Suspiciously Clean` | X1 §7 rules |
| `xray.title.lastDecimal` | `Held to the Last Decimal` | - |
| `xray.title.collector` | `Complete Set Collector` | - |
| `xray.title.dustBunny` | `Dust Bunny` | - |
| `xray.title.bagholder` | `Certified Bagholder` | - |
| `xray.oneLiner.clean` | `Clean. Suspiciously clean.` | 0 bags only |
| `xray.oneLiner.collected` | `You didn’t lose money. You collected it.` | X1 §7 order 1 |
| `xray.oneLiner.holding` | `Down 96%. Still holding. Respect.` | Only if worst ≥ 96 |
| `xray.oneLiner.tops` | `Every top, collected.` | - |
| `xray.oneLiner.counts` | `{n} bags. {d} are dust. {e} accounts are sitting on your rent.` | Only if `n`, `d`, `e` ≥ 2 |
| `xray.oneLiner.worst` | `Worst bag: {ticker}, {pct} from ATH. A classic.` | Only with a worst bag |
| `xray.oneLiner.charts` | `The charts went down. The collection went up.` | - |
| `xray.oneLiner.hands` | `Diamond hands. Mostly by accident.` | - |
| `xray.seg.bags.one` | `1 bag` | First segment of the line |
| `xray.seg.bags.other` | `{n} bags` | - |
| `xray.seg.feedable` | `{n} feedable` | Held at `S` only |
| `xray.seg.checkAtFeed` | `{n} to check at Feed` | Only when > 0 |
| `xray.seg.bid.one` | `1 has a bid ≈{sol} SOL est.` | Capped estimate |
| `xray.seg.bid.other` | `{n} have a bid ≈{sol} SOL est.` | - |
| `xray.seg.empty.one` | `1 empty account ≈{sol} SOL rent back` | - |
| `xray.seg.empty.other` | `{n} empty accounts ≈{sol} SOL rent back` | - |
| `xray.linePrefix` | `X-ray: {who}` | `xrayLine` = prefix ✳ segments (bot); `og:description` = segments only |
| `xray.section.feedable` | `Feedable` | - |
| `xray.section.checkAtFeed` | `To check at Feed` | - |
| `xray.section.notFeedable` | `Not feedable this season` | - |
| `xray.section.bid` | `Has a bid` | - |
| `xray.section.notInSet` | `Not in the set` | - |
| `xray.stat.feed.one` | `1 bag to feed` | Stat tile: feedable and to check at Feed together; the number large |
| `xray.stat.feed.other` | `{n} bags to feed` | Stat tile |
| `xray.stat.bid.one` | `1 bag with a bid` | Under the bid stat (`common.est` of their total) |
| `xray.stat.bid.other` | `{n} bags with a bid` | Stat tile |
| `xray.notInSet.one` | `1 not eligible · why?` | "Not in the set", closed behind its count; open, each reason once, then the coins |
| `xray.notInSet.other` | `{n} not eligible · why?` | Closed by default |
| `xray.feedableLabel` | `{min}–{max} SOL when it’s pulled` | Under "Feedable", once: OG and AH royalties from config (PARAMS §19) |
| `xray.rentBack` | `≈{sol} SOL refund` | Actual lamports of the accounts: a stat tile, with `count.emptyAccounts` under it |
| `xray.amountUnavailable` | `Amount unavailable` | Mint missing |
| `xray.empty` | `No bags in the set.` | - |
| `xray.result.partial` | `Some values are unavailable right now. Try again soon.` | Only when `valuesPartial` (D25) |

### 2.3 Reasons (one per X1 reason code)

| Key | Text | Notes |
|---|---|---|
| `xray.reason.not_pump_fun` | `Not from pump.fun` | - |
| `xray.reason.token_extensions` | `Not supported (token extensions)` | - |
| `xray.reason.mint_authority` | `Not supported (mint authority still set)` | - |
| `xray.reason.freeze_authority` | `Not supported (freeze authority still set)` | - |
| `xray.reason.decimals` | `Not supported (more than {limit} decimals)` | `{limit}` = `FEED_RULES.maxMintDecimals` |
| `xray.reason.unknown_program` | `Not supported (unknown token program)` | - |
| `xray.reason.mint_unparseable` | `Not supported (unreadable mint)` | - |
| `xray.reason.mint_missing` | `Not supported (mint not found)` | - |
| `xray.reason.excluded` | `Not in the set (SOL and $1PCT stay out)` | - |
| `xray.reason.snapshot_not_held` | `Not feedable this season (bought after {date})` | `{date}` = block time of `S` |
| `xray.reason.snapshot_not_held_undated` | `Not feedable this season` | Block time unavailable |
| `xray.reason.snapshot_at_feed` | `Final check when you Feed` | Unknown or unchecked snapshot status |

### 2.4 Card and share

| Key | Text | Notes |
|---|---|---|
| `xray.card.head` | `X-ray ✳ {who}` | Share image |
| `xray.card.bottom` | `The machine takes your dust ✳ onepercent.fun` | Bottom band |
| `xray.card.alt` | `X-ray card. {segments}` | `alt` of the card image |
| `xray.og.title` | `X-ray ✳ {who}` | `og:title` |
| `xray.share.intent.one` | `X-ray ✳ 1 bag ✳ {title}` | X intent text; the link carries `ref` |
| `xray.share.intent.other` | `X-ray ✳ {n} bags ✳ {title}` | - |
| `xray.share.fallback` | `View the X-ray` | Link in the no-shell share page |

### 2.5 After a scan

| Key | Text | Notes |
|---|---|---|
| `xray.cta.feedMine` | `Feed my bags →` | The connected wallet is the scanned one and `FEED` is on |
| `xray.cta.connect` | `Connect to feed these bags` | No wallet connected |
| `xray.cta.feedOpens` | `Feed opens at Stock-Up ✳ {date}` | `FEED` off, `stock_up_ts` set |
| `xray.cta.feedOpensUndated` | `Feed opens at Stock-Up` | `stock_up_ts` not set |
| `xray.cta.yours` | `X-ray your wallet` | Someone else’s address |
| `xray.cta.another` | `X-ray another wallet` | - |

### 2.6 API errors (the `message` of each X-ray error code)

| Key | Text | Notes |
|---|---|---|
| `xray.error.evm_not_supported` | `Solana wallets only for now.` | SPEC §2.1 |
| `xray.error.invalid_address` | `That’s not a Solana wallet address.` | Also for a `.sol` name (D9) |
| `xray.error.name_not_found` | `No wallet uses that name. Paste the address.` | - |
| `xray.error.name_resolution_failed` | `That name didn’t resolve. Paste the address.` | - |
| `xray.error.wallet_too_large` | `This wallet has more than {limit} token accounts. X-ray can’t read it yet.` | `{limit}` = `XRAY.maxTokenAccounts` |
| `xray.error.scan_timeout` | `The X-ray took too long. Try again.` | - |
| `xray.error.upstream_failed` | `Wallet data didn’t load. Try again.` | - |
| `xray.error.prices_unavailable` | `Prices didn’t load. Try again.` | - |
| `xray.error.rate_limited` | `Too many X-rays from here. Try again in {s} s.` | From `Retry-After` |
| `xray.error.turnstile_required` | `One quick check, then the X-ray runs.` | - |
| `xray.error.not_in_fixtures` | `This wallet isn’t in the test set.` | Fixtures mode only |
| `xray.error.invalid_format` | `Pick landscape or square.` | `card.png` |
| `xray.error.invalid_response` | `The X-ray came back unreadable. Try again.` | Schema-invalid body |
| `xray.error.unavailable` | `X-ray is unavailable. Try again.` | Anything else |

### 2.7 Accessibility

| Key | Text | Notes |
|---|---|---|
| `xray.aria.result` | `X-ray result for {who}` | Region label |
| `xray.aria.share` | `Share options` | Group label |

---

## 3. Feed and take-back

### 3.1 Panel

| Key | Text | Notes |
|---|---|---|
| `feed.titleNoWallet` | `Feed the machine.` | The Feed page’s one title (the wallet is in the header) |
| `feed.connect` | `Connect a wallet to see what you can feed.` | - |
| `feed.loading` | `Reading your wallet…` | - |
| `feed.quoting` | `Getting quotes…` | - |

### 3.2 Groups and rows

| Key | Text | Notes |
|---|---|---|
| `feed.group.feed.one` | `1 bag to feed` | The list’s title |
| `feed.group.feed.other` | `{n} bags to feed` | The list’s title |
| `feed.group.leftAlone` | `Not in the set, no bid ✳ left alone` | - |
| `feed.group.out.one` | `1 not eligible · why?` | The bags that can’t be fed, closed behind their count; open, each reason once, then the coins |
| `feed.group.out.other` | `{n} not eligible · why?` | Closed by default |
| `feed.row.feed` | `Feed` | The row’s checkbox, on by default; off leaves the bag in the wallet |
| `feed.row.roi` | `≈{sol} SOL` | One per bag: what it fetches if sold now, beside its "up to N×" badge |
| `feed.row.multiple` | `up to {n}×` | `feedUpTo`: the most a Dust Card pays over the bag’s sold-now value, rounded down; from 2×; a bold badge |
| `feed.row.checkAtFeed` | `Final check when you Feed` | Once, as a footnote under the list; a * marks the bags it covers when only some get it |
| `feed.rentRefund` | `Closing empty accounts also refunds ≈{sol} SOL` | One quiet line below the list, when bags are checked: the empty accounts closed in the Feed transaction (actual lamports) |
| `feed.row.needsConfirm` | `Feed needs a confirmation` | Quote above `FEED_RULES.confirmAboveLamports` |
| `feed.row.noBid` | `No bid now` | - |

### 3.3 Guards

| Key | Text | Notes |
|---|---|---|
| `feed.confirm.title` | `Feed this bag?` | - |
| `feed.confirm.body` | `You’ll get {min}–{max} SOL when it’s pulled, not the ≈{sol} SOL it sells for now.` | `{sol}` = the bag’s executable quote |
| `feed.confirm.yes` | `Feed it` | - |
| `feed.confirm.no` | `Keep it in my wallet` | - |
| `feed.capLeft.one` | `You can feed 1 more fresh bag now; more when some are pulled.` | - |
| `feed.capLeft.other` | `You can feed {n} more fresh bags now; more when some are pulled.` | - |
| `feed.capReached` | `{cap} fresh cards already in the machine; more when some are pulled` | SPEC §2.6 |
| `feed.merge.one` | `1 bag sits in several token accounts: it is merged first ({approvals}).` | Whole-bag rule |
| `feed.merge.other` | `{n} bags sit in several token accounts: they are merged first ({approvals}).` | - |

### 3.4 Deposits and rent back

| Key | Text | Notes |
|---|---|---|
| `feed.deposits.total` | `+{sol} SOL refundable deposit` | `solCost`, after the approvals under the button |
| `feed.deposits.entry.one` | `1 Deck entry × {each} SOL ✳ back when the card leaves the machine` | - |
| `feed.deposits.entry.other` | `{n} Deck entries × {each} SOL ✳ each back when its card leaves the machine` | - |
| `feed.deposits.newCoin.one` | `The first card of a new coin also pays ≈{sol} SOL for that coin’s vault; it comes back to you when that coin’s vault is empty.` | Master §11.4 M3.2 |
| `feed.deposits.newCoin.other` | `The first cards of {n} new coins also pay ≈{sol} SOL each for their vaults; each comes back to you when that coin’s vault is empty.` | - |
| `feed.deposits.myCards` | `+{sol} SOL to open My cards (back when you close it)` | A wallet’s first Feed |
| `feed.rentBack.emptied.one` | `Emptying the bag also refunds +{sol} SOL` | “Refund”, as `feed.rentRefund` and the X-ray |
| `feed.rentBack.emptied.other` | `Emptying {n} bags also refunds +{sol} SOL` | - |

### 3.5 Summary, button and trust

| Key | Text | Notes |
|---|---|---|
| `feed.machineToday` | `Machine today: {deck} cards ✳ {pulls} pulled in 24 h ✳ your {cards} ≈{sol} SOL a day if pulled at today’s pace` | PARAMS §18 formula |
| `feed.outlook.upTo` | `up to {n}×` | The hero stat, gold, for the bags together: the most their Dust Cards can pay when pulled (`FEED_BACK_RANGE.max` each) over what they fetch if sold now, rounded down; like `feed.row.multiple`, only bags with a value count and it shows from 2×. Top of the Feed page and end of the X-ray result; without it, the hero is `feed.outlook.expected`’s amount |
| `feed.outlook.whenPulled` | `when a pack pulls it` | Under the hero’s number |
| `feed.outlook.expected` | `≈{sol} SOL expected` | Under it: one Dust Card per bag × the edition-mix estimate (`feedBackEstimate`) |
| `feed.outlook.soldNow` | `≈{sol} SOL if sold now` | The second stat, small and muted: what the bags fetch if sold now |
| `feed.outlook.soldEst` | `≈{sol} SOL est. for these bags` | The X-ray’s second stat: its values are estimates (§0.4), never “if sold now” |
| `feed.outlook.note` | `An estimate, not a promise. Take any card back until it’s pulled.` | Always under the outlook, once |
| `feed.button.feed` | `Feed {bags}` | The checked bags; the rent refund is `feed.rentRefund`, under the list |
| `feed.button.rentOnly` | `Close empty accounts · ≈{sol} SOL refund` | Only empty accounts, no bag checked |
| `feed.plan` | `{transactions}, {approvals}` | Under the button, before the trust line (PARAMS §19) |
| `feed.oneFirst` | `Feed 1 bag first` | - |
| `feed.trust` | `You sign everything. Take any card back until it’s pulled.` | Always under the button |
| `feed.explainer` | `Your wallet will show the tokens going to the 1% Machine vault.` | Always before signing |

### 3.6 Phase and gates

| Key | Text | Notes |
|---|---|---|
| `feed.phase.before` | `Feed opens at Stock-Up ✳ {date} {time}` | - |
| `feed.phase.beforeUndated` | `Feed opens at Stock-Up.` | - |
| `feed.phase.over` | `Season over ✳ Feed is closed ✳ take-back stays open forever` | - |
| `feed.phase.paused` | `Feed is paused for now ✳ take-back still works` | Guardian FEED bit |

### 3.7 Signing states

`errors.tooLong` covers an expired batch and `errors.walletNo` a rejected one.

| Key | Text | Notes |
|---|---|---|
| `feed.state.ready` | `Quotes good for {s} s.` | API quote expiry countdown |
| `feed.state.quoteExpired` | `Prices moved. Tap for a fresh quote.` | SPEC §2.6 |
| `feed.state.merging` | `Merging split accounts… {c}/{t} confirmed` | Phase 1 |
| `feed.state.attesting` | `Running the final check…` | Attestation request |
| `feed.state.signing` | `Check your wallet. {transactions}, {approvals}.` | - |
| `feed.state.sending` | `Feeding the machine… {c}/{t} confirmed` | - |
| `feed.state.done` | `Done. {cards} in the machine ✳ +{rent} SOL refund` | Landed figures only; the deposits were shown before signing |
| `feed.state.partial.one` | `{ok} of {t} went through. 1 bag is still in your wallet. Retry?` | - |
| `feed.state.partial.other` | `{ok} of {t} went through. {n} bags are still in your wallet. Retry?` | - |
| `feed.state.nothing` | `Nothing to feed. Mint condition.` | - |
| `feed.retry` | `Retry` | Rebuilds only what did not land |
| `feed.refresh` | `Refresh quotes` | - |

### 3.8 Refusals from the final check

One key per `FeedRefusal` reason and per guard code of the intake route (`02-M2-BRIEF.md` §11.4). A code without a key renders `feed.refusal.unknown` and is reported in the PR.

| Key | Text | Notes |
|---|---|---|
| `feed.refusal.snapshot_not_held` | `Not held at the snapshot (bought {date})` | SPEC §2.6 |
| `feed.refusal.snapshot_not_held_undated` | `Not held at the snapshot` | No `date` returned |
| `feed.refusal.not_bought` | `Not bought with a swap (airdrops don’t count)` | - |
| `feed.refusal.passed_on` | `This bag’s eligibility already went to another wallet` | - |
| `feed.refusal.hop_sender_ineligible` | `The wallet that sent it wasn’t eligible` | One hop only |
| `feed.refusal.hop_used` | `The wallet that sent it already used its eligibility` | - |
| `feed.refusal.live_card` | `Already in the machine` | SPEC §2.6 |
| `feed.refusal.zero_balance` | `No balance left` | - |
| `feed.refusal.not_whole_bag` | `Your balance changed. Tap again.` | - |
| `feed.refusal.fresh_cap` | `{cap} fresh cards already in the machine; more when some are pulled` | - |
| `feed.refusal.feed_closed` | `Feed is closed right now` | - |
| `feed.refusal.team_wallet` | `Team wallets don’t feed` | - |
| `feed.refusal.not_pump_fun` | `Not from pump.fun` | Hard-check mirror |
| `feed.refusal.not_supported` | `Not supported (token extensions)` | Hard-check mirror |
| `feed.refusal.mint_forbidden` | `Not in the set (SOL and $1PCT stay out)` | Hard-check mirror |
| `feed.refusal.indexer_lag` | `The final check is catching up. Try again in a minute.` | 503 |
| `feed.refusal.evidence_unavailable` | `The final check can’t read the history right now. Try again soon.` | 503 |
| `feed.refusal.service_down` | `The final check is offline. Try again soon.` | Other 503; take-back still works |
| `feed.refusal.unknown` | `Didn’t pass the final check` | - |

### 3.9 In the machine and take-back

| Key | Text | Notes |
|---|---|---|
| `takeBack.title` | `In the machine` | Tab and section |
| `takeBack.empty` | `None of your cards are in the machine.` | - |
| `takeBack.row` | `{ticker} ✳ {amount} tokens` | - |
| `takeBack.refed` | `Fed back from My cards` | REFED entry |
| `takeBack.button` | `Take back` | One card |
| `takeBack.buttonMany` | `Take back {cards} · {transactions}, {approvals}` | - |
| `takeBack.presign.one` | `Take back {ticker} ✳ {amount} tokens → your wallet ✳ +{deposit} SOL deposit back` | SPEC §2.2 |
| `takeBack.presign.other` | `Take back {cards} → your wallet ✳ +{deposit} SOL in deposits back` | - |
| `takeBack.ata` | `{accounts} need {sol} SOL (back when you close them)` | `{accounts}` = `count.newTokenAccounts`; `solCost` |
| `takeBack.done.one` | `Back in your wallet.` | - |
| `takeBack.done.other` | `{n} cards back in your wallet.` | - |
| `takeBack.pulled` | `That card was just pulled. +{sol} SOL is on its way to you.` | SPEC §2.6; royalty of that pack |
| `takeBack.pulledNoAmount` | `That card was just pulled. Its {pct} is on its way to you.` | Royalty amount not known yet |
| `takeBack.always` | `Take-back never pauses and stays open after the season.` | - |
| `takeBack.findCards` | `Find my cards` | Deck scan when the indexer is down |
| `takeBack.scanning` | `Reading the machine… {c}/{t}` | - |

### 3.10 Vault deposits

| Key | Text | Notes |
|---|---|---|
| `vault.title` | `Your vault deposits` | - |
| `vault.held` | `{ticker} vault ✳ {sol} SOL ✳ back when that coin’s vault is empty` | MintLedger `payer` is the wallet |
| `vault.returned` | `{ticker} vault ✳ {sol} SOL ✳ returned` | After `VaultClosed` |

### 3.11 Royalties

| Key | Text | Notes |
|---|---|---|
| `royalty.title` | `Royalties` | - |
| `royalty.digest.one` | `Your Dust Cards were pulled once in 24 h ✳ +{sol} SOL` | SPEC §2.2 |
| `royalty.digest.other` | `Your Dust Cards were pulled {n} times in 24 h ✳ +{sol} SOL` | - |
| `royalty.none` | `None of your Dust Cards were pulled in the last 24 h.` | - |
| `royalty.row` | `{edition} pack #{seq} pulled your {ticker} ✳ +{sol} SOL` | Links to `/verify/{seq}` |
| `royalty.redirected` | `This {pct} went to the stock: your wallet couldn’t receive it.` | `RoyaltyRedirected` for this wallet |

---

### 3.13 Trading-fee disclosures (D27)

Trading fees use the collected amount and the phase and book read at collection start. These strings extend issue 1 for M4.1; the token and fairness surfaces wire them when their lane ships. Values come from `STOCK.creatorFeeFloorLamports` and `CREATOR_FEE_SPLIT_BPS`, formatted by the existing `sol` and `pct` helpers. Stock means `stock_sol + Σ C(b)` at cost. Copy issue 1 contained no previous split strings to replace.

| Key | Text | Notes |
|---|---|---|
| `tradingFees.timing` | `Trading fees are split by the rule in force when they are collected.` | Required timing disclosure |
| `tradingFees.disclosure` | `2.5% on every $1PCT buy and sell: 2% to Onepercent (half to the boosters stock, half to the team), 0.5% to Meteora.` | D27 SEASON split; belowFloor and afterEnd exceptions follow |
| `tradingFees.belowFloor` | `Stock below {sol} SOL: {pct} of trading fees goes to the stock.` | PoweredOn or OnAir; floor and belowFloor.stock |
| `tradingFees.seasonStock` | `Stock at or above {sol} SOL: {pct} of trading fees goes to the stock, with no cap.` | PoweredOn or OnAir; floor and season.stock |
| `tradingFees.seasonTeam` | `{pct} goes to the team.` | season.team; follows seasonStock |
| `tradingFees.afterEnd` | `Once pack sales close, {pct} of trading fees goes to the team.` | Phase ≥ BuysClosed; afterEnd.team |
| `tradingFees.noBurn` | `Trading fees do not fund burn. The pack burn stays at {pct}.` | PACK_SPLIT_BPS.burn1pct |
| `tradingFees.seed` | `To seed the stock, send SOL to FeeIn and collect it. The same split applies.` | Direct SOL transfers create no depositor claim |

---

## 4. Issue 2 scope (D7)

Issue 2 adds these sections with the same rules. The founder authorized Codex to draft the remaining text on 2026-10-09. The draft in §7 is usable for implementation and remains subject to architect review in the PR. Live activation still requires the W3 checks.

- **Errors:** `machineChanged`, `refilling`, `hungry`, `busy`, `myCardsFull` (M1 §15.5) and `notFeedable`, `pullPending`, `myCardsNotEmpty` (M2 §8; `sellBackFallback` is §6.3), each worded so it never claims "nothing was charged" when a network fee was paid.
  - **Proposed for issue 2:** `errors.machineChanged` = `The machine changed while you were signing. No pack was bought, and the pack price stayed in your wallet.` It replaces M1 §15.5's reference string "…Nothing was charged.", which is false once a `buy_packs` transaction lands and fails: its network fee is spent. The new string holds in both cases: caught in simulation (nothing sent) or failed on chain (`LiveFlagsChanged`, the price never left the wallet).
- **Packs and Rip:** edition names and prices; the panel states (covered "Rip up to N now", refilling, hungry, Jackpot not live, before On Air, season over, busy, paused); quantity and Turbo; the pre-sign lines (draw fee, Pull deposit, card slots, My cards header, referral, holder, keep-balance warning); the trust line "Every draw can be verified."; Cranking, "Still cranking. The draw is on-chain.", the 300 s refund offer and refunded state.
- **Reveal:** Dust Card strip "→ {who} +{sol} SOL (depositor)", House Card, hit lines per tier with "stocked at" and "≈ … if sold now", Jackpot and The 1% lines (J-B), result bar, Turbo summary, `RevealFallback` text, Share and Verify.
- **My cards:** tabs, rows, the cover and toolbar, Close My cards "+{sol} SOL", withdraw owed, pending pulls (drawing, refundable, settling). Its actions, bulk bar and confirmations are §6.
- **Verify and fairness:** check labels, the VRF paragraph of M1 §10.7 in final form, the unrefunded draw fee, the Jackpot and creator-fee disclosures, the PARAMS §19 figures, "not live now: its width goes to Silver".
- **Live, token and 1% TV:** tiles, Highlights, the ticker formats of DA §9.4 rewritten for v2, the TV state labels ("On air" only with live data), the CA, The 1% cards and their release times, burns, trust lines ("Exits can’t be paused ✳ upgrades are timelocked 12 h by a 2-of-3 multisig ✳ …", "Sealed.").

## 5. B2 audit additions

Authorized in audit fix round 1. These keys cover the Rip image state and remove timing promises for bot features deferred by D18. They do not issue the remaining Bot/Blinks or issue 2 copy.

| Key | Text | Notes |
|---|---|---|
| `blink.rip.state.refilling` | `Refilling` | Rip image state label |
| `bot.alerts.fromOnAir` | `Alerts aren’t live yet.` | The existing key is retained; no launch timing is promised |
| `bot.me.placeholder` | `<b>Linked: {short}</b>\nOpen My cards to see your cards.\nAlerts: {mode} ✳ /alerts to switch.` | `{mode}` is the existing localized alert mode |
| `bot.hits.on` | `<b>Hit posts on.</b> Holo Foil and up. Posts aren’t live yet.` | Opt-in is saved; group posts remain deferred |

## 6. My cards and the Rip end (issue 2, first part, D30)

Founder decision D30 (2026-10-09): each card offers at most two actions, each with one clear number. Hits (Silver Foil to Black Foil): **Sell** (the `sell_back` instruction, the machine buys it now) or **Redeem**. Dust Cards: **Feed back** (one estimate, paid when a pack pulls it) or **Redeem**. The Jackpot and The 1%: **Redeem**. There is no Sell at market and no Keep: a card stays in My cards until its owner chooses. No market price stands next to the Sell price, in confirmations, Verify or the Rip end. The rest of My cards (tabs, rows, pending pulls, empty states) is still issue 2 (§4).

### 6.1 Page

| Key | Text | Notes |
|---|---|---|
| `cards.total` | `≈{sol} SOL in your cards` | The cover’s total line: the Sell value of the hits + the Feed back estimate of the Dust Cards + the Jackpot’s and The 1%’s own value (D30) |
| `cards.ripAgain` | `Rip again` | The page’s main call to action, in the dock (sticky on phones); opens Packs |

### 6.2 Actions

| Key | Text | Notes |
|---|---|---|
| `cards.choose` | `Choose an action` | The actions’ group label |
| `cards.choice.sell` | `Sell` | Hits; the `sell_back` instruction |
| `cards.figure.sell` | `+{sol} SOL · instant` | The signed Sell quote, on its own |
| `cards.choice.redeem` | `Redeem` | Every card; never closes |
| `cards.choice.redeem.line` | `Tokens to your wallet.` | The one action whose name needs a line |
| `cards.choice.feedBack` | `Feed back` | Dust Cards |
| `cards.figure.feedBack` | `≈{sol} SOL when it’s pulled` | `feedBackEstimate`: 2% of the expected pack price at the recent edition mix (`/api/machine` `feedBack.estimate`); one number, never a range |

### 6.3 When Sell is closed

Sell shows closed with one of these lines, and Redeem stays the action. There is no market fallback; the API refusal contains `ok: false` and `reason` only (cleanup #47).

| Key | Text | Notes |
|---|---|---|
| `cards.sell.refusal.refilling` | `The machine is refilling. Try again soon.` | Quote refusals `SOL_FLOOR`, `HOURLY_BUDGET`; landing errors `SellBackFloor`, `SellBackBudget` |
| `cards.sell.refusal.coin` | `The machine isn’t buying this coin right now.` | `CAP`, `BUCKET_DISABLED`, `MINT`; `BucketCapExceeded`, `BucketDisabled` |
| `cards.sell.refusal.noPrice` | `No price for this coin right now. Try again soon.` | `QUOTE_UNAVAILABLE` |
| `cards.sell.refusal.closed` | `Sell is closed right now.` | `PHASE` |
| `errors.sellBackFallback` | `The machine can’t buy this card right now.` | Any other refusal, and the SDK’s `sellBackFallback` (M2 §8) |

### 6.4 Bulk bar

| Key | Text | Notes |
|---|---|---|
| `cards.bulk.label` | `All your cards` | The bar’s group label |
| `cards.bulk.sell` | `Sell all hits · +{sol} SOL` | The hits whose Sell is open: the sum of their Sell quotes. Shown only when it applies, like the next two |
| `cards.bulk.feedBack` | `Feed back all dust · ≈{sol} SOL` | The Dust Cards whose Feed back is open, × the estimate |
| `cards.bulk.redeem` | `Redeem all` | Every card; also its sheet’s title |
| `cards.bulk.title.sell` | `Sell all hits` | Sheet title |
| `cards.bulk.title.feedBack` | `Feed back all dust` | Sheet title |
| `cards.bulk.partial` | `{ok} of {t} cards can do this now; the rest stay here.` | Some cards of that kind are closed |

### 6.5 Confirmations

One sentence on what happens and when it pays. The technical lines follow in one small details row, joined by ` ✳ `, never as main copy.

| Key | Text | Notes |
|---|---|---|
| `cards.lead.sell.one` | `The machine buys it now, and +{sol} SOL lands in your wallet with the transaction.` | `{sol}` = the signed Sell quote |
| `cards.lead.sell.other` | `The machine buys these {n} cards now, and +{sol} SOL lands in your wallet with the transactions.` | - |
| `cards.lead.redeem.one` | `{amount} {ticker} land in your wallet with the transaction.` | - |
| `cards.lead.redeem.other` | `The tokens of these {n} cards land in your wallet with the transactions.` | - |
| `cards.lead.feedBack.one` | `It goes into the next packs, and you get ≈{sol} SOL when one pulls it.` | The estimate |
| `cards.lead.feedBack.other` | `These {n} cards go into the next packs, and you get ≈{sol} SOL in all as packs pull them.` | The estimate × the cards |
| `cards.details.batch` | `{transactions}, {approvals}` | Details row |
| `cards.details.networkFee` | `Network fee ≈{sol} SOL` | `solCost` |
| `cards.details.ata.one` | `1 new token account needs {sol} SOL (back when you close it)` | Redeem; `solCost` |
| `cards.details.ata.other` | `{n} new token accounts need {sol} SOL (back when you close them)` | - |
| `cards.details.deposit.one` | `+{sol} SOL refundable deposit` | Feed back: the Deck entry deposit (`ENTRY_DEPOSIT`), back when the card leaves the machine; `solCost` |
| `cards.details.deposit.other` | `+{sol} SOL in refundable deposits` | - |
| `cards.feedBack.confirm.title` | `Feed this card back?` | A Dust Card above `FEED_RULES.confirmAboveLamports` (SPEC §2.2) |
| `cards.feedBack.confirm.body` | `You’ll get ≈{sol} SOL when it’s pulled, not the ≈{value} SOL it sells for now.` | `{value}` = its executable quote |
| `cards.feedBack.confirm.yes` | `Feed it back` | - |
| `cards.feedBack.confirm.titleMany` | `Feed these cards back?` | - |
| `cards.feedBack.confirm.bodyMany` | `You’ll get ≈{sol} SOL in all when they’re pulled, not the ≈{value} SOL these {n} sell for now.` | - |
| `cards.feedBack.confirm.yesMany` | `Feed them back` | - |

### 6.6 Buttons and results

| Key | Text | Notes |
|---|---|---|
| `cards.button.sell` | `Sell · +{sol} SOL` | The confirm button |
| `cards.button.sellQuoting` | `Sell` | While the quote loads |
| `cards.button.sellMany` | `Sell {cards} · +{sol} SOL` | - |
| `cards.button.redeem` | `Redeem` | - |
| `cards.button.redeemMany` | `Redeem {cards}` | - |
| `cards.button.feedBack` | `Feed back` | - |
| `cards.button.feedBackMany` | `Feed back {cards}` | - |
| `cards.done.sell` | `Sold. +{sol} SOL.` | Lamports actually received |
| `cards.done.redeem.one` | `In your wallet.` | - |
| `cards.done.redeem.other` | `{n} cards in your wallet.` | - |
| `cards.done.feedBack.one` | `Back in the machine.` | - |
| `cards.done.feedBack.other` | `{n} cards back in the machine.` | - |

### 6.7 Rip end

After the reveal a hit offers two choices: Sell, and Go to My cards, which opens My cards with that card highlighted. The Jackpot and The 1% offer Go to My cards. Dust Cards have no action there; they land in My cards. "Rip again" stays the strongest call to action. The Sell button reuses `cards.choice.sell` and `cards.figure.sell`.

| Key | Text | Notes |
|---|---|---|
| `rip.end.myCards` | `Go to My cards` | - |
| `rip.end.dust` | `Dust Cards land in My cards.` | A Dust Card’s line |
| `rip.end.sold` | `Sold.` | Toast beside the `+{sol} SOL` chip |
| `rip.end.soldChip` | `Sold · +{sol} SOL` | The result bar after a Sell |


## 7. Rip and public data (issue 2, draft by Codex, architect review)

Dated 2026-10-09. Authorized by the founder for M3.3 implementation. These strings follow §0; amounts, odds, release times and fees come from the authoritative config or confirmed chain reads. The 100-pull check verifies draw math and does not independently verify the provider proof. D30 applies to every surface.

### 7.1 Errors and Rip

| Key | Text | Notes |
|---|---|---|
| `errors.machineChanged` | `The machine changed while you were signing. No pack was bought, and the pack price stayed in your wallet.` | Draft for architect review |
| `errors.refilling` | `The machine is refilling. Try again soon.` | Draft for architect review |
| `errors.hungry` | `The machine needs more Dust Cards.` | Draft for architect review |
| `errors.busy` | `Machine busy. Try again shortly.` | Draft for architect review |
| `errors.myCardsFull` | `My cards is full. Redeem some cards, then try again.` | Draft for architect review |
| `errors.notFeedable` | `This card cannot go into the machine. Redeem stays open.` | Draft for architect review |
| `errors.pullPending` | `This Pull is still drawing.` | Draft for architect review |
| `errors.myCardsNotEmpty` | `My cards cannot close yet. Check its cards, deposits and pending Pulls.` | Draft for architect review |
| `rip.title` | `Rip a pack.` | Draft for architect review |
| `rip.editions` | `Edition` | Draft for architect review |
| `rip.button` | `Rip {n} · {sol} SOL` | Draft for architect review |
| `rip.again` | `Rip again · {sol} SOL` | Draft for architect review |
| `rip.change` | `Change pack` | Draft for architect review |
| `rip.reveal` | `Reveal` | Draft for architect review |
| `rip.reveal.tap` | `Tap to reveal` | Draft for architect review |
| `rip.reveal.auto` | `Auto` | Draft for architect review |
| `rip.turbo` | `Turbo` | Draft for architect review |
| `rip.balance` | `{sol} SOL in your wallet` | Draft for architect review |
| `rip.myCards` | `My cards →` | Draft for architect review |
| `rip.share` | `I pulled {title} on The 1% Machine. Dust in, Packs out.` | Draft for architect review |
| `rip.copied` | `Copied. Paste it anywhere.` | Draft for architect review |
| `rip.failed` | `The draw could not be shown. Check My cards.` | Draft for architect review |
| `rip.quantity` | `Packs` | Draft for architect review |
| `rip.quantity.option` | `×{n}` | Draft for architect review |
| `rip.next` | `Next pack` | Draft for architect review |
| `rip.progress` | `Pack {n} of {t}` | Draft for architect review |
| `rip.line` | `Your Pull` | Draft for architect review |
| `rip.preview.deposits` | `Refundable deposits · ≈{sol} SOL` | Draft for architect review |
| `rip.preview.depositsNote` | `Back when your cards leave or you close My cards.` | Draft for architect review |
| `rip.preview.details` | `Details` | Draft for architect review |
| `rip.preview.approvals` | `{transactions}, {approvals}` | Draft for architect review |
| `rip.preview.approvalsMax` | `Up to {transactions}, {approvals}` | Draft for architect review |
| `rip.preview.copyProgram` | `Copy program address` | Draft for architect review |
| `rip.preview.programCopied` | `Address copied.` | Draft for architect review |
| `rip.preview.copyFailed` | `Could not copy the address. Try again.` | Draft for architect review |
| `rip.preview.title` | `Before you Rip` | Draft for architect review |
| `rip.preview.price` | `{n} × {each} SOL` | Draft for architect review |
| `rip.preview.drawFee` | `Draw fee · {sol} SOL` | Draft for architect review |
| `rip.preview.drawFeeNote` | `Not refundable.` | Draft for architect review |
| `rip.preview.pullDeposit` | `Pull deposit · {sol} SOL` | Draft for architect review |
| `rip.preview.pullNote` | `Back when the Pull settles.` | Draft for architect review |
| `rip.preview.slots` | `Card slots · {sol} SOL` | Draft for architect review |
| `rip.preview.slotsNote` | `Back when the cards leave My cards.` | Draft for architect review |
| `rip.preview.binder` | `My cards account · {sol} SOL` | Draft for architect review |
| `rip.preview.binderNote` | `Back when you close My cards.` | Draft for architect review |
| `rip.preview.total` | `Total · ≈{sol} SOL` | Draft for architect review |
| `rip.preview.confirm` | `Sign and Rip` | Draft for architect review |
| `rip.preview.holder` | `Holder boost applied.` | Draft for architect review |
| `rip.preview.noHolder` | `Standard odds.` | Draft for architect review |
| `rip.preview.referrer` | `Referrer · {who}` | Draft for architect review |
| `rip.preview.keepBalance` | `This leaves less than {sol} SOL for future network fees.` | Draft for architect review |
| `rip.preview.networkEstimate` | `Network fee · ≈{sol} SOL` | Draft for architect review |
| `rip.preview.networkFee` | `Network fees are added to this amount.` | Draft for architect review |
| `rip.preview.program` | `Program · {program}` | Draft for architect review |
| `rip.unsupported` | `Cards open in a simple view on this device.` | Draft for architect review |
| `rip.timeout` | `The draw timed out. You can take back the pack price. The draw fee stays spent.` | Draft for architect review |
| `rip.refund` | `Take back SOL` | Draft for architect review |
| `rip.refunded` | `The pack price is back in your wallet.` | Draft for architect review |
| `rip.state.beforeOnAir` | `Packs open when the machine is On Air.` | Draft for architect review |
| `rip.state.busy` | `Machine busy. Try again shortly.` | Draft for architect review |
| `rip.state.hungry` | `The machine needs more Dust Cards.` | Draft for architect review |
| `rip.state.refilling` | `The machine is refilling.` | Draft for architect review |
| `rip.state.covered` | `Rip up to {n} now` | Draft for architect review |
| `rip.machineChanged` | `The machine changed. Review your Pull again.` | Draft for architect review |
| `rip.myCardsFull` | `My cards is full. Redeem some cards, then try again.` | Draft for architect review |
| `settle.prepend` | `Up to {transactions} settle earlier Pulls first.` | Draft for architect review |
| `settle.fees` | `Network fees for those Pulls ≈{sol} SOL.` | Draft for architect review |
| `settle.optional` | `Your action stays available if those Pulls cannot settle.` | Draft for architect review |

### 7.2 My cards

| Key | Text | Notes |
|---|---|---|
| `cards.feedBack.confirm.unavailable` | `No executable quote is available for this selection. You can still Feed back or Redeem.` | Draft for architect review |
| `cards.title` | `My cards` | Draft for architect review |
| `cards.unvalued.one` | `1 card has no value now` | Draft for architect review |
| `cards.unvalued.other` | `{n} cards have no value now` | Draft for architect review |
| `cards.owed.label` | `Owed to you` | Draft for architect review |
| `cards.owed.withdraw` | `Withdraw` | Draft for architect review |
| `cards.close.button` | `Close My cards ✳ +{sol} SOL` | Draft for architect review |
| `cards.close.line` | `My cards is empty. Close it and its deposit comes back to you.` | Draft for architect review |
| `cards.tabs.label` | `Filter cards` | Draft for architect review |
| `cards.tab.all` | `All` | Draft for architect review |
| `cards.tab.hits` | `Hits` | Draft for architect review |
| `cards.tab.dust` | `Dust` | Draft for architect review |
| `cards.tab.pending` | `Pending` | Draft for architect review |
| `cards.sort.label` | `Sort` | Draft for architect review |
| `cards.sort.value` | `Value` | Draft for architect review |
| `cards.sort.newest` | `Newest` | Draft for architect review |
| `cards.sort.tier` | `Tier` | Draft for architect review |
| `cards.view.grid` | `Grid` | Draft for architect review |
| `cards.view.list` | `List` | Draft for architect review |
| `cards.kind.dust` | `Dust Card` | Draft for architect review |
| `cards.kind.silver` | `Silver Foil` | Draft for architect review |
| `cards.kind.blue` | `Blue Foil` | Draft for architect review |
| `cards.kind.holo` | `Holo Foil` | Draft for architect review |
| `cards.kind.black` | `Black Foil` | Draft for architect review |
| `cards.kind.jackpot` | `Jackpot` | Draft for architect review |
| `cards.kind.one_pct` | `The 1%` | Draft for architect review |
| `cards.kind.spotlight` | `Spotlight` | Draft for architect review |
| `cards.kind.final` | `Final Pull card` | Draft for architect review |
| `cards.kindWithMult` | `{name} {mult}` | Draft for architect review |
| `cards.face.dustOrigin` | `pump.fun ✳ Solana` | Draft for architect review |
| `cards.face.final` | `The Final Pull` | Draft for architect review |
| `cards.face.mantra` | `RIP. REVEAL. OWN.` | Draft for architect review |
| `cards.card.aria` | `{name}, {amount} {ticker}, {value}` | Draft for architect review |
| `cards.card.ariaAmount` | `{name}, {amount} {ticker}` | Draft for architect review |
| `cards.from` | `{edition} ✳ pull #{seq}` | Draft for architect review |
| `cards.figure.tokens` | `{amount} {ticker}` | Draft for architect review |
| `cards.state.sending` | `Sending… {c}/{t} confirmed` | Draft for architect review |
| `cards.done.owed` | `+{sol} SOL to your wallet.` | Draft for architect review |
| `cards.done.close` | `My cards closed. +{sol} SOL back.` | Draft for architect review |
| `cards.done.refund` | `Refunded. +{sol} SOL.` | Draft for architect review |
| `cards.done.settle` | `Settled.` | Draft for architect review |
| `cards.wallet.balance` | `{sol} SOL in your wallet` | Draft for architect review |
| `cards.pending.pack` | `{edition} ×{n}` | Draft for architect review |
| `cards.pending.pull` | `pull #{seq}` | Draft for architect review |
| `cards.pending.drawing` | `Cranking…` | Draft for architect review |
| `cards.pending.slow` | `Still cranking. The draw is on-chain.` | Draft for architect review |
| `cards.pending.refundable` | `No draw came back. Refund the full price.` | Draft for architect review |
| `cards.pending.settling` | `Drawn. Settling…` | Draft for architect review |
| `cards.pending.refund` | `Refund · +{sol} SOL` | Draft for architect review |
| `cards.pending.refundNoAmount` | `Refund` | Draft for architect review |
| `cards.pending.settle` | `Settle` | Draft for architect review |
| `cards.empty.title` | `No cards yet.` | Draft for architect review |
| `cards.empty.hits` | `No hits here yet. Silver Foil and up land in this tab.` | Draft for architect review |
| `cards.empty.dust` | `No Dust Cards here.` | Draft for architect review |
| `cards.empty.pending` | `Nothing pending. Every pull is drawn.` | Draft for architect review |
| `cards.dock.label` | `Wallet and machine` | Draft for architect review |
| `cards.machine.aria` | `In the machine, {n}` | Draft for architect review |

### 7.3 Public data, Verify and fairness

| Key | Text | Notes |
|---|---|---|
| `public.updated` | `Confirmed at slot {s}` | Draft for architect review |
| `public.refresh` | `Refresh` | Draft for architect review |
| `public.chainUnavailable` | `The machine’s confirmed state is unavailable.` | Draft for architect review |
| `public.stale` | `The last read is shown. Live data is unavailable.` | Draft for architect review |
| `public.details` | `Details` | Draft for architect review |
| `public.unknown` | `Not available` | Draft for architect review |
| `public.edition` | `Edition` | Draft for architect review |
| `public.tier` | `Card` | Draft for architect review |
| `public.liveNow` | `Live now` | Draft for architect review |
| `public.notLive` | `Not live now: its width goes to Silver.` | Draft for architect review |
| `public.baseOdds` | `Published odds with both specials live.` | Draft for architect review |
| `public.onePct` | `The 1%` | Draft for architect review |
| `public.jackpot` | `Jackpot` | Draft for architect review |
| `public.dust` | `Dust Card` | Draft for architect review |
| `public.silver` | `Silver Foil` | Draft for architect review |
| `public.blue` | `Blue Foil` | Draft for architect review |
| `public.holo` | `Holo Foil` | Draft for architect review |
| `public.black` | `Black Foil` | Draft for architect review |
| `public.sealed` | `Sealed. The program has no upgrade authority.` | Draft for architect review |
| `public.timelocked` | `Program upgrades require {n} approvals and a {s}-second timelock.` | Draft for architect review |
| `verify.heading` | `Verify pull #{seq}` | Draft for architect review |
| `verify.intro` | `The draw, recomputed in your browser.` | Draft for architect review |
| `verify.empty` | `This Pull has no readable reveal yet.` | Draft for architect review |
| `verify.error` | `The Pull could not be checked. Try again.` | Draft for architect review |
| `verify.passed` | `Draw checks match.` | Draft for architect review |
| `verify.failed` | `Draw checks do not match.` | Draft for architect review |
| `verify.refunded` | `This Pull was refunded.` | Draft for architect review |
| `verify.rpc` | `Source: confirmed Solana transactions.` | Draft for architect review |
| `verify.indexer` | `Source: the indexer archive. Transaction data could not be read.` | Draft for architect review |
| `verify.proof` | `This page checks the draw math. It does not independently verify MagicBlock’s provider proof.` | Draft for architect review |
| `verify.seed` | `Request seed` | Draft for architect review |
| `verify.match` | `Matches` | Draft for architect review |
| `verify.mismatch` | `Does not match` | Draft for architect review |
| `verify.unchecked` | `Not checked` | Draft for architect review |
| `verify.slot` | `Reveal slot` | Draft for architect review |
| `verify.order` | `Reveal order` | Draft for architect review |
| `verify.tableHash` | `Odds table SHA-256` | Draft for architect review |
| `verify.paramsHash` | `Published parameter hash` | Draft for architect review |
| `verify.pack` | `Pack {n}` | Draft for architect review |
| `verify.draw` | `Draw number` | Draft for architect review |
| `verify.widths` | `Segment widths` | Draft for architect review |
| `verify.bucket` | `Stock bucket, recorded` | Draft for architect review |
| `verify.bucketNote` | `The bucket is recorded. Rechecking it requires the stock at that slot.` | Draft for architect review |
| `verify.dust` | `Dust index {n}` | Draft for architect review |
| `verify.transactions` | `Transactions` | Draft for architect review |
| `verify.request` | `VRF request` | Draft for architect review |
| `verify.callback` | `VRF callback` | Draft for architect review |
| `verify.settle` | `Settle {n}` | Draft for architect review |
| `fairness.vrf.title` | `VRF` | Draft for architect review |
| `fairness.vrf.summary` | `One oracle. Timing can change.` | Draft for architect review |
| `fairness.state.title` | `Outcomes` | Draft for architect review |
| `fairness.state.summary` | `Depend on the machine when your draw lands.` | Draft for architect review |
| `fairness.refund.title` | `Timed-out draws` | Draft for architect review |
| `fairness.refund.summary` | `Pack price back. Draw fee stays spent.` | Draft for architect review |
| `fairness.sell.title` | `Sell` | Draft for architect review |
| `fairness.sell.summary` | `Machine price, paid in SOL. Can pause.` | Draft for architect review |
| `fairness.jackpot.title` | `Jackpot` | Draft for architect review |
| `fairness.jackpot.summary` | `Paid in $1PCT. Redeem only.` | Draft for architect review |
| `fairness.creator.title` | `Trading fees` | Draft for architect review |
| `fairness.creator.summary` | `Stock and team. No burns.` | Draft for architect review |
| `fairness.intro` | `Every edition. Every range.` | Draft for architect review |
| `fairness.pendingDraws` | `Pack sales are closed. These widths still apply to pending Pulls.` | Draft for architect review |
| `fairness.odds` | `Odds per pack` | Draft for architect review |
| `fairness.probability` | `Probability` | Draft for architect review |
| `fairness.holder` | `Holder probability` | Draft for architect review |
| `fairness.oneIn` | `1 in {n}` | Draft for architect review |
| `fairness.design` | `Design figures` | Draft for architect review |
| `fairness.stocked` | `≈{pct} at stocked value, including the Jackpot allocation.` | Draft for architect review |
| `fairness.realized` | `Realized figures are not available yet.` | Draft for architect review |
| `fairness.disclosures` | `Before you Rip` | Draft for architect review |
| `fairness.vrf` | `MagicBlock’s VRF output is checked on-chain by its upgradeable program. MagicBlock runs one oracle. It can delay or withhold a draw and chooses when draws land, including their order. The operator could withhold its own losing draws.` | Draft for architect review |
| `fairness.state` | `Timing changes outcomes: The 1% and Jackpot availability move the ranges of the other tiers. Dust Cards, the stock coin and its token amount depend on the machine when your draw lands.` | Draft for architect review |
| `fairness.refund` | `After {s} seconds without a reveal, you can take the pack price back. The {sol} SOL draw fee is not refunded.` | Draft for architect review |
| `fairness.sell` | `Sell pays a price set by the machine, instantly, in SOL. It can pause when its budget runs out. Redeem stays available.` | Draft for architect review |
| `fairness.jackpot` | `The Jackpot is paid in $1PCT. Its token amount and market value change. It cannot be sold to the machine.` | Draft for architect review |
| `fairness.creator` | `Trading fees refill stock below its floor. Otherwise, during pack sales, half goes to stock and half to the team. Once pack sales close, all goes to the team. Trading fees do not fund burns.` | Draft for architect review |

### 7.4 Live and token

| Key | Text | Notes |
|---|---|---|
| `live.intro` | `The machine, as it happens.` | Draft for architect review |
| `live.stock` | `Stocked value` | Draft for architect review |
| `live.deck` | `Dust Cards in the Deck` | Draft for architect review |
| `live.pending` | `Pending Pulls` | Draft for architect review |
| `live.jackpot` | `Jackpot tokens` | Draft for architect review |
| `live.highlights` | `Highlights` | Draft for architect review |
| `live.today` | `Today` | Draft for architect review |
| `live.season` | `This season` | Draft for architect review |
| `live.noHighlights` | `No confirmed hits in this window.` | Draft for architect review |
| `live.highlight` | `{who} pulled {title}` | Draft for architect review |
| `live.tv` | `1% TV` | Draft for architect review |
| `live.onAir` | `On Air` | Draft for architect review |
| `live.offline` | `Signal unavailable` | Draft for architect review |
| `live.waiting` | `Waiting for confirmed events.` | Draft for architect review |
| `live.paused` | `Broadcast paused.` | Draft for architect review |
| `live.event.pull` | `{who} pulled {title}` | Draft for architect review |
| `live.event.feed` | `{who} fed the machine` | Draft for architect review |
| `live.event.system` | `The machine changed phase.` | Draft for architect review |
| `live.state.buysClosed` | `Pack sales closed` | Draft for architect review |
| `live.state.idle` | `Standby` | Draft for architect review |
| `live.state.countdown` | `Power-On` | Draft for architect review |
| `live.state.onAir` | `On Air` | Draft for architect review |
| `live.state.lastCall` | `Last Call` | Draft for architect review |
| `live.state.finalPull` | `The Final Pull` | Draft for architect review |
| `live.state.sealed` | `Season closed` | Draft for architect review |
| `live.countdown` | `On Air in {time}` | Draft for architect review |
| `live.highlightValue` | `{sol} SOL stocked value when pulled` | Draft for architect review |
| `live.highlightsUnavailable` | `Highlights are unavailable.` | Draft for architect review |
| `live.totalsUnavailable` | `Machine totals are unavailable.` | Draft for architect review |
| `live.disabled` | `The broadcast is off.` | Draft for architect review |
| `token.intro` | `The coin inside the specials.` | Draft for architect review |
| `token.address` | `Contract address` | Draft for architect review |
| `token.before` | `The contract address appears at Power-On.` | Draft for architect review |
| `token.launch` | `$1PCT launches on Meteora DBC and migrates to DAMM v2.` | Draft for architect review |
| `token.slots` | `The 1% cards` | Draft for architect review |
| `token.card` | `The 1% · {n}` | Draft for architect review |
| `token.amount` | `{amount} $1PCT` | Draft for architect review |
| `token.burned` | `$1PCT burned` | Draft for architect review |
| `token.waiting` | `Waiting for release` | Draft for architect review |
| `token.pulled` | `Pulled` | Draft for architect review |
| `token.final` | `Moved to The Final Pull` | Draft for architect review |
| `token.release` | `Scheduled release: {date} {time}` | Draft for architect review |
| `token.releasePending` | `Release starts from On Air.` | Draft for architect review |
| `token.preceding` | `Later cards wait for every earlier card to be pulled.` | Draft for architect review |
| `token.jackpot` | `Jackpot pot` | Draft for architect review |
| `token.jackpotCost` | `SOL used to buy the pot` | Draft for architect review |
| `token.conversion` | `SOL waiting for conversion` | Draft for architect review |
| `token.noEstimate` | `No executable SOL quote is available.` | Draft for architect review |
