# Codex brief — M5: Telegram bot and Blinks, the rest of M5.1 and all of M5.2 (The 1% Machine)

Issued 2026-10-16 (D7) by the architect. **X3 is M5.1's core and is merged** (`X3-BOT-BLINKS-BRIEF.md`, PR #6, commit `a1dcc71` on `main`): the bot `@OnePercentAutoBot`, the X-ray Blink and the SIWS wallet link. This brief does not re-specify X3. It gives the delta on X3's code for the rest of M5.1, then all of M5.2. Two PRs and two gates: **G5.1** (D10; the bot is public from X-ray Week) and **G5.2** (D14; alerts and the Rip Blink turn on at On Air). Gate **G5** as a whole is a non-custodial review (§15).

Read it with `AGENTS.md`, `DECISIONS.md` (D1–D14), `00-MASTER-BRIEF.md` (§3, §6, §7, §9, §10, §11.4 M5, §11.5), `02-M2-BRIEF.md` §11, `03-M3-BRIEF.md` §5, §7, §8, §12, `PARAMS.md` §18, and X3's merged code. If anything is ambiguous, contradictory or impossible, **stop and report with options**. Do not guess.

---

## 0. Read this first

### 0.1 Authority

Master §0.1 applies, highest first: `DECISIONS.md` (binding), `MODEL.md`, `PARAMS.md` (issue 3; the operational keys of §4.2 are pending issue 4), `00-MASTER-BRIEF.md`, **this brief** (for M5), `00-M0-SCAFFOLD.md` as migrated by M0.1, `AGENTS.md`, then `COPY.md`.

- **X3's merged code is the base.** Where this brief names no change, X3's behaviour, copy and tests stand.
- `02-M2-BRIEF.md` owns the API routes it implements (schemas in `@onepercent/sdk/api`), the indexer tables and the M2 part of `packages/db`. `03-M3-BRIEF.md` owns the web router, `packages/copy`, `packages/web-api` and `wallet/deeplinks.ts`. M5 consumes them; what it needs from them is listed under "Amendments proposed to other docs" at the end.
- "M1 §x", "M2 §x", "M3 §x", "X1 §x", "X3 §x" mean the sections of those briefs; "master §x" means `00-MASTER-BRIEF.md`; "SPEC §x" is MODEL-SPEC v2 (provenance only).
- Items marked **(pending founder)** wait on the questions at the end. The body says what ships until they are answered.

### 0.2 Scope versus the master plan

| Master §11.4 M5 item | Where | PR |
|---|---|---|
| `/start [ref]` | X3 as merged; state in Postgres (§5) | B1 |
| `/xray <addr>` | X3, plus D9 (M5-A1), the sharer's code in share links (§7.2), one Feed button (M5-A4) | B1 |
| `/machine`, a countdown before On Air | §7.3 | B1 |
| `/link`, SIWS in the wallet's browser | X3 as merged; Postgres store and `/unlink` (M5-A6) in B1; the Backpack button in B2 | B1, B2 |
| Messages in the DA §12 format, with v2 copy | §7.6 and the copy keys of amendment 1 | B1 |
| The deep-link session service: single-use ids, valid for 10 minutes | §6 | B1 |
| The X-ray Blink | X3, plus D9 and `BLINKS_XRAY` (§10.3) | B1 |
| `/feed` and `/rip [edition] [n]` deep links for Phantom, Solflare and Backpack | §6.3, §7.2: Phantom and Solflare through `/go` in B1, Backpack in B2 | B1, B2 |
| `/me` and `/alerts`: opt-in DMs, the daily royalty digest, Holo-and-up group posts through a priority queue at ≤ 25 msg/s | §7.4, §7.5, §8 | B2 |
| The Rip, Feed and Highlight Blinks, and the Dialect registration | §10.4–§10.9 | B2 |
| **Not in M5** | Spotlight (D1). Any transaction built or signed by the bot. A Mini App, Stars, payments, paid broadcasts. A referral alias resolver (pending founder, Q2). A countdown to a date the chain has not fixed (pending founder, Q1). The status page (M6.1) | — |

### 0.3 What X3 already ships (do not rebuild)

| Area | X3 code on `main` | M5 keeps |
|---|---|---|
| Bot shell | `createBot(deps)`, `ALLOWED_UPDATES` (`message`, `callback_query`, `my_chat_member`), command menus, the per-update rate-limit middleware (first refusal answered, later ones silent), graceful shutdown, "bot disabled" exit 0 | All of it; §7 adds commands, stores, the lock and health |
| Secret guard | `guard.ts`: 12, 15, 18, 21 or 24 words of 3–8 letters (any case), 85–90 base58 characters, or a list of 64 bytes, in text, command arguments or captions; deletes the message, replies SECRET_GUARD, keeps nothing | Unchanged |
| Referral capture | `referral.ts`: `/start ref_<code>`, first code wins, codes per X3 §3.4 | Parser unchanged; the `.sol` pattern goes (M5-A1) |
| Commands | `/start`, `/xray`, `/feed`, `/rip`, `/link`, `/me`, `/alerts`, `/hits`, plain-text X-rays, callback `xray_help` | Kept except the rows of §7.2 |
| Notifier | `notify/sender.ts`: gates (started, opted in, tier ≥ Holo, group opt-in), throttle (25/s, 1 s per chat, 20/min per group), 403 → `markBlocked`, one 429 retry; `notify/templates.ts` (royalty, Holo, Black, Jackpot, The 1%); no production caller | Gates, error mapping and templates; §8 adds the queue, the sources and the caller |
| Clients | `clients/xray.ts` (bearer when the secret is set, 12 s timeout, error mapping), `clients/link.ts` (`createNonce`, `walletOf`) | `ref` on X-ray requests (§7.2); `unbind` (§7.5) |
| Actions | `actions.json`, X-ray GET/POST (external link), the disabled Rip stub, the Actions headers, `spec.ts` (actions-spec 2.4.2), recorded fixtures | X-ray kept with D9 and its flag (§10.3); the Rip stub is replaced in B2 |
| SIWS link API | `/api/link/{nonce, session/:nonce, verify, telegram/:id}`, the message builder, base58, the timing-safe bearer check, in-memory store and limits | Routes kept; Postgres store; Redis limits; `POST /api/link/unbind` (§7.5) |
| Web | `/link/:nonce` (Wallet Standard connect and `signMessage`) | The Backpack button in its no-wallet state (B2) |

### 0.4 Amendments this brief makes (binding for M5)

| # | Amendment | Amends | Why |
|---|---|---|---|
| M5-A1 | D9 reaches the bot and the X-ray Blink: no `.sol` input, pattern or copy. A `<name>.sns` input is passed to X1 unchanged; X1 answers 400 unless its resolver flag is on. `{who}` is the 4+4 short form of the address X1 returns | X3 §3.2, §3.3, §5.1 (master §0.5 already orders it) | X3 merged with `.sol` still in `referral.ts`, START, XRAY_USAGE and the X-ray Action |
| M5-A2 | Web targets use the canonical routes `/rip` and `/cards`, never `/packs` | X3 §3.5, §3.8 | D10. The aliases keep links already sent working |
| M5-A3 | Signing-flow buttons (`/feed`, `/rip`, `/me`, [Feed my bags], [Rip a pack]) open `${PUBLIC_WEB_URL}/go/<id>`: one single-use id per wallet button, valid `BOT.sessionTtlSeconds`. `/link` keeps X3's `/link/<nonce>`: its nonce already is a single-use 10-minute session | X3 §3.5 (`TODO(M6.2)`), SPEC §2.4 | Master M5.1. One id per button, so a tap in the wrong wallet does not use up the others |
| M5-A4 | The X-ray reply carries [Feed my bags] (a callback, private chats only) and [Share X-ray], instead of one Feed button per wallet | X3 §3.2 | DA §12 caps a message at 3 buttons, and Backpack is a third wallet. Sessions are created only when the user asks to Feed |
| M5-A5 | The bot reads and writes Postgres (`DATABASE_URL`), polls as one instance behind a Postgres advisory lock, and serves `/health` and `/ready` on a private port | Master §3.2 ("`TELEGRAM_BOT_TOKEN` only"), X3 §3.7 | Opt-ins and links must survive restarts; Telegram serves one `getUpdates` consumer per bot; master §7.3 asks every service for `/health`. The bot still holds no key |
| M5-A6 | `/unlink` deletes the Telegram ↔ wallet pair and turns alerts off | Master §11.4 M5 command list | That pair is the most sensitive data the bot keeps (X3 §3.1, "a known incident class") |
| M5-A7 | `/alerts` takes `on` (each royalty as it is paid, coalesced per chat), `daily` (one digest a day) or `off` | X3 §3.2 (`on\|off`) | Master M5.2 asks for opt-in DMs and a daily digest; one switch with three states keeps both opt-in |
| M5-A8 | Notifications read the indexer's tables, and only rows whose transaction is `finalized` | X3 §3.8 ("the worker feeds it later") | No new service or stream. A message never reports something a fork rolled back |
| M5-A9 | When the bag sits in several token accounts, the Feed Blink POST answers with an external link to `/feed` | SPEC §2.5 (one transaction) | The whole-bag rule (master §11.4 M2.2) needs a merge transaction that lands first |
| M5-A10 | The Rip Blink's `min_live_flags` is the live-flags value its GET displayed (`lf` in the button URL) | SPEC §2.5 | Same rule as the web: the flags shown at tap (M3 §12.3) |
| M5-A11 | Master acceptance 7 applies to the images that carry live machine numbers (Rip, Feed, Highlight). The X-ray Blink image is X1's square card: a scan snapshot with X1's cache, which shows its scan time through an interface request to the architect | Master §11.4 M5 acceptance 7 | X-ray numbers come from a 24 h scan cache (`XRAY.cacheSeconds`), not from the machine |
| M5-A12 | M5's operational values live in a marked `packages/config` section (`BOT_OPS`, `BLINKS_OPS`), pending PARAMS issue 4 | PARAMS §18 | M2 §4.3 precedent; X3 asked for these rows |
| M5-A13 | `BLINKS_FEED` turns on in production after G5.2 passes (D14), not at SW-2 (D13) | Master §11.5 | G5.2 comes a day after Stock-Up; no Blink goes live before its gate |
| M5-A14 | `actions.json` also maps `/rip`, `/packs` and `/verify/*` to the Rip and Highlight Blinks | X3 §5.1 | Shared web links unfurl as Blinks in clients that support them |
| M5-A15 | At startup the bot sets its description and short description from copy | — | The no-keys line is visible before anyone sends `/start` |

None adds or removes a mechanic or changes a PARAMS number.

### 0.5 Decisions and facts M5 relies on

- **D1:** no Spotlight. The `spotlight` card kind never produces a post or a Blink.
- **D4:** no program on mainnet before the RC deploy (Sat–Sun 10-24/25). Until then `/machine` cannot read the machine (§7.3, row 1).
- **D9, D10:** M5-A1, M5-A2.
- **D13:** no new credential name ends in `SECRET_KEY` or `PRIVATE_KEY`; the key-variable guard pattern stays literal (§7.1).
- **D14:** `SERVICES.transport` timeouts govern M5's DB, RPC and Redis calls.
- **F13:** the bot's display name is "1% Machine" and its handle `@OnePercentAutoBot`; BotFather settings are in Appendix A.0.
- **Telegram** (Bot FAQ and Bot API 10.3, read 2026-10-08, Appendix B): avoid more than one message per second in one chat; at most 20 messages per minute in one group; about 30 per second for bulk sends; a private chat's `my_chat_member` update arrives only when the user blocks or unblocks the bot; bots may delete incoming private messages.

---

## 1. Scope and PR plan

### 1.1 Two PRs

| PR | Branch | Days | Gate | Production |
|---|---|---|---|---|
| **B1**, the rest of M5.1 | `feat/m5.1-bot-core` | D7–D10 | G5.1 | Live at SW-1 (X-ray Week) with `BLINKS_XRAY` on |
| **B2**, M5.2 | `feat/m5.2-alerts-blinks` | D11–D14 | G5.2 | `BLINKS_RIP` and `BOT_ALERTS` on at SW-3 (On Air) after Appendix A.1; `BLINKS_FEED` on after G5.2 (M5-A13) |

**B1 delivers:**
1. D9 and the copy keys (M5-A1, §7.6).
2. `@onepercent/config`: import `BOT`, `BLINKS`, `UI` and `PACK_EDITIONS` (with `code` and `maxPerRip`) and delete X3's `TODO(config)` mirrors (the `BOT` and `UI` objects of `services/bot/src/limits.ts`, whose `RATE_RULES` now read `BOT_OPS.userLimits`; `LIVE_NUMBERS_MAX_AGE_SECONDS`; `SESSION_TTL_SECONDS`); add the §4.2 section.
3. `packages/db`: the M5 migration with every M5 table (§5); Postgres stores for the bot (`BotStore`) and the API (`LinkStore`, `GoStore`), with contract tests.
4. Deep-link sessions (§6): the API routes, the web page `/go/:id`, the bot buttons for Phantom and Solflare, the fallback.
5. Bot: `/machine` (§7.3), `/unlink` (§7.5), the X-ray changes (§7.2), command menus and descriptions, `my_chat_member` and chat migration, the per-group reply limit, the runtime (key guard, lock, health; §7.1).
6. Actions: D9, `BLINKS_XRAY`, the chain id by cluster, the response cache and the Redis limiters (§10.1, §10.3).

**B2 delivers, in this order** (cut lines of master §11.6):
1. Backpack in every wallet button set, in the link page and in `wallet/deeplinks.ts` (§6.3).
2. The Rip Blink and its generic form, the Blink images, the `actions.json` rules, `blinks:check` and the registration sheet (§10.2, §10.4, §10.8, §10.9); the validator e2e of §13.6.
3. `/me` and the `/alerts` modes (§7.4, §7.5).
4. **Cut line, master §11.6 item 3:** notifications: queue, sources, sender, group posts and digest (§8).
5. **Cut line, master §11.6 item 4:** the Feed Blink (with the X-ray Blink's Feed button) and the Highlight Blink (§10.5, §10.6).

If B2 runs late, the architect may move items 4 and 5 to a follow-up PR on the same rules. The PR says so; nothing is dropped silently.

### 1.2 File ownership

| Path | M5 may |
|---|---|
| `app/services/bot/**` | Everything (X3's code is the base) |
| `app/services/api/src/{actions,link,go}/**` | Everything (`go/` is new) |
| `app/services/api/src/cards/blink-{rip,feed,highlight}.tsx` | Create as placeholders (§10.8). Once the architect replaces one, never edit it |
| `app/apps/web/src/{link,go}/**` | Everything (`go/` is new) |
| `app/packages/db/src/schema.ts` | Append the M5 tables between `// ===== BEGIN M5 BOT TABLES` and `// ===== END M5 BOT TABLES`. The generated migration and `drizzle/meta/*` are regenerated, never hand-merged. Add `packages/db/tests/m5-bot.integration.test.ts` |
| `app/packages/config/src/index.ts` | Only between `// ===== BEGIN M5 BOT SECTION` and `// ===== END M5 BOT SECTION` (§4.2) |
| `app/services/api/src/app.ts`, `src/index.ts` | Append only: `registerGo(app, deps)` and at most 10 lines of dependency wiring (store and limiter choice) |
| `app/apps/web/src/routes/table.ts` (M3.1) | One row for `/go/:id`. If the router is not on your base yet, extend the `main.tsx` switch instead (≤ 8 lines, X3's pattern) |
| `app/apps/web/src/wallet/deeplinks.ts` (M3) | B2 appends the Backpack builder and its golden test; nothing else. Showing a third button in the web's wallet hint is M3's (amendment 5) |
| `app/packages/copy/src/en.ts` (M3) | Only if `COPY.md` has issued the Bot and Blinks sections (amendment 1): append those keys between `// ===== BEGIN M5 COPY` and `// ===== END M5 COPY` (§7.6) |
| `.env.example` files, `app/VERSIONS.md`, `app/README.md` | Append: env rows, the "Bot, Blinks and wallet link" README section. No `VERSIONS.md` row is expected (§3) |
| `.github/workflows/app.yml` | B2 appends `pnpm --filter api blinks:e2e` to the `nightly` job |
| Import only | `packages/{sdk, market, eligibility, service-kit, web-api}`; `services/api/src/xray/**` (X1's in-process service), `services/api/src/cards/render.ts` (fonts), `services/api/src/public/**` (S4's in-process snapshots and feed-attest forwarding, amendment 4) |
| Never | `programs/**`, `test-programs/**`, `services/worker/**`, `apps/web/src/experience/**`, a replaced template, `docs/codex/**`, `AGENTS.md`, the landing. No M2 table changes, except the one index of §5.2 |

### 1.3 What M5 needs from other lanes

| Needs | From | Until it lands |
|---|---|---|
| `packages/db`, its migrator, `service-kit` (`SlidingWindowLimiter`, `hashClientIp`) | M2 S0 (PR #10) | B1 starts on `main` once S0 merges (planned D7). Never add the M5 migration before S0's `0000` is on your base |
| `BOT`, `BLINKS`, `UI`, `PACK_EDITIONS[].code` and `.maxPerRip`, `CARD_KINDS`, `HIT_TIERS`, `TOKEN_1PCT`, `JACKPOT`, `COVERAGE`, `SEASON`, `ATTESTATIONS`, `CU_LIMITS`, `TX_LIMITS`, `INTAKE`, `XRAY` in `@onepercent/config` (and `WEB`, `SERVICES` from the M3 and M2 sections) | M1 (PARAMS §22.4); M2, M3 | B1 starts after G1 (D7) |
| `@onepercent/sdk/api` (`ConfigResponse`, `MachineResponse`, `MeResponse`, `ValueResponse`), S4's routes and in-process functions | M2 S4 (PR D12, G2.2 D13) | Local zod copies marked `// SWITCH to @onepercent/sdk/api`, tested on fixtures. G5.2 runs against S4 merged |
| Indexer tables `chain_txs`, `pulls`, `packs`, `dust_picks`, `royalties`, filled | M2 S1 (D12) | Integration tests seed rows themselves |
| SDK: `buildBuyPacksTransaction`, `planFeedTransactions`, PDAs, layouts, `maxQty`, the error map; `liveFlags(machine, edition, nowTs)`, `jackpotLive` and `onePctLiveIndex` (`math/specials.ts`) | M1; M4.1 (`04-M4-BRIEF.md` §10) for the specials | The Rip Blink needs M1. Before M4.1 the live flags are 0 |
| `MachineResponse.tokenMint`, `.onePctLiveIndex`, `onePct[].releaseTs` | M4.2 (`04-M4-BRIEF.md` §11.6) | `/machine` omits the Jackpot value and The 1% line |
| The FEED attestation path behind `POST /api/feed/attest` (its rate limits included) | M2 S2 and S4 | The Feed Blink codes against M2 §11.4's shapes with fixtures |
| `packages/copy` (`t`, `sol`, `short`, `shortTv`, `amount`, `count`, `mult`, `dateUtc`, `timeUtc`, `countdown`), the router, `wallet/deeplinks.ts`, `POST /api/values` | M3.1 (G3.1 D10) | X3-style local copy modules and the `main.tsx` switch; royalty DMs use the no-ticker template |
| `/rip` reading `?edition=` and `?n=` | M3.3 | Amendment 5 states the contract |
| Blink image templates, the X-ray card's scan time | The architect | Codex placeholders (§10.8) |
| `COPY.md` Bot and Blinks sections | The architect (amendment 1) | The texts proposed in amendment 1 are binding for M5 as written there |

### 1.4 Calendar (master §11.1)

| Day | B1 | B2 | Around it |
|---|---|---|---|
| D7 Fri 10-16 | Starts | — | G1; S0 merged; S1–S4 start |
| D10 Wed 10-21 | PR; **G5.1** | — | G3.1 |
| D11 Thu 10-22 | Live at SW-1 | Starts | X-ray Week |
| D12 Fri 10-23 | — | — | S1–S4 PRs; G4.1 |
| D13 Mon 10-26 | — | — | G2.2; Stock-Up (SW-2) |
| D14 Tue 10-27 | — | PR; **G5.2** | G3.3 |
| T0 Thu 10-29, On Air 16:15 UTC | — | `BLINKS_RIP`, `BOT_ALERTS` on, once Appendix A.1 passed | SW-3 |

---

## 2. Rules for this milestone

1. **Branches** per §1.1. Never push to `main`. Rebase on `main` daily; regenerate `pnpm-lock.yaml` with `pnpm install` and the drizzle meta with `drizzle-kit generate`, never by hand.
2. **Paths.** Edit only §1.2's paths.
3. **Non-custodial, absolutely.**
   - Nothing asks for, accepts, stores, derives or logs a private key or a seed phrase: not the bot, not the API, not the web pages.
   - The bot never builds, signs or sends a transaction, and imports no Solana library.
   - The API builds Blink transactions unsigned. Their only signer is the requesting `account`.
   - The public API holds no key (M2 §11.1). There is no Action Identity key.
4. **Never the first message.** Replies answer the user's own command or tap. Anything else the bot sends (royalty DMs, digests, hit posts) goes only to private chats that sent `/start` and opted in, and to groups whose admin opted in. Joining a group sends nothing.
5. **Numbers** come only from `@onepercent/config`. A token amount shown in SOL is an executable quote labelled "≈ … SOL if sold now" (master §7.2); the X-ray's capped estimates keep "≈ … SOL est.". No quote, no SOL figure.
6. **Strings** come only from copy keys (§7.6). A static test forbids user-facing literals elsewhere.
7. **Tests are offline.** A setup file makes any unstubbed `fetch` throw (X3 §1, rule 3). Postgres and Redis suites run under `SERVICES_INTEGRATION=1` (CI job `services`).
8. **Services.** TypeScript strict, ESM, Node 22; zod on every boundary; pino logs without secrets, payloads or Telegram ↔ wallet pairs; DB, RPC and Redis timeouts from `SERVICES.transport` (D14).
9. **Referral.** A Blink binds a referrer only when the account has no binding. Bot targets carry the user's own pending code, in private chats only. Group messages never carry a user's code (X1's default `ref=<scanned address>` in X-ray share links stays as X1 builds it).
10. **No holder attestation** in any Blink.
11. **Exits are never presented as closed.** No bot or Blink text says take-back or Redeem is unavailable.
12. **Time.** Display countdowns may use the host clock. Anything that gates a transaction reads chain time (the API's chain reads).
13. **Vocabulary.** The lists of `packages/config/src/vocabulary.ts` (AGENTS.md lists 1–3) and no DA v1 concept (SPEC §2.7: "paid in SOL", Convert, Globe, EV, Trade-in Credit, Assist, Comeback Cup) in any bot, Blink or `/go` string.

---

## 3. Dependencies

- **No new registry dependency.** grammY stays at `1.46.0` (published 2026-08-26; the newest release on 2026-10-08, older than 14 days). `@solana/actions-spec` `2.4.2` stays a dev dependency of `api`, for types only.
- Workspace dependencies: `bot` adds `@onepercent/db`, `drizzle-orm` at the workspace's existing pin (0.45.3, S0), `@onepercent/sdk` (imported only as `@onepercent/sdk/api`), and `@onepercent/copy` and `@onepercent/web-api` once they are on your base. `api` adds `@onepercent/sdk`, `@onepercent/db` and `@onepercent/service-kit` if S0 has not. No new version enters `pnpm-lock.yaml`.
- **Not used:** grammY plugins (`@grammyjs/auto-retry`, `@grammyjs/transformer-throttler`: the sender handles 429 itself); `@solana/actions` (X3's `spec.ts` and `headers.ts` stand); `@onepercent/service-kit` in the bot (it loads `@solana/web3.js` at import); any key, mnemonic or Ed25519-signing library in M5's paths.
- If something else seems needed, stop and ask.

---

## 4. Parameters and flags

### 4.1 Keys M5 reads

| Key | Value | Use |
|---|---|---|
| `BOT.sessionTtlSeconds` | 600 | `/go` ids; X3's link nonces |
| `BOT.maxMessagesPerSecond` | 25 | Global send cap, replies included (§8.3) |
| `BOT.hitPostMinKind` | `holo` | Group posts |
| `BOT.maxMessageLines` | 6 | Every message |
| `BLINKS.liveNumbersMaxAgeSeconds` | 60 | Blink GET responses and images |
| `BLINKS.ripQuantities` | 1, 5 | Rip Blink buttons |
| `BLINKS.imagePx` | 1,080 | Blink images |
| `UI.tickerMaxChars` | 10 | Tickers |
| `PACK_EDITIONS[]` (`index`, `id`, `code`, `name`, `priceLamports`, `maxPerRip`) | PARAMS §22.4 | Commands and Blinks; `/rip` aliases are `code` lowercased and `id` |
| `CARDS_PER_PACK`, `PACK_SPLIT_BPS.royaltyPerDustCard`, `HIT_TIERS`, `CARD_KINDS`, `TOKEN_1PCT` | PARAMS §2, §3, §11 | Copy numbers; tier codes (the on-chain kind is the index in `CARD_KINDS`) |
| `JACKPOT.minPotPriceMultiple` | 15 | Jackpot live in an edition iff `jackpot.cost ≥ 15 × price` |
| `COVERAGE.dustBuffer` | 50 | Hungry iff `deck.free < 4 × qty + 50` |
| `SEASON.lastCallSeconds`, `TOKEN_1PCT.onePctReleaseOffsetsSeconds` | 21,600; 0 / 12 / 24 / 36 h (D37) | `/machine` |
| `INTAKE.rateLimitPerMinutePerWallet`, `.rateLimitPerMinutePerIp` | 30, 60 | Feed Blink POST (same path as `/api/feed/attest`) |
| `XRAY.rateLimitPerMinutePerIp` | 60 | X-ray Blink scans |
| `CU_LIMITS.feed[0]`, `CU_LIMITS.buyPacks.x1`, `.x10` | M1's measurements | Blink transactions |
| `TX_LIMITS.maxTxBytes`, `.byteHeadroomBps` | 1,232; 1,500 | Size checks (Feed ≤ 1,047 B) |
| `WEB.priorityFeeCapMicroLamports` | 500,000 | Cap on the Blink priority price (the user pays it, as on the web) |
| `SERVICES.transport.*` | D14 | Timeouts |

### 4.2 Operational keys (`[OFF] [A]`, PARAMS issue 4, pending)

B1 adds this block to `packages/config` verbatim, between the §1.2 markers, headed `// PARAMS issue 4 (pending) — 05-M5-BRIEF.md §4.2`. The architect publishes the same values in issue 4.

```ts
export const BOT_OPS = {
  userLimits: { updatesPer60s: 20, xraysPer60s: 6, linksPer600s: 3, deepLinkRepliesPer600s: 10 }, // X3 §3.6, plus /go replies
  groupLimits: { repliesPer60s: 10 },          // per group chat; leaves ≥ 10/min of Telegram's 20 for hit posts
  apiLimits: { linkNoncesPerUserPer600s: 5, linkSessionPerIpPer60s: 30, linkVerifyPerIpPer60s: 10, // X3 §6
               goSessionsPerUserPer600s: 30, goRedeemPerIpPer60s: 30 },
  telegram: { perChatMinIntervalMs: 1_000, groupMaxPerMinute: 20 }, // Telegram Bot FAQ, read 2026-10-08
  notify: {
    pollMs: 2_000, lookbackSlots: 1_500, claimBatch: 200, coalesceRoyaltiesMax: 50, sendMaxAttempts: 3,
    maxAgeSeconds: { royalty: 3_600, hit: 900, digest: 21_600 },
    priority: { onePct: 0, jackpot: 0, royalty: 1, hit: 2, digest: 3 }, // lower is sent first
    retentionHours: 48,
  },
  digestHourUtc: 16,
  closedIdGraceSeconds: 60,                    // X3: a closed nonce answers 410 until expiry + 60 s, then 404
  lockRetrySeconds: 5,
  apiTimeoutMs: 12_000,                        // X3's clients
  machineCacheMs: 5_000, valueCacheMs: 60_000, symbolCacheSeconds: 86_400,
} as const;
export const BLINKS_OPS = {
  ripPostPerMinutePerAccount: 6, postPerMinutePerIp: 120, imagesPerMinutePerIp: 120,
  mintInfoCacheSeconds: 60, symbolCacheSeconds: 86_400, imageCacheEntries: 500,
} as const;
```

`validateParams()` gains: every value positive; `telegram.groupMaxPerMinute ≤ 20`; `BOT.maxMessagesPerSecond ≤ 30`; `notify.maxAgeSeconds.hit ≤ .royalty ≤ .digest`; `notify.priority.onePct = .jackpot < .royalty < .hit < .digest`; `0 ≤ digestHourUtc ≤ 23`; `apiLimits.goSessionsPerUserPer600s ≥ 3 × userLimits.deepLinkRepliesPer600s`; `groupLimits.repliesPer60s < telegram.groupMaxPerMinute`. None of these keys carries an economic value.

### 4.3 Flags

Read `@onepercent/config`'s flags reader (master §11.5, `flags.ts`) when it is on your base. Otherwise use a local `readFlag(env, name)`: `FLAG_<NAME>` equal to `on` is on, anything else (or unset) is off; mark it `TODO(flags.ts)`. dev and staging set every M5 flag on.

| Flag | Read by | Off | On | Production |
|---|---|---|---|---|
| `BLINKS_XRAY` | api | X-ray Actions answer the "off" form (§10.1) | §10.3 | SW-1 |
| `BLINKS_FEED` | api | Feed Actions answer "off"; the X-ray Blink has no Feed button | §10.5 (with `FEED` on) | After G5.2 (M5-A13) |
| `BLINKS_RIP` | api | Rip Actions answer "off"; Highlights show no Rip button | §10.4 (with `PACKS` on) | SW-3, after Appendix A.1 |
| `BOT_ALERTS` | bot | No polling and no digest; queued jobs end `flag_off`; `/alerts` and `/hits` still store opt-ins | §8 | On Air, after Appendix A.1 |

---

## 5. Data model (`packages/db`, B1)

The schema owner of `packages/db` is M2 (S0). M5 adds one migration, generated after rebasing on S0 with `drizzle-kit generate --name m5_bot` (file `NNNN_m5_bot.sql`, the next free index). It creates every M5 table, B2's included, so B2 adds no migration. The PR announces it to the schema owner; it changes no M2 table except §5.2's index. Conventions are M2 §11.2's: forward-only, `timestamptz`, CI fails on a `generate` diff.

### 5.1 Tables

```ts
// packages/db/src/schema.ts, appended between the M5 markers. Telegram ids are below 2^52: bigint, mode "number".
tg_chats       chat_id bigint PK
               kind text NOT NULL CHECK (kind IN ('private','group'))
               started_at timestamptz NULL       -- private: the last /start
               blocked_at timestamptz NULL       -- 403, "chat not found", kicked or left; cleared by /start or /hits on
               alerts text NOT NULL DEFAULT 'off' CHECK (alerts IN ('off','live','daily'))
               hits boolean NOT NULL DEFAULT false
               updated_at timestamptz NOT NULL
               CHECK (kind = 'private' OR alerts = 'off'), CHECK (kind = 'group' OR hits = false)
               INDEX tg_chats_hits_idx (chat_id) WHERE hits AND blocked_at IS NULL
tg_referrals   telegram_user_id bigint PK
               code text NOT NULL CHECK (code ~ '^([1-9A-HJ-NP-Za-km-z]{32,44}|[a-z0-9_]{3,16})$')
               set_at timestamptz NOT NULL       -- INSERT … ON CONFLICT DO NOTHING: the first code wins (X3 §3.4)
tg_links       telegram_user_id bigint PK
               wallet text NOT NULL UNIQUE CHECK (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
               linked_at timestamptz NOT NULL
link_nonces    nonce text PK CHECK (nonce ~ '^[0-9a-f]{32}$')
               telegram_user_id bigint NOT NULL, bot_username text NOT NULL
               issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, closed_at timestamptz NULL
               UNIQUE INDEX link_nonces_open_user_idx (telegram_user_id) WHERE closed_at IS NULL
go_sessions    id text PK CHECK (id ~ '^[0-9a-f]{32}$')
               telegram_user_id bigint NOT NULL
               action text NOT NULL CHECK (action IN ('feed','rip','cards'))
               edition text NULL CHECK (edition IN ('original','blue_shift','signature','after_hours'))
               n smallint NULL CHECK (n BETWEEN 1 AND 10)
               ref text NULL (the tg_referrals code check)
               created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz NULL
               CHECK (action = 'rip' OR (edition IS NULL AND n IS NULL)), CHECK (n IS NULL OR edition IS NOT NULL)
               INDEX go_sessions_user_idx (telegram_user_id, created_at), INDEX go_sessions_expiry_idx (expires_at)
notify_jobs    id bigint generated always as identity PK
               dedupe_key text NOT NULL UNIQUE
               chat_id bigint NOT NULL
               kind text NOT NULL CHECK (kind IN ('royalty','hit','digest'))
               priority smallint NOT NULL
               payload jsonb NOT NULL            -- zod-validated; u64 as decimal strings
               not_before timestamptz NOT NULL, expires_at timestamptz NOT NULL
               status text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sending','sent','skipped','failed','expired'))
               attempts smallint NOT NULL DEFAULT 0
               outcome text NULL                 -- a Delivery value (§8.3); never a Telegram error text
               created_at timestamptz NOT NULL, finished_at timestamptz NULL
               INDEX notify_jobs_due_idx (priority, id) WHERE status = 'queued'
               INDEX notify_jobs_chat_idx (chat_id, kind) WHERE status = 'queued'
notify_cursors name text PK CHECK (name IN ('royalties','hits')), slot bigint NOT NULL, updated_at timestamptz NOT NULL
digest_runs    day date PK, started_at timestamptz NOT NULL, finished_at timestamptz NULL, jobs integer NOT NULL DEFAULT 0
```

Every time comparison takes `now` as a parameter from the injected clock, never SQL `now()`, so tests drive real Postgres with a fake clock.

### 5.2 The one change to an M2 table

`CREATE INDEX royalties_settle_sig_idx ON royalties (settle_sig)`, in the same migration. §8.1 joins settle transactions to their royalties by signature; without it every poll scans `royalties`.

### 5.3 Writers, retention, privacy

| Table | Writer | Readers | Retention |
|---|---|---|---|
| `tg_chats`, `tg_referrals` | bot | bot | While the chat exists; `markBlocked` keeps the row with `blocked_at` |
| `tg_links` | api (verify, unbind) | api, bot (§8.1 joins) | Until `/unlink` or a new link replaces it |
| `link_nonces`, `go_sessions` | api | api | Deleted when `expires_at + closedIdGraceSeconds < now` (hourly; idempotent on every replica) |
| `notify_jobs`, `notify_cursors`, `digest_runs` | bot | bot | Finished jobs deleted after `notify.retentionHours`; digest runs after 30 days |
| M2's `chain_txs`, `pulls`, `packs`, `dust_picks`, `royalties` | indexer | bot (§8), api (§10.6) | M2 |

- No M5 column may hold a key, a seed phrase, a signature, a message text or a start payload (test C1.02).
- A Telegram ↔ wallet pair exists only in `tg_links` and, for at most `notify.retentionHours`, in a royalty or digest job's `chat_id` and `payload`. `/unlink` deletes the pair and marks that chat's queued jobs `skipped`.
- The bot never runs migrations; the `api` pre-deploy command does (M2 §11.2). Ops may give the bot a Postgres role limited to the reads and writes listed above; the gate does not require it.

### 5.4 Store interfaces

```ts
export type AlertMode = "off" | "live" | "daily";
export interface BotStore {                                   // X3 §3.7, extended
  recordStart(userId: number, chatId: number): Promise<void>; // also clears blocked_at
  hasStarted(chatId: number): Promise<boolean>;
  setPendingReferral(userId: number, code: ReferralCode): Promise<boolean>;
  getPendingReferral(userId: number): Promise<ReferralCode | null>;
  setAlerts(userId: number, mode: AlertMode): Promise<void>;  // was boolean; X3's true is "live"
  getAlerts(userId: number): Promise<AlertMode>;              // was boolean
  setGroupHits(chatId: number, on: boolean): Promise<void>;   // on also clears blocked_at
  getGroupHits(chatId: number): Promise<boolean>;
  markBlocked(chatId: number): Promise<void>;                 // alerts off, hits off, not started
  migrateChat(from: number, to: number): Promise<void>;       // new
}
export interface LinkStore { /* X3 §6, unchanged */ unbind(telegramUserId: number): Promise<boolean>; } // unbind is new
export interface GoInput { telegramUserId: number; action: "feed" | "rip" | "cards"; edition?: EditionId; n?: number; ref?: ReferralCode }
export interface GoStore {
  create(input: GoInput, count: 1 | 2 | 3, now: number): Promise<{ id: string; expiresAt: string }[]>;
  redeem(id: string, now: number): Promise<{ status: "open"; session: GoInput } | { status: "gone" | "missing" }>; // atomic
  purge(now: number): Promise<number>;
}
```

- Each interface has an in-memory implementation (X3's, kept for tests and local runs) and a Postgres one (`PgBotStore` in `services/bot/src/store-pg.ts`; `PgLinkStore`, `PgGoStore` under `services/api/src/{link,go}/`).
- One contract suite per interface runs against both: always for memory, and for Postgres under `SERVICES_INTEGRATION=1`.
- `PgLinkStore` keeps X3's semantics: a new nonce closes the user's open one in the same transaction; `takeNonce` is one `UPDATE … WHERE closed_at IS NULL AND expires_at > $now RETURNING`; naming a nonce burns it even when verify then fails; 410 until `expires_at + closedIdGraceSeconds`, then 404.

---

## 6. Deep-link sessions (B1)

### 6.1 API (`services/api/src/go/**`)

| Route | Auth and limits | Request → response |
|---|---|---|
| `POST /api/go` | Bearer `BOT_API_SECRET` (X3's `isBotAuthorized`): unset secret → 503, wrong → 401. At most `BOT_OPS.apiLimits.goSessionsPerUserPer600s` ids per `telegramUserId` → 429 with `Retry-After` | Strict body `{ telegramUserId, action, edition?, n?, ref?, count }`: `telegramUserId` as X3 §6; `action` ∈ `feed`, `rip`, `cards`; `count` 1–3; `edition` (a `PACK_EDITIONS` id) and `n` only with `rip`; `n` needs `edition` and `1 ≤ n ≤ edition.maxPerRip`; `ref` in X3 §3.4's format. Anything else → 400. **201** `{ sessions: [{ id, expiresAt }] }` with `count` entries |
| `POST /api/go/redeem` | Public. CORS `WEB_ORIGIN` only (X3's global CORS). `Cache-Control: no-store`. At most `BOT_OPS.apiLimits.goRedeemPerIpPer60s` per client IP → 429 with `Retry-After` | Body `{ id }`, 32 lowercase hex. The first redeem of an open, unexpired id gets **200** `{ target }`. A used or expired id gets **410** until `expiresAt + closedIdGraceSeconds`, then **404**. An unknown id gets **404** |

- **Ids:** 32 lowercase hex characters from `crypto.randomBytes(16)`; `expiresAt = now + BOT.sessionTtlSeconds`.
- **Targets** are relative, built from the stored row only, and golden-pinned:
  - `feed` → `/feed`, plus `?ref=<code>` when the row has a code;
  - `rip` → `/rip`, then `edition=<id>`, `n=<n>` and `ref=<code>`, only the parts the row has, in that order, the first one after `?` and the others after `&`;
  - `cards` → `/cards`.
- **Atomic redeem.** Postgres: `UPDATE go_sessions SET used_at = $now WHERE id = $id AND used_at IS NULL AND expires_at > $now RETURNING …`; when no row comes back, one `SELECT` tells 410 from 404. Memory: no `await` between lookup and mark (X3's `takeNonce`).
- **Logs:** route, status and latency. Never the id, `ref`, user id or target.

### 6.2 Web page `/go/:id` (`apps/web/src/go/**`)

- `route.ts`: `matchGoRoute(pathname)` for `^/go/([0-9a-f]{32})/?$`, registered per §1.2.
- `GoPage.tsx`, with the layout tokens of X3's link page:
  - **Loading:** `go.loading` (new key), `role="status"`. On mount, `POST /api/go/redeem` with the request options of X3's `link/api.ts`: base `VITE_API_URL`, `credentials: "omit"`, `cache: "no-store"`, `referrerPolicy: "no-referrer"`, `redirect: "error"`.
  - **200:** parse `target` with `new URL(target, location.origin)`. Navigate only if the origin is `location.origin`; the path is `/feed`, `/rip` or `/cards`; every query key is `ref`, `edition` or `n`; `ref` has X3 §3.4's format, `edition` is a `PACK_EDITIONS` id and `n` is 1–10. Then `location.replace(url.href)`: a full load, so the target route stores `ref` itself (M3 §7.3). Any other target shows the network-error state and navigates nowhere.
  - **404 or 410:** `go.expired` (new key) and a link `common.home` to `/`.
  - **429:** `errors.rateLimited`, `{s}` from `Retry-After`.
  - **Network error:** `common.networkError` and a `common.retry` button.
- Nothing in `localStorage` or `sessionStorage`; no third-party request; no wallet code. `GET /go/<id>` is the SPA shell (Caddy's `try_files`): a crawler or a wallet's link scanner that fetches the URL consumes nothing. Only the page's POST does.

### 6.3 Bot buttons and wallet links

- `walletButtons(ctx, action, params)` replaces X3's `walletButtons(target, …)` for signing flows:
  1. Private chats only. Read the user's pending code (X3's `referral()`).
  2. `POST /api/go` with `count` = the number of wallets (2 in B1: Phantom, Solflare; 3 in B2: Phantom, Solflare, Backpack) and the action fields.
  3. One URL button per wallet, in that order, each to that wallet's browse link for `${PUBLIC_WEB_URL}/go/<its id>`.
- **Browse links** (both parts `encodeURIComponent`-encoded; `ref` is the `PUBLIC_WEB_URL` origin; golden tests pin the strings):
  - Phantom: `https://phantom.com/ul/browse/<target>?ref=<origin>` (X3);
  - Solflare: `https://solflare.com/ul/v1/browse/<target>?ref=<origin>` (X3);
  - Backpack (B2): `https://backpack.app/ul/v1/browse/<target>?ref=<origin>`. Backpack's Browse page documents this form, while its overview page shows `/ul/browse/`. Run Appendix B check B-2 when B2 starts and pin the form that opens the page.
- **Labels:** `bot.button.<action>.<wallet>` (new keys, amendment 1).
- `/link` keeps X3's `/link/<nonce>` targets and gains the Backpack button in B2. The link page's no-wallet state gains `wallet.openBackpack` (new key) in B2, and X3's `TODO(M5.1)` in `apps/web/src/link/links.ts` is deleted: the nonce is the session.
- **Groups** never create sessions and never carry a user's code. The hit-post button and `/machine`'s group button are plain `${PUBLIC_WEB_URL}` URLs.

### 6.4 Fallback

If `BOT_API_SECRET` is unset, or `POST /api/go` fails (timeout `BOT_OPS.apiTimeoutMs`, a status other than 201, a schema mismatch), the buttons wrap the absolute canonical targets of §6.1 (`${PUBLIC_WEB_URL}` + target) in the same browse links. The bot logs `go_fallback` at most once a minute. A reply is never dropped.

---

## 7. Bot

### 7.1 Runtime (B1)

- **Key-variable guard.** Before parsing its environment, the bot exits 1, logging only the variable's name, if any variable name matches `/(?:_KEYPAIR$|PRIVATE_KEY|SECRET_KEY|MNEMONIC|SEED_PHRASE)/i` (M2 §11.1's literal pattern, D13). It lives in `services/bot/src/keyguard.ts` without importing `service-kit`. A test checks that it returns the same verdicts as `service-kit`'s `assertKeyIsolation("public", env)` on a table of names.
- **Stores.** With `DATABASE_URL` set: the Postgres stores, the lock and the notifier. Without it: X3's in-memory stores, no notifier, and one `warn` line `bot memory stores` (local development only; Railway always sets it). Missing tables make `/ready` fail; the bot does not migrate.
- **One poller (M5-A5).** With Postgres, take `pg_try_advisory_lock(hashtext('onepct:bot'))` on a dedicated connection before `bot.init`. While another instance holds it, retry every `BOT_OPS.lockRetrySeconds` and do not poll. Release it on shutdown. Railway runs one replica; the lock covers deploy overlap, when two pollers would collide (Telegram answers the second `getUpdates` with 409 "terminated by other getUpdates request"; Appendix B check B-9).
- **Health.** A `node:http` server on `PRIVATE_HOST:PRIVATE_PORT` (defaults `127.0.0.1:3001`, as M2's runtime; Railway sets `PRIVATE_HOST` so that M6's monitor reaches it over the private network, M6 OPS-07). `GET /health` → 200 `{ ok: true, polling, lock }` while polling; 503 while starting, waiting for the lock or stopping. `GET /ready` → 200 when `SELECT 1` answers within `SERVICES.transport.dbStatementTimeoutMs`, else 503. No other route.
- **Startup calls** (after `bot.init`, before `bot.start`): `setMyCommands` (§7.2), `setMyDescription(bot.description)` and `setMyShortDescription(bot.shortDescription)` (new keys; at most 512 and 120 characters, Bot API limits). A failure logs the method name and startup continues.
- `ALLOWED_UPDATES` and long polling stay as X3 built them.

### 7.2 Commands and updates

Rows not listed keep X3 §3.2's behaviour.

| Command or update | Chat | PR | Behaviour (delta on X3) |
|---|---|---|---|
| `/start [ref_<code>]` | private | B1 | X3; `recordStart` also clears `blocked_at` |
| `/xray <input>` and plain-text inputs | any / private | B1 | **D9:** a base58 string that decodes to 32 bytes is scanned; an input matching X1's `^[^\s/]{1,100}\.sns$` (case-insensitive) is passed to X1 unchanged (X1 400 or 404 → `bot.xray.usage`); `0x…` → `xray.error.evm_not_supported`. Any other `/xray` input, `.sol` included, → `bot.xray.usage` with no request. Plain text in a private chat: an address or a `.sns` name is scanned, a text ending in `.sol` gets `bot.xray.usage`, anything else `bot.unknown` (X3). **Share code:** in a private chat whose user has a linked wallet (`link.walletOf`; a failure means no code), the X-ray request carries `?ref=<linked wallet>`, so the share links carry the sharer's code (X1 keeps a valid incoming code, SPEC §6.7); otherwise no `ref`, and X1 uses the scanned address. **Buttons (M5-A4):** private chat and `feedable + checkAtFeed > 0` → [Feed my bags] (callback `feed_menu`) and [Share X-ray]; otherwise [Share X-ray] only |
| callback `feed_menu` | private | B1 | `answerCallbackQuery`, then `bot.feed` with the §6.3 buttons (action `feed`). Pressed in a group: `answerCallbackQuery({ text: bot.privateOnly })`, no message |
| `/feed` | private | B1 | `bot.feed`; buttons per §6.3 |
| `/rip [edition] [n]` | private | B1 | Aliases: each edition's `code` lowercased and its `id`. `n` defaults to 1 and must be `1 ≤ n ≤ edition.maxPerRip`, else `bot.rip.usage`. No arguments → `bot.rip.all`; buttons per §6.3 (action `rip`, with `edition` and `n` when given) |
| callback `rip_menu` | private | B1 | `bot.rip.all` with the §6.3 buttons (action `rip`, no edition) |
| `/machine` | any | B1 | §7.3 |
| `/link` | private | B1, B2 | X3; Backpack button in B2 |
| `/unlink` | private | B1 | §7.5 |
| `/me` | private | B1, B2 | X3's placeholder text in B1; §7.4 in B2 |
| `/alerts [on\|daily\|off]` | private | B1, B2 | X3's `on`/`off`, persisted, in B1; `daily` and §7.5 in B2 |
| `/hits on\|off` | group | B1, B2 | X3, persisted; `on` also clears `blocked_at`. Posting is §8 (B2) |
| `my_chat_member` | any | B1 | New status `kicked` or `left` → `markBlocked(chat)`. Added to a group → zero API calls (X3). A private unblock → nothing until `/start` |
| `message.migrate_to_chat_id` | group | B1 | `migrateChat(old, new)` |
| other text | private | B1 | `bot.unknown` (now lists `/machine`) |

Menus: private chats `start, xray, machine, feed, rip, link, me, alerts, unlink`; groups `xray, machine, hits`. Each description is a `bot.command.*` key.

**X-ray golden after B1** (X3's fixture; typography and keys per §7.6):

```
<b>X-ray: 7xKp…d2Qa</b>
37 bags ✳ 16 feedable ✳ 12 to check at Feed ✳ 12 have a bid ≈0.79 SOL est.
104 empty accounts ≈0.21 SOL rent back
Worst: $WIFHAT −99.6% from ATH
Condition: Heavily Played ✳ Certified Bagholder
You sign everything in your own wallet. No keys, ever.
```

The lines are `xray.linePrefix` (bold), the `xray.seg.*` segments, `xray.seg.empty.*`, `xray.worst`, `bot.xray.condition` and `bot.footer`. The only text change from X3's golden is the period after `ATH`, which `xray.worst` does not have.

### 7.3 `/machine` (B1)

**Inputs.** `GET /api/config` first; `GET /api/machine` only for rows 4–6; both cached `BOT_OPS.machineCacheMs`. Before the program exists, `/api/config` answers 200 with `phase: null` (M6 brief, Appendix B, B14). For the Jackpot, `GET /api/value?mint=<tokenMint>&amount=<jackpot.tokens>`, cached `BOT_OPS.valueCacheMs`, only when `jackpot.tokens > 0` and `MachineResponse.tokenMint` is set (appended by M4.2, `04-M4-BRIEF.md` §11.6). Until S4 merges, parse with local zod copies marked `// SWITCH to @onepercent/sdk/api`.

| # | When (first match) | Lines | Buttons |
|---|---|---|---|
| 1 | `/api/config` fails, times out or fails its schema; or `/api/machine` does in rows 4–6 | `common.networkError` | none |
| 2 | `phase` is null (no program yet, D4), or `phase = Setup` and `season.stockUpTs` is null | `bot.machine.setup` | none |
| 3 | `phase = Setup` and `stockUpTs` is set | `bot.machine.stockUpSoon` | none |
| 4 | `phase = StockUp` | `feed.phase.paused` (bold) when the `feed` pause bit is set; else `bot.machine.feedClosed` when `flags.FEED` is off; else `bot.machine.stockUp` | private, Feed open: [Feed my bags] (`feed_menu`) |
| 5 | `phase = PoweredOn` | `bot.machine.poweredOn` | private, Feed open: [Feed my bags] |
| 6 | `phase = OnAir` and `now < season.endTs` | `bot.machine.onAir`, the Rip line, the Jackpot line, The 1% line, then `bot.machine.lastCall` when `endTs − now ≤ SEASON.lastCallSeconds` | When `flags.PACKS` is on: private [Rip a pack] (`rip_menu`); group [Rip a pack] → `${PUBLIC_WEB_URL}/rip` |
| 7 | `phase` is BuysClosed, FinalPull or Done, or OnAir with `now ≥ endTs` | `errors.seasonOver` in bold; in FinalPull, then `bot.machine.finalPull` | none |

"Feed is open" means `flags.FEED` on and the `feed` pause bit clear (`ConfigResponse.paused`).

- **Rip line:** `flags.PACKS` off → `bot.machine.packsClosed`; else the `rip` pause bit set → `errors.paused`; else `vrf.busy` → `errors.busy`; else `deck.free < 4 + COVERAGE.dustBuffer` → `errors.hungry`; else `bot.machine.ripUpTo`, with one segment per edition in `PACK_EDITIONS` order: `bot.machine.edition` with `n = coverage.maxQty[id]` when `n ≥ 1`, else `bot.machine.refilling`.
- **Jackpot line:** omitted when `jackpot.tokens = 0`. It is live in the editions where `jackpot.cost ≥ JACKPOT.minPotPriceMultiple × price`. Keys `bot.machine.jackpot` and `.jackpotNotLive`, or `.jackpotValue` and `.jackpotNotLiveValue` when `/api/value` answers `status: "ok"` (`≈{sol} SOL if sold now`). No quote, no SOL figure.
- **The 1% line** (row 6 only), from M4.2's `MachineResponse.onePctLiveIndex` and `onePct[].{state, releaseTs}`: the live card → `bot.machine.onePct.live`; none live and one still locked → `.next` at its `releaseTs`; all pulled → `.done`. Until M4.2's fields exist, the line is omitted.
- **Formats:** `count` for the Deck, `amount` for $1PCT, `sol` for SOL, `dateUtc`, `timeUtc` and `countdown` (M3.1's `packages/copy`; until then local copies marked `TODO(packages/copy)` with the same output). Countdowns use the host clock; nothing here gates a transaction.
- **(pending founder, Q1)** No countdown to Power-On or On Air before the chain sets them: row 3 counts down to `stock_up_ts`, row 5 to `on_air_ts` (Power-On sets it 15 minutes ahead).

Example, row 6:

```
<b>On Air ✳ 61,240 cards in the Deck</b>
Rip up to: The Original 10 ✳ Blue Shift 10 ✳ Signature refilling ✳ After Hours 2
Jackpot 5,620,113 $1PCT ≈49 SOL if sold now ✳ live in The Original, Blue Shift
The 1% ✳ card 2 of 4 live
```

### 7.4 `/me` (B2)

- `link.walletOf(user)` (X3). No wallet → `bot.me.none`; secret unset → `bot.linkOff` (X3).
- Then `GET /api/me/:wallet` (`MeResponse`, no cache); a failure → `common.networkError`.
- Lines, at most 5:
  1. `bot.me.head` (bold): the short address, `count.cards.*` of `binder.cards` (0 without a Binder) and the Deck entries' count ("in the machine");
  2. `bot.me.hits` with one `bot.me.hitSegment` per kind 1–6 (`HIT_TIERS` labels, Jackpot, The 1%), zero segments omitted; the whole line omitted when there are none;
  3. `royalty.digest.one|other` with `royalties.count24h` and `royalties.lamports24h`, or `royalty.none` when the count is 0;
  4. `bot.me.pending` when `pulls.pending` is not empty;
  5. `bot.me.alerts` with the mode label `bot.alerts.mode.*`.
- Buttons: [My cards in Phantom], [… Solflare], [… Backpack] through `/go` (action `cards`).

### 7.5 `/alerts` and `/unlink`

| Input | PR | Needs | Effect | Reply |
|---|---|---|---|---|
| `/alerts` | B1: X3's reply (the current state); B2: as here | — | none | `bot.alerts.status` |
| `/alerts on` | B1 | a linked wallet (else `bot.alerts.needLink`) | mode `live` | `bot.alerts.on`, plus `bot.alerts.fromOnAir` while `BOT_ALERTS` is off |
| `/alerts daily` | B2 | a linked wallet (else `bot.alerts.needLink`) | mode `daily` | `bot.alerts.daily`, plus `bot.alerts.fromOnAir` while off |
| `/alerts off` | B1 | nothing: it works unlinked and without `BOT_API_SECRET` (X3 asked for a link) | mode `off`; that chat's queued royalty and digest jobs → `skipped` | `bot.alerts.off` |
| `/unlink` | B1 | `BOT_API_SECRET` (else `bot.linkOff`) | `walletOf`, then `POST /api/link/unbind` (bearer; body `{ telegramUserId }`; 200 `{ removed: boolean }`), then alerts `off` and the chat's queued royalty and digest jobs → `skipped` | `bot.unlink.done` with the old short address, or `bot.me.none` when nothing was linked |

`/unlink` in a group → `bot.privateOnly`. An unknown `/alerts` argument → `bot.unknown` (X3).

### 7.6 Message format and copy

- X3 §3.1 stands: HTML parse mode with `escapeHtml` on every value; at most `BOT.maxMessageLines` lines; 1–3 buttons; numbers first, separated by ✳; no emoji except the mark in X3's The 1% template; `sanitizeTicker` on every symbol; 4+4 short addresses in the user's own context, 3+2 in hit posts and Blinks.
- New: a message of two or more lines starts with its bold line (DA §12). Typographic marks follow COPY §0.3, including ’ for apostrophes, so several X3 goldens change by one character.
- **Copy keys.** Every user-facing string is a key: an existing `COPY.md` key where one fits (`xray.*`, `royalty.*`, `errors.*`, `common.*`, `count.*`, `feed.*`, `wallet.*`), else a new `bot.*`, `blink.*` or `go.*` key. Amendment 1 gives each new key's exact text.
  - If `COPY.md` carries the Bot and Blinks sections and `@onepercent/copy` is on your base, append the keys per §1.2 and call `t()`.
  - Otherwise keep X3's local modules (`services/bot/src/copy.ts`, `services/api/src/actions/copy.ts`, `apps/web/src/{link,go}/copy.ts`), keyed by the same names, with the texts of amendment 1, marked `TODO(packages/copy)`.
  - A static test forbids string literals with letters as the first argument of `reply`, `ctx.reply`, `answerCallbackQuery`, `InlineKeyboard.url` and `.text`, and as Action `title`, `description`, `label` or `message`, outside the copy modules and tests.
- Placeholders follow COPY §0.5, plus the new ones defined in amendment 1, for example `{anEdition}` (the edition name with its article: "a Signature", "an After Hours", "The Original") and `{buyer}` (`shortTv`, 3+2). Each takes the formatter amendment 1 names; none receives a raw number.

### 7.7 Rate limits (bot)

X3's middleware stays, with `BOT_OPS.userLimits` and two new rules:
- `deepLinkRepliesPer600s` per user, counting every reply that creates `/go` ids (`/feed`, `/rip`, `/me`, `feed_menu`, `rip_menu`);
- `groupLimits.repliesPer60s` per group chat, keyed `group:<chatId>`, for any reply in a group. A refusal there is silent: answering would spend the group's budget.

The limiter stays in memory: one instance polls (§7.1).

### 7.8 Logging and privacy

X3 §3.1 stands: the command name, outcome and latency only. Also never logged: `/go` ids, wallet addresses (short ones included), chat ids in notifier logs, job payloads, Telegram error descriptions (their codes only). Notifier logs carry the job kind, the `Delivery` value, the latency and counts.

---

## 8. Notifications (B2)

### 8.1 Sources

Two pollers run every `BOT_OPS.notify.pollMs` while `BOT_ALERTS` is on. Each poll reads `:to = SELECT max(slot) FROM chain_txs WHERE commitment = 'finalized'` and `:from = cursor − notify.lookbackSlots`, inserts jobs with `ON CONFLICT (dedupe_key) DO NOTHING` and moves its cursor to `:to`, all in one transaction. On its first run (no cursor row) a poller sets the cursor to `:to` and sends nothing older: no backfill. Only `finalized` rows are read (M5-A8). The lookback re-reads rows the indexer wrote late, and the dedupe keys make the re-read harmless.

**Royalties:**

```sql
SELECT r.seq, r.pack, r.k, r.depositor, r.amount, d.mint, p.edition, t.block_time, c.chat_id
FROM chain_txs t
JOIN royalties  r ON r.settle_sig = t.signature
JOIN dust_picks d ON d.seq = r.seq AND d.pack = r.pack AND d.k = r.k
JOIN pulls      p ON p.seq = r.seq
JOIN tg_links   l ON l.wallet = r.depositor
JOIN tg_chats   c ON c.chat_id = l.telegram_user_id
WHERE t.commitment = 'finalized' AND t.slot > :from AND t.slot <= :to
  AND r.redirected = false AND r.amount > 0
  AND c.kind = 'private' AND c.alerts = 'live' AND c.started_at IS NOT NULL AND c.blocked_at IS NULL
ORDER BY t.slot, t.tx_index
```

One job per row: dedupe `roy:<seq>:<pack>:<k>`, kind `royalty`, priority `notify.priority.royalty`, payload `{ wallet, mint, edition, seq, lamports: amount }`, `expires_at = block_time + notify.maxAgeSeconds.royalty`. The amount is the royalty (`royalties.amount`, 2% of the pack price), not the Deck-entry deposit that settle returns with it.

**Hits:**

```sql
SELECT p.seq, k.pack, k.tier, k.hit_value, k.hit_amount, p.buyer, p.edition, t.block_time, c.chat_id
FROM pulls p
JOIN chain_txs t ON t.signature = p.revealed_sig
JOIN packs     k ON k.seq = p.seq
JOIN tg_chats  c ON c.kind = 'group' AND c.hits AND c.blocked_at IS NULL
WHERE p.revealed_slot > :from AND p.revealed_slot <= :to AND t.commitment = 'finalized'
  AND k.tier >= :minKind          -- CARD_KINDS.indexOf(BOT.hitPostMinKind)
ORDER BY p.revealed_slot, p.reveal_order, k.pack
```

One job per (pack, group): dedupe `hit:<seq>:<pack>:<chatId>`, kind `hit`, priority `notify.priority.jackpot` or `.onePct` for those kinds, else `.hit`, `expires_at = block_time + notify.maxAgeSeconds.hit`. Only the kinds `holo`, `black`, `jackpot` and `one_pct` post; any other value is skipped and logged once as `hit_kind_unknown`.

### 8.2 The priority queue

- **Claim:** `UPDATE notify_jobs SET status = 'sending', attempts = attempts + 1 WHERE id IN (SELECT id FROM notify_jobs WHERE status = 'queued' AND not_before <= $now AND expires_at > $now ORDER BY priority, id LIMIT notify.claimBatch FOR UPDATE SKIP LOCKED) RETURNING *`. Queued rows past `expires_at` are marked `expired` first. Lower priority values go first: The 1% and Jackpot posts, then royalty DMs, then Holo and Black posts, then digests.
- **Coalescing:** when the sender takes a royalty job for a chat, it also claims that chat's other due royalty jobs (`status = 'queued'`, `not_before <= $now`, up to `notify.coalesceRoyaltiesMax`) and sends one message for all of them. They share one outcome.
- **At most once:** at boot, rows still `sending` become `failed` with outcome `interrupted`; they are never re-sent.
- **Retention:** finished rows older than `notify.retentionHours` are deleted hourly.
- **Two implementations** behind one `NotifyQueue` interface: in memory (unit tests, and nothing in production) and Postgres (the SQL above, tested under `SERVICES_INTEGRATION=1`).

### 8.3 Sender

X3's `notify/sender.ts` stays the only place that calls `api.sendMessage`. Its in-memory promise queue gives way to a drain loop over §8.2, every 100 ms while jobs are due and every `notify.pollMs` otherwise.

- **Gates,** re-checked just before each send (X3): a private chat must be started, not blocked, with mode `live` for a royalty and `daily` for a digest; a group must have hits on, not be blocked, and the tier must be at least `BOT.hitPostMinKind`; `BOT_ALERTS` must be on. A refused job ends `skipped` with its `Delivery` value. `Delivery` gains `expired` and `flag_off`.
- **Throttle with replies counted.** `notify/window.ts` installs a grammY API transformer (`bot.api.config.use`) that records every outgoing `sendMessage`, replies included, with its chat id and time, before the call. The sender waits until all hold:
  - fewer than `BOT.maxMessagesPerSecond` sends in the last 1,000 ms;
  - at least `telegram.perChatMinIntervalMs` since that chat's last send;
  - for a group, fewer than `telegram.groupMaxPerMinute` sends in the last 60 s.

  Replies are never delayed.
- **Errors:**
  - 403 → `markBlocked`, `blocked`;
  - 400 with `parameters.migrate_to_chat_id` → `migrateChat`, then one retry to the new id;
  - 400 whose description says the chat was not found → `markBlocked`;
  - 429 → pause the drain loop for `parameters.retry_after` seconds (replies are not queued and keep going); the job goes back to `queued` with `not_before = now + retry_after`; after `notify.sendMaxAttempts` attempts → `failed`;
  - anything else → `failed`.

### 8.4 Templates

| Kind | Keys | Values |
|---|---|---|
| Royalty, one job | `bot.royalty.one` (X3's ROYALTY) | `{sol}` = `sol(lamports)`; `{ticker}` from the symbol lookup; `{short}` of the wallet |
| Royalty, one job, no symbol | `bot.royalty.oneNoTicker` | — |
| Royalty, n ≥ 2 jobs | `bot.royalty.many` | n, the summed `sol`, `{short}` |
| Holo or Black Foil | `bot.hit.stock` (X3) and the button `bot.button.samePack` → `${PUBLIC_WEB_URL}/rip?edition=<id>` | `{tier}` label, `{mult}`, `{buyer}`, `{anEdition}`, `{sol}` of `hit_value` |
| Jackpot | `bot.hit.jackpot` (X3) | `{amount}` = `amount(hit_amount)` at `TOKEN_1PCT.decimals` |
| The 1% | X3's `onePctCopy` text, unchanged | `TOKEN_1PCT.onePctCardAmount`; a test asserts it equals `hit_amount` on the fixtures |
| Digest | `royalty.digest.one\|other` in bold, then `bot.digest.paidTo` | n, `sol`, `{short}` |

**Symbols:** `POST /api/values` (M3.1, `mode: "est"`, one item per mint not yet cached, amount 1), its `symbol` through `sanitizeTicker`, cached `BOT_OPS.symbolCacheSeconds` per mint. Any failure → the no-ticker template.

Examples:

```
<b>+0.002 SOL.</b> Your $WIFHAT card was pulled.
Paid to 7xKp…d2Qa.

<b>Holo Foil 4×</b> ✳ 9pQ…a1 ripped a Signature ✳ stocked at 2 SOL      [Rip the same pack]
```

### 8.5 Daily digest

- **When:** at `BOT_OPS.digestHourUtc`:00 UTC on the host clock. Insert the `digest_runs` row for the UTC day first (`ON CONFLICT DO NOTHING`; a conflict means the day already ran). A bot started after that hour runs the day's digest only before `hour + notify.maxAgeSeconds.digest`.
- **Who:** each private chat with mode `daily`, started, not blocked, with a linked wallet.
- **What,** per wallet, with `:now` = the run time:

  ```sql
  SELECT count(*) AS n, coalesce(sum(r.amount), 0) AS lamports
  FROM royalties r JOIN chain_txs t ON t.signature = r.settle_sig
  WHERE r.depositor = :wallet AND r.redirected = false AND t.commitment = 'finalized'
    AND t.block_time > :now - interval '24 hours' AND t.block_time <= :now
  ```

- `n = 0` → no job (the bot never sends "nothing happened"). Otherwise one job: dedupe `digest:<day>:<chatId>`, priority `notify.priority.digest`, expiring at `hour + notify.maxAgeSeconds.digest`.
- **Parity:** for the same wallet and `:now`, `lamports` equals `MeResponse.royalties.lamports24h` (amendment 4 defines that field as royalty amounts only).

### 8.6 Flag and first enable

With `BOT_ALERTS` off, nothing polls and no digest runs; the drain loop ends queued jobs `flag_off`. When it turns on, each poller starts at the current finalized slot (§8.1): turning it on at On Air sends nothing about earlier activity.

---

## 9. API endpoints consumed

| Endpoint | Owner | Consumer | Fields used | Cache, timeout | On failure |
|---|---|---|---|---|---|
| `GET /api/xray/:addr[?ref=]` | X1 | bot | `XrayResult` | —, 12 s | X3's mapping |
| `POST /api/link/nonce`, `GET /api/link/telegram/:id` | X3 | bot | — | —, 12 s | `bot.linkOff` |
| `POST /api/link/unbind` (new, bearer) | M5 | bot | `removed` | —, 12 s | `bot.linkOff` |
| `POST /api/go` (new, bearer) | M5 | bot | `sessions` | —, 12 s | §6.4 fallback |
| `POST /api/go/redeem` (new) | M5 | web `/go` | `target` | none | §6.2 states |
| `GET /api/config` | M2 S4 | bot (`/machine`); Actions in-process | `phase` (null before the program exists, M6 B14), `season`, `paused`, `flags`, `vrf` | 5 s | row 1 / ActionError 503 |
| `GET /api/machine` | M2 S4; M4.2 appends fields | bot; Actions in-process | `deck`, `coverage.maxQty`, `jackpot`, `onePct`, `vrf.busy`; M4.2's `tokenMint`, `onePctLiveIndex`, `onePct[].releaseTs` | 5 s (the API's own ≤ 2 s age) | same |
| `GET /api/value?mint=&amount=` | M2 S4 (X2) | bot; Actions call X2's `valueNow` in-process | `status`, `lamports` | 60 s | no SOL figure |
| `GET /api/me/:wallet` | M2 S4 | bot `/me` | `binder.cards`, `deck`, `pulls.pending`, `royalties` | none | `common.networkError` |
| `POST /api/values` | M3.1 | bot (symbols) | `symbol` | 24 h per mint | no-ticker template |
| The FEED attestation path (in-process) | M2 S2, S4 | Feed Blink POST | `attestations`, `refused` | none | ActionError (§10.5) |
| DB: `chain_txs`, `pulls`, `packs`, `dust_picks`, `royalties` | M2 S1 | bot (§8), Highlight (§10.6) | §8.1 | — | retried next tick |

The bot calls `PUBLIC_API_URL` over Railway's private network and parses every body with zod.

---

## 10. Blinks

### 10.1 Rules for every Action route

- **Headers:** X3 §5.2's set on every Actions response, errors and `OPTIONS` included, with `X-Action-Version: 2.4`. `X-Blockchain-Ids`: the X-ray routes always say mainnet, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (X1 scans mainnet); Rip, Feed and Highlight follow `CLUSTER`: `mainnet-beta` → the mainnet id, `devnet` and `localnet` → `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.
- **CORS:** the wildcard origin only on `/actions.json` and `/api/actions/*` (X3 §5.4). Image routes keep the global CORS.
- **Spec conformance:** every GET body parses with `spec.ts`'s `ActionGetResponseSchema`; POST bodies with `ActionPostRequestSchema`. Add `TransactionResponseSchema` (`{ type: "transaction", transaction: base64, message?: string }`), transcribed from actions-spec 2.4.2's `TransactionResponse`. Labels at most 5 words and starting with a verb; titles at most 40 characters; descriptions at most 140, whole segments only (X3's `joinDescription`); `icon` absolute.
- **Flag off:** GET → 200 with `disabled: true`, `error: { message: blink.off }` and no `links`; POST → 403 `blink.off`.
- **Caching:** GET bodies are cached in process per full URL for `BLINKS.liveNumbersMaxAgeSeconds` and sent with `Cache-Control: public, max-age=60`. POST answers are never cached (`no-store`).
- **Errors:** an `ActionError` `{ message }` from copy. Status 400 for a bad request, 403 for a flag, phase or pause, 404 for an unknown route, edition, mint or pull, 422 for a refusal (intake, coverage, simulation), 429 with `Retry-After`, 500 or 503 when something inside or upstream fails. Unless a section names a more specific key, the messages are `blink.badRequest` (400), `common.notFound` (404), `errors.rateLimited` (429) and `common.networkError` (500, 503). From B1 this replaces X3's API-local texts on every Actions route ("Unknown edition.", "Not found.", "That doesn't look like a Solana address."); the link routes keep theirs.
- **Not used:** an Action Identity (the public API holds no key, master §3.2), `links.next` chaining, `message`-type actions (a sign-message request).
- **Logs:** route, outcome code and latency. Never `account`, `ref` or transaction bytes.

### 10.2 `actions.json` (B2)

```json
{"rules":[
  {"pathPattern":"/x/*","apiPath":"/api/actions/xray/*"},
  {"pathPattern":"/rip","apiPath":"/api/actions/rip"},
  {"pathPattern":"/packs","apiPath":"/api/actions/rip"},
  {"pathPattern":"/verify/*","apiPath":"/api/actions/highlight/*"},
  {"pathPattern":"/api/actions/**","apiPath":"/api/actions/**"}
]}
```

Unchanged `Cache-Control: public, max-age=300`. Clients keep the query string (the Actions spec: "Query parameters from the original URL are always preserved"), so a shared `https://onepercent.fun/rip?edition=after_hours&ref=<code>` reaches `/api/actions/rip?edition=after_hours&ref=<code>`.

### 10.3 X-ray Blink (B1 delta; one addition in B2)

- **D9:** an address input is accepted iff it is base58 decoding to 32 bytes, or matches X1's `.sns` pattern and goes to X1 unchanged. An X1 4xx (`invalid_address`, `name_not_found`) → 400 with `xray.error.<code>`; anything else from X1 keeps X3's answer (the generic Blink with `bot.xray.busy`). `.sol` → 400 `xray.error.invalid_address` with no scan. The title uses the 4+4 short form of the address X1 returns.
- **Limit:** GETs with an address that miss the 60 s response cache count against `XRAY.rateLimitPerMinutePerIp` per IP; over it → 429 `errors.rateLimited`. Cached answers are not counted: a shared Blink of one address costs one scan a minute however many people view it.
- **B2:** while `BLINKS_FEED` and `FEED` are on and Feed is open (§10.5's gate), `links.actions` gains a second entry `{ type: "external-link", label: blink.feed.label, href: "/api/actions/feed" + keptRefQuery }`.
- The image stays X1's square card (M5-A11). Everything else stays X3's.

### 10.4 Rip Blink (B2)

**Routes:** `GET|POST /api/actions/rip/:edition` and `GET|POST /api/actions/rip`. The second reads the edition from `?edition=`, and without one gives the generic Blink.

**GET inputs:** S4's config and machine snapshots (in-process), the live flags (the SDK's `liveFlags(machine, edition, nowTs)`, M4.1), the Jackpot value (X2's `valueNow` on `jackpot.tokens` of `MachineResponse.tokenMint`, cached 60 s) and the request's `ref` (kept if valid, X3 §3.4).

**State per edition,** checked in this order, mirroring M3 §12.2:

| State | When | GET answer |
|---|---|---|
| off | `BLINKS_RIP` or `PACKS` off | §10.1 off form |
| beforeOnAir | `phase` null (no program yet) or before OnAir | `disabled`, `blink.rip.beforeOnAir` |
| seasonOver | `phase` after OnAir, or `now ≥ endTs` | `disabled`, `errors.seasonOver` |
| paused | the `rip` pause bit | `disabled`, `errors.paused` |
| busy | `vrf.busy` | `disabled`, `errors.busy` |
| hungry | `deck.free < 4 + COVERAGE.dustBuffer` | `disabled`, `errors.hungry` |
| refilling | `maxQty(E) = 0` | `disabled`, `errors.refilling` |
| covered | otherwise | the response below |

**Covered response:**
- `title`: `blink.rip.title` (`{edition} ✳ {price} SOL`).
- `description`, segments in this order, whole segments only, until 140 characters: the Jackpot when it is live in this edition (`blink.rip.jackpotValue` with a quote, else `blink.rip.jackpot`), `blink.rip.upTo`, `blink.rip.onePct` when a card is live, `blink.rip.contents`, `blink.rip.verifiable`.
- `icon`: `${PUBLIC_API_URL}/api/og/blink/rip/<id>.png?m=<minute>`.
- `label`: `blink.rip.label.one`.
- `links.actions`: `{ type: "transaction", label: blink.rip.label.one, href: "/api/actions/rip/<id>?n=1&lf=<flags>" + kept "&ref=<code>" }`, plus the same with `n=5` and `blink.rip.label.other` when `maxQty(E) ≥ 5` and `edition.maxPerRip ≥ 5`.
- `lf` is the live-flags value read for this GET (M5-A10).

**Generic response** (no edition): title `blink.rip.genericTitle`; description `blink.rip.contents` and `blink.rip.verifiable`, after the Jackpot segment when it is live in some edition; icon `/api/og/blink/rip.png?m=<minute>`; one `blink.rip.edition` button (`Rip {edition}`) per covered edition, `n=1`. With no covered edition: `disabled`, and the first non-covered state's message in edition order.

**POST** `/api/actions/rip/:edition?n=&lf=&ref=`:
1. Body `{ account }`, base58 decoding to 32 bytes, else 400 `xray.error.invalid_address`.
2. `n ∈ BLINKS.ripQuantities` and `n ≤ edition.maxPerRip`; `lf` absent or an integer 0–255. Else 400 `blink.badRequest`.
3. The GET gates again, on S4's snapshots (≤ 2 s old; the simulation of step 8 is the final check): off, beforeOnAir, seasonOver or paused → 403; busy, hungry for `n` (`deck.free < 4n + dustBuffer`) or `coverage.maxQty[E] < n` → 422 with the state's copy (`blink.rip.upTo` when `1 ≤ maxQty < n`).
4. Read the Binder `binderPda(account)` at `confirmed`: `pull_nonce` (0 without a Binder), `referrer`, `season_spend`.
5. **Referrer (master acceptance 5):** `ref`, only if it decodes to 32 bytes, differs from `account`, and the Binder is missing or has `referrer = 0` and `season_spend = 0`. Otherwise none. Aliases are never resolved (pending founder, Q2).
6. `min_live_flags` = `lf` when present, else the live flags at POST time.
7. Build with the SDK: `buildBuyPacksTransaction({ buyer: account, edition: index, qty: n, pullNonce, minLiveFlags, referrer, hold: null, queue: config.vrf_queues[active_queue], … })`, with `CU_LIMITS.buyPacks.x1` for `n = 1` and `.x10` otherwise. Master acceptance 6: `hold` is always `null`.
8. The §10.7 checks and simulation.
9. **200** `{ type: "transaction", transaction, message: blink.rip.done }`.

The generic `POST /api/actions/rip` answers 400 `blink.badRequest`: every button names an edition.

**Example GET** (After Hours at 16:15 UTC on the example On Air day, covered for 2, Jackpot live, no `ref`; the `lf` value is illustrative, M4.1 fixes the bits):

```json
{
  "type": "action",
  "icon": "https://onepercent.fun/api/og/blink/rip/after_hours.png?m=29888175",
  "title": "After Hours ✳ 1 SOL",
  "description": "Jackpot 5,620,113 $1PCT ≈49 SOL if sold now ✳ Rip up to 2 now ✳ 4 Dust Cards + 1 hit per pack ✳ every draw can be verified",
  "label": "Rip 1 pack",
  "links": { "actions": [
    { "type": "transaction", "label": "Rip 1 pack", "href": "/api/actions/rip/after_hours?n=1&lf=1" }
  ] }
}
```

### 10.5 Feed Blink (B2)

**Generic** `GET|POST /api/actions/feed`: GET → title `blink.feed.genericTitle`, description `blink.feed.genericDescription`, one `{ type: "external-link", label: blink.feed.label, href: "/api/actions/feed" + keptRefQuery }`. POST → `{ type: "external-link", externalLink: "${WEB_ORIGIN}/feed" + kept "?ref=" }`. The X-ray Blink's second button uses it.

**By mint** `GET|POST /api/actions/feed/:mint`:
- **GET.**
  - The mint must decode to 32 bytes, else 400.
  - Hard checks through `@onepercent/market` (`deriveBondingCurve` with `hasDiscriminator`, `createMintSafetyClient`), and mint ∉ {`Config.token_mint`, wSOL}; cached `BLINKS_OPS.mintInfoCacheSeconds`. A failure → `disabled` with `xray.reason.<code>`.
  - Symbol through X2's tokens client, cached `BLINKS_OPS.symbolCacheSeconds`, then X1's `cardTicker(symbol, mint)`.
  - Feed gate: `FEED` on, `phase` in StockUp, PoweredOn or OnAir, `end_ts = 0` or `now < end_ts`, `feed` pause bit clear. Closed → `disabled` with `feed.phase.before` (dated when `stockUpTs` is set), `.beforeUndated` (also for a null `phase`), `.over` or `.paused`.
  - Open → title `blink.feed.mintTitle`, description `blink.feed.mintDescription` (royalty range from config), icon `/api/og/blink/feed/<mint>.png?m=<minute>`, label and one `{ type: "transaction", label: blink.feed.mintLabel, href: "/api/actions/feed/<mint>" }`.
- **POST:**
  1. `account` as in §10.4 step 1.
  2. `BLINKS_FEED` and `FEED` on and the Feed gate open, else 403 with the phase copy.
  3. Request the attestation through S4's in-process FEED path (M2 §11.4, with its `INTAKE` limits per requested wallet and per client IP): `{ wallet: account, chunks: [[{ mint }]] }`. Never call the intake signer's private route directly.
  4. `refused[0]` → 422 with `feed.refusal.<reason>` and its `{date}` (an unknown reason → `feed.refusal.unknown`). 429 → 429. The 503 codes (`indexer_lag`, `evidence_unavailable`, `service_down`) → 503 with `feed.refusal.<code>`.
  5. `attestations[0].bags[0].mergeFrom` not empty → **200** `{ type: "external-link", externalLink: "${WEB_ORIGIN}/feed" + kept "?ref=", message: blink.feed.merge }` (M5-A9).
  6. Build with the SDK: `planFeedTransactions({ wallet: account, bags: [{ mint, amount, decimals, tokenProgram, source, vaultExists, closeSource: true }], attest: … })`, where `attest` returns exactly the signer's nonce, expiry, message and signature, and `vaultExists` comes from one `getMultipleAccounts` read. The result must be exactly one transaction, else 422 `errors.generic` (and report it). Compute limit `CU_LIMITS.feed[0]`.
  7. The §10.7 checks (the Feed allow-list, ≤ 1,047 B, one `feed`) and simulation.
  8. **200** `{ type: "transaction", transaction, message: blink.feed.done }`.
- The attestation expires `ATTESTATIONS.feedTtlSeconds` after the signer's chain time, minus the SDK's 10 s margin. A signature after that fails on chain with `AttestationExpired`; the bag stays in the wallet.

### 10.6 Highlight Blink (B2)

- **Routes:** `GET|POST /api/actions/highlight/:pull`, where `:pull` is a decimal `seq` or a base58 Pull address (the two forms of `/verify/:pull`, M3-A8), resolved through the indexer's `pulls` table.
- **Not revealed** (`status` not `revealed` or `closed`, or no row) → 404 `blink.highlight.notFound`.
- **Best pack:** the highest kind (`one_pct` > `jackpot` > `black` > `holo` > `blue` > `silver`), then the highest `hit_value`, then the lowest pack index.
- **Title by kind:** `blink.highlight.stockTitle` (`{tier} {mult} ✳ stocked at {sol} SOL`), `.jackpotTitle`, `.onePctTitle`. Never a "+x SOL" line: a hit is a card (SPEC §2.7).
- **Description:** `blink.highlight.description` (`{buyer}`, `{anEdition}`, `{seq}`).
- **Icon:** `/api/og/blink/highlight/<seq>.png`.
- **Buttons:** those of §10.4 for the pull's edition, with the request's kept `ref` only. When that edition is not covered: `disabled` with its state's message and no `links`.
- **POST:** delegates to §10.4's POST for the pull's edition, with `n` from the query (default 1).

### 10.7 Transaction rules (every Blink POST)

- Built by the API from chain reads and config. The client supplies only `account`, and the URL's `n`, `lf` and `ref`; never an amount.
- **Unsigned:** every signature slot is zero; `numRequiredSignatures = 1`; the only signer and the fee payer is `account`. The API never signs, partially signs or stores one.
- Legacy messages. Size at most `TX_LIMITS.maxTxBytes`; Feed at most 1,047 B (`byteHeadroomBps`).
- **Top-level programs:** Rip ⊆ {Compute Budget, `onepercent`}; Feed ⊆ master §7.5's set {Compute Budget, Ed25519, SPL Token, Token-2022, ATA, System, `onepercent`}. Exactly one `onepercent` instruction (`buy_packs` or `feed`). A Rip has no Ed25519 instruction.
- **Compute budget:** `SetComputeUnitLimit` from `CU_LIMITS`; `SetComputeUnitPrice(min(p50 of getRecentPrioritizationFees([machinePda]), WEB.priorityFeeCapMicroLamports))`, as on the web (M3 §9).
- **Blockhash:** `getLatestBlockhash("confirmed")`. Blink clients replace it in an unsigned transaction (Actions spec).
- **Simulation (master acceptance 4):** `simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" })` before answering. Any `err` → no transaction; 422 with the SDK error map's copy (M1 §15.5, M2 §8). VRF failures are matched by program id → `errors.busy`; missing lamports → `errors.insufficientSol`, or `errors.simulation` when the shortfall is unknown.

### 10.8 Images (B2)

- **Routes:** `GET /api/og/blink/rip/:edition.png`, `/api/og/blink/rip.png`, `/api/og/blink/feed/:mint.png`, `/api/og/blink/highlight/:pull.png`. `?m=<minute>` only keys the cache. Every `icon` that points at them is absolute: `${PUBLIC_API_URL}` + the route.
- 1080 × 1080 PNG (`BLINKS.imagePx`), satori and resvg with X1's `loadFonts`. `Cache-Control: public, max-age=60`; an in-memory LRU of `BLINKS_OPS.imageCacheEntries` entries keyed by template, key and minute, each kept 60 s. At most `BLINKS_OPS.imagesPerMinutePerIp` per IP.
- **"As of" (master acceptance 7):** every image prints `blink.asOf` (`as of {time}`, `timeUtc`): the snapshot time for Rip and Feed (when the API read it, floored to the minute), the reveal block time for a Highlight.
- **Templates** are architect-owned (master §2.5); Codex designs nothing. It ships minimal placeholders: the props as plain text on the existing color tokens and fonts, at 28 px or more, no new visual language, each file starting `// PLACEHOLDER until the architect's Blink templates`. The props, all strings preformatted from copy:

```ts
export interface BlinkRipCardProps { edition: EditionId | null; name: string | null; priceSol: string | null;
  state: "covered" | "refilling" | "hungry" | "busy" | "paused" | "beforeOnAir" | "seasonOver" | "off";
  upTo: number | null; jackpot: { amount: string; valueSol: string | null; live: boolean } | null;
  onePct: { card: number; of: number } | null; asOf: string }
export interface BlinkFeedCardProps { ticker: string; mintShort: string; royaltyMinSol: string; royaltyMaxSol: string;
  state: "open" | "before" | "over" | "paused" | "notInSet" | "off"; asOf: string }
export interface BlinkHighlightCardProps { kind: "silver" | "blue" | "holo" | "black" | "jackpot" | "one_pct";
  title: string; valueLine: string; edition: string; buyer: string; seq: string; asOf: string }
```

- The X-ray Blink keeps X1's square card (M5-A11; interface request in amendment 8).

### 10.9 Dialect registration (B2 prepares, the founder submits)

- **Facts** (Appendix B):
  - Phantom, Backpack and X render only Blinks registered in Dialect's registry; Dialect's client SDK defaults to trusted Blinks only.
  - Review is manual. Dialect's docs say to email `hello@dialect.to`; other sources point to `dial.to/register`.
  - The registry list is public at `https://registry.dial.to/v1/list` (entries `actionUrl`, `blinkUrl`, `websiteUrl`, `createdAt`, `tags`).
  - Dialect's client fetches Actions and images through `https://proxy.dial.to`.
- **`pnpm --filter api blinks:check --origin <url>`** (a script, never run in CI):
  - fetches `/actions.json`, then one sample URL per route and state;
  - checks the headers, CORS and `OPTIONS`, the spec parse and limits, and that each `icon` answers `image/png` with `max-age ≤ 60`;
  - prints a registration sheet: host, Action URL patterns, one description per Action from copy, a contact placeholder.
- **README section "Blinks registration":** run `blinks:check` against production after SW-1 (X-ray) and after SW-3 (Rip); test at `https://dial.to/?action=solana-action:<urlencoded action url>`; submit; check the registry list.
- Registration is a founder action (Appendix A.2), not a merge blocker.

---

## 11. Rate limits (summary)

| Who | What | Limit | Key | Source |
|---|---|---|---|---|
| bot | any update | 20 per 60 s | user (user:chat in groups) | X3 |
| bot | X-rays | 6 per 60 s | same | X3 |
| bot | `/link` | 3 per 600 s | same | X3 |
| bot | replies that create `/go` ids | 10 per 600 s | user | §4.2 |
| bot | any reply in a group | 10 per 60 s, silent | group chat | §4.2 |
| bot → Telegram | every send, replies included | `BOT.maxMessagesPerSecond` (25) per s | global | PARAMS §18 |
| bot → Telegram | queued sends | ≥ 1 s apart per chat; ≤ 20 per 60 s per group | chat | Telegram FAQ |
| api | `POST /api/link/nonce` | 5 per 600 s | user | X3 |
| api | `GET /api/link/session/:nonce`, `POST /api/link/verify` | 30 and 10 per 60 s | IP | X3 |
| api | `POST /api/go` | 30 ids per 600 s | user | §4.2 |
| api | `POST /api/go/redeem` | 30 per 60 s | IP | §4.2 |
| api | X-ray Blink GET missing the cache | 60 per 60 s | IP | `XRAY.rateLimitPerMinutePerIp` |
| api | Rip and Highlight Blink POST | 6 per 60 s per account; 120 per 60 s per IP | account, IP | §4.2 |
| api | Feed Blink POST | 30 per 60 s per wallet; 60 per 60 s per IP | wallet, IP | `INTAKE` (the same limiter as `/api/feed/attest`) |
| api | other Actions POSTs | 120 per 60 s | IP | §4.2 |
| api | Blink images | 120 per 60 s | IP | §4.2 |

- IP keys use the socket address, or the trusted header named by X3's `TRUST_PROXY_HEADER`, hashed with `LOG_IP_SALT` (`hashClientIp`) before they become Redis keys.
- With `REDIS_URL` set, the API uses `service-kit`'s `SlidingWindowLimiter` (replicas share counts); otherwise X3's in-memory limiter.
- **Shared proxies.** Blink clients fetch through shared proxies (`proxy.dial.to`), so an IP limit there is shared by every user of that client. That is why the GET cache sits in front of the X-ray limiter and Rip limits are per account first. The Feed Blink keeps `INTAKE`'s per-IP limit by design (master §3.3); through a proxy it caps Feed Blinks at 60 a minute for all users, and the web stays the main Feed path. Appendix B check B-4 asks whether the proxy forwards the client IP.

---

## 12. Environment

| Variable | Service | Rule |
|---|---|---|
| `TELEGRAM_BOT_TOKEN`, `LOG_LEVEL`, `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `BOT_API_SECRET` | bot | X3, unchanged |
| `DATABASE_URL` | bot | New, optional (§7.1); set on every Railway environment |
| `PRIVATE_HOST`, `PRIVATE_PORT` | bot | New; defaults `127.0.0.1`, `3001` |
| `FLAG_BOT_ALERTS` | bot | New (§4.3) |
| `FLAG_BLINKS_XRAY`, `FLAG_BLINKS_FEED`, `FLAG_BLINKS_RIP` | api | Master §11.5; `/api/config` serves them too |
| `CLUSTER`, `DATABASE_URL`, `REDIS_URL`, `RPC_URL`, `LOG_IP_SALT` | api | M2's runtime, unchanged |
| `WEB_ORIGIN`, `PUBLIC_API_URL`, `TRUST_PROXY_HEADER`, `BOT_API_SECRET` | api | X1 and X3, unchanged |

No new kind of secret: the bot's `DATABASE_URL` is a Railway reference to the shared Postgres, not a key, and `BOT_API_SECRET` is X3's. Every name passes D13 (none ends in `SECRET_KEY` or `PRIVATE_KEY`). `.env.example` files list names and rules only.

---

## 13. Tests

Every suite runs offline (rule 7). The bot suites drive `bot.handleUpdate` with X3's fake Telegram API recorder and stubbed clients. Postgres suites run under `SERVICES_INTEGRATION=1` in CI's `services` job.

### 13.1 Bot (B1)

| Id | Test |
|---|---|
| B1.01 | X3's `/start` referral tests, against both store implementations |
| B1.02 | `xray_d9_inputs`: base58 → scan; `alice.sol` → `bot.xray.usage` with zero requests; `alice.sns` → the client receives `alice.sns`; an X1 400 → usage; START, usage and UNKNOWN contain no `.sol` |
| B1.03 | `xray_golden_b1`: §7.2's golden and X3's `link_preview_options` |
| B1.04 | `xray_ref`: a linked user in private → request carries `ref=<linked wallet>`; unlinked or in a group → no `ref` |
| B1.05 | `xray_buttons`: private and `feedable + checkAtFeed > 0` → [Feed my bags][Share X-ray]; zero → [Share X-ray]; group → [Share X-ray] |
| B1.06 | `feed_menu`: private → `bot.feed` with `/go` buttons; group → callback answer only, no message |
| B1.07 | `go_buttons_golden`: `/feed`, `/rip`, `/rip og`, `/rip ah 5`, `rip_menu` → one `POST /api/go` with the exact body each; buttons = exact browse links to `/go/<id>` |
| B1.08 | `rip_bounds`: `/rip ah 6` and `/rip og 11` → usage; `/rip og 10` ok; `/rip zz` → usage |
| B1.09 | `go_fallback`: secret unset, a 500 and a timeout → exact direct targets; one `go_fallback` log line per minute |
| B1.10 | `machine_states`: every §7.3 row; in rows 4–5 Feed open, flag off and paused (button only when open); in row 6 `PACKS` off, covered and refilling editions, paused, busy, hungry, Jackpot live or not, quote ok or unavailable, The 1% live, next or done, Last Call; goldens; at most 6 lines; no SOL figure without a quote |
| B1.11 | `machine_group`: a group gets the URL button to `/rip` (row 6) and creates no session |
| B1.12 | `unlink`: linked → unbind called, alerts off, `bot.unlink.done`; unlinked → `bot.me.none`; group → private-only; secret unset → `bot.linkOff` |
| B1.13 | `menus_and_descriptions`: exact command lists for both scopes; description texts from copy, within 512 and 120 characters |
| B1.14 | `chat_member_and_migration`: kicked or left → `markBlocked`; added → zero API calls; `migrate_to_chat_id` → hits move to the new id |
| B1.15 | `rate_limits`: X3's cases; the 11th `/go` reply in 600 s → one refusal; the 11th group reply in 60 s → silent |
| B1.16 | `keyguard`: `FOO_KEYPAIR`, `X_PRIVATE_KEY`, `SECRET_KEY`, `MY_MNEMONIC`, `SEED_PHRASE` → exit 1 naming only the variable; `BOT_API_SECRET`, `TELEGRAM_BOT_TOKEN`, `DATABASE_URL` → boot; same verdicts as `assertKeyIsolation("public")` |
| B1.17 | `health_and_lock`: `/health` 200 while polling, 503 while stopping; a second instance waits for the lock and never polls (Postgres) |
| B1.18 | `bot_store_contract`: first-wins referral, alert modes, hits, `markBlocked`, `/start` and `/hits on` clearing `blocked_at`, `migrateChat`, persistence across store instances, the injected clock |
| B1.19 | `no_secret_requests` (X3 §4, item 2, extended): every new command, callback, state and template, and both descriptions; the X3 regex finds nothing; at most 6 lines and 3 buttons |
| B1.20 | `static_rules` (X3 §4, item 3, extended): no `@onepercent/sdk` import other than `@onepercent/sdk/api`; no `@onepercent/service-kit` or `@solana/*` import; `api.sendMessage` only in `notify/sender.ts`; no user-facing literal outside the copy modules (§7.6) |
| B1.21 | `format_rules`: a message of two or more lines starts bold; ✳ separators; typographic apostrophes; no `.sol`; no v1 concept (rule 13) |
| B1.22 | `logs_clean`: captured pino output holds no message text, address, nonce, `/go` id, payload, chat-wallet pair or Telegram error description |
| B1.23 | `alerts_b1`: `/alerts on` needs a link; `/alerts off` works unlinked and without the secret; both persist; `/alerts` with no argument keeps X3's reply |
| C1.01 | `custody_static`: no `Keypair`, `fromSecretKey`, `secretKey`, `.sign(`, `partialSign`, `signTransaction`, `derivePath`, `bip39`, `@scure/bip39`, `tweetnacl` or `ed25519-hd-key` in `services/api/src/{actions,go,link}` and `apps/web/src/{go,link}` |
| C1.02 | `custody_columns`: no M5 column name matches `/secret\|seed\|mnemonic\|private\|keypair/i` |

### 13.2 Bot (B2)

| Id | Test |
|---|---|
| B2.01 | `me_golden`: `MeResponse` fixtures with no Binder, every card kind, royalties none, one and many, pending pulls |
| B2.02 | `me_buttons`: 3 wallet buttons, action `cards` |
| B2.03 | `alerts_modes`: on, daily, off; `daily` needs a link; `off` always works; the `fromOnAir` line while the flag is off; queued jobs skipped on `off` |
| B2.04 | `backpack_links_golden`: bot buttons, the link page and `wallet/deeplinks.ts` |
| B2.05 | `three_buttons_max`: every reply in the B1.19 matrix has at most 3 buttons with Backpack added |

### 13.3 Notifications (B2)

| Id | Test |
|---|---|
| N2.01 | `finalized_only`: a `confirmed` settle → no job; once `finalized` → one job |
| N2.02 | `dedupe_and_lookback`: polling the same slots twice adds nothing; a row written late inside the lookback → one job |
| N2.03 | `no_backfill`: the first run sets the cursor; older rows send nothing |
| N2.04 | `gates`: not started, alerts off, mode `daily` for a royalty, blocked → no job, or `skipped` with zero API calls |
| N2.05 | `coalesce`: 3 royalties for one chat → one `bot.royalty.many` with n = 3 and the sum; all 3 jobs `sent` |
| N2.06 | `symbol_lookup`: `/api/values` ok → ticker; failure → no-ticker template |
| N2.07 | `hit_fanout`: Holo, Black, Jackpot and The 1% → one job per opted-in group; Silver and Blue → none; kinds read through `CARD_KINDS` |
| N2.08 | `priority_order`: queued digest, Holo post, royalty and Jackpot post → sent Jackpot, royalty, Holo, digest |
| N2.09 | `cap_with_replies` (fake clock): 100 jobs plus 10 concurrent replies → never more than 25 `sendMessage` in a rolling second; replies never delayed |
| N2.10 | `per_chat_and_group`: ≥ 1 s between sends to a chat; ≤ 20 per minute to a group |
| N2.11 | `errors`: 403 → blocked; "chat not found" → blocked; migration → retried to the new id; 429 → paused and rescheduled; attempts cap → `failed` |
| N2.12 | `expiry`: a Holo post older than 900 s → `expired`, never sent |
| N2.13 | `at_most_once`: `sending` rows at boot → `failed`, not re-sent |
| N2.14 | `optout_while_queued`: `/alerts off` or `/unlink` before the send → `skipped` |
| N2.15 | `flag_off`: no polling, no digest, queued jobs `flag_off` |
| N2.16 | `digest`: 24 h window, finalized only, redirected royalties excluded, n = 0 → no job, two runs a day → one, the late-start rule, parity with a `MeResponse` fixture |
| N2.17 | `templates_golden`: royalty one, no ticker and many; Holo; Black; Jackpot; The 1% (amount equals config); digest one and other |

### 13.4 API: sessions, link, X-ray Action (B1)

| Id | Test |
|---|---|
| G1.01 | `go_create`: bearer 401 and 503; strict body; `edition` and `n` rules; `count` 1–3 |
| G1.02 | `go_targets_golden`: `feed` with and without `ref`; `rip` with every combination; `cards` |
| G1.03 | `go_redeem_concurrent`: 10 parallel redeems → one 200, nine 410 |
| G1.04 | `go_expiry`: at 601 s → 410; after `expiresAt + 60 s` → 404; unknown → 404 |
| G1.05 | `go_limits`: ids per user; redeems per IP → 429 with `Retry-After` |
| G1.06 | `go_cors_cache`: `WEB_ORIGIN` only, never `*`; `no-store` |
| G1.07 | `go_logs_clean`: no id, `ref`, user id or target in logs |
| G1.08 | `go_store_contract`: memory and Postgres |
| L1.01 | X3's link suite against `PgLinkStore` (contract) |
| L1.02 | `unbind_route`: bearer; unknown user → `{ removed: false }`; after unbind `walletOf` and `telegramOf` are null |
| A1.01 | X3's Actions fixtures updated for D9 and §10.1's error keys: `.sol` → 400 with no scan; a `.sns` input passed to X1 unchanged; an X1 4xx → 400 with its copy; titles from the returned address; 404 and 500 bodies from copy |
| A1.02 | `blinks_xray_flag_off`: GET off form; POST 403 |
| A1.03 | `chain_id_by_cluster`: X-ray always mainnet; Rip, Feed, Highlight per `CLUSTER` |
| A1.04 | `xray_limit_cache_misses_only`: cached GETs pass; the 61st uncached GET in a minute → 429 |
| A1.05 | `redis_limiters` (integration): link, go and Actions limits shared across two app instances |

### 13.5 Web

| Id | Test |
|---|---|
| W1.01 | `matchGoRoute`: valid and invalid paths |
| W1.02 | `go_redeem_navigates`: a 200 → `location.replace` with the exact URL |
| W1.03 | `go_target_guard`: another origin, another path, an extra query key, a bad `n`, `edition` or `ref` → network-error state, no navigation |
| W1.04 | `go_states`: 404 and 410 → `go.expired` with the home link; 429 → `errors.rateLimited`; network error → retry |
| W1.05 | `go_no_storage`: nothing written to storage; no request other than the redeem |
| W2.01 | Link page: Backpack button in the no-wallet state (B2) |
| W2.02 | `deeplinks` Backpack golden (B2, appended to M3's file) |

### 13.6 Blinks (B2)

All with fakes for the snapshots, the RPC (simulation included), the intake path and X2's value.

| Id | Test |
|---|---|
| R2.01 | `rip_get_states`: off, beforeOnAir, seasonOver, paused, busy, hungry, refilling, covered for 1, covered for 5; Jackpot live or not; quote ok or not; The 1% live |
| R2.02 | `rip_get_generic`: one button per covered edition; none covered → disabled with the first state's message; the generic POST → 400 |
| R2.03 | `rip_get_spec_limits`: every body parses; title ≤ 40; description ≤ 140 in whole segments; labels ≤ 5 words, verb first; absolute icon |
| R2.04 | `rip_post_validation`: `account`, `n`, `lf`, edition |
| R2.05 | `rip_post_gates`: flags, phase and pause → 403; busy, hungry and `maxQty < n` → 422 |
| R2.06 | `rip_post_instruction`: decoded args equal edition index, `qty`, `pull_nonce` (0 without a Binder), `min_live_flags = lf`, the active queue |
| R2.07 | `referrer_no_binder`: no Binder and a valid `ref` → `Some(ref)` |
| R2.08 | `referrer_bound`: Binder with `referrer` set → `None` |
| R2.09 | `referrer_spent`: Binder with `referrer = 0` and `season_spend > 0` → `None` |
| R2.10 | `referrer_self`: `ref = account` → `None` |
| R2.11 | `referrer_invalid`: alias, malformed or absent `ref` → `None` |
| R2.12 | `rip_no_hold`: no Ed25519 instruction; `hold` is `None` |
| R2.13 | `rip_simulation_mapping`: `LiveFlagsChanged` → `errors.machineChanged`; `Refilling`; `MachineHungry`; a VRF program failure → `errors.busy`; missing lamports → `errors.insufficientSol` |
| R2.14 | `rip_unsigned`: zero signatures, one required signer = `account` = fee payer |
| R2.15 | `rip_post_limits`: 6 per minute per account and 120 per IP → 429 with `Retry-After` |
| R2.16 | `rip_get_cache`: identical GETs within 60 s read the snapshots once; `Cache-Control: public, max-age=60` |
| F2.01 | `feed_generic`: GET action and POST external link with and without `ref` |
| F2.02 | `feed_get_states`: each `xray.reason.*`, each `feed.phase.*`, open |
| F2.03 | `feed_post_gates`: flags and phase → 403 |
| F2.04 | `feed_post_refusals`: every `FeedRefusal` → its copy with `{date}`; unknown → `feed.refusal.unknown`; 429; the three 503 codes |
| F2.05 | `feed_post_merge`: `mergeFrom` not empty → external link with `blink.feed.merge` |
| F2.06 | `feed_post_transaction`: the Ed25519 message equals the signer's; `transfer_checked` moves the attested whole balance; `close_account` of the source; `create_idempotent` iff the vault is missing; one `feed`; ≤ 1,047 B |
| F2.07 | `feed_post_limits`: the `INTAKE` limits through the shared limiter |
| F2.08 | `feed_post_simulation`: an `err` → 422, no transaction |
| F2.09 | `xray_blink_feed_button`: present iff `BLINKS_FEED` and `FEED` are on and Feed is open |
| H2.01 | `highlight_forms`: `seq` and Pull address resolve to the same answer |
| H2.02 | `highlight_best_pack`: kind, then value, then index |
| H2.03 | `highlight_titles`: stock, Jackpot and The 1% titles; no "+x SOL" |
| H2.04 | `highlight_not_revealed`: 404 |
| H2.05 | `highlight_buttons`: follow §10.4's gates for the pull's edition; kept `ref` only |
| H2.06 | `highlight_post_delegates`: same transaction as the Rip POST for that edition |
| I2.01 | `image_headers`: `image/png`, 1080 × 1080 (PNG header), `max-age=60` |
| I2.02 | `image_as_of`: props `asOf` equal the snapshot or reveal time as `HH:MM UTC`; the placeholder's SVG contains `as of HH:MM UTC` |
| I2.03 | `image_cache`: one render per template, key and minute |
| I2.04 | `image_limits`: 120 per minute per IP → 429 |
| J2.01 | `actions_json_golden`, with X3's header tests |
| J2.02 | `blinks_check_fixtures`: the checker, run in process against the API in fixtures mode, passes and prints the registration sheet |
| C2.01 | `custody_hold`: C1.01 still holds over B2's code; no reference to the HOLD path or `/api/hold/attest` in `services/api/src/actions` |
| C2.02 | `custody_tx_matrix`: every POST fixture is unsigned, single-signer, allow-listed and within its size |
| C2.03 | `copy_scans`: the vocabulary lists, the v1 concepts and X3's no-secret regex over every Blink and `/go` string |

**Validator e2e** (`pnpm --filter api blinks:e2e`; nightly and at the gate): `solana-test-validator` 4.3.0 with the v3 `.so`, the mock VRF and M1's exported OnAir state (M1 §16.6). The FEED attestation is signed by a test key generated at runtime whose public key is the fixture Config's `intake_signer` (pass it to the exporter or read it from the export; if neither is possible, stop and report).

| Id | Test |
|---|---|
| E2.01 | Rip Blink POST for OG × 1 and × 5: simulation `err: null`; signed by the test wallet and landed; the Pull exists |
| E2.02 | Feed Blink POST for a fixture bag: simulation `err: null`; landed; Deck + 1 |
| E2.03 | The first Blink Rip with `ref = A` binds A in the Binder; a second with `ref = B` leaves A |

### 13.7 Database (B1)

| Id | Test |
|---|---|
| D1.01 | The M5 migration applies after `0000` on an empty database; `generate` shows no diff |
| D1.02 | Constraints: code formats, alert modes, `kind` checks, `go_sessions` edition and `n` rules |
| D1.03 | One open nonce per user (partial unique index) |
| D1.04 | `royalties_settle_sig_idx` exists |
| D1.05 | Retention: purges delete exactly the rows of §5.3 |

### 13.8 Master acceptance → tests

| Master §11.4 M5 acceptance | Evidence |
|---|---|
| 1. Handlers unit-tested without network | §13.1–§13.6, run with networking disabled (§16) |
| 2. No key or seed phrase requested, accepted, stored or derived | B1.16, B1.19, B1.20, B1.22, G1.07, C1.01, C1.02 (B1); C2.01–C2.03 (B2) |
| 3. Deep-link checklist in each wallet | Appendix A.1 (founder) |
| 4. Blink POST transactions simulate cleanly | R2.13, F2.08, E2.01, E2.02 |
| 5. Blink referrer only without a binding | R2.07–R2.11, E2.03 |
| 6. No holder attestation in Blinks | R2.12, C2.01, C2.02 |
| 7. Blink images cached ≤ 60 s with "as of HH:MM UTC" | I2.01–I2.03 (scope: M5-A11) |

---

## 14. Acceptance criteria

**G5.1 (B1):**
1. **Scope.** `git diff <base> --stat` shows only §1.2's paths; the shared files show only their allowed lines.
2. **Pipeline.** From `app/`, `pnpm install --frozen-lockfile && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm lint:words` passes, also with networking disabled and no M5 variable set. The `services` job passes with `SERVICES_INTEGRATION=1`.
3. **Boot.** Without `TELEGRAM_BOT_TOKEN` the bot logs "bot disabled" and exits 0; with a key-like variable it exits 1 naming only the variable (B1.16).
4. **D9 and the X-ray reply.** B1.02–B1.05, A1.01.
5. **Persistence.** B1.01, B1.18, G1.08, L1.01, D1.01–D1.05. A restart keeps referrals, alert modes, group opt-ins and links.
6. **Sessions and signing-flow commands.** G1.01–G1.07, W1.01–W1.05, B1.06–B1.09.
7. **`/machine`.** B1.10, B1.11.
8. **`/unlink`, `/alerts`, menus, member updates.** B1.12–B1.14, B1.23, L1.02.
9. **Hard rules** (master 1 and 2). B1.15–B1.17, B1.19–B1.22, C1.01, C1.02.
10. **Actions.** A1.02–A1.05, and X3's Actions tests still pass.
11. **G5, B1's part.** §15's items for B1's paths pass.
12. **Manual** (the founder; not a merge blocker): Appendix A.1 rows 1–6 on a preview, in Phantom and Solflare.

**G5.2 (B2):**

13. **Backpack.** B2.04, B2.05, W2.01, W2.02, and Appendix B check B-2's result in the PR.
14. **`/me`, `/alerts`.** B2.01–B2.03.
15. **Notifications.** N2.01–N2.17.
16. **Blinks.** R2.01–R2.16, F2.01–F2.09, H2.01–H2.06, I2.01–I2.04, J2.01, C2.01–C2.03; X3's Actions tests still pass.
17. **Master 4.** E2.01 and E2.02 outputs (signatures, simulation logs) in the PR.
18. **Master 5, 6, 7.** As in §13.8.
19. **Registration pack.** J2.02, and `blinks:check` run against a local API in fixtures mode; the registration sheet is in the PR.
20. **Master 3.** Appendix A.1 is complete on staging before `BLINKS_RIP` and `BOT_ALERTS` turn on in production (the founder; not a merge blocker).
21. **G5.** §15 passes in full.

---

## 15. Gate G5: non-custodial review (the architect)

- [ ] Nothing in `services/bot`, `services/api/src/{actions,go,link}` or `apps/web/src/{go,link}` asks for, accepts, stores, derives or logs a key or a seed phrase (static tests and a read of the diff).
- [ ] The bot builds and signs no transaction and imports no Solana library; from the SDK only `@onepercent/sdk/api`.
- [ ] Blink transactions are built unsigned, simulated before every answer, signed only by `account`, within the program allow-lists; the client supplies nothing but `account`, `n`, `lf` and `ref`.
- [ ] The public API holds no key; no Action Identity; no `message` action.
- [ ] Referral: Blinks bind only without a binding; bot targets carry only the user's own pending code, in private chats.
- [ ] No holder attestation in any Blink.
- [ ] Never the first message: opt-ins are checked at send time; joining a group sends nothing; `/unlink` deletes the pair.
- [ ] Logs hold no message text, payload, nonce, `/go` id, signature or Telegram-user ↔ wallet pair.
- [ ] Deep links: allow-listed same-origin targets; single-use ids consumed only by POST; no amount, wallet or Telegram id in a URL.
- [ ] Copy: no v1 concept, no word of the vocabulary lists; "if sold now" only on executable quotes; X-ray estimates labelled "est.".
- [ ] No text presents an exit as closed.

---

## 16. Commands

The architect runs, from `app/`:

```
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm lint:words
# offline proof (macOS; on Linux use `unshare -rn`):
sandbox-exec -p '(version 1)(allow default)(deny network*)' pnpm --filter bot --filter api --filter web test
SERVICES_INTEGRATION=1 TEST_DATABASE_URL=<local> pnpm --filter @onepercent/db --filter bot --filter api test
pnpm --filter @onepercent/db generate && git diff --exit-code -- packages/db/drizzle
pnpm --filter bot start                                # no token: "bot disabled", exit 0
pnpm program:build && pnpm --filter api blinks:e2e     # B2: E2.01–E2.03
pnpm --filter api blinks:check --origin http://localhost:3000   # B2, fixtures mode
```

---

## 17. Do NOT

**Custody and keys**
- Build, sign or send a transaction from the bot, or import a Solana library there.
- Ask for, accept, store, derive or log a key or a seed phrase; add a Mini App, a `web_app` button, Stars, invoices or paid broadcasts.
- Sign, partially sign or store a Blink transaction; return one that failed simulation; accept an amount from a client; use an Action Identity key.

**Users and messages**
- Send a first message; message a chat that has not opted in; post when added to a group.
- Notify from `confirmed` rows; backfill when the flag turns on; re-send a job after a crash.
- Bind a referrer when the account has a binding; put a holder attestation in a Blink; put a user's code in a group message.
- Consume a `/go` id on GET; redirect outside the allow-list; put a wallet, an amount or a Telegram id in a `/go` URL.

**Data, process and words**
- Hand-merge `pnpm-lock.yaml` or drizzle meta; change an M2 table beyond §5.2's index; run migrations from the bot; run two pollers.
- Add a dependency.
- Edit `docs/codex/**`, `AGENTS.md`, `apps/web/src/experience/**`, a replaced template, the landing, `programs/**` or `services/worker/**`.
- Accept or print `.sol` names; ship a v1 concept, a vocabulary-list word, "if sold now" on anything but an executable quote, or a SOL figure for a token amount without a quote.
- Log message text, payloads, nonces, `/go` ids, signatures, chat ids in notifier logs, or Telegram-user ↔ wallet pairs.

---

## 18. Report back (in each PR)

1. The §16 command outputs. `VERSIONS.md`: no new row expected; say so.
2. The fixture and golden diffs, with each X3 golden that changed and why (D9, typography, buttons).
3. B1: the migration file and its SQL; the `/go` targets; the `/machine` goldens.
4. B2: Appendix B check B-2 (Backpack) with the form pinned; the `blinks:e2e` outputs; the `blinks:check` registration sheet; the notifier's measured send rate on the fake clock and on staging; Appendix A.1's table once the founder has run it.
5. The interface requests filed with the architect (amendment 8).
6. Every field of `@onepercent/sdk/api` or S4's in-process functions you needed and did not find (M4.2's `MachineResponse` fields included, if they are late).
7. Deviations from this brief, and every place you had to stop and decide.

---

## Appendix A. Founder checklists

### A.0 BotFather settings (before SW-1)

Display name "1% Machine", handle `@OnePercentAutoBot`, the DA §12 avatar (F13). Privacy mode on (the default). Joining groups allowed. Inline mode off; no Web App, menu-button app, game or payment settings. A separate dev bot and staging bot (master §5.1); each `TELEGRAM_BOT_TOKEN` lives only in its own environment's `bot` service.

### A.1 Deep-link checklist (master acceptance 3)

On iOS and Android, in Phantom, Solflare and (B2) Backpack, with the staging bot and staging web. Rows 8 to 10 need the canary On Air (its T−1 rehearsal at the latest); the founder signs at most OG × 1 and one dust Feed.

| # | Step | Expected |
|---|---|---|
| 1 | `/start`, then [X-ray a wallet] | START, then the usage line |
| 2 | `/xray <own wallet>`, [Feed my bags], each wallet button | The wallet opens `/go/<id>` in its browser and lands on `/feed?ref=…` (the page is whatever M3 has shipped by then; once M3.2 is there, connecting works) |
| 3 | Tap the same button again | `go.expired` |
| 4 | A fresh `/feed`, wait 11 minutes, tap | `go.expired` |
| 5 | `/rip ah 5`, each wallet button | Lands on `/rip?edition=after_hours&n=5`; once M3.3 is on staging, After Hours ×5 is preselected (B-8) |
| 6 | `/link`, sign in each wallet; then `/me`; then `/unlink`; then `/me` | SUCCESS page; `/me` shows the wallet; unlinked; `/me` shows none |
| 7 | (B2) `/me`, [My cards in …] | `/cards` in that wallet |
| 8 | (B2) In a test group: `/hits on` as admin; a Holo-or-better pull on the canary | One post within a minute of finality; [Rip the same pack] opens `/rip?edition=…` in Telegram's browser with the wallet hint and three wallet links |
| 9 | (B2) `/alerts on`, then a pull of your Dust Card; `/alerts daily` | One royalty DM; the digest at the hour |
| 10 | (B2) X-ray, Rip, Feed and Highlight Blinks at `dial.to`; later, once Dialect has registered them (A.2), in each wallet's Blink view | Each unfurls; Rip × 1 and Feed sign and land. Only the `dial.to` part gates the flags; the registered part is recorded when it happens |

Record pass or fail per wallet and OS, with screenshots, in the B2 PR or the G5.2 thread.

### A.2 Dialect registration (master §11.4 M5.2)

1. After SW-1: test the X-ray Blink at `https://dial.to/?action=solana-action:<urlencoded https://onepercent.fun/api/actions/xray>` and submit the host to Dialect (check B-3 tells whether one submission covers every Action of the host).
2. After B2 merges and before SW-3: run `pnpm --filter api blinks:check --origin https://onepercent.fun` and send the registration sheet for the Rip, Feed and Highlight Actions if B-3 says they need their own entry.
3. Check `https://registry.dial.to/v1/list` until the Action URLs appear with `tags: ["registered"]`; then run row 10 of A.1 in each wallet.

---

## Appendix B. Sources and checks to run at M5 start

Facts read on 2026-10-08:

| Fact | Source |
|---|---|
| Phantom: `https://phantom.com/ul/browse/<url>?ref=<ref>`, both URL-encoded, no session needed | docs.phantom.com/phantom-deeplinks/other-methods/browse |
| Solflare: `https://solflare.com/ul/v1/browse/<url>?ref=<ref>`, both URL-encoded | docs.solflare.com/solflare/technical/deeplinks/other-methods/browse |
| Backpack: the Browse page gives `https://backpack.app/ul/v1/browse/<url>?ref=<ref>`; the "Other Methods" page shows `https://backpack.app/ul/browse/?ref=` | docs.backpack.app/deeplinks/other-methods/browse; docs.backpack.app/deeplinks/other-methods |
| `@solana/actions-spec` latest is 2.4.2 (2024-10-24); `TransactionResponse` is `{ type: "transaction", transaction, message?, links? }`; `ExternalLinkResponse` `{ type: "external-link", externalLink }` | registry.npmjs.org/@solana/actions-spec; unpkg.com/@solana/actions-spec@2.4.2/index.d.ts |
| `actions.json` sits at the domain root with `Access-Control-Allow-Origin: *`; `*` matches one segment, `**` any; query parameters of the original URL are always preserved; the client replaces fee payer and blockhash of an unsigned transaction | solana.com/developers/guides/advanced/actions; solana.com/docs/advanced/actions |
| Chain ids: mainnet `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `@solana/actions` 1.6.6, `lib/esm/constants.js` |
| Dialect's `blinks-core` 0.20.7 (latest) reads `x-action-version` and `x-blockchain-ids`, supports spec ≤ 2.4, proxies requests and images through `https://proxy.dial.to`, shows the success `message` after confirmation | registry.npmjs.org/@dialectlabs/blinks-core (0.20.7 tarball) |
| Registry: manual review; email `hello@dialect.to`; statuses trusted, none, blocked; Phantom and Backpack do not render none or blocked; list at `registry.dial.to/v1/list` | docs.dialect.to/blinks/blinks-provider/blink-registry; registry.dial.to/v1/list |
| Telegram: ≤ 1 message per second per chat, ≤ 20 per minute per group, about 30 per second bulk; paid broadcasts up to 1,000 per second | core.telegram.org/bots/faq |
| Bot API 10.3 (2026-08-24): description ≤ 512 and short description ≤ 120 characters; `callback_data` 1–64 bytes; `my_chat_member` in private chats only on block or unblock; `migrate_to_chat_id`; `retry_after`; bots delete incoming private messages; updates kept 24 h | core.telegram.org/bots/api |
| Deep-link start parameter: `A-Z`, `a-z`, `0-9`, `_`, `-`, up to 64 characters | core.telegram.org/bots/features |
| grammY 1.46.0 (2026-08-26) is the latest release; grammY advises honouring `retry_after` | registry.npmjs.org/grammy; grammy.dev/advanced/flood |

**Checks to run at M5 start** (results in the PR; a failed check is a stop-and-report):

| # | Check | How |
|---|---|---|
| B-1 | Phantom and Solflare links still open the target in the in-app browser from Telegram | Appendix A.1 rows 2 and 5 on a preview |
| B-2 | Which Backpack form works | On iOS and Android with Backpack installed, tap both forms from a Telegram message; pin the one that opens the target page |
| B-3 | Dialect registration route, and whether one registration covers a host or each Action URL pattern | Ask `hello@dialect.to` (the founder sends it) and read `registry.dial.to/v1/list` entries for multi-route hosts |
| B-4 | Whether `proxy.dial.to` forwards the client IP, and in which header | Log header names (never values) on a staging request made through dial.to |
| B-5 | X still unfurls only registered Blinks | Post a staging link before and after registration |
| B-6 | `@solana/actions-spec` and `blinks-core` versions unchanged | `npm view @solana/actions-spec version`, `npm view @dialectlabs/blinks-core version` |
| B-7 | The SDK's names: `buildBuyPacksTransaction`, `planFeedTransactions`, M4.1's `liveFlags`, `jackpotLive`, `onePctLiveIndex`; S4's exported functions | Read `main` after G1, G2.2 and G4.1; use the real names and report differences |
| B-8 | M3.3's `/rip` reads `edition` and `n` | Run Appendix A.1 row 5 once M3.3 is on staging |
| B-9 | Two pollers on one token conflict (409), and the advisory lock prevents it | Start two bot instances against the dev bot and one Postgres: the second waits for the lock and never calls `getUpdates`. Without the lock, observe the 409 (known from field reports, not stated on the Bot API page) |

---

## Open questions for the founder

**Q1. A countdown before the chain fixes the dates** (pending founder; §7.3). Before Power-On, the chain holds no On Air time: `power_on` sets it 15 minutes ahead. A multi-day countdown would need the announced T0 (F1).
- **Recommendation:** once F1 is confirmed, allow the bot and 1% TV to show it labelled "planned" (for example "Power-On planned for Oct 29 ✳ 16:00 UTC"), from one ops-set value served by `/api/config`, replaced by the chain's values once they exist.
- **Until you answer:** `/machine` shows only chain facts (Stock-Up countdown, then On Air once powered on).

**Q2. Referral aliases in Season 1** (pending founder; §10.4). PARAMS §13.2 allows "an alias that resolves to a wallet"; X3 stores aliases unresolved, and M3 waits for a resolver "in M5.2". No brief defines who may claim an alias.
- **Recommendation:** no aliases in Season 1. A code is a wallet address, as in every X-ray share link. Aliases already stored are ignored. A claim flow (`/alias <name>` for linked wallets, with uniqueness and name rules) can come in Season 2.
- **Until you answer:** no alias is resolved anywhere; Blinks and the web pass only base58 codes.

---

## Amendments proposed to other docs

The architect decides and issues these; Codex edits none of these files.

**1. `COPY.md`, new sections "Bot" and "Blinks"** (issue 2 or the next issue), plus three keys elsewhere. Texts are exact; `\n` is a new line. The bot's HTML tags are part of the text.

| Key | Text |
|---|---|
| `bot.start` | `<b>1% Machine.</b>\nSend /xray and any Solana wallet address. No connection, no keys.\nBags in. Packs out.` |
| `bot.startGroup` | `<b>1% Machine.</b> Send /xray and a Solana wallet address.` |
| `bot.xray.usage` | `Send /xray and a Solana wallet address.` |
| `bot.xray.busy` | `The X-ray is busy. Try again in a minute.` |
| `bot.xray.clean` | `<b>X-ray: {who}</b>\nThat wallet’s clean. Nothing to X-ray. Mint condition.` |
| `bot.xray.condition` | `Condition: {condition} ✳ {title}` |
| `bot.footer` | `You sign everything in your own wallet. No keys, ever.` |
| `bot.feed` | `<b>Feed the machine.</b>\nEach bag becomes a Dust Card ✳ {min}–{max} SOL to you when it’s pulled.\nTake it back any time before it’s pulled.\n{footer}` |
| `bot.rip.all` | `<b>Rip a pack.</b>\n{editions}\n{dust} Dust Cards + {hit} hit per pack. Real tokens inside.\n{footer}` |
| `bot.rip.editionPrice` | `{edition} {price} SOL` |
| `bot.rip.one.one` / `.other` | `<b>{edition} ✳ {price} SOL</b>\nRip 1 pack in your wallet. The page shows the odds before you sign.\n{footer}` / the same with `Rip {n} packs` |
| `bot.rip.usage` | `Editions: og, bs, sg, ah. Packs: 1 to {maxPacks}, or 1 to {maxPacksAh} for ah. Example: /rip ah 5` |
| `bot.link` | `<b>Link a wallet.</b>\nOpens {host} in your wallet to sign one message. No transaction, no fees.\nRead-only: I can show your cards and send the alerts you turn on.\nWorks once, for {minutes} minutes. Don’t forward it.` |
| `bot.linkOff` | `Linking is off right now.` |
| `bot.me.none` | `<b>No wallet linked.</b>\nSend /link to link one. Read-only, one signed message.` |
| `bot.me.placeholder` | `<b>Linked: {short}</b>\nCards, royalties and deposits show here from On Air.\nAlerts: {mode} ✳ /alerts to switch.` (B1 only) |
| `bot.me.head` | `<b>Linked: {short} ✳ {cards} ✳ {inMachine} in the machine</b>` |
| `bot.me.hits` / `bot.me.hitSegment` | `Hits: {segments}` / `{n} {tier}` |
| `bot.me.pending` | `Pending pulls: {n} ✳ My cards has them` |
| `bot.me.alerts` | `Alerts: {mode} ✳ /alerts to change` |
| `bot.alerts.mode.off` / `.live` / `.daily` | `off` / `on` / `daily` |
| `bot.alerts.status` | `<b>Alerts: {mode}.</b>\n/alerts on: each royalty, as it’s paid.\n/alerts daily: one summary at {hour}:00 UTC.\n/alerts off: nothing.` |
| `bot.alerts.on` | `<b>Alerts on.</b> Royalties for {short}, when your cards are pulled.\n/alerts off to stop.` |
| `bot.alerts.daily` | `<b>Daily alerts on.</b> One royalty summary for {short} at {hour}:00 UTC.\n/alerts off to stop.` |
| `bot.alerts.off` | `<b>Alerts off.</b> I won’t message you.` |
| `bot.alerts.needLink` | `Link a wallet first: /link.` |
| `bot.alerts.fromOnAir` | `They start at On Air.` |
| `bot.unlink.done` | `<b>Unlinked.</b> This chat no longer knows {short}. Alerts are off.` |
| `bot.hits.on` / `.off` / `.notAdmin` / `.private` | X3's HITS_ON, HITS_OFF, HITS_NOT_ADMIN, HITS_PRIVATE texts |
| `bot.privateOnly` | `Ask me in a private chat.` |
| `bot.unknown` | `I know /xray, /machine, /feed, /rip, /link, /me and /alerts.` |
| `bot.rateLimited` | `One at a time. Try again in {s} s.` |
| `bot.secretGuard` | X3's SECRET_GUARD text |
| `bot.machine.setup` | `<b>The machine is warming up.</b>\nSend /xray and a wallet address to see what you could feed.` |
| `bot.machine.stockUpSoon` | `<b>Feed opens at Stock-Up.</b>\n{date} {time} ✳ in {countdown}.\nSend /xray to see what you could feed.` |
| `bot.machine.stockUp` | `<b>Stock-Up ✳ Feed is open.</b>\n{deck} cards in the Deck ✳ packs open at On Air.` |
| `bot.machine.feedClosed` | `<b>Stock-Up.</b> Feed is not open yet.` |
| `bot.machine.poweredOn` | `<b>Powered on ✳ On Air at {time}.</b>\nIn {countdown} ✳ {deck} cards in the Deck.` |
| `bot.machine.onAir` | `<b>On Air ✳ {deck} cards in the Deck</b>` |
| `bot.machine.packsClosed` | `Packs are not open yet.` |
| `bot.machine.ripUpTo` / `.edition` / `.refilling` | `Rip up to: {editions}` / `{edition} {n}` / `{edition} refilling` |
| `bot.machine.jackpot` / `.jackpotValue` | `Jackpot {amount} $1PCT ✳ live in {editions}` / `Jackpot {amount} $1PCT ≈{sol} SOL if sold now ✳ live in {editions}` |
| `bot.machine.jackpotNotLive` / `.jackpotNotLiveValue` | `Jackpot {amount} $1PCT ✳ not live yet` / `Jackpot {amount} $1PCT ≈{sol} SOL if sold now ✳ not live yet` |
| `bot.machine.onePct.live` / `.next` / `.done` | `The 1% ✳ card {k} of {of} live` / `The 1% ✳ card {k} of {of} from {date} {time}` / `The 1% ✳ all {of} pulled` |
| `bot.machine.lastCall` | `Last Call ✳ buys close in {countdown}` |
| `bot.machine.finalPull` | `The Final Pull is open ✳ openers claim their share in My cards.` |
| `bot.royalty.one` | `<b>+{sol} SOL.</b> Your {ticker} card was pulled.\nPaid to {short}.` |
| `bot.royalty.oneNoTicker` | `<b>+{sol} SOL.</b> One of your Dust Cards was pulled.\nPaid to {short}.` |
| `bot.royalty.many` | `<b>+{sol} SOL.</b> {n} of your Dust Cards were pulled.\nPaid to {short}.` |
| `bot.hit.stock` | `<b>{tier} {mult}</b> ✳ {buyer} ripped {anEdition} ✳ stocked at {sol} SOL` |
| `bot.hit.jackpot` | `<b>Jackpot</b> ✳ {buyer} pulled {amount} $1PCT from {anEdition} pack` |
| `bot.hit.onePct` | X3's The 1% template text, unchanged |
| `bot.digest.paidTo` | `Paid to {short} ✳ /alerts to change.` |
| `bot.description` | `1% Machine. Send /xray and a Solana wallet address to X-ray it. Feed and Rip links open {host} inside your wallet, where you sign. I never ask for a seed phrase or a private key. Admins never DM first.` |
| `bot.shortDescription` | `X-ray any Solana wallet. Feed bags, rip packs. You sign in your own wallet. No keys, ever.` |
| `bot.button.xray` / `.how` / `.share` / `.feedMenu` / `.ripMenu` / `.samePack` | `X-ray a wallet` / `How it works` / `Share X-ray` / `Feed my bags` / `Rip a pack` / `Rip the same pack` |
| `bot.button.feed.phantom` / `.solflare` / `.backpack` | `Feed in Phantom` / `Feed in Solflare` / `Feed in Backpack` (likewise `bot.button.rip.*` `Rip in …`, `bot.button.link.*` `Link in …`, `bot.button.cards.*` `My cards in …`) |
| `bot.command.start` … `.hits` | `Meet the machine`, `X-ray a wallet`, `See the machine`, `Feed the machine`, `Rip a pack`, `Link a wallet`, `Unlink your wallet`, `Show my wallet`, `Switch royalty alerts`, `Switch group hit posts` |
| `blink.off` | `This Blink is off right now.` |
| `blink.badRequest` | `That request isn’t valid.` |
| `blink.asOf` | `as of {time}` |
| `blink.xray.genericTitle` / `.genericDescription` | `X-ray any wallet` / `Bags, bids and rent back for any Solana wallet. No connection, no keys.` |
| `blink.rip.title` / `.genericTitle` / `.edition` | `{edition} ✳ {price} SOL` / `Rip a pack` / `Rip {edition}` |
| `blink.rip.label.one` / `.other` | `Rip 1 pack` / `Rip {n} packs` |
| `blink.rip.upTo` / `.contents` / `.verifiable` | `Rip up to {n} now` / `{dust} Dust Cards + {hit} hit per pack` / `every draw can be verified` |
| `blink.rip.jackpot` / `.jackpotValue` / `.onePct` | `Jackpot {amount} $1PCT` / `Jackpot {amount} $1PCT ≈{sol} SOL if sold now` / `The 1% card {k} of {of} live` |
| `blink.rip.beforeOnAir` | `On Air soon` |
| `blink.rip.done` | `Ripped. The draw is on-chain: see your pack in My cards on {host}.` |
| `blink.feed.genericTitle` / `.genericDescription` / `.label` | `Feed the machine` / `Each bag becomes a Dust Card ✳ {min}–{max} SOL to you when it’s pulled ✳ take it back any time before` / `Feed my bags` |
| `blink.feed.mintTitle` / `.mintDescription` / `.mintLabel` | `Feed {ticker}` / `Your {ticker} bag becomes a Dust Card ✳ {min}–{max} SOL to you when it’s pulled ✳ take it back any time before` / `Feed my bag` |
| `blink.feed.merge` | `This bag sits in several token accounts. Finish on {host}: it merges them first.` |
| `blink.feed.done` | `Fed. Your {ticker} bag is a Dust Card in the machine. Take it back any time on {host}.` |
| `blink.highlight.stockTitle` / `.jackpotTitle` / `.onePctTitle` | `{tier} {mult} ✳ stocked at {sol} SOL` / `Jackpot ✳ {amount} $1PCT` / `The 1% ✳ {amount} $1PCT` |
| `blink.highlight.description` | `{buyer} ripped {anEdition} pack ✳ pull #{seq} ✳ every draw can be verified` |
| `blink.highlight.notFound` | `That pull isn’t revealed yet.` |
| `go.loading` | `Opening the machine…` |
| `go.expired` | `This link expired or was already used. Send the command to the bot again.` |
| `wallet.openBackpack` | `Open in Backpack` |

New placeholders for COPY §0.5, with their formatters:

| Placeholder | Formatter or source |
|---|---|
| `{anEdition}` | `editionWithArticle(PACK_EDITIONS[].name)`: a name starting with "The " as is, a vowel takes "an", anything else "a" (X3's rule) |
| `{buyer}` | `shortTv` (3+2) |
| `{tier}`, `{mult}` | `HIT_TIERS[].label`; `mult` of its `valueBps` (`4×`) |
| `{price}` | `sol` of `priceLamports` |
| `{dust}`, `{hit}`, `{k}`, `{of}`, `{inMachine}`, `{minutes}`, `{maxPacks}`, `{maxPacksAh}` | `count`: `CARDS_PER_PACK.dust` and `.hit`; The 1% card number from 1 and `TOKEN_1PCT.onePctCardCount`; Deck entries; `BOT.sessionTtlSeconds / 60`; the largest `maxPerRip` and After Hours' `maxPerRip` |
| `{hour}` | the two-digit UTC hour of `BOT_OPS.digestHourUtc` |
| `{countdown}` | `countdown` |
| `{host}` | the host of `PUBLIC_WEB_URL` (bot) or `WEB_ORIGIN` (API) |
| `{editions}` | resolved fragments joined by ` ✳ ` (`bot.rip.all`, `bot.machine.ripUpTo`) or by `, ` (the Jackpot lines) |
| `{mode}`, `{footer}` | another key, already resolved (`bot.alerts.mode.*`, `bot.footer`), as `{title}` is |

Existing keys reused as they are: `xray.linePrefix`, `xray.seg.*`, `xray.worst`, `xray.error.evm_not_supported`, `xray.error.invalid_address`, `xray.reason.*`, `royalty.digest.*`, `royalty.none`, `feed.phase.*`, `feed.refusal.*`, `count.cards.*`, `common.networkError`, `common.retry`, `common.home`, `errors.rateLimited`, `errors.paused`, `errors.seasonOver`, `errors.insufficientSol`, `errors.simulation`, `errors.generic`, and from issue 2 `errors.busy`, `errors.hungry`, `errors.refilling`, `errors.machineChanged`.

**2. `PARAMS.md` issue 4:** add `BOT_OPS` and `BLINKS_OPS` with the values and checks of §4.2, tagged `[OFF] [A]`, in §18 and §26. PARAMS §18's `BOT` and `BLINKS` rows are unchanged.

**3. `00-MASTER-BRIEF.md`:**
- §3.1: web route `/go/:id` (M5).
- §3.2 and §6: the `bot` service also holds `BOT_API_SECRET` (X3's recorded deviation) and `DATABASE_URL`, runs one replica with a private health port, and holds no key (M5-A5).
- §3.3: `POST /api/go`, `POST /api/go/redeem`, `POST /api/link/unbind`, `GET /api/og/blink/**`, `GET|POST /api/actions/rip` (no edition) and `GET|POST /api/actions/feed` (no mint).
- §11.4 M5: the command list gains `/unlink` and `/alerts daily`; acceptance 7 reads as M5-A11.
- §11.5: `BLINKS_FEED` turns on after G5.2 (M5-A13); the Appendix A.1 checklist passes before `BLINKS_RIP` and `BOT_ALERTS` turn on.

**4. `02-M2-BRIEF.md` (S4, S0):**
- S4 exports in-process, for M5's Actions: the config snapshot, the machine snapshot, and the `/api/feed/attest` forwarding function with its rate limiter, taking the client IP.
- `MeResponse.royalties.{count24h, lamports24h, total}` count non-redirected royalties and sum `royalties.amount` (royalty only, without the Deck-entry deposit settle returns), the figure M5's digest uses. S1 confirms the `royalties` columns: `amount` the royalty, `refund` the Deck-entry deposit, `paid` what reached the wallet.
- The schema owner (S0) acknowledges M5's migration and the `royalties (settle_sig)` index (§5.2).

**5. `03-M3-BRIEF.md`:**
- §12.1: `/rip` reads `?edition=<id>` (preselects that edition) and `?n=` (clamped to `1..maxQty`); the bot's `/go` targets and the Blinks rely on it.
- §7.1: register `/go/:id` (M5's page), as for `/link/:nonce`.
- §8.2: Backpack's browse link is appended by M5.2 to `deeplinks.ts`; the wallet hint (`wallet.inAppHint`, `wallet.telegramHint`) shows it as a third button labelled `wallet.openBackpack`.
- §7.3: aliases stay stored and unused (Q2's recommendation); no resolver comes in M5.2.
- §5.2: `packages/copy` gains the Bot and Blinks keys, appended by M5 between markers, unless M3 prefers to mirror them itself.
- §4.2: M5 creates `services/api/src/cards/blink-{rip,feed,highlight}.tsx` (placeholders, architect-owned once replaced); M3 keeps the rest of `cards/`.

**6. `RUNBOOK.md` and `06-M6-BRIEF.md`** (both in progress):
- Step 6.3 (SW-2) turns on `FLAG_BLINKS_FEED` only if G5.2 has passed; otherwise a separate step right after G5.2 (M5-A13). The flags table says the same.
- Step 9.4 and the flags table: `FLAG_BOT_ALERTS` is set on the `bot` service (§4.3), and `BLINKS_RIP` and `BOT_ALERTS` turn on only once Appendix A.1 has passed.
- The `bot` row of the variables table gains `DATABASE_URL`, `PRIVATE_HOST`, `PRIVATE_PORT` and `FLAG_BOT_ALERTS` (§12). M6's OPS-07 already probes the bot's `/ready`, which §7.1 provides.
- A new step after SW-1 for Appendix A.2 (Dialect registration).

**7. `X3-BOT-BLINKS-BRIEF.md`:** superseded where M5 changes it: `/packs` targets (now `/rip` through `/go`), `.sol` input and copy (D9), and its "M6.2" items (Backpack, `/go`, Dialect, Blink images), now specified here.

**8. Interface requests to the architect** (master §2.5):
- The three Blink templates of §10.8, built to DA §13 with v2 copy: a Highlight shows "stocked at …", never DA §13's "+15 SOL", and no Rip image says "paid in SOL".
- X1's square X-ray card prints its scan time ("as of {time}", `scannedAt`) for the X-ray Blink (M5-A11).
