# Codex brief: X3, Telegram bot (non-custodial) and Solana Actions/Blinks foundation

Issued 2026-10-08 by the architect. X3 is a **parallel track** alongside X1 (X-ray scan), X2 and the program lane. Read it with `AGENTS.md`, `00-MASTER-BRIEF.md` (§3.2, §3.3, §7.6, M6) and `PARAMS.md` §18.

This brief quotes what it needs from MODEL-SPEC §2.4, §2.5, §2.6, §6.7 and DA §5.3, §12, §13. When the DA conflicts with SPEC §2.7, SPEC wins: "Convert" is **Feed**, and Globe, EV, Royalty Pool, Trade-in Credit, Assist and cross-chain lines are dropped.

## 0. Context in 8 lines

- **What the bot is.** "1% Machine" is a **plain grammY chat bot**: no Mini App (Telegram ToS §7 limits crypto Mini Apps to TON), no Stars, no payments in Telegram, and it never sends the first message.
- **Where signing happens.** Telegram's in-app browser has no wallet extensions. Every signing flow opens onepercent.fun **inside the wallet's browser** through universal links (§3.5).
- **Keys.** The bot never asks for, receives, stores or derives a private key or seed phrase (§4).
- **Scope.** X3 ships the bot, the Actions/Blinks foundation (read-only X-ray Blink plus a disabled Rip stub), and Sign-In-With-Solana (SIWS) wallet linking across bot, API and web.
- **No transactions.** X3 builds none. `/feed` and `/rip` reply with links only; the flows themselves belong to other milestones.
- **X-ray data** comes from X1 (`GET /api/xray/:address` → `XrayResult`). Code against §9.
- **Storage.** Interfaces with in-memory implementations now; Postgres (`packages/db`) later.
- **If anything is ambiguous or impossible, stop and report.** Do not guess.

## 1. Rules for this track

1. **Branch.** Use `feat/x3-bot-blinks`, cut from `feat/m0-scaffold` (PR #1 is not merged yet). After PR #1 merges, rebase onto `main` and retarget the PR. Never push to `main`.
2. **Ownership.** X3 edits only the paths below. For anything else, stop and report.

| Path | Allowed |
|---|---|
| `app/services/bot/**` | Everything, including replacing M0's `handler.ts` and its test |
| `app/services/api/src/actions/**`, `app/services/api/src/link/**` | Everything |
| `app/services/api/src/app.ts` | Only the `registerActions(...)` / `registerLink(...)` lines and the CORS change of §5.4 |
| `app/services/api/src/env.ts` | Add `BOT_API_SECRET` (§8) |
| `app/apps/web/src/link/**` | Everything |
| `app/apps/web/src/main.tsx` | The route switch of §7 (≤ 8 lines) |
| `package.json` of bot, api, web | Only the dependencies of §8 |
| `app/pnpm-lock.yaml` | Regenerate with `pnpm install` only. On a rebase conflict, take the base version and re-run install |
| `app/VERSIONS.md`, `app/README.md`, `app/.env.example`, `services/{api,bot}/.env.example` | Append only: dependency rows, a "Bot, Blinks and wallet link" section, new env vars |

3. **Toolchain and tests.** TypeScript strict, ESM, Node 22, exact versions. **Every test runs offline.** A setup file in each X3 test folder replaces `globalThis.fetch` with a function that throws unless the test stubs it.
4. **Copy and numbers.** User-facing strings live in one copy module per package (`services/bot/src/copy.ts`, `services/api/src/actions/copy.ts`, `apps/web/src/link/copy.ts`), each marked `TODO(packages/copy): move when M4.1 ships packages/copy`. Prices, the 2% royalty, tier multipliers and card counts come from `@onepercent/config`, never typed by hand.
5. **Names.** Follow DA §3: X-ray, Feed, Rip, Pull, Dust Card, Silver / Blue / Holo / Black Foil, Jackpot, The 1%, My cards, On Air. "Rip" is only the pack verb, in sentence case.

## 2. Layout (create)

```
services/bot/src/
  index.ts              # entry; KEEP the M0 top-of-file sentence; wiring + long polling
  env.ts                # + PUBLIC_WEB_URL, PUBLIC_API_URL, BOT_API_SECRET
  bot.ts                # createBot(deps) → Bot; registers guard, rate limit, commands
  copy.ts format.ts links.ts referral.ts guard.ts limits.ts ratelimit.ts store.ts
  xray-result.ts        # TODO(X1) local mirror of XrayResultSchema (§9)
  clients/xray.ts clients/link.ts   # HTTP clients, zod-parsed; link client sends Bearer BOT_API_SECRET
  handlers/             # start xray feed rip link me alerts hits text callback
  notify/sender.ts notify/templates.ts
  test/                 # fake Telegram API recorder, fixtures/, *.test.ts
services/api/src/actions/  # index headers spec actions-json xray rip xray-port copy xray-result __fixtures__/ tests
services/api/src/link/     # index routes message base58 store auth ratelimit tests
apps/web/src/link/         # LinkPage.tsx wallets.ts api.ts route.ts copy.ts link.css tests
```

## 3. Bot (`services/bot`)

### 3.1 Shape and wiring

- **Construction.** `createBot(deps)` takes `{ env, store, rateLimiter, xray, link, clock, logger }`. Tests pass a fixed `botInfo` (no `getMe`) and an API transformer (`bot.api.config.use`) that records every call and returns canned results. They drive the bot through `bot.handleUpdate(update)` with no network.
- **Kept from M0.** With no token: log "bot disabled", exit 0. Graceful shutdown stays.
- **Updates and command menus.** `allowed_updates: ["message", "callback_query", "my_chat_member"]`. At startup, `setMyCommands` registers start, xray, feed, rip, link, me, alerts for private chats, and xray, hits for `all_group_chats`.
- **Messages.** `parse_mode: "HTML"` with `escapeHtml` on every interpolated value; at most 6 lines (`BOT.maxMessageLines`) and 1–3 inline buttons; the first line is the news, in `<b>`; numbers first, separated by " ✳ "; no emoji except ✨ for The 1%.
- **`format.ts`** (DA §4.3). `shortAddress` is 4+4 (`7xKp…d2Qa`) in the user's own context and 3+2 (`9pQ…a1`) in hit posts. `formatSol` takes X1's exact decimal string (or lamports as `bigint`), never a float. It keeps 2 decimals, zeros trimmed, at ≥ 0.01, else 3 significant digits ("0.7912"→`0.79`, "412.6"→`412.6`, "1"→`1`, "0.0061"→`0.0061`, "0.002039"→`0.00204`, "0"→`0`). When X1 is on your base, reuse its `format.ts` helpers (`lamportsToSol`) rather than duplicating them. Use U+2212 for minus, one-decimal percentages (`−99.6%`), `×` and `≈`.
- **`sanitizeTicker`.** Uppercase, `[A-Z0-9]` only, ≤ 10 characters (`UI.tickerMaxChars`), so a hostile token symbol can never carry a link or HTML.
- **Logging.** Log only the command name, outcome and latency. Never log message text, start payloads, nonces, `BOT_API_SECRET`, the bot token, or any Telegram-user ↔ wallet pair (wallet de-anonymisation is a known incident class).

### 3.2 Commands

| Command | Chat | Behaviour |
|---|---|---|
| `/start [payload]` | private | `store.recordStart(userId, chatId)`, capture the referral (§3.4), reply START. In a group: START_GROUP, payload ignored |
| `/xray <address\|name.sol>` | any | Trim the input; lowercase `.sol` names.<br>• `0x…` → SOLANA_ONLY.<br>• Matches neither `^[1-9A-HJ-NP-Za-km-z]{32,44}$` nor `^[a-z0-9][a-z0-9-]{0,62}\.sol$` → XRAY_USAGE.<br>• Otherwise: `sendChatAction("typing")`, `xray.get(input)`, then XRAY_RESULT with `link_preview_options = { url: share.landscapeUrl, prefer_large_media: true, show_above_text: false }` (the landscape card is the preview) |
| plain text | private | A message that is only an address or `.sol` name is handled as `/xray`; anything else gets UNKNOWN. The secret guard (§4) runs first |
| `/feed` | private | FEED with [Feed in Phantom] [Feed in Solflare] → feed target (§3.5) |
| `/rip [edition] [n]` | private | `edition`: `og\|original`, `bs\|blue_shift`, `sg\|signature` or `ah\|after_hours` → `PACK_EDITIONS` id. `n` is 1–10, default 1 (the web page re-checks live coverage).<br>No args → RIP_ALL; args → RIP_ONE; bad input → RIP_USAGE. Buttons: [Rip in Phantom] [Rip in Solflare] |
| `/link` | private | `link.createNonce(userId, botInfo.username)`, then LINK with [Link in Phantom] [Link in Solflare] → `${PUBLIC_WEB_URL}/link/<nonce>` |
| `/me` | private | `link.walletOf(userId)` → ME_NONE or ME_LINKED (placeholder until cards and royalties exist) |
| `/alerts [on\|off]` | private | Needs a linked wallet (else ALERTS_NEED_LINK). Stores the opt-in; with no argument, shows the current state |
| `/hits on\|off` | group | Admins only: `getChatMember` status `creator`/`administrator`, or anonymous admin (`ctx.senderChat?.id === ctx.chat.id`). Stores the opt-in. **Stub: nothing posts yet.** Private chat → HITS_PRIVATE |
| `/link` `/me` `/alerts` `/feed` `/rip` | group | PRIVATE_ONLY. A link nonce never appears in a group |
| callback `xray_help` | any | `answerCallbackQuery`, then XRAY_USAGE |
| `my_chat_member` (bot added) | group | **Send nothing.** Joining a group never produces a message |

X-ray client: it sends `Authorization: Bearer BOT_API_SECRET` when the secret is set (X1 §6.4 then skips its per-IP limit and Turnstile) and times out after 12 s (X1's own deadline is 10 s). Error bodies are `{ error, message }`:
- 400 or 404 → XRAY_USAGE;
- 403 `turnstile_required`, 429, 5xx, 504 or timeout → XRAY_BUSY;
- schema failure → XRAY_BUSY, plus the log line `xray_schema_mismatch`.

### 3.3 Copy (exact; `{}` = variable, `\n` = new line)

| Key | Text |
|---|---|
| START | `<b>1% Machine.</b>\nSend /xray and any Solana wallet or .sol name. No connection, no keys.\nBags in. Packs out.`<br>Buttons: [X-ray a wallet] (callback `xray_help`), [How it works] (URL `PUBLIC_WEB_URL`) |
| START_GROUP | `<b>1% Machine.</b> Send /xray and a Solana wallet.` |
| XRAY_USAGE / SOLANA_ONLY / XRAY_BUSY | `Send /xray and a Solana address or .sol name.` / `Solana wallets only for now.` / `The X-ray is busy. Try again in a minute.` |
| XRAY_CLEAN | `<b>X-ray: {who}</b>\nThat wallet's clean. Nothing to X-ray. Mint condition.`<br>Used when `counts.bags == 0` and `counts.empty == 0` |
| XRAY_RESULT | Lines, in order:<br>1. `<b>X-ray: {who}</b>`<br>2. `{bags} bags ✳ {feedable} feedable ✳ {sellable} have a bid ≈{sellValueSol} SOL`<br>3. `{empty} empty accounts ≈{rentBackSol} SOL rent back`<br>4. `Worst: ${TICKER} −{dd}% from ATH.` (only when `worst` is set)<br>5. `Condition: {card.condition} ✳ {card.title}`<br>6. FOOTER<br>Drop zero-count segments and lines, and use the singular for 1 (`1 bag`, `1 has a bid`, `1 empty account`), as X1's `xrayLine` does. `{who}` is the `.sol` input, else 4+4.<br>Buttons: [Feed in Phantom] [Feed in Solflare] (only if `feedable > 0`), [Share X-ray] (URL `share.xIntentUrl`) |
| FOOTER | `You sign everything in your own wallet. No keys, ever.`<br>DA §12's "Your bags never touch an Onepercent wallet" **must not ship**: in v2, fed bags do go into the program vault |
| FEED | `<b>Feed the machine.</b>\nEach bag becomes a Dust Card ✳ {min}–{max} SOL to you each time it's pulled.\nTake it back any time before it's pulled.\n` + FOOTER<br>Range = `min/max(priceLamports) × PACK_SPLIT_BPS.royaltyPerDustCard / 10_000` = 0.002–0.02 |
| RIP_ALL | `<b>Rip a pack.</b>\n{name} {price} SOL ✳ …` (4 editions from config) `\n{dust} Dust Cards + {hit} hit per pack. Real tokens inside.\n` + FOOTER |
| RIP_ONE / RIP_USAGE | `<b>{name} ✳ {price} SOL</b>\nRip {n} pack(s) in your wallet. The page shows the odds before you sign.\n` + FOOTER / `Editions: og, bs, sg, ah. Packs: 1 to 10. Example: /rip ah 5` |
| LINK | `<b>Link a wallet.</b>\nOpens {webHost} in your wallet to sign one message. No transaction, no fees.\nRead-only: I can show your cards and send the alerts you turn on.\nWorks once, for {ttlMin} minutes. Don't forward it.` |
| LINK_OFF | `Linking is off right now.` (when `BOT_API_SECRET` is unset) |
| ME_NONE / ME_LINKED | `<b>No wallet linked.</b>\nSend /link to link one. Read-only, one signed message.` / `<b>Linked: {short}</b>\nCards, royalties and deposits show here from On Air.\nAlerts: {on\|off} ✳ /alerts to switch.` |
| ALERTS_ON / _OFF / _NEED_LINK | `<b>Alerts on.</b> Royalties for {short}, when your cards are pulled.\n/alerts off to stop.` / `<b>Alerts off.</b> I won't message you.` / `Link a wallet first: /link.` |
| HITS_ON / _OFF / _NOT_ADMIN / _PRIVATE | `<b>Hit posts on.</b> Holo Foil and up, from On Air.` / `<b>Hit posts off.</b>` / `Only group admins can switch hit posts.` / `Hit posts are for groups. Add me to one and send /hits on.` |
| PRIVATE_ONLY / UNKNOWN / RATE_LIMITED | `Ask me in a private chat.` / `I know /xray, /feed, /rip, /link, /me and /alerts.` / `One at a time. Try again in {s} s.` |
| SECRET_GUARD | `<b>Deleted.</b> That looked like the words or numbers that unlock a wallet. I kept nothing.\nNobody at Onepercent will ever ask for them.\nIf it was real, move your funds to a new wallet now.` |

### 3.4 Referral capture (SPEC §6.7)

- **Payload.** Telegram allows `[A-Za-z0-9_-]`, up to 64 characters. The payload is `ref_<code>`. A code is a wallet address (`^[1-9A-HJ-NP-Za-km-z]{32,44}$`) or an alias (`^[a-z0-9_]{3,16}$`). Aliases are stored unresolved and resolve later. Any other payload is ignored silently.
- **First wins.** `setPendingReferral` writes only when the user has no pending code. This mirrors the chain: `buy_packs` binds once, at the wallet's first Rip, and ignores self-referral and existing bindings.
- **Where it is used.** The code is appended as `ref=<code>` to the Feed and Rip targets built for **that user in a private chat**. Group replies never carry a code.
- **Document the link format** for the other tracks: `https://t.me/<bot>?start=ref_<code>`.

### 3.5 Universal links (`links.ts`; Phantom and Solflare docs checked 2026-10-08)

- **Phantom.** `https://phantom.com/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(ref)}`
- **Solflare.** `https://solflare.com/ul/v1/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(ref)}`
- **`ref`** is the `PUBLIC_WEB_URL` origin.
- **Targets.** `${PUBLIC_WEB_URL}/feed[?ref=]`, `${PUBLIC_WEB_URL}/packs?edition=<id>&n=<n>[&ref=]` and `${PUBLIC_WEB_URL}/link/<nonce>`. They carry only the intended action, never amounts. Golden tests pin the exact strings.
- **`TODO(M6.2)`.** Move to single-use `/go/<session>` ids (SPEC §2.4). Backpack links also come in M6.2.

### 3.6 Rate limits and mirrored params (`limits.ts`)

Per-user limits (off-chain; propose them for `PARAMS.md` in the PR):

| Scope | Limit |
|---|---|
| Any update | 20 per 60 s |
| `/xray`, including plain-text X-rays | 6 per 60 s |
| `/link` | 3 per 600 s |

- **Keys.** `${userId}`, or `${userId}:${chatId}` in groups.
- **On refusal.** The first refusal in a window replies RATE_LIMITED (for callbacks, the same text via `answerCallbackQuery`). Later refusals in that window are silent.
- **Interface.** `RateLimiter.consume(key, rule)` returns `{ ok: true }` or `{ ok: false, retryAfterS }`. In-memory now, Redis later.
- **Mirrored params** from `PARAMS.md` §18, marked `TODO(config)`: `BOT.sessionTtlSeconds` 600, `BOT.maxMessagesPerSecond` 25, `BOT.hitPostMinKind` `holo`, `BOT.maxMessageLines` 6. If `@onepercent/config` already exports `BOT` on your base, import it instead. A test pins these values.

### 3.7 Storage (`store.ts`)

```ts
export interface BotStore {
  recordStart(userId: number, chatId: number): Promise<void>;     // chat may receive opted-in messages
  hasStarted(chatId: number): Promise<boolean>;
  setPendingReferral(userId: number, code: ReferralCode): Promise<boolean>; // false if one exists
  getPendingReferral(userId: number): Promise<ReferralCode | null>;
  setAlerts(userId: number, on: boolean): Promise<void>;  getAlerts(userId: number): Promise<boolean>;
  setGroupHits(chatId: number, on: boolean): Promise<void>;  getGroupHits(chatId: number): Promise<boolean>;
  markBlocked(chatId: number): Promise<void>;                      // 403 → alerts off, not started
}
```

Ship `InMemoryBotStore`, with a `TODO(packages/db)` for the Postgres version. It never holds message text.

### 3.8 Notification sender (`notify/`; the worker feeds it later; no caller yet)

```ts
export type RoyaltyEvent = { wallet: string; ticker: string; lamports: bigint };
export type HitEvent =
  | { tier: "holo" | "black"; buyer: string; edition: EditionId; stockedLamports: bigint }
  | { tier: "jackpot"; buyer: string; edition: EditionId; onePctAmount: bigint }
  | { tier: "onePct"; buyer: string; edition: EditionId };
export type Delivery = "sent" | "not_started" | "opted_out" | "below_min_tier" | "blocked" | "failed";
export interface NotificationSender {
  royalty(chatId: number, e: RoyaltyEvent): Promise<Delivery>;
  hit(chatId: number, e: HitEvent): Promise<Delivery>;
}
```

- **Gates (checked before any API call).** A private chat needs `hasStarted` and alerts on. A group needs hits on and a tier ≥ `BOT.hitPostMinKind`.
- **Throttle.** ≤ 25 msg/s globally, ≥ 1 s between messages to one chat, ≤ 20/min per group.
- **Errors.** 403 → `markBlocked`, result `blocked`. 429 → honour `retry_after` once, then result `failed`.
- **Templates (`templates.ts`).** Labels and multipliers come from `HIT_TIERS`; amounts use config decimals.

| Event | Template |
|---|---|
| royalty | `<b>+{sol} SOL.</b> Your ${TICKER} card was pulled.\nPaid to {short4+4}.` |
| holo / black | `<b>{label} {mult}×</b> ✳ {buyer3+2} ripped {a\|an} {edition} ✳ stocked at {sol} SOL` + button [Rip the same pack] → `${PUBLIC_WEB_URL}/packs?edition=<id>` |
| jackpot | `<b>Jackpot</b> ✳ {buyer3+2} pulled {amount} $1PCT from {a\|an} {edition} pack` |
| The 1% | `✨ <b>The 1%.</b> {buyer3+2} pulled {TOKEN_1PCT.onePctCardAmount} $1PCT from {a\|an} {edition} pack.` |

- **One send path.** `api.sendMessage` appears **only** in `notify/sender.ts`. Everything else replies through `ctx.reply` or `ctx.answerCallbackQuery`.

## 4. Hard rules and the tests that prove them (bot)

1. **Keys and secrets.** Keep the M0 sentence as line 1 of `index.ts` and atop `guard.ts`. The **secret guard** (`guard.ts`) is the first middleware on private-chat text.
   - It fires on any of: exactly 12, 15, 18, 21 or 24 whitespace-separated tokens each matching `^[a-z]{3,8}$`; a base58 string of 85–90 characters; a bracketed list of exactly 64 integers from 0 to 255.
   - On a match it calls `deleteMessage` (bots may delete incoming private messages), replies SECRET_GUARD and stops. It never stores, logs or forwards the text, and imports no word list or key library.
2. **Output test (`test/no-secret-requests.test.ts`).** Run a matrix through `bot.handleUpdate`: every command with no, valid and invalid arguments, in private and in groups; plain text; callbacks; the guard inputs. Also render every notifier template.
   - Collect every outgoing `text`, `caption` and button label (not URLs: base58 can spell anything). None may match `/seed|private key|secret key|recovery phrase|mnemonic|passphrase|import (your )?wallet|\b(12|24)[ -]words?\b/i`.
   - Every message must have ≤ 6 lines and ≤ 3 buttons. Run the same regex over `apps/web/src/link/copy.ts`.
3. **Static test (`test/static-rules.test.ts`).** Scan `services/bot/src/**/*.ts` (tests excluded) and `services/bot/package.json`. It fails on:
   - imports of `bip39`, `@scure/bip39`, `ed25519-hd-key`, `tweetnacl`, `@solana/web3.js`, `@solana/kit`;
   - the identifiers `Keypair`, `fromSecretKey`, `secretKey`, `derivePath`;
   - the strings `web_app`, `WebApp`, `sendInvoice`, `createInvoiceLink`, `"XTR"`, `pre_checkout_query`, `successful_payment`, `setChatMenuButton`, `answerWebAppQuery`;
   - any `api.sendMessage` outside `notify/sender.ts`.
4. **Never the first message.** The notifier returns `not_started` with zero API calls for a chat without `/start`. An "added to group" `my_chat_member` update makes zero API calls. `allowed_updates` contains no payment update.
5. **Logs.** Capture pino output during the matrix run. It must contain no input text, address, nonce, start payload or `BOT_API_SECRET`.
6. **Vocabulary.** A test scans the three copy modules, whole-word and case-insensitive (`ZK` case-sensitive). It fails on:
   - the AGENTS.md list: grave, graveyard, tomb, tombstone, bury, burial, ghost, ghoul, lich, haunt, wake, funeral, mourner, undertaker, soul, cremate;
   - the DA §3.4 list: casino, gamble, bet, guaranteed, risk-free, free money, profit, yield, APY, passive income, sweep, "verify your wallet";
   - `\bZK\b`.

## 5. API: Solana Actions (`services/api/src/actions/**`)

**Sources, verified 2026-10-08:** `@solana/actions-spec` 2.4.2 types, the `@solana/actions` constants (`ACTIONS_CORS_HEADERS`, `BLOCKCHAIN_IDS`), and solana.com/docs/advanced/actions. Dialect `blinks-core` 0.20.7 supports spec ≤ 2.4, and without both version headers it shows "Blink compatibility metadata is not set".

### 5.1 Routes

| Route | Response |
|---|---|
| `GET /actions.json` | `{"rules":[{"pathPattern":"/x/*","apiPath":"/api/actions/xray/*"},{"pathPattern":"/api/actions/**","apiPath":"/api/actions/**"}]}` (clients keep the query string). `Cache-Control: public, max-age=300` |
| `GET /api/actions/xray?address=<a>` and `GET /api/actions/xray/<a>` | `<a>` is base58 (32 bytes decoded) or a `.sol` name. `addr` is accepted as an alias of `address` (SPEC §2.5).<br>Body fields:<br>• `type: "action"`<br>• `icon`: `share.squareUrl` (1080², DA §13)<br>• `title`: `X-ray: {short4+4 or name.sol}` (≤ 40 chars)<br>• `description`: `{bags} bags ✳ {feedable} feedable ✳ {sellable} have a bid ≈{sol} SOL` (≤ 140 chars, zero segments dropped)<br>• `label`: `X-ray your wallet`<br>• `links.actions: [{ type: "external-link", label: "X-ray your wallet", href: "/api/actions/xray" + keptRefQuery }]`<br>Headers: `Cache-Control: public, max-age=60` (`BLINKS.liveNumbersMaxAgeSeconds`) |
| `GET /api/actions/xray` (no address) | Generic Blink:<br>• title `X-ray any wallet`<br>• description `Bags, bids and rent back for any Solana wallet. No connection, no keys.`<br>• same `links.actions`<br>• fallback icon (§5.3) |
| `POST` any xray route | `{ account }` must decode to 32 bytes, else 400.<br>Returns `{ "type": "external-link", "externalLink": "${WEB_ORIGIN}/x/<account>[?ref=<code>]" }`.<br>`ref` is kept only when the request URL carried a valid code (§3.4), because share artifacts embed the sharer's code (SPEC §6.7) |
| `GET /api/actions/rip/:edition` | `:edition` must be a `PACK_EDITIONS` id, else 404 `Unknown edition.`<br>Body fields:<br>• `type: "action"`<br>• `title`: `{name} ✳ {price} SOL`<br>• `description`: `{dust} Dust Cards + {hit} hit per pack. Real tokens inside.` (`CARDS_PER_PACK`)<br>• `label`: `Rip 1 pack`<br>• `disabled: true`<br>• `error: { message: "On Air soon" }`<br>• fallback icon, no `links` |
| `POST /api/actions/rip/:edition` | 403 `{ "message": "On Air soon" }`. **Builds nothing** |

Errors: an upstream X-ray failure returns 200 with the generic Blink plus `error: { message: "The X-ray is busy. Try again in a minute." }`; an invalid address returns 400 `{ "message": "That doesn't look like a Solana address." }`; every 4xx/5xx body is an `ActionError`.

### 5.2 Headers on every Actions response (errors and `OPTIONS` included)

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,PUT,OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids
Access-Control-Expose-Headers: X-Action-Version, X-Blockchain-Ids
Content-Type: application/json            (not on a bodiless OPTIONS)
X-Action-Version: 2.4
X-Blockchain-Ids: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
```

- **Chain id.** Mainnet, because X-ray scans mainnet. If your base's API env already has a cluster variable, map devnet to `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.
- **`OPTIONS`.** Returns 204 or 200 with the same headers.

### 5.3 Port, icon, spec conformance

- **X-ray port.** `XrayPort.get(address): Promise<XrayResult>`. In production it wires X1's in-process `xrayService.get(input)` (X1 §6.1), which bypasses the HTTP middleware. Until X1 is on your base, wire `app.request("/api/xray/" + encodeURIComponent(a))` parsed with the §9 mirror, marked `TODO(X1)`. Tests inject a fake.
- **Fallback icon.** `ACTIONS_FALLBACK_ICON = new URL("/assets/pack-3d.png", WEB_ORIGIN)`, marked `TODO(art)`. The architect supplies the 1080² Blink images in M6.2. Icons are always absolute URLs.
- **Spec conformance.** `spec.ts` transcribes zod schemas from `@solana/actions-spec@2.4.2` `index.d.ts` (cite the version): `ActionGetResponse`, `ActionPostRequest`, `ExternalLinkResponse`, `ActionError`, `ActionsJson`. Handlers also `satisfies` the package types (api devDependency). Limits: labels ≤ 5 words and starting with a verb; titles ≤ 40 characters; descriptions ≤ 140.

### 5.4 Registration and CORS (the only `app.ts` changes)

- **Actions CORS.** Wrap the global `cors({ origin: [WEB_ORIGIN] })` so it **skips** `/actions.json` and `/api/actions/*`. Those routes get the §5.2 headers instead; the wildcard origin exists only there.
- **Link-page CORS.** Extend the global CORS with `allowMethods: ["GET", "POST"]` and `allowHeaders: ["Content-Type"]`. `/api/link/*` stays `WEB_ORIGIN`-only.
- **Registration.** Add `registerActions(app, deps)` and `registerLink(app, deps)`. Change the signature to `createApi(env, deps = defaultDeps(env))` so the M0 tests keep passing.

### 5.5 How the web host serves it (document in the PR; edit no Caddy or landing file)

- **Production.** `web` (Caddy) reverse-proxies `/actions.json`, `/api/*` and `/x/*` to `api` (master §3.2). Put this snippet in the PR: `handle /actions.json { reverse_proxy {$API_UPSTREAM} }` and `handle /api/* { reverse_proxy {$API_UPSTREAM} }`.
- **Before SW-1.** The landing owns onepercent.fun. Test against a preview API origin (it serves `/actions.json` at its own root) through a Blink inspector: `https://dial.to/?action=solana-action:<urlencoded action url>`.
- **Dialect registration** is M6.2.

## 6. API: wallet link with SIWS (`services/api/src/link/**`)

| Route | Auth | Request → response |
|---|---|---|
| `POST /api/link/nonce` | Bearer `BOT_API_SECRET` (bot only) | **Request:** `{ telegramUserId: int, 0 < n ≤ MAX_SAFE_INTEGER; botUsername: ^[A-Za-z0-9_]{5,32}$ }`.<br>**Response:** 201 `{ nonce, expiresAt }`.<br>**Nonce:** 32 lowercase hex characters from `crypto.randomBytes(16)` (SIWS requires ≥ 8 alphanumerics). TTL 600 s (`BOT.sessionTtlSeconds`, mirrored, `TODO(config)`).<br>**Limits:** a new nonce **invalidates** that user's earlier open nonces; at most 5 per user per 10 min |
| `GET /api/link/session/:nonce[?address=]` | public, 30/min per IP | **200:** `{ status: "open", expiresAt, botUsername, message? }`. `message` is the exact §6.1 text, present only when `address` is a valid 32-byte base58 key.<br>**Unknown:** 404. **Expired or used:** 410 |
| `POST /api/link/verify` | public, 10/min per IP | **Request:** `{ nonce, address, signature }`, where `signature` is base64 of 64 bytes.<br>**Single use:** the nonce is consumed **atomically** by the first verify that names it, whether that verify succeeds or fails.<br>**Responses:** expired 410; unknown 404; bad signature 401; on success, `bind(telegramUserId, address)` → 200 `{ ok: true, wallet, botUsername }` |
| `GET /api/link/telegram/:telegramUserId` | Bearer (bot only) | 200 `{ wallet: string \| null, linkedAt: string \| null }` |

- **Bearer check.** Compare SHA-256 digests with `crypto.timingSafeEqual`. A mismatch returns 401 with no detail.
- **Secret unset.** The bot-only routes return 503, and the API logs `link disabled` once.
- **Per-IP key.** The socket address. Use the first `X-Forwarded-For` hop only when the socket address is private-network. Reuse X1's helper if it has merged.
- **Binding.** One wallet per Telegram user and one Telegram user per wallet. A new verified link replaces the old pair on both sides.

### 6.1 Message (`message.ts`; LF line endings; golden test vector)

```
{host of WEB_ORIGIN} wants you to sign in with your Solana account:
{address}

Link this wallet to the 1% Machine Telegram bot. Read-only. No transaction, no fees.

URI: {WEB_ORIGIN}/link/{nonce}
Version: 1
Chain ID: mainnet
Nonce: {nonce}
Issued At: {issuedAt ISO-8601}
Expiration Time: {expiresAt ISO-8601}
```

- **Format.** Phantom SIWS ABNF (github.com/phantom/sign-in-with-solana). Phantom validates SIW-formatted `signMessage` requests and warns on a domain mismatch.
- **Rebuild, never trust.** The API rebuilds this text from stored state plus the submitted `address`, and verifies against the rebuilt text. It never trusts message text sent by the client.
- **Verification** uses `node:crypto`: `createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: base64url(pubkey32) }, format: "jwk" })`, then `verify(null, bytes, key, sig)`. No new dependency.
- **`base58.ts`** encodes and decodes. Vectors: 32 zero bytes ↔ `11111111111111111111111111111111`, plus 2 known keys.
- **`LinkStore`** exposes `createNonce`, `peekNonce`, `takeNonce` (atomic consume), `bind`, `walletOf` and `telegramOf`.
- **`InMemoryLinkStore`** sweeps expired nonces on each create, caps live nonces at 10,000, takes an injected clock, and is marked `TODO(packages/db)`.

## 7. Web: `/link/:nonce` (`apps/web/src/link/**`, uses `VITE_API_URL`)

**Route.** `route.ts` exports `matchLinkRoute(pathname)` for `^/link/([0-9a-f]{32})/?$`. `main.tsx` renders `<LinkPage nonce=… />` on a match and `<App />` otherwise. Vite dev already falls back to `index.html`. Production routing ships with the web milestone.

**Flow.**
1. **Load.** `GET session`. A 404 or 410 shows EXPIRED.
2. **Discover.** `getWallets()` from `@wallet-standard/app`. Keep wallets with a `solana:` chain, `standard:connect` and `solana:signMessage`, and subscribe to `register`.
3. **No wallet.** Show NO_WALLET with [Open in Phantom] [Open in Solflare]: universal links for `window.location.href`, using the §3.5 builders duplicated in `link/`.
4. **Connect.** One `Connect {wallet.name}` button per wallet. Call `standard:connect`, take the first account that has `solana:signMessage`, then `GET session?address=` to get the `message`.
5. **Sign.** [Sign to link] calls `signMessage({ account, message: utf8(message) })`. If `signedMessage` differs from the bytes sent, show MISMATCH and do not post.
6. **Verify.** `POST verify` with `{ nonce, address, signature: base64 }`. 200 → SUCCESS with [Back to Telegram] → `https://t.me/{botUsername}`; 401 → MISMATCH; 410 → EXPIRED; network error → OFFLINE.
7. **Wallet errors.** Any wallet error during connect or sign shows REJECTED.

**Copy.**

| Key | Text | Key | Text |
|---|---|---|---|
| TITLE | `Link your wallet to Telegram` | SIGNING | `Waiting for your wallet…` |
| SUB | `One signed message. No transaction, no fees. Read-only.` | REJECTED | `Wallet said no. Nothing was sent.` (SPEC §2.6) |
| LOADING | `Checking the link…` | MISMATCH | `That signature didn't match. Send /link to the bot again.` |
| EXPIRED | `This link expired or was already used. Send /link to the bot again.` | OFFLINE | `The machine didn't answer. Try again.` |
| NO_WALLET | `Open this page in your wallet app.` | SUCCESS | `Linked. Back to Telegram.` |

**Style.** Existing CSS variables (cream background, ink text); Fraunces 700 title at −0.055em; DM Sans body; ink-oval buttons with cream text and a visible focus ring on the button itself; `role="status"` on status lines.

**Constraints.** No third-party requests, because the nonce is in the URL. Nothing in `localStorage`. No other wallet logic: no transactions, balances or adapters.

## 8. Env vars and dependencies

| Var | Service | Rule |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | bot | Unchanged (M0) |
| `PUBLIC_WEB_URL` | bot | Origin; default `http://localhost:5173`; `https:` unless the host is localhost. Must equal the API's `WEB_ORIGIN` in every environment (say so in `.env.example`) |
| `PUBLIC_API_URL` | bot | An origin the bot can reach (a private-network URL is fine); default `http://localhost:3000` |
| `BOT_API_SECRET` | bot, api | Optional, ≥ 32 characters, server-to-server only, **never** a `VITE_` variable. When unset, the bot replies LINK_OFF to `/link` and `/me`, and the API disables its bot-only routes |

- **API origin.** The API reuses `WEB_ORIGIN` for the SIWS domain, external links and icons.
- **No double definitions.** X1 also parses `BOT_API_SECRET` (and `PUBLIC_WEB_URL` / `PUBLIC_API_URL`) in `services/api/src/xray/env.ts`. If X1 is on your base, read the value from there and do not touch `src/env.ts`. Never define the secret twice.
- **New secret.** `BOT_API_SECRET` is the only one. The master brief says the bot holds only `TELEGRAM_BOT_TOKEN`, so record this deviation in the PR.

New dependencies, with exact versions and a `VERSIONS.md` row each (date and registry link). Nothing else: no `@solana/web3.js`, no wallet adapter, no grammY plugin, no base58 or ed25519 package.

| Package | Adds |
|---|---|
| bot | `@onepercent/config` (`workspace:*`) |
| api | `@onepercent/config` (`workspace:*`); dev: `@solana/actions-spec` 2.4.2 (types only, 2024-10-24) |
| web | `@wallet-standard/app`, `@wallet-standard/base`, `@wallet-standard/features` 1.1.1 (2026-06-03); `@solana/wallet-standard-features` 1.5.0 (2026-09-10) |

## 9. Coordination with X1 (`XrayResult`)

- **Source of truth.** `docs/codex/X1-XRAY-BRIEF.md` §6.2 defines `XrayResultSchema` in `app/packages/eligibility/src/xray-result.ts`, exported as `@onepercent/eligibility/xray-result`.
- **If X1 is on your base,** import it from there and delete the mirrors.
- **Until then,** bot and api each keep an `xray-result.ts` headed `// TODO(X1): delete and import from @onepercent/eligibility/xray-result`. It mirrors X1 §6.2 with `bags` and `emptyAccounts` loosened, since X3 never reads them:

```ts
const Sol = z.string().regex(/^\d+(\.\d{1,9})?$/);             // exact decimal SOL, a STRING
const B58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const N = z.number().int().nonnegative();
export const XrayResultSchema = z.object({
  address: B58, chain: z.literal("solana"), scannedAt: z.iso.datetime(), cached: z.boolean(),
  counts: z.object({ bags: N, feedable: N, notFeedable: N, sellable: N, empty: N, notInSet: N }),
  totals: z.object({ sellValueSol: Sol, rentBackSol: Sol }),
  worst: z.object({ symbol: z.string(), mint: B58, drawdownPct: z.number().min(0).max(100) }).nullable(), // 99.6 → "−99.6%"; symbol has no "$"
  bags: z.array(z.unknown()), emptyAccounts: z.array(z.unknown()),
  card: z.object({ title: z.string(), oneLiner: z.string(),
    condition: z.enum(["Mint", "Near Mint", "Lightly Played", "Played", "Heavily Played", "Damaged"]) }),
  share: z.object({ landscapeUrl: z.url(), squareUrl: z.url(), xIntentUrl: z.url() }),
});
```

- **Fields read.** Only those used in §3.3 and §5.1.
- **If X1 changes the shape,** X1's file wins. Adapt `format.ts` and the fixtures, never the bot's message layout.

**Fixture** `test/fixtures/xray-result.json`: an address that shortens to `7xKp…d2Qa`; counts 37 / 16 / 9 / 12 / 104 / 3; totals `"0.7912"` / `"0.2121"`; worst `WIFHAT` 99.6; card `Heavily Played` / `Certified Bagholder`.

The XRAY_RESULT golden must read exactly:

```
<b>X-ray: 7xKp…d2Qa</b>
37 bags ✳ 16 feedable ✳ 12 have a bid ≈0.79 SOL
104 empty accounts ≈0.21 SOL rent back
Worst: $WIFHAT −99.6% from ATH.
Condition: Heavily Played ✳ Certified Bagholder
You sign everything in your own wallet. No keys, ever.
```

**Open item to raise in the PR (not a blocker).** X1 leaves referral codes out of scope: `buildShareLinks(address, { ref? })` ignores `ref`. Propose a `ref` query on `/api/xray` for M6, so that share links built for a linked bot user embed that user's code.

## 10. Acceptance criteria (the architect will run these)

1. **Scope.** `git diff <base> --stat` shows only §1.2 paths. `git diff <base> -- app/services/api/src/app.ts app/apps/web/src/main.tsx` shows only the §5.4 and §7 lines.
2. **Pipeline.** From `app/`, `pnpm install --frozen-lockfile && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` passes, also **with networking disabled** and with no X3 env var set.
3. **Disabled bot.** The bot still exits 0 with "bot disabled" when `TELEGRAM_BOT_TOKEN` is unset.
4. **Bot: referral and X-ray** (all through `handleUpdate`).
   - `/start ref_<addr>` stores the code; a later `/start ref_<other>` doesn't change it; an invalid payload stores nothing.
   - The §9 golden passes, including `link_preview_options.url === share.landscapeUrl`.
   - XRAY_CLEAN, SOLANA_ONLY, XRAY_USAGE (400/404), and XRAY_BUSY for timeout, 403, 429, 5xx and schema failure.
   - The X-ray client sends the bearer header only when `BOT_API_SECRET` is set.
   - The symbol `<a href="x">` is escaped and sanitized.
5. **Bot: links, commands and limits.**
   - Exact universal-link strings for feed, packs and link, with `ref` in private chats only.
   - `/rip ah 5` and `/rip zz` give the expected replies.
   - `/link` and `/me` in a group give PRIVATE_ONLY and create no nonce.
   - `/hits on` is refused for a member and stored for an admin (anonymous admin included).
   - The 7th `/xray` within 60 s gets one RATE_LIMITED; the 8th gets no reply.
6. **Hard rules and notifier.** Every §4 test exists and passes. Notifier tests cover the gates (not started, opted out, below Holo, group off), 403 → `markBlocked`, ≤ 25 msg/s under a fake clock, and goldens for royalty, Holo, Black, Jackpot and The 1%. Nothing in production calls the notifier yet.
7. **Actions.**
   - Responses equal **recorded fixtures** in `actions/__fixtures__/` (exact JSON) for: actions.json; xray with an address, in query and path forms; generic xray; xray POST with and without a kept `ref`; rip GET and POST; an invalid address.
   - Every response, `OPTIONS` and errors included, carries the §5.2 headers. Every GET body parses with `spec.ts`.
   - `Origin: https://dial.to` gets `*` on Actions routes and **no** allow-origin on `/health`.
   - Label, title and description limits hold, and no Actions response has a `transaction` field.
8. **Link** (real Ed25519; tests use a throwaway `generateKeyPairSync("ed25519")` key).
   - Happy path: nonce → session with address → sign the returned message → verify 200 → `GET telegram/:id` returns the wallet.
   - Replay → 410; at 601 s on a fake clock → 410.
   - Wrong key, wrong address or another nonce's signature → 401, and the nonce is still consumed. A second nonce invalidates the first.
   - Missing or wrong bearer → 401; unset secret → 503. Per-IP limits hold. The §6.1 golden passes. Nonce, secret and signature are never logged.
9. **Web** (jsdom; fake wallet via `getWallets().register`; stubbed `fetch`).
   - Success shows `Linked. Back to Telegram.` and posts `{ nonce, address, signature }`.
   - A rejection shows REJECTED and makes no POST. A 410 shows EXPIRED. A `signedMessage` mismatch makes no POST.
   - With no wallet, both universal links for the current URL are shown. `matchLinkRoute` is tested on valid and invalid paths.
10. **Manual checklist** (the founder runs it; not a merge blocker). With `PUBLIC_WEB_URL` on an HTTPS preview of `apps/web`, on a phone with Telegram, Phantom and Solflare:
    - `/link` opens inside each wallet, signs and shows SUCCESS, and `/me` then shows the wallet.
    - `/feed` and `/rip` open the right preview URL in each wallet.
    - The X-ray Blink unfurls in a Blink inspector.

## 11. Do NOT

- **No transactions.** Do not build, serialize or return one, and do not call `buy_packs`, `feed` or any SDK builder. The Rip Blink stays disabled.
- **No custody.** No server-side signing. Nothing in bot, API or web asks for, receives, stores or derives a private key or seed phrase. No key library in the bot.
- **No Mini App.** No `web_app` button, menu-button app, Main Mini App or BotFather web-app setting. No Stars, invoices or payments in Telegram. No Telegram Ads.
- **Never the first message.** No broadcast, nothing on joining a group, no unsolicited "linked" DM. Notifications go only to started, opted-in chats.
- **Out of scope (M6).** Backpack links, `/machine`, the `/go/<session>` service, Dialect registration, hit posting in production.
- **Do not touch** the landing, Caddy, Dockerfiles, Railway, the worker, `packages/*` (config, sdk, eligibility) or X1's files.
- **Dependencies and secrets.** No dependency beyond §8. No secret in a `VITE_` variable or in the bundle.
- **Vocabulary.** None of the §4.6 words in code, strings or docs. No "ZK", no promise or casino words, no "verify your wallet" phrasing.
- **Logging.** Never log message text, start payloads, nonces, signatures, secrets or Telegram-user ↔ wallet pairs.

## 12. Report back (PR description)

Include the M0 §12 items (versions, commands run and their results), the fixture diffs, the §5.5 Caddy snippet, the §3.4 referral format, the §3.6 values proposed for `PARAMS.md`, the `BOT_API_SECRET` deviation, the X1 open item of §9, and every spec ambiguity you hit, with options.
