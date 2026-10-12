# Codex brief — M3: web app plumbing and wiring (The 1% Machine)

Issued 2026-10-12 (D3) by the architect. M3 ships as **three PRs**: **M3.1** shell and X-ray (gate G3.1, live at SW-1), **M3.2** Feed (G3.2, live at SW-2), **M3.3** packs, reveal and My cards (G3.3, flag-on at SW-3). X1 is M3.1's X-ray part. Read with `COPY.md` (issue 1: shell, X-ray, Feed; issue 2 with Rip and My cards follows on D7).

This brief is self-contained for M3. Where it restates a rule, the source is cited. If anything is ambiguous, contradictory or impossible, **stop and report with options**. Do not guess.

---

## 0. Read this first

### 0.1 Authority

Master §0.1 applies, highest first: `DECISIONS.md` (binding founder decisions), `MODEL.md`, `PARAMS.md` (issue 3), `00-MASTER-BRIEF.md`, **this brief** (for M3), `00-M0-SCAFFOLD.md` as migrated by M0.1, `AGENTS.md`, then `COPY.md` (the only strings that may ship). X1, X2 and X3 are interfaces this brief integrates; where they disagree with this brief inside M3's scope, this brief wins, as corrected by master §0.5. `02-M2-BRIEF.md` owns the API contract of the routes M2.2 implements (`@onepercent/sdk/api`, M2 §11.8), the SSE stream and the SDK additions M3 uses; this brief consumes them and lists what it needs added (§5.1 C).

### 0.2 Scope versus the master plan

| Master item (§11.4 M3) | Here |
|---|---|
| Routing, flags client, data layer, SSE client, wallet provider, asset pipeline, deploy | M3.1, §7, §8, §15 |
| X-ray (X1), real Turnstile, referral codes, X-ray numbers | M3.1, §10 (X1 is not re-specified) |
| Feed planning and signing, deposits, Sell at market, closing empty accounts, take-back, royalty memos, daily digest data | M3.2, §11 |
| `buy_packs` flow, reveal data, My cards actions, Close My cards, vault deposits, Verify, `/live`, `/token`, `/fairness`, 1% TV adapter, Highlights | M3.3, §12–§14 |
| Wiring of experience waves 1–4 | §6, per PR |

**Not in M3:** program instructions (M1, M2.1, M4.1); signers, indexer, keeper and the `api` public v1 routes with their schemas, `/api/stream` included (M2.2, M2 §11); the bot, Blinks and Backpack mobile links (M5); `/status` data, the rescue page (M6); Spotlight (D1: no Spotlight in Season 1, so no Spotlight UI is built and the `SPOTLIGHT` flag stays unread); cross-chain (X4).

### 0.3 Decisions and facts this brief relies on

- **D1** no Spotlight. **D6** shared MagicBlock queue: the "Machine busy" occupancy guard stays (§12.2).
- **D10** accepts M3-A1 to M3-A3. **D11** puts `getSignaturesForAddress`, `getTransaction` and `getBlockHeight` on M2's `/api/rpc` allow-list (§5.1 C). **D7–D9** (X-ray price age, schema, no `.sol` names) apply through X1 (master §0.5).
- **Jackpot J-B** (master §0.2): the pot is held in $1PCT and shown "≈ … if sold now". No "buying the Jackpot" state exists.
- **Figures** come from `PARAMS.md` §19, never from SPEC or DA examples. Example: "≈62.5% in SOL if you sell back every foil hit" (PARAMS), not SPEC's 67.5%.
- **DA v1 concepts are out:** the Globe as a SOL prize pool, Convert/Burn/Rep, Trade-in Credit, Assists, Hot or Overdue Jackpot, Pass tiers, Common tier, "paid in SOL" (SPEC §2.7, master §1). Names come from AGENTS.md.

### 0.4 Amendments this brief makes

| # | Amendment | Amends | Why |
|---|---|---|---|
| M3-A1 | Canonical routes `/rip`, `/cards`, `/verify/:pull`. `/packs` → `/rip`, `/me` → `/cards` and `/verify/:seq` are permanent aliases (client redirect, query and hash kept) | master §3.1, X3 §3.5 targets | Routes follow the verbs users see. Every link already issued (bot, Blinks) keeps working |
| M3-A2 | The wallet stack is the Wallet Standard packages X3 introduced (§3), not `@solana/wallet-adapter-react` | master §4.2 wallet row | One stack with X3's `/link`. Direct access to multi-input `solana:signAndSendTransaction`, so the approval count shown is true. The adapter UI is unused anyway (the wallet UI is the architect's) |
| M3-A3 | The API routes no milestone owns go to the Web lane, under `services/api/src/web/**`, with their zod schemas in a new package `packages/web-api` (§5.1 B): batch values, logo proxy, web config, swap build, send fallback, events poll, highlights, royalties, beacon | master §3.3 | M2 §11.8 owns the rest; the Web lane needs these and can build them in parallel without touching M2's directories |
| M3-A5 | The Rip component's action ids are `'redeem' \| 'sell_back' \| 'sellMarket' \| 'feed' \| 'keep'`, plus `share` and `retry` events, as delivered in `experience/lab/src/rip/types.ts` | earlier notes (`sellback`) | The delivered interface wins |
| M3-A6 | A `WEB` section in `packages/config`, between markers, for non-economic web timings and limits (§5.3), each `[A]`, published in `PARAMS.md` issue 3 §26.2 | PARAMS §0 | Same mechanism as X2's section |
| M3-A7 | A displayed SOL amount the user **pays** rounds up; one the user **receives** rounds down | DA §4.3 (format only) | A floored cost understates it |
| M3-A8 | `/verify/:pull` takes a decimal `seq` (canonical, M1 A1) **or** a base58 Pull address. The address form reads `getSignaturesForAddress` and `getTransaction` through `/api/rpc` (§5.1 C), so it works without the indexer | M1 A1 | Verify must not depend on the indexer |

---

## 1. Scope

### 1.1 Three PRs

| PR | Branch | Days | Live |
|---|---|---|---|
| M3.1 shell and X-ray | `feat/m3.1-shell` | D3–D10 | SW-1 (X-ray Week) |
| M3.2 Feed | `feat/m3.2-feed` | D8–D12 | SW-2 (Stock-Up) |
| M3.3 packs and My cards | `feat/m3.3-packs` | D9–D14 | SW-3 (On Air), flags on |

Each PR branches from `main` after the previous M3 PR merges; M3.2 and M3.3 may start on the previous branch and rebase.

### 1.2 Dependencies and fixtures

| Needs | From | Until it lands |
|---|---|---|
| SDK PDAs, layouts, builders (`feed`, `take_back`, `buy_packs`, `settle`, `refund_pull`, `redeem`), errors map | M1 (G1, D7) | M3.1 needs none of it |
| `sell_back`, `feed_back`, `withdraw_owed`, `close_binder` builders (`tx/{sellback,feedback,binder}.ts`), `buildMergeTransactions`, `@onepercent/sdk/{events,verify,api}`, `decodeVrfQueue` | M2 P0–P2, S1, S2, S4 (D8–D12) | M3 codes against M2's published shapes, with fixtures |
| `/api/config`, `/api/machine`, `/api/me`, `/api/verify`, `/api/stream`, `/api/value`, `/api/rpc`, `/api/feed/attest`, `/api/sellback/quote` | M2.2 (G2.2, D13) | A fixture server in `apps/web/e2e/mock-api` that validates every body with `@onepercent/sdk/api` |
| `/api/hold/attest` | M4.2 (404 until then, M2 §11.8) | Rip without the holder boost |
| Experience waves 1–4 | Architect, D5 / D8 / D10 / D12 | Codex placeholders (§6.4) |

**No gate passes on fixtures alone** (master §11.3): each gate runs its flows against the real backends that exist by then (validator, devnet).

### 1.3 Work order

| PR | Order |
|---|---|
| M3.1 | `packages/copy`, `packages/web-api`, WEB config section → router, boot, flags, data layer → wallet session → tx engine core (no flow yet) → X1 integration (after X1 merges) → real Turnstile → web routes in `services/api/src/web/` (values, logo, web config, beacon) → deploy (Dockerfile, Caddyfile, landing assets) → wave 1 wiring → tests, budgets |
| M3.2 | Feed planner (merge, close, sell, feed, attest) → reconciliation → take-back and "In the machine" → royalty memos, digest and royalties route → swap build and send routes → wave 2 wiring → validator e2e |
| M3.3 | Edition models and `maxQty` → Rip flow, Pull watch (M2's stream, events poll route) → reveal adapter and RipMount → My cards actions → Verify → fairness, live, token, TV adapter, Highlights → waves 3–4 wiring → e2e, 100-pull Verify run |

---

## 2. Rules

1. Branch per PR (§1.1). Open a PR. **Never push to `main`.** Rebase on `main` daily; regenerate `pnpm-lock.yaml` with `pnpm install`, never hand-merge it.
2. Edit only the paths of §4.2. The landing (repo root) stays byte-identical. Never edit `docs/codex/**`, `AGENTS.md`, `apps/web/src/experience/**`, `apps/web/public/experience/**`, or the two architect templates once replaced (§6.1).
3. Dependencies: exactly §3, exact pins, each published ≥ 14 days before you add it (master §0.3 C), recorded in `app/VERSIONS.md` with date and source. Nothing else.
4. **Numbers.** Every economic number comes from `@onepercent/config` (PARAMS). Every displayed number traces to chain state, config, a labelled executable quote or a capped labelled estimate (master §7.2, §9.2 S4). Non-economic web timings live in the WEB section (§5.3). No numeric literal in `apps/web/src/{tx,adapters,data,wallet}/**` other than `0`, `1`, `2`, `-1` and their bigint forms, except HTTP codes in `data/http-status.ts` (static test). Sizes and offsets come from `ACCOUNT_SIZES`.
5. **Strings.** Only `@onepercent/copy` keys (`COPY.md`). No raw user-facing literal in `apps/web/src/**` outside `experience/`, `xray/XrayView.tsx` and tests (lint rule, §16.1). API error bodies keep their `error` code; their `message` comes from copy.
6. **Custody.** Users sign their own transactions. Nothing asks for, receives, stores or derives a private key or a seed phrase. The browser holds no RPC key, provider key or secret; reads go through `/api/rpc`.
7. **Build at tap time.** Every transaction is built in the browser at tap time through `@onepercent/sdk` (program instructions), `@solana/spl-token` (token accounts) or the API's Jupiter build (swaps), simulated before the wallet prompt, with a blockhash fetched at `confirmed` right before the prompt (§9).
8. **Reveal.** No outcome reaches the experience layer before the chain has it, and never a guess (master §2.5). Every tier gets the same anticipation path.
9. **Exits** (take-back, Redeem, Sell at market, settle, refund, withdraw owed, Close My cards, Verify, `/fairness`, the rescue link) are never behind a flag, never rate-limited client-side, and render from chain data (master §11.5, §9.2 S3).
10. No network in unit or component tests: a setup file makes any unmocked `fetch` throw. Recorded fixtures only. CI never reaches mainnet, Helius or Jupiter.
11. TypeScript `strict`, ESM, React 19 function components. Lamports and base units are `bigint` end to end; they become strings only in `packages/copy` formatters.
12. Names per AGENTS.md. Forbidden vocabulary per §19.

---

## 3. Dependencies

| Package | Pin | Where | Why |
|---|---|---|---|
| `@wallet-standard/app`, `@wallet-standard/base`, `@wallet-standard/features` | 1.1.1 | web | Same pins as X3 (M3-A2); whichever of X3 and M3.1 merges first adds them |
| `@solana/wallet-standard-features` | 1.5.0 | web | Same pin as X3 |
| `@onepercent/sdk` (with `/api`, `/events`, `/verify`), `@onepercent/config`, `@onepercent/copy`, `@onepercent/web-api`, `@onepercent/eligibility` | workspace | web | — |
| `@solana/web3.js`, `@anchor-lang/core` | the workspace's single versions (1.99.0, 0.32.2) | web, through the SDK | One version in the lockfile |
| `@solana/spl-token` | 0.4.15 | web | Token-account merges, closes, ATA ids |
| `zod` | 4.6.5 | web, copy, web-api | — |
| `@playwright/test` | 1.63.0 | web (dev) | master §4.2 |
| `@axe-core/playwright` | newest release ≥ 14 days old, exact | web (dev) | Accessibility gate |
| `litesvm` (npm) | 0.8.0 (workspace) | web (dev) | Tx engine tests on the v3 `.so` |
| `three` 0.180.0, `@types/three` 0.180.0, `gsap` 3.15.0 (`PARAMS.md` §26.4) | added by the architect's wave PRs | web | Experience dependencies. Codex never adds, removes or bumps them |

No router, data-fetching, state, CSS or analytics library; no wallet-adapter packages; no error-reporting SDK; no third-party script except Turnstile. If `@anchor-lang/core` needs a global `Buffer` in the browser, set it once in `main.tsx` from the `buffer` package already in the lockfile.

---

## 4. Layout and file ownership

### 4.1 Target layout

```
app/apps/web/
  Dockerfile  Dockerfile.dockerignore  Caddyfile  budget.json  playwright.config.ts  .env.example
  scripts/  sync-landing-assets.mjs  budget.mjs  lcp.mjs
  e2e/      mock-wallet/  mock-api/  rpc-replay/  helpers/{validator,vrf}.ts  specs/w1-*.spec.ts w2-* w3-*
  tests/chain/*.test.ts                      # LiteSVM-backed tx engine tests (node env)
  src/
    main.tsx                                 # boot: config → flags → router (replaces the X1/X3 route switch)
    app/       AppShell.tsx  providers.tsx  ErrorBoundary.tsx  NotFound.tsx  OfflineBanner.tsx
    routes/    router.ts  table.ts  pages/{Home,Xray,Feed,Rip,Cards,Verify,Fairness,Live,Token,Status,DevExperience}.tsx
    data/      api.ts  rpc.ts  resource.ts  config.ts  flags.ts  machine.ts  me.ts  binder.ts  deck.ts  stream.ts
               server-time.ts  referral.ts
    wallet/    session.ts  WalletProvider.tsx  capabilities.ts  deeplinks.ts  environment.ts
    tx/        engine/{build,simulate,blockhash,send,confirm,reconcile,errors,progress}.ts
               feed/{plan,merge,close,sell,attest,reconcile}.ts  take-back.ts  rip.ts  watch-pull.ts  settle.ts
               refund.ts  redeem.ts  sell-back.ts  sell-at-market.ts  feed-back.ts  close-binder.ts  withdraw-owed.ts
    adapters/  rip-result.ts  feed-panel.ts  in-the-machine.ts  edition.ts  odds.ts  my-cards.ts  verify.ts
               tv-events.ts  token.ts  trust.ts  values.ts  royalties.ts
    bridge/    RipMount.tsx  ExperienceSlot.tsx  contracts.pending.ts  placeholders/*.tsx  RevealFallback.tsx
    analytics/ events.ts  client.ts
    sound/     player.ts
    xray/  (X1)   link/  (X3)   experience/  (architect)
app/packages/copy/        src/{en.ts,t.ts,format.ts,index.ts}  tests/{parity,placeholders,words}.test.ts
app/packages/web-api/     src/{values,logo,web-config,swap,send,events,highlights,royalties,beacon,royalty-memo,index}.ts
                          fixtures/*.json  tests/*.test.ts
app/services/api/src/web/ router.ts values.ts logo.ts web-config.ts swap.ts send.ts events.ts highlights.ts
                          royalties.ts beacon.ts
```

### 4.2 Who may edit what (parallel lanes)

| Path | Owner | M3 may |
|---|---|---|
| `apps/web/src/**` except the rows below; `apps/web/{e2e,tests,scripts}/**`; the web root files above | M3 | everything |
| `apps/web/src/experience/**`, `apps/web/public/experience/**`; `apps/web/src/xray/XrayView.tsx` and `services/api/src/cards/xray-card.tsx` once wave 1 replaces them | architect | import only; never edit |
| `apps/web/src/xray/**`, `packages/eligibility/**`, `services/api/src/{xray,cards}/**` | X1, then M3.1 | after X1 merges: copy migration, real Turnstile, referral gaps (§10) |
| `apps/web/src/link/**`, `services/api/src/{actions,link}/**`, `services/bot/**` | X3 / M5 | register `/link/:nonce` in the router only |
| `packages/copy/**`, `packages/web-api/**`, `services/api/src/web/**` | M3 | create and own. After G3.1, a `web-api` change is announced in the PR and needs the architect's OK |
| `services/api/src/app.ts`, `services/api/src/index.ts` | shared, append-only | one `registerWeb(app, deps)` line; ≤ 10 lines building deps |
| `packages/config/src/index.ts` | M1 (PARAMS blocks), X2 (its section) | only between `// ===== BEGIN M3 WEB SECTION` and `// ===== END M3 WEB SECTION` |
| `packages/config/src/vocabulary.ts`, `packages/sdk/**` (with `src/api`, `src/events`, `src/verify`), `packages/market/**`, `packages/db/**`, `packages/service-kit/**` | M1, M2, X2 | import only (`db` and `service-kit` from `services/api/src/web/**` only, read-only queries). A missing SDK builder: code against M2's published shape with fixtures and report; never encode a program instruction by hand |
| `services/api/src/{public,intake,quote,internal,roles.ts}`, `services/worker/**`, `programs/**`, `test-programs/**`, `tests/**` | M1, M2, M4 | none |
| `apps/web/package.json` | M3; the experience dependency lines are the architect's | add §3 rows |
| `app/eslint.config.js`, `.github/workflows/app.yml` | shared | append one scoped block (§16.1), one job and one nightly step (§18) |
| `app/.env.example`, `services/api/.env.example`, `app/VERSIONS.md`, `app/README.md` | shared | append rows |

---

## 5. Shared contracts

### 5.1 API routes

**A. Routes M2.2 implements** (schemas in `@onepercent/sdk/api`, M2 §11.8; u64 as `U64String`, every response carries `asOfSlot`). M3 parses every body with them and never redefines one.

| Route | M3 uses |
|---|---|
| `GET /api/config` | `cluster`, `programId`, `flags`, `paramsHash`, `phase`, `season`, `paused`, `vrf` |
| `GET /api/machine` | `coverage.maxQty` (display; re-checked from chain at tap), `deck`, `jackpot`, `onePct`, `sellBack`, `vrf.busy` |
| `GET /api/me/:wallet` | `binder.closable`, `deck[]` (indices verified on chain, §7.3), `pulls.pending` and `pulls.settleable` (§12.6), `vaultDeposits`, `royalties` |
| `GET /api/verify/:seq` | the Pull's fields, `randomness`, `packs[]` (decoded `PackRevealed`), `revealOrder`, `check` |
| `GET /api/stream` (SSE) | events `feed`, `takeBack`, `pullOpened`, `reveal`, `settle`, `refund`, `sellBack`, `stock`, `phase`, `ping`; `Last-Event-ID` resume |
| `GET /api/value?mint=&amount=` | single executable quotes |
| `POST /api/feed/attest` | §11.4 (request: chunks of mints without amounts; the signer computes nonces, whole balances, `source` and `mergeFrom`) |
| `POST /api/sellback/quote` | §13.3 (request `{owner, cardIndices}`) |
| `POST /api/hold/attest` | 404 until M4.2: Rip without the boost |
| `POST /api/rpc` | reads, simulation; M2's allow-list (M2 §11.8), which includes C below |

**B. Routes the Web lane owns** (`services/api/src/web/**`, schemas in `packages/web-api`, built from `@onepercent/sdk/api`'s primitives; until S4 merges, local copies marked `// SWITCH to @onepercent/sdk/api`).

| Route | PR | Contract |
|---|---|---|
| `POST /api/values` | M3.1 | `{mode: 'est' \| 'now', items: [{mint, amount}]}` (≤ `WEB.valuesBatchMax`) → per item `{mint, amount, symbol, name, decimals, logo: '/api/logo/<mint>' \| null, value}`; `value` is M2's `ValueResponse` for `now` (X2 `valueNow`), or `{status: 'ok', lamports, capped, label: 'est'}` for the capped Price v3 estimate (master §7.2); rate-limited per IP (`WEB.valuesNowPerMinutePerIp` items for `now`) |
| `GET /api/logo/:mint` | M3.1 | PNG/JPEG/WebP/GIF bytes (magic-checked), ≤ `WEB.logoMaxBytes`, fetched once from an `https` URL on a host in `WEB.logoHosts`, cached 24 h, `nosniff`. No SVG. Anything else → 404 (the UI shows a monogram) |
| `GET /api/web/config` | M3.1 | `{lookupTable \| null, adminMultisig \| null}` from env (`PROTOCOL_LUT_ADDRESS`, `ADMIN_MULTISIG_ADDRESS`); the browser verifies both on chain before use (§9, §14.3) |
| `POST /api/beacon` | M3.1 | Analytics (§7.6). 204 |
| `POST /api/send` | M3.2 | Fallback only (§8.3). `{tx: base64}` fully signed, ≤ 1,232 B → `{signature}`. Logs no payload |
| `GET /api/royalties/:wallet?before=` | M3.2 | Read-only from M2's `royalties` table: `[{seq, pack, lamports, edition, mint, sig, ts, redirected}]`, newest first, paged |
| `GET /api/events?after=<id>` | M3.3 | Poll fallback of the stream: `XRANGE onepct:events` after `id`, at most `SERVICES.api.sseReplayEvents`, same event schema as `/api/stream` |
| `GET /api/highlights?window=today\|season` | M3.3 | Read-only from M2's `pulls` and `packs`: biggest stocked value, then multiplier: `[{seq, tier, edition, who, hitValueLamports, sig, ts}]` |

`packages/web-api/src/royalty-memo.ts` exports `parseRoyaltyMemo('1pct:roy:<seq>')`, shared with M5.

**C. RPC methods M3 relies on (D11, in M2 §11.8):** `getSignaturesForAddress` (limit ≤ 10, `confirmed`), `getTransaction` (`confirmed`, `maxSupportedTransactionVersion: 0`) and `getBlockHeight` are on the `/api/rpc` allow-list. If a gate run finds one refused, stop and report.

### 5.2 `packages/copy` (M3.1)

- `src/en.ts`: one object, key for key and byte for byte `COPY.md`'s tables. `parity.test.ts` parses `docs/codex/COPY.md` and fails on any difference in keys, text or placeholders.
- `t(key, vars)`: typed by key; placeholders are `{name}`; plural keys end `.one` / `.other` and take `{n}`. A missing var throws in tests and renders the key in production (logged once).
- `src/format.ts`: the DA §4.3 formatters, moved from `packages/eligibility/src/format.ts` (eligibility re-exports them): `sol` (receive, floor), `solCost` (pay, ceil, M3-A7), `solExact`, `pct` (U+2212), `mult` (×), `short` (4+4), `shortTv` (3+2), `ticker`, `amount`, `count` (en-US grouping), `dateUtc`, `timeUtc`, `countdown`. Every copy var that holds a number is produced by one of them.
- `pnpm lint:words` scans `packages/copy` with the promise words added (AGENTS.md list 3).

### 5.3 The WEB config section (`[OFF] [A]`, `PARAMS.md` issue 3 §26.2)

`PARAMS.md` issue 3 §26.2 holds these values and the TS block; where they differ, PARAMS wins. Issue 3 changed two rows, already applied below: `liveStaleAfterMs` is 45,000 (30,000 failed the check in its own row), and `blockhashValidBlocks` is gone (D11 made its fallback unnecessary).

| Key | Value | Use |
|---|---|---|
| `WEB.configRefreshMs` | 60_000 | `/api/config` refresh |
| `WEB.machinePollMs` / `machinePollHiddenMs` | 5_000 / 30_000 | Machine snapshot and chain reads while a page is visible / hidden |
| `WEB.liveStaleAfterMs` | 45_000 | "On air" turns off without an event or `ping` for this long (validated > 2 × `SERVICES.api.ssePingSeconds`) |
| `WEB.sseFailuresBeforePoll` / `eventsPollMs` | 3 / 5_000 | SSE → polling fallback |
| `WEB.pullPollFastMs` / `pullPollFastForMs` / `pullPollSlowMs` | 400 / 10_000 / 2_000 | Pull watch safety-net polling |
| `WEB.revealDataDeadlineMs` | 1_200 | Display data deadline after a reveal (§6.6) |
| `WEB.confirmPollMs` | 800 | Signature status polling |
| `WEB.settlePrependAfterSeconds` | 30 | A user's own revealed, unsettled packs older than this get a settle transaction first in the next batch |
| `WEB.priorityFeeCapMicroLamports` | 500_000 | Cap on the priority price (p50 of `getRecentPrioritizationFees([machine])`) |
| `WEB.walletDetectMs` | 1_000 | Wait for Wallet Standard registrations before "No wallet" |
| `WEB.valuesBatchMax` / `valuesNowPerMinutePerIp` | 50 / 240 | `/api/values` limits (items) |
| `WEB.logoMaxBytes` / `logoTimeoutMs` / `logoHosts` | 262_144 / 3_000 / `['ipfs.io','arweave.net','cf-ipfs.com','gateway.pinata.cloud','*.mypinata.cloud','*.arweave.net','ipfs.filebase.io']` | Logo proxy; report misses in the PR |
| `WEB.sellMaxAccounts` | 24 | Jupiter `maxAccounts` for user sells, so redeem + swap fit one v0 transaction |
| `WEB.jupiterProgramIds` | `['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4']` [EXT, verified 2026-10-08, PARAMS §21] | Swap instruction allow-list (§11.6) |
| `WEB.beaconPerMinutePerIp` | 60 | Analytics |

Zod schema and tests in the same section. These keys never carry an economic value.

---

## 6. Experience integration (master §2.5)

### 6.1 Boundary

- **Location.** The architect delivers through `exp/<wave>` PRs into `apps/web/src/experience/` (components, `contracts.ts`, `index.ts`, the vanilla `rip/` module from `experience/lab/src/rip`), static assets into `apps/web/public/experience/` (the machine GLB `onepercent-machine.glb`, packs, poster), and the two templates (`xray/XrayView.tsx`, `services/api/src/cards/xray-card.tsx`).
- **Never** (Codex): edit, restyle, re-time or re-order any of it; pass an outcome early; compute a number inside a component. A visual problem, or a missing prop, goes back as a PR comment ("interface request").
- **Never** (experience): import a wallet, RPC client or the SDK, or fetch data (loading its own assets is fine). Its only package imports are `three`, `gsap`, `@fontsource/*`, `@onepercent/copy` and `@onepercent/config` enums.
- `experience/index.ts` exports the components, `contracts.ts`, `RIP_ASSETS = {assetsBase, machineUrl}` and `jackpotLevel(input): number` (the meter mapping is visual, so it is the architect's).

### 6.2 Contracts (the shapes Codex fills)

`experience/contracts.ts` lands with wave 1. Until then Codex keeps the identical `bridge/contracts.pending.ts`, deleted in the commit that switches imports. Names may be refined by a wave; Codex then adapts its adapters, never the component. D30 (2026-10-09) refined Wave 2 and `CardRow`/`MyCardsProps` below: one Feed checkbox per bag, no Sell at market, no Keep.

```ts
import type { CopyKey } from '@onepercent/copy';
export type EditionId = 'original' | 'blue_shift' | 'signature' | 'after_hours';            // PACK_EDITIONS[].id
export type CardKind = 'dust'|'silver'|'blue'|'holo'|'black'|'jackpot'|'one_pct'|'spotlight'|'final'; // CARD_KINDS
export type Value = { kind: 'now'; lamports: bigint }   // executable quote: "≈{x} SOL if sold now"
  | { kind: 'est'; lamports: bigint }                   // capped estimate, lists and X-ray only: "≈{x} SOL est."
  | { kind: 'none' };                                   // "—"
export interface Msg { key: CopyKey; vars?: Record<string, string> }   // vars already formatted (§5.2)
export interface Coin { mint: string; ticker: string; name: string; logoUrl: string | null }
export interface Gate { open: boolean; reason: Msg | null }
export interface Flow { phase: 'idle'|'planning'|'quoting'|'ready'|'signing'|'sending'|'done'|'partial'|'expired'|'rejected'|'failed';
  confirmed: number; total: number; approvals: number; message: Msg | null }
// Wave 1
export interface HeroProps { phase: string; countdown: { label: Msg; toTs: number } | null; onAir: boolean;
  jackpot: { costLamports: bigint; tokens: bigint; liveEditions: EditionId[] }; reducedMotion: boolean; soundOn: boolean;
  onXray(input: string): void; onFeedCta(): void; onWatchLive(): void }
// XrayView keeps X1's props: { result: XrayResult; onShareX(): void; onCopyLink(): void }
// Wave 2
export interface FeedRow { coin: Coin; amountUi: string; drawdownPct: number | null; value: Value;
  feed: boolean; canFeed: Gate; needsConfirm: boolean; confirmed: boolean; note: Msg | null }   // feed: the checkbox, on by default
export interface FeedPanelProps { wallet: string; rentBack: { accounts: number; lamports: bigint };   // empties always close
  estimateLamports: bigint;                                   // one Dust Card when pulled (feedBackEstimate)
  rows: FeedRow[]; deposits: { totalLamports: bigint; lines: Msg[] }; emptiedRentBackLamports: bigint;
  machineToday: Msg | null; plan: { bags: number; transactions: number; approvals: number } | null;
  explainer: Msg; trust: Msg; flow: Flow; gate: Gate;
  onToggle(mint: string, feed: boolean): void; onConfirmBag(mint: string): void;
  onFeed(selection: { feed: string[] }): void; onFeedOneFirst(): void;
  onRefreshQuotes(): void; onRetry(): void }
export interface InTheMachineProps { entries: { entryId: string; coin: Coin; amountUi: string; depositLamports: bigint; refed: boolean }[];
  vaultDeposits: { coin: Coin; lamports: bigint; state: 'held'|'returned' }[]; flow: Flow; onTakeBack(entryIds: string[]): void }
// Wave 3
export interface EditionModel { id: EditionId; priceLamports: bigint; maxQty: number; maxPerRip: number;
  state: 'covered'|'refilling'|'hungry'|'busy'|'paused'|'beforeOnAir'|'seasonOver'; stateLine: Msg;
  jackpot: { tokens: bigint; value: Value; live: boolean; liveFromLamports: bigint }; onePct: { live: boolean; card: number | null; of: number } }
export interface RipPanelProps { editions: EditionModel[]; selected: EditionId; qty: number; turbo: boolean; preSign: Msg[];
  trust: Msg; flow: Flow; refundable: { seq: string; priceLamports: bigint } | null;
  onSelectEdition(id: EditionId): void; onQty(n: number): void; onTurbo(on: boolean): void;
  onRip(a: { edition: EditionId; qty: number }): void; onOdds(id: EditionId): void; onRefund(seq: string): void }
export interface OddsDialogProps { edition: EditionId; rows: { id: string; ppb: number; live: boolean; oneIn: string; note: Msg | null }[];
  figures: Msg[]; onVerify(): void }
export interface CardRow { cardId: string; kind: CardKind; edition: EditionId; seq: string; coin: Coin; amountUi: string;
  stockedLamports: bigint | null; value: Value; sellBack: Value | null;
  actions: { redeem: Gate; sellBack: Gate; feedBack: Gate } }   // at most two per card (D30)
export interface MyCardsProps { hits: CardRow[]; dust: CardRow[]; prizes: CardRow[]; inTheMachine: InTheMachineProps;
  pending: { seq: string; edition: EditionId; qty: number; state: 'drawing'|'refundable'|'settling' }[];
  owedLamports: bigint; closeMyCards: { lamports: bigint } | null; preSign: Msg[]; flow: Flow;
  onRedeem(ids: string[]): void; onSellBack(ids: string[]): void; onFeedBack(ids: string[]): void;
  onSettle(seq: string): void; onRefund(seq: string): void; onWithdrawOwed(): void; onCloseMyCards(): void; onVerify(seq: string): void }
export interface TvEvent { id: string; kind: 'pull'|'feed'|'burn'|'system'; tier?: CardKind; edition?: EditionId; who: string;
  ticker?: string; lamports?: bigint; sig: string; ts: number }
export interface TvProps { state: 'idle'|'countdown'|'xray'|'onAir'|'lastCall'|'finalPull'|'sealed'; onAir: boolean;
  countdownTo: number | null; events: TvEvent[]; reducedMotion: boolean }
export interface VerifyProps { seq: string; checks: { id: string; ok: boolean | null; label: Msg; detail: string }[];
  packs: { index: number; t: number; widths: number[]; tier: CardKind; dust: { index: number; deckLenBefore: number }[] }[];
  links: { request: string; callback: string | null; settles: string[] }; tableHash: string }
```

The Rip stage, `RipLine`, `LiveView`, `TokenView`, the Jackpot and The 1% moments (inside the Rip module), Block-0 and the Final Pull screen take the same building blocks; their props arrive with waves 3–4.

### 6.3 Bridge components (Codex)

- **`ExperienceSlot`** wraps every experience component: `React.lazy` chunk, a `Suspense` fallback (the architect's poster or skeleton if exported, else an empty sized box: no layout shift), an error boundary that renders the placeholder (§6.4) and reports `experience_error` (§7.6).
- **`RipMount`** wraps the vanilla module: mounts `mountRip(div, { ...RIP_ASSETS, autoSellBackAnimation: false, reducedMotion, turbo, revealMode })` in a layout effect, subscribes `cardAction`, `share`, `retry`, `beat`, `sound`, and calls `destroy()` on unmount (StrictMode double-mount safe). It exposes an imperative handle: `play`, `setResult`, `fail`, `skip`, `animateSellBack`, `setJackpotLevel`, `setTurbo`, `setRevealMode`, `setReducedMotion`, `reset`. `play()` rejections named `AbortError` or `RipFailedError` are expected and swallowed.
- **`autoSellBackAnimation` is always `false`.** The "Sold back" animation plays only after the `sell_back` signature is confirmed (§13.3).
- `minCrankingMs` and every timing option stay at the module's defaults. `revealMode` and `turbo` are viewer preferences (localStorage, wrapped in try/catch).
- **No WebGL2**, or `mountRip` throws: render `RevealFallback`, a semantic list of the same `RipResult` built from copy keys, and report it. The architect may replace it.

### 6.4 Placeholders until a wave lands

`bridge/placeholders/*` implement each pending component's props with semantic HTML and the existing tokens: functional, unanimated, no new visual language. Each file starts `// PLACEHOLDER until experience wave N`. The wiring PR for a wave deletes the matching placeholders. `/dev/experience` (dev builds only) renders every delivered component with the architect's mocks.

### 6.5 Adapters (pure, unit-tested on recorded chain fixtures)

Adapters turn decoded chain data, config and API data into props. They never fetch, never sign, never read the clock directly (they take `nowMs`). Golden tests: decoded fixture accounts and events → props, deep-equal to a committed expectation.

### 6.6 `RipResult` from the chain (`adapters/rip-result.ts`)

Input: one decoded `PackRevealed` (from the source of §12.4, cross-checked), plus one display batch. Output: the module's `RipResult`.

| Field | Source |
|---|---|
| `dust[k]` for each slot whose `house_mask` bit is clear, in slot order | `DustPick.mint`, `.amount`, `.depositor`; `symbol`, `logoUrl`, decimals and `valueSolUi` from `/api/values` (`mode: 'now'`) |
| House slots | Not passed: the module renders missing entries as House Cards (interface request filed: an explicit `house` flag, so a House Card keeps its slot) |
| `hit.tier` | `PackRevealed.tier`: 1 silver · 2 blue · 3 holo · 4 black · 5 jackpot · 6 one_pct. Any other value: `fail(t('errors.generic'))` and report (7 cannot occur in Season 1, D1) |
| `hit.symbol`, `amountUi` | `hit_mint`, `hit_amount`; `TOKEN_1PCT.symbol` for kinds 5–6 |
| `hit.valueSolUi` | `valueNow(hit_mint, hit_amount)` through `/api/values`; unavailable → `'—'` |
| `hit.sellBackSolUi` | Stock tiers only, when the Sell back gate of §13.2 is open apart from the quote request: `sol(floor(min(hit_value, quote) × SELL_BACK.payoutBps / 10_000))`; otherwise omitted |
| `packValueSolUi` | Never passed: a sum of separate quotes is not one executable quote |
| `RipInput.pullId` | The Pull address (deterministic replays) |

**Timing (no tells).** One `/api/values` batch per Pull covers every card of every pack (≤ 50 items). `setResult` for pack `i` is called when that batch settles or at `WEB.revealDataDeadlineMs` after the reveal was observed, whichever comes first; items still missing render as `'—'` and a monogram. The batch never depends on the tier. Interface request filed: `setQuotes()` so values can arrive after the result.

### 6.7 Events to transactions

| Experience event | Preconditions (chain, flags) | Flow (`tx/`) | Instructions | After confirmation |
|---|---|---|---|---|
| `onRip({edition, qty})` | §12.2 gates | `rip.ts` | `[CU] [ed25519 HOLD?] buy_packs` (+ a first settle transaction, §12.6) | Pull watch → reveal |
| Rip `cardAction(i, 'redeem')`, `onRedeem(ids)` | card in My cards | `redeem.ts` | `[CU] (create_idempotent ATA, redeem)×≤8`, indices descending | Re-read Binder |
| `cardAction(4, 'sell_back')`, `onSellBack(ids)` | §13.2 | `sell-back.ts` | `[CU] [ed25519 SB] sell_back` | `animateSellBack(4, payoutUi)` (Rip only) |
| `cardAction(i, 'sellMarket')`, `onSellAtMarket(ids)` | any kind; swap route available | `sell-at-market.ts` | `[CU] create_idempotent ATA, redeem, Jupiter setup/swap/cleanup, close ATA` (one v0; else 2 in one approval, §13.4) | Re-read Binder and balance |
| `cardAction(i, 'feed')`, `onFeedBack(ids)` | kinds 0–4, `FEED` on, phase StockUp–OnAir, `now < end_ts`; confirmation above `FEED_RULES.confirmAboveLamports` | `feed-back.ts` | SDK `buildFeedBackTransactions`: `[CU] feed_back` (≤ 8, indices descending) | Re-read Binder and Deck |
| `cardAction(i, 'keep')` | — | none | — | analytics only |
| Rip `share` (Holo and up) | — | X intent: `/verify/<seq>?ref=<wallet>` | — | — |
| Rip `retry` | after `fail()` with no pack bought | `rip.ts` | rebuild `buy_packs` | — |
| `onFeed(selection)`, `onFeedOneFirst()` | §11 | `feed/*` | merge, close, sell, feed (§11.4) | Reconcile, re-read |
| `onTakeBack(ids)` | entry in the Deck | `take-back.ts` | `[CU] (create_idempotent ATA, take_back)×≤8` | Reconcile |
| `onSettle(seq)`, `onRefund(seq)`, `onWithdrawOwed()`, `onCloseMyCards()` | chain state only | `settle.ts`, `refund.ts`, `withdraw-owed.ts`, `close-binder.ts` | SDK `buildSettleTransaction`, `buildRefundTransaction`, `buildWithdrawOwedTransaction`, `buildCloseBinderTransaction` | Re-read |
| `onVerify(seq)`, `onShare(kind)`, `onXray(input)`, `onWatchLive()` | — | navigation | — | — |

The Rip module has no per-action progress API: Codex shows progress in its own `Flow` toast region (copy keys) and files the interface request `setActionState(cardIndex, action, state)`.

### 6.8 Loading, slow and failed states

| Situation | Behaviour |
|---|---|
| Experience chunk loading | Suspense fallback with the same box size; the GLB loads inside the module (it builds a stand-in when the file is missing) |
| Chunk fails to load | Placeholder + `common.retry`, reported |
| `/api/config` unreachable | Every flag off (master §11.5); `OfflineBanner` with the rescue link; exits that need only `/api/rpc` still render |
| `/api/rpc` unreachable | Exits cannot be built in the web: show `common.rpcOffline` and the rescue link (M6.2) |
| Values slow | Deadline of §6.6; lists show `—` per row and keep working |
| SSE down | Polling fallback; "On air" off once stale (§7.4) |
| Wallet slow | No timeout on the wallet prompt; the blockhash expiry path handles it (§9) |

---

## 7. Shell

### 7.1 Routes (`routes/table.ts`; no router library)

| Path | Page | Chunk | Flag | PR |
|---|---|---|---|---|
| `/` | Home: hero (wave 1), X-ray field, phase CTA, TV, ticker, section links | entry | — (TV data `TV_LIVE`) | M3.1 |
| `/x`, `/x/:address` | X1's page | entry (no web3.js, no spl-token) | `XRAY` | M3.1 |
| `/feed` | Feed panel + In the machine | `feed` | `FEED` (take-back never) | M3.2 |
| `/rip` (alias `/packs`) | Crown, edition panel, Rip stage | `rip` + `experience-3d` | `PACKS` | M3.3 |
| `/cards` (alias `/me`) | My cards | `cards` | never | M3.3 |
| `/verify/:pull` | Verify (M3-A8) | `verify` | never | M3.3 |
| `/fairness` | Odds and disclosures | `fairness` | never | M3.3 |
| `/live`, `/token` | Machine stats, Highlights, TV / CA, The 1% cards, burns | `live`, `token` | `TV_LIVE`, `BOARDS` | M3.3 |
| `/link/:nonce` | X3's page | `link` | — | registered in M3.1 |
| `/status` | Reserved for M6.1: registered, not linked, renders `NotFound` until M6.1 ships it | — | never | — |
| `/dev/experience` | Previews | dev only | — | M3.1 |
| anything else | `NotFound` | entry | — | M3.1 |

- `router.ts`: `history.pushState`, `popstate`, link interception for same-origin `<a>`, `matchRoute(pathname) → {route, params}`, alias redirects with `replaceState` (query and hash kept). Path params are decoded once and validated (base58, decimal `seq`, nonce regex) before any fetch.
- On navigation: `document.title` from copy, focus moves to the page `h1` (`tabIndex=-1`), scroll to top unless a hash targets an element.
- `/dev/experience` is behind `import.meta.env.DEV` with a dynamic import; the production build contains neither the route nor its chunk (test, §16).

### 7.2 Boot, config and flags

1. `main.tsx` renders the shell immediately (LCP is not blocked by data).
2. `data/config.ts` fetches `/api/config` and `/api/web/config` (zod), refreshes every `WEB.configRefreshMs`. `data/server-time.ts` keeps the chain clock: `getBlockTime(getSlot())` through `/api/rpc` on load and each refresh, as an offset to `Date.now()`, for countdowns and the 300 s refund clock (on-chain deadlines never use the device clock).
3. `useFlag(name)`: from config; unreachable API → every flag off.
4. Phase-driven UI reads `config.phase`, then the Machine account for anything that gates a transaction.

### 7.3 Data layer (`data/*`)

- `api.ts`: `fetch` with `AbortController`, a timeout, zod-parsing against `@onepercent/sdk/api` (M2 routes) or `@onepercent/web-api` (§5.1 B); an invalid body is an error. Errors carry the API code → `COPY.md` key.
- `resource.ts`: a small cache keyed by URL, stale-while-revalidate, in-flight dedupe, visibility-aware polling (`WEB.machinePollMs` / `machinePollHiddenMs`).
- `rpc.ts`: a web3.js `Connection` on `${origin}/api/rpc`, commitment `confirmed`, no websocket use, `disableRetryOnRateLimit`.
- `binder.ts`, `deck.ts`, `machine.ts`: chain reads decoded with the SDK layouts. Deck entries come from `/api/me` indices, each verified with `getAccountInfo(deck, {dataSlice: {offset: deckHeader + deckEntry·i, length: deckEntry}})` (`ACCOUNT_SIZES`); a mismatch drops the row and refetches. When `/api/me` fails (indexer down) but `/api/rpc` answers, "Find my cards" scans the Deck in `dataSlice` reads of `SERVICES.api.rpcMaxDataSliceBytes` (M2 §4.3).
- `referral.ts` (extends X1's): any route with a valid `?ref=` (X3 §3.4 format) stores it in `sessionStorage` (first wins). Only base58 codes are passed to `buy_packs` in Season 1; aliases stay stored and unused until an alias resolver exists (M5.2).

### 7.4 Live data (1% TV, ticker, machine stats)

- `stream.ts` opens M2's `/api/stream`. After `WEB.sseFailuresBeforePoll` consecutive failures it polls `/api/events?after=<id>` every `WEB.eventsPollMs`, and retries SSE with backoff. Events are deduped by their id (`slot-txIndex-eventIndex`). Nothing is published before its transaction is confirmed (M2 §11.3).
- `adapters/tv-events.ts` maps stream events → `TvEvent`: confirmed events only, never synthesized or looped (DA §9.4), tickers sanitized to `[A-Z0-9]` ≤ `UI.tickerMaxChars`, addresses 3+2.
- `onAir` is `true` only while an event or `ping` arrived within `WEB.liveStaleAfterMs` (master §7.4).
- The web ticker mirror: `role="log"`, `aria-live="polite"`, announces Holo and up only, visible pause control (DA §9.5).

### 7.5 Events poll route (M3.3, `services/api/src/web/events.ts`)

`GET /api/events?after=<id>` reads the indexer's Redis Stream `onepct:events` with `XRANGE` (exclusive of `after`), at most `SERVICES.api.sseReplayEvents` entries, and returns them in the stream's own event schema. It adds no event, filters nothing and caches nothing. Rate-limited per IP like `/api/stream`.

### 7.6 Analytics (privacy-safe)

- First party only: `navigator.sendBeacon('/api/beacon', json)`; disabled when `navigator.globalPrivacyControl === true` or `doNotTrack === '1'`. No cookies, no identifiers, no wallet address, mint, signature, amount or free text. Counts are bucketed (1, 2–5, 6–10, 11+).
- Events (enum in `web-api/beacon.ts`): `page_view {route}`, `xray_submit {cached}`, `xray_share {channel}`, `wallet_connect {wallet: phantom|solflare|backpack|other, mobile, inApp}`, `feed_plan {bags, txs, approvals}`, `feed_result {status}`, `take_back_result {status}`, `rip_start {edition, qty}`, `rip_result {status, edition}`, `card_action {action, kind}`, `tx_error {flow, code}`, `experience_error {component}`, `web_vitals {route, lcpMs, cls, inpMs}`.
- The server validates, rate-limits per IP in memory (`WEB.beaconPerMinutePerIp`), stores hourly counters in Redis, and never stores or logs the IP.

---

## 8. Wallet (`wallet/*`)

### 8.1 Discovery and connection

- `getWallets()` (`@wallet-standard/app`). Keep wallets with a `solana:` chain, `standard:connect`, `standard:events` and either `solana:signAndSendTransaction` or `solana:signTransaction`. Phantom, Solflare and Backpack register this way on desktop and inside their in-app browsers.
- **Connect**: the user picks a wallet (the picker visuals are the architect's; Codex ships a placeholder list); `standard:connect()`; take the first account whose `chains` include `solana:<cluster>` (`solana:mainnet` or `solana:devnet` from config); none → `wallet.noAccount`.
- **Reconnect strategy:**
  1. The last wallet name is stored in localStorage (`onepercent.wallet`, try/catch).
  2. On boot, wait for registrations up to `WEB.walletDetectMs`, then `standard:connect({ silent: true })`. Accounts returned → connected; none → stay disconnected and show Connect. Never prompt on load.
  3. `standard:events` `change`: a new account → reset every in-flight plan, re-read Binder, Deck and balances, show `wallet.switched`; no accounts → disconnected.
  4. Back from a hidden tab: re-check `wallet.accounts`.
  5. Disconnect: forget the stored name; signed transactions already in flight are still tracked to the end.

### 8.2 Mobile and Telegram (`environment.ts`, `deeplinks.ts`)

- No wallet after `WEB.walletDetectMs` on a mobile user agent, or inside Telegram's in-app browser (`window.TelegramWebviewProxy` present, or `Telegram` in the user agent): show `wallet.inAppHint` (or `wallet.telegramHint`) with two buttons for the **current URL, `ref` kept**:
  - Phantom: `https://phantom.com/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(origin)}`
  - Solflare: `https://solflare.com/ul/v1/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(origin)}`

  Same strings as X3 §3.5; golden tests pin both. Backpack mobile links come with M5.2. Mobile Wallet Adapter is out of scope.
- Never auto-redirect to a wallet app; the user taps.

### 8.3 Signing capabilities (`capabilities.ts`)

| Wallet feature | Batch path | Approvals for t transactions |
|---|---|---|
| `solana:signAndSendTransaction` accepting several inputs in one call, **and** S5 recorded one prompt for a batch in that wallet | one call per batch of ≤ `TX_LIMITS.txPerSignAll`; `options.mode: 'serial'` where the typings expose it | `ceil(t / txPerSignAll)` |
| `solana:signAndSendTransaction`, one prompt per input | one call per transaction | `t` |
| `solana:signTransaction` only | sign the batch in one call, then submit each through `POST /api/send` | `ceil(t / txPerSignAll)` |

- The per-wallet table cites the founder's S5 results; a wallet without S5 evidence takes the conservative row. **The approval count on every button equals what the wallet will show** (PARAMS §19: never "1 approval" for more than 8 transactions).
- `chain` is always `solana:<cluster>`. A send error naming an unknown blockhash while our simulation passed maps to `wallet.wrongNetwork`.

---

## 9. Transaction engine (`tx/engine/*`)

**Plan → build → check → simulate → blockhash → prompt → track → reconcile.**

1. **Plan.** A flow returns ordered items `{id, phase, build(blockhash), landed(chainState)}`. Items of a later phase depend on an earlier phase having landed (Feed merges, §11.4).
2. **Build.** Compute budget first: `SetComputeUnitLimit` from `CU_LIMITS` in config (M1 §16.3 shape), `SetComputeUnitPrice(min(p50 of getRecentPrioritizationFees([machinePda]), WEB.priorityFeeCapMicroLamports))`. Legacy, or v0 with the protocol lookup table when `/api/web/config.lookupTable` is set **and** the chain shows it frozen (authority `None`) and holding the expected addresses; otherwise legacy.
3. **Check.** `serializedSize` with dummy signatures ≤ 1,232 B; Feed ≤ 1,047 B (`TX_LIMITS.byteHeadroomBps`). Feed transactions: one signer; programs ⊆ {onepercent, SPL Token, Token-2022, ATA, System, Compute Budget, Ed25519}; exactly one `feed`. Swap transactions: every program id ∈ {Compute Budget, System, SPL Token, Token-2022, ATA, onepercent (redeem only), `WEB.jupiterProgramIds`}; the wallet is the only signer. A failed check never reaches the wallet.
4. **Simulate** each transaction (`sigVerify: false`, `replaceRecentBlockhash: true`, `confirmed`). Any error → mapped copy, **no prompt**.
5. **Blockhash.** `getLatestBlockhash('confirmed')` right before the prompt; set it on every transaction of the batch; keep `lastValidBlockHeight`.
6. **Prompt** through §8.3. A wallet rejection (error code 4001 or a user-rejected error) → `errors.walletNo`, nothing sent.
7. **Track.** Poll `getSignatureStatuses` every `WEB.confirmPollMs` until `confirmed`, an error, or the current block height (`getBlockHeight`, §5.1 C) `> lastValidBlockHeight` (expired). Progress `{confirmed, total}` drives `Flow`.
8. **Reconcile** every item that is not confirmed, from chain state (table below). Outcome: `done`; `partial` (retry rebuilds only the items not landed: new attestations, new quotes, new blockhash); `expired` (`errors.tooLong`; the next tap rebuilds); `failed` (mapped copy).

| Flow item | Landed iff (read at `confirmed`) |
|---|---|
| Merge (one mint) | Extra accounts closed and the primary account holds the whole balance |
| Close empties | Every account in the item is gone |
| Feed (per bag) | The source account is closed or at 0 **and** a Deck entry (wallet, mint, amount) exists (index from `/api/me`, verified by `dataSlice`) |
| Sell (wallet bag) | Signature confirmed (balance at 0 confirms) |
| Take-back | Entry gone and the wallet ATA grew by `amount`; entry gone without that → `takeBack.pulled` |
| `buy_packs` | The Pull PDA (buyer, nonce) exists or a later state of it |
| Redeem, Feed back, Sell back | Card gone from the Binder (and, for Redeem, ATA grew) |
| Settle | `settled_mask` bit set or the Pull closed |
| Refund | Pull closed with `PullRefunded` in its signatures |

**Errors** (`engine/errors.ts`): the SDK's program-error map (M1 §15.5) → copy key; VRF failures by failing program id → `busy`; blockhash expiry → `tooLong`; insufficient lamports in simulation → `errors.insufficientSol` with the shortfall; RPC failure → `common.networkError`; anything else → `errors.generic`.

---

## 10. X-ray (M3.1; X1 is the X-ray part, not re-specified)

Once X1 merges, M3.1 rebases and delivers only what master §11.4 M3.1 adds or corrects:

1. **Routes.** X1's `matchXrayPath` registers in the router; `main.tsx`'s X1 and X3 switches are replaced by the router.
2. **Copy.** Every X1 `PROVISIONAL` string (`xray/strings.ts`, `eligibility/src/copy.ts`, API messages, card text) moves to `COPY.md` §2 keys. Reason codes map 1:1 to `xray.reason.*`.
3. **Labels** (master §7.2): estimates read "≈{x} SOL est."; "if sold now" never appears in X-ray; no readable cap or a price older than `XRAY.priceMaxAgeSlots` → no value.
4. **Counts:** "{n} feedable" counts bags held at `S`; unknown or unchecked bags count in `counts.checkAtFeed`, shown when > 0, each with "Final check when you Feed". The card omits the Worst line when `worst` is null (never "Worst: —").
5. **Referral codes in every share link:** `ref=<scanned address>` by default, an incoming valid `?ref=` kept instead; `/x/:address` stores an incoming `ref` (§7.3). Golden tests pin the share strings.
6. **Real Turnstile.** `CloudflareTurnstileVerifier` posts to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `TURNSTILE_SECRET` (D13), the token and `remoteip`, a 3 s timeout, injected `fetch`; any failure or timeout → `false` (fail closed: 403 `turnstile_required`). The web loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` only after a 403, renders the widget (`VITE_TURNSTILE_SITE_KEY`, public), resends the request with header `cf-turnstile-response`, once. `NoopTurnstileVerifier` stays for fixtures mode and tests only: with `XRAY_SOURCE=live` the API refuses to boot without `TURNSTILE_SECRET_KEY` (Cloudflare's published test secret is fine on Railway `dev`).
7. **After a scan:** own wallet connected and `FEED` on → "Feed my bags" (`/feed`); not connected → "Connect to feed these bags"; `FEED` off → "Feed opens at Stock-Up" with the date when `stock_up_ts` is set; someone else's address → "X-ray your wallet".
8. **Wave 1:** the architect's `XrayView` replaces X1's with the same props; Codex changes nothing in it.

---

## 11. Feed and take-back (M3.2)

### 11.1 Inputs

| Data | Source |
|---|---|
| Token accounts and balances (both programs) | `getTokenAccountsByOwner` through `/api/rpc`, decoded with `unpackAccount(address, info, owner)` |
| Classification and snapshot status | `GET /api/xray/:wallet` (cached is fine: hard checks and `S` do not change). A mint missing from it is classified in the browser with `@onepercent/eligibility` hard checks on chain reads, snapshot status `unknown` |
| Quotes | `/api/values` `mode: 'now'` (SPEC §2.1: firm quotes belong to this panel) |
| First-of-coin | `getMultipleAccounts(ledgerPda(mint))`: missing → this card also pays the vault ATA and the MintLedger |
| Binder | exists?, `fresh_in_deck`, FEED nonce window |
| Deposits | `getMinimumBalanceForRentExemption` for the exact sizes of `ACCOUNT_SIZES` (never a typed rate) |
| Machine today | `/api/machine.today` (PARAMS §18 formula) |
| Phase and pause | Machine account (`phase`, `end_ts`), Config pause bits |

### 11.2 Defaults and guards (SPEC §2.2, PARAMS §6.2)

- **Sell is the default** when the bag's `now` quote > `FEED_RULES.sellDefaultAboveLamports`; otherwise Feed when eligible (held at `S`, or unknown → "Final check when you Feed"); otherwise Sell when it has a bid; otherwise left alone.
- Feeding a bag quoted > `FEED_RULES.confirmAboveLamports` needs `onConfirmBag` (`feed.confirm.*`).
- Fresh cap: at most `FEED_RULES.freshCapPerWallet − binder.fresh_in_deck` fresh bags; the rest are disabled with `feed.capReached`.
- Feed gate: `FEED` flag on, phase ∈ {StockUp, PoweredOn, OnAir}, `end_ts == 0 ∨ now < end_ts`, FEED not paused. Otherwise the panel shows the matching `feed.phase.*` line; **"In the machine" and take-back stay available**.
- Not feedable this season and not-in-set bags with a bid offer Sell; the rest are listed as left alone.

### 11.3 Panel numbers

| Line | Computation |
|---|---|
| Rent back | Σ actual lamports of the selected empty accounts (X1 rule: never computed rent) |
| Feed group | count of bags chosen for Feed |
| Deposits | Deck entry growth per card; + vault ATA (165 or 170 B) and MintLedger (80 B) per first-of-coin card; + Binder header (112 B) on a wallet's first Feed. Shown as `solCost` |
| Rent back from emptied bags | Σ lamports of the source accounts Feed closes |
| Sell group | Σ `now` quotes of bags chosen for Sell |
| Net now | Sell quotes + rent back + emptied rent − deposits, signed (`feed.net`) |
| Button | `feed.button.feed`: bags, transactions and approvals from the plan (§8.3) |

### 11.4 Plan (`tx/feed/plan.ts`)

1. **Phase 1, merges** (whole-bag rule, master §11.4 M2.2): a mint whose balance sits in more than one token account of the wallet gets SDK `buildMergeTransactions(wallet, mint, sources, canonicalAta)` (M2 S2): every other account into the canonical ATA, then closed. Phase 1 must land before attesting phase 2: the button counts these approvals too.
2. **Attest:** one `POST /api/feed/attest` per approval batch (M2 §11.4): `chunks` of mints planned by byte size, without amounts; the signer returns per chunk the nonce, expiry, message, signature and each bag's whole `amount`, `source` and `mergeFrom`. Build each feed transaction from exactly those values, in that order. A refused bag shows `feed.refusal.<reason>` with its `date`; a bag whose `mergeFrom` is not empty goes back to phase 1. Attestations expire after `ATTESTATIONS.feedTtlSeconds` minus the SDK's margin: build, simulate and prompt immediately.
3. **Phase 2:** feed transactions from SDK `planFeedTransactions({wallet, bags, lut, attest})` (one `feed` each, greedy by size), Sell transactions (§11.6), close-empties transactions (`close_account` × as many as fit 1,047 B). Order inside a batch: feeds, sells, closes.
4. "Feed 1 bag first" builds a one-bag plan from the first Feed row.

### 11.5 States and reconciliation

Copy per `COPY.md` §3: quoting, ready, quote expired, signing ("Check your wallet. {t}, {a}."), sending ("Feeding the machine… {c}/{t} confirmed"), done, partial ("{ok} of {t} went through. … Retry?"), expired, rejected, nothing to do. Retry rebuilds only the bags not landed (§9 step 8). The pre-sign explainer (`feed.explainer`, with the program id) and the trust line always show.

### 11.6 Retired market-sale flow

D30 and cleanup #47 remove this action and its market-sale parameters. A refused Sell stays closed with its reason; Redeem remains available.

### 11.7 Take-back and "In the machine"

- Rows: the wallet's Deck entries (§7.3), with the deposit each returns; REFED entries marked. `onTakeBack(ids)` → batches of ≤ `TX_LIMITS.takeBackPerTx`, `create_idempotent` ATA per mint (the pre-sign line shows new token accounts and their rent), each instruction carrying its Deck index and expected (mint, amount).
- `CardMoved`: re-read the Deck, rebuild once silently; a second failure shows `errors.cardMoved`. An entry gone because it was pulled shows `takeBack.pulled` with the royalty from the matching `pack_revealed` event (or the no-amount variant).
- Vault deposits: MintLedgers whose `payer` is the wallet, `held` while the ledger exists, `returned` after `VaultClosed`.
- Take-back is never behind a flag and works after the season.

### 11.8 Royalties

`parseRoyaltyMemo` reads `1pct:roy:<seq>` from settle transfers. The daily digest ("pulled {n} times in 24 h ✳ +{x} SOL") sums `/api/me.royalties24h`; each history row links to `/verify/<seq>`. A `RoyaltyRedirected` event for this wallet shows `royalty.redirected`.

---

## 12. Rip (M3.3)

### 12.1 Edition models (`adapters/edition.ts`)

From the Machine account and the Deck header (`dataSlice` of `ACCOUNT_SIZES.deckHeader` bytes), read on load, every `WEB.machinePollMs` and again at tap time: `maxQty(E)` by the SDK (coverage greedy loop, `COVERAGE.dustBuffer`, `maxPerRip`), the Jackpot (`jackpot_tokens`, `jackpot_cost`, live iff `jackpot_cost ≥ JACKPOT.minPotPriceMultiple × price`; value `now` for `jackpot_tokens` of $1PCT), The 1% slots (live card and index of 4). Quantities offered: 1, 5, 10, each ≤ `maxQty`; a deep-link `n` is clamped.

### 12.2 States and gates

| State | Rule | Rip button |
|---|---|---|
| beforeOnAir / seasonOver | `phase ≠ OnAir`, or `now ≥ end_ts` | off; countdown or season-over line |
| paused | RIP pause bit | off |
| busy | `/api/machine.vrf.occupancyBps > VRF.busyOccupancyBps` or `oldestItemAgeS > VRF.busyOldestItemSeconds` | off |
| hungry | `deck.len − reserved_dust < 4·qty + dustBuffer` | off for that qty |
| refilling | `maxQty(E) = 0` | off |
| covered | otherwise | on, "Rip up to N now" |

`PACKS` off → the whole panel is hidden behind the phase line. The odds dialog never lists a tier the machine cannot pay (master §10): it shows only for an edition on sale, and specials that are not live read "not live now" (§14.2).

### 12.3 Build (`tx/rip.ts`)

- `edition` index, `qty`, `pull_nonce = binder.pull_nonce` (0 without a Binder), `min_live_flags` = the live flags shown on the panel at tap (from the chain read of that tap), `referrer` = the session code only when it is base58, ≠ buyer, and the Binder is missing or has `referrer == 0` and `season_spend == 0`; `hold` only when `HOLDER_BOOST` is on and `/api/hold/attest` returns ok (404 until M4.2, or any failure: Rip without it, no error). Queue: `config.vrf_queues[active_queue]`.
- Pre-sign lines (copy issue 2): price × qty; draw fee `VRF.feeLamports`; Pull deposit `rent(pullHeader + pullPerPack·qty)` (`ACCOUNT_SIZES`), back at settle; card slots = the Binder's rent growth for `5·qty` more slots (the SDK's `grow_for` rule), back when the cards leave; Binder header on a first Rip; the referral line; the holder line; the keep-balance warning when the balance after signing < `UI.keepBalanceWarningLamports`. All from `getMinimumBalanceForRentExemption` at tap time, shown with `solCost`.

### 12.4 Watch, reveal, timeout (`tx/watch-pull.ts`)

1. The wallet returns the signature → `RipMount.play({ edition, pullId })` for pack 0 (Cranking starts at signing, DA §8.1).
2. Watch the Pull PDA (buyer, nonce): stream `pullOpened`, `reveal` and `refund` events for its `seq` are hints; polling of the Pull account (`WEB.pullPollFastMs` for `pullPollFastForMs`, then `pullPollSlowMs`) is the safety net. Every hint triggers a `getAccountInfo` at `confirmed`, decoded by the SDK. The first read gives `seq`.
3. `buy_packs` not landed (expired or failed) → `fail(copy)`; nothing was escrowed.
4. **Revealed**, or closed after existing (the keeper settled first). The outcome comes from, in order:
   1. the callback transaction, found with `getSignaturesForAddress(pull)` and decoded locally with `@onepercent/sdk/events` (our program's frames only; §5.1 C);
   2. if that read fails, `/api/verify/:seq`'s `packs` (the indexer's decode of the confirmed callback transaction, M2 §11.3).

   Cross-checks before anything reaches the stage: `seq` equals the Pull's; packs `0..qty−1` each once; while the account is still open, each pack's `tier`, `carved_bucket`, `house_mask` and the four royalty depositors equal its `PackRecord`; `verifyPull` (`@onepercent/sdk/verify`) recomputes `t`, the widths and the tier from `PullRevealed.randomness`. Any mismatch → `fail(errors.generic)`, report, no `setResult`.
5. Closed with a `refund` event or `PullRefunded` → refunded state.
6. At `created_ts + VRF.timeoutSeconds` on the chain clock (§7.2) still Pending → `fail(t('rip.timeout'))` and the refund action (`refund_pull`, permissionless; `TooEarlyToRefund` → wait).
7. Packs play in on-chain order. After pack `i`'s end state, the next `play()` starts on "Next pack" (Turbo: automatically). After the last pack, `RipLine` shows every pack (wave 3).

`setResult` is called only after step 4, from step 4's cross-checked data and the §6.6 batch. **Nothing else may call it.**

### 12.5 Errors specific to Rip

`LiveFlagsChanged` → `machineChanged`; `Refilling` → `refilling`; `MachineHungry` → `hungry`; VRF program failure → `busy`; `BinderFull` → `myCardsFull`; `SeasonOver`, `WrongPhase` → `seasonOver` (M1 §15.5; strings in copy issue 2).

### 12.6 Settle

The keeper settles (M2.2). The client adds a settle transaction (SDK `buildSettleTransaction`: ≤ `TX_LIMITS.settlePacksPerTx` packs, memo `1pct:roy:<seq>`, payee writability per M1 A14) at the front of the user's next batch for each revealed, unsettled pack older than `WEB.settlePrependAfterSeconds` in `/api/me.pulls.settleable` (as buyer or depositor), re-checked on the Pull account. My cards' pending list offers "Settle" for any such Pull. Settle never blocks the user's own action.

---

## 13. My cards (M3.3)

### 13.1 Data

- The Binder account (`getAccountInfo(binderPda)`, SDK decode) is the truth for cards; tabs: Hits (kinds 1–4), Dust (0), Jackpot & The 1% (5–6); Final cards (8) appear from M4.
- Values: `/api/values` `mode: 'est'` for rows ("≈ … SOL est."), `mode: 'now'` when an action panel opens. Stocked value = `card.value`.
- Pending: Pull PDAs for nonces `0..binder.pull_nonce` read in one `getMultipleAccounts`: Pending → drawing or refundable (300 s), Revealed → settling.
- `cardId` = `seq_lo:kind:mint:amount:ordinal`; at action time the Binder is re-read and ids resolve to current indices.

### 13.2 Actions per card (PARAMS §3.3)

| Action | Open when |
|---|---|
| Redeem | always (every kind, every phase) |
| Sell back | kinds 1–4, `SELL_BACK` on, phase OnAir, `now < end_ts`, SELLBACK not paused, and the quote route answers `ok` |
| Sell at market | every kind; falls back to Redeem when the swap route is unavailable |
| Feed back | kinds 0–4, the gate of §6.7 |
| Keep | always |
| Withdraw owed | `sol_owed > 0` |
| Close My cards "+{x} SOL" | `len == 0`, `reserved == 0`, `fresh_in_deck == 0`, `sol_owed == 0`, and `season_spend == 0` or both Final claim bits set (M2 B8), read from the Binder (`/api/me.binder.closable` only as a hint); simulated on tap. `{x}` = the Binder's lamports |

### 13.3 Sell back

One mint per batch, ≤ `TX_LIMITS.redeemPerTx` cards. `POST /api/sellback/quote` with `{owner, cardIndices}` (M2 §11.5); the signer reads the cards from chain and returns them sorted descending with the message and signature; SDK `buildSellBackTransaction` builds `[ed25519 SB] sell_back` from exactly that. Show the payout on its own ("Sell · +X SOL · instant", never a market price next to it, D30) and the TTL (`SELL_BACK.quoteTtlSeconds` by class). A refusal containing only `ok: false` and `reason`, or a landing error mapped to `sellBackFallback` (M2 §8), closes Sell with its COPY §6.3 line; Redeem stays. Expired quote → `quoteExpired`. One quote in flight per Binder (its `sb_nonce`). In the Rip end state, `animateSellBack(4, payoutUi)` runs only after the signature is confirmed.

### 13.4 Redeem and Sell at market

- Redeem batches: ≤ 8 per transaction, indices strictly descending **across the whole batch** (the first transaction holds the highest), sent serially; `CardMoved` re-reads and rebuilds the rest. The pre-sign line counts the mints without an owner ATA and their rent (`getMinimumBalanceForRentExemption(165 or 170)`).
- Sell at market for a card: one v0 transaction `[CU] create_idempotent ATA, redeem, Jupiter setup/swap/cleanup, close_account(ATA)` with `WEB.sellMaxAccounts`. If it exceeds 1,232 B: two transactions in one approval, serial (redeem, then swap and close). Redeem landed and swap not → `sell.redeemedOnly` (the tokens are in the wallet).

---

## 14. Verify, fairness, live, token (M3.3)

### 14.1 Verify (`/verify/:pull`)

1. Resolve: a `seq` through `/api/verify/:seq`; an address through `getSignaturesForAddress` (§5.1 C), which needs no indexer.
2. Fetch the request, callback and settle transactions through `/api/rpc` (§5.1 C) and decode `PullOpened`, `PackRevealed`, `PullRevealed`, `PackSettled` locally; if they cannot be read, use `/api/verify/:seq`'s data and say so on the page.
3. Recompute in the browser with `verifyPull` (`@onepercent/sdk/verify`) and the SDK math (M1 §11): `caller_seed = sha256("1pct:vrf:v1" ‖ program_id ‖ seq_le ‖ buyer)` equals the seed in the VRF request instruction; per pack `t`, the segment widths (from `PACK_EDITIONS`, `HIT_ODDS`, the Pull's `live_flags` and `holder`) equal `PackRevealed.widths`, and the tier follows; each dust index from `deck_len_before`. The bucket pick needs the stock at that slot: shown as recorded.
4. Table hash: `sha256` of the canonical JSON of the edition's odds table built from `@onepercent/config`, next to `/api/config.paramsHash`.
5. Show the reveal slot and order (from the API when present), and links to every transaction.

Acceptance: equal to the chain for 100 pulls (§17).

### 14.2 Fairness (`/fairness`)

- Per edition, the PARAMS §4.3 table from config: The 1% (and the holder width when `HOLDER_BOOST` is on), Jackpot, Black, Holo, Blue, Silver (the remainder for the current live state, PARAMS §4.4). Live markers from chain; a special that is not live reads "not live now: its width goes to Silver". No Spotlight row (D1).
- Figures from PARAMS §19, computed from config. Disclosures (copy issue 2): the VRF paragraph of M1 §10.7, the unrefunded draw fee, the Sell back line, the Jackpot line, the creator-fee rule.
- Realized figures: a placeholder until an API serves them.

### 14.3 Live and token

- `/live`: machine tiles from `/api/machine` and chain reads; Highlights from `/api/highlights` (other boards behind `BOARDS`, none built in M3); the TV renderer (wave 3) with §7.4 events.
- `/token`: the CA from `Config.token_mint` (before it is set, the copy says when it appears); The 1% slots from `Machine.onepct[4]` with release times `on_air_ts + TOKEN_1PCT.onePctReleaseOffsetsSeconds`; `burned_total`; the Jackpot pot. No "buy $1PCT" funnel (master §10).
- **Trust lines** (`adapters/trust.ts`): pass a trust line only when the chain makes it true. Read the program's ProgramData `upgrade_authority`: equal to the Squads vault derived from `/api/web/config.adminMultisig` (vault index 0) **and** the multisig account shows threshold 2 and `time_lock` = `GOVERNANCE.timelockSeconds` → the timelock line; `None` → Sealed; anything else → no line. Hand-decode the few multisig fields; fixture tests per state.

---

## 15. Performance, accessibility, security, deploy

### 15.1 Budgets (`budget.json`, checked by `pnpm --filter web budget` on the Vite manifest, gzip)

| Item | Budget |
|---|---|
| Entry JS (shell, home, `/x`) | ≤ 120 KB; no `@solana/web3.js`, `spl-token`, `@anchor-lang/core`, `three` or `gsap` in it |
| Each route chunk without the experience | ≤ 250 KB |
| `experience-3d` chunk (three, gsap, Rip, hero) | loaded only on `/rip`, and on `/` after `requestIdleCallback` following LCP, with WebGL2, without `saveData` |
| CSS | ≤ 30 KB |
| LCP on `/` and `/x/<fixture>` | ≤ 2.5 s, CLS ≤ 0.05, TBT ≤ 300 ms (`pnpm --filter web lcp`: Playwright with CDP CPU ×4 and a 1.6 Mbps / 150 ms network; fixtures mode) |
| GLB | fetched by the module after mount; never on `/x` or `/feed` |

### 15.2 Accessibility

- axe (`@axe-core/playwright`): zero serious or critical violations on every route, in both color schemes the site supports.
- Keyboard: every action reachable and operable; focus integrated in controls, no detached outline (AGENTS.md); focus moves to the page heading on navigation and to the first error on a failed flow.
- Reduced motion: `prefers-reduced-motion` plus an in-app toggle → `setReducedMotion` and the matching props; nothing is lost (DA §15).
- Contrast: DA §4.2 pairs only; gold never on cream. Text ≥ 15 px desktop, ≥ 14 px mobile.
- Live regions polite; only Holo and up announced (the Rip module announces its own result; Codex does not repeat it). Moving content has a pause control.

### 15.3 Security

- **CSP** (Caddy, on every response including proxied `/x/*`): `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; font-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. Plus `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. If an experience component needs more, it is an interface request, never a silent widening.
- No inline script in `dist`; no secret, provider URL or key (`grep` gate, §18). `VITE_` variables are public: `VITE_API_URL`, `VITE_TURNSTILE_SITE_KEY`, `VITE_CLUSTER` only.
- Route params and API data are rendered as text (React escaping); token symbols and names go through `cleanText` (X1).
- Logo proxy: host allow-list, https only, magic-byte check, size and time limits, no redirects off the allow-list.

### 15.4 Deploy (master §3.2, §5.2)

- `apps/web/Dockerfile`, built with the **repo root as context** and `apps/web/Dockerfile.dockerignore` whitelisting `app/**` (without `node_modules`, `target`, `dist`) and exactly the landing assets the experience and pages use. Stage 1 (`node:22-alpine`): `pnpm install --frozen-lockfile`, `pnpm build:libs`, `node apps/web/scripts/sync-landing-assets.mjs` (copies the allow-listed `public/assets/*` files from the repo root into `apps/web/public/landing/`, gitignored, failing on a missing file), `pnpm --filter web build`. Stage 2: `caddy:2.11.4-alpine` (the landing's pin) with `apps/web/Caddyfile`.
- Caddyfile: `admin off`; SPA fallback `try_files {path} /index.html`; `reverse_proxy` of `/api/*`, `/x/*` and `/actions.json` to `{$API_UPSTREAM}`; `flush_interval -1` and no compression for `/api/stream`; `/assets/*` `public, max-age=31536000, immutable`; HTML `no-cache`; `.glb` as `model/gltf-binary`; the §15.3 headers.
- Railway `dev`: services `web` and `api` (Watch Paths to their packages and the shared ones). Before SW-1, on `dev`: a landing asset loads, `/x/<address>` returns OG tags through Caddy, `curl -N /api/stream` shows a `ping` within `SERVICES.api.ssePingSeconds` through Caddy (no buffering); the Turnstile widget renders under the CSP. No landing file changes, no root `.dockerignore` change.

---

## 16. Tests

### 16.1 Static and unit (Vitest, every PR)

- **Lint rule** (one block appended to `app/eslint.config.js`, files `apps/web/src/**/*.tsx` excluding `experience/**`, `xray/XrayView.tsx` and `**/*.test.tsx`; placeholders are linted too): `no-restricted-syntax` on non-blank `JSXText` and on string literals in `aria-label`, `title`, `alt` and `placeholder` attributes.
- `packages/copy`: parity with `COPY.md`; every placeholder used has a formatter; plural pairs complete; `lint:words` clean.
- `packages/web-api`: every fixture parses; `services/api/src/web` responses parse with it; `/api/send` refuses an unsigned or oversized transaction.
- Router (matching, aliases with query and hash, param validation, 404); flags (API down → all off); referral (first wins, invalid ignored, base58 only at Rip).
- Wallet: capability table, silent reconnect, account change resets plans, universal-link golden strings, Telegram detection.
- Tx engine (`tests/chain/*.test.ts`, node env, npm `litesvm` 0.8.0 on the v3 `.so`, run in the CI `program` job): feed plan sizes and approvals for 1, 2, 8, 9 and 16 bags; merge phase ordering; reconciliation of every row of §9; simulation failure → no prompt; expiry → rebuild; redeem ordering across transactions; take-back `CardMoved` retry.
- Adapters (golden): `RipResult` from recorded `PackRevealed` for every tier and House slots; `FeedPanelProps`, `InTheMachineProps`, `MyCardsProps`, `EditionModel`, odds rows (equal to a golden JSON transcribed from PARAMS §4.3–§4.4), `VerifyProps`, trust lines per authority state, `TvEvent` sanitization.
- Static: no numeric literal outside the allowed set in `tx/`, `adapters/`, `data/`, `wallet/`; no `setResult` call outside `tx/watch-pull.ts`'s reveal path; no import of `experience/**` internals other than `experience/index.ts`.

### 16.2 Playwright (`apps/web/e2e`)

- **Mock wallet** (`e2e/mock-wallet/`): registers through the Wallet Standard `register-wallet` event (no extra package); features `standard:connect` (with `silent`), `standard:events`, `solana:signAndSendTransaction` (multi-input), `solana:signTransaction`, `solana:signMessage`; signing happens in Node through `page.exposeFunction` with a keypair generated at runtime. Behaviours: approve, reject, batch or one prompt per transaction, drop transaction *i* (partial), hold until the blockhash expires, switch account.
- **Projects:** `fixtures` (every PR: mock API serving fixtures that parse with `@onepercent/sdk/api` and `@onepercent/web-api`, `rpc-replay` from recorded validator runs, Turnstile script stubbed by route interception); `validator` (nightly and gates: `solana-test-validator` 4.3.0 with the v3 `.so`, the mock VRF and M1's `export_fixtures`, API in local mode against it; `e2e/helpers/vrf.ts` fulfils with chosen randomness through the mock VRF `0xF0`); `devnet` (gates only, with the founder's go; master §8.3 E1).

| Id | Project | Scenario |
|---|---|---|
| W1.01 | fixtures | Every route, the aliases, 404; titles and focus |
| W1.02 | fixtures | API down: flags off, offline banner, exits and rescue link present |
| W1.03 | fixtures | X-ray scan, sections and labels, share link carries `ref`, incoming `ref` stored |
| W1.04 | fixtures | 11th scan in a minute: Turnstile path, resend once, 403 copy on failure |
| W1.05 | fixtures | Connect, silent reconnect after reload, account switch, disconnect |
| W1.06 | fixtures | Mobile and Telegram user agents without a wallet: universal links exact |
| W1.07 | fixtures | axe on every route; reduced motion; keyboard path X-ray → Connect |
| W2.01 | validator | 16 bags fed: Deck +16, approvals shown = prompts seen |
| W2.02 | validator | 3 taken back, deposits back |
| W2.03 | validator | Partial: transaction 3 dropped → partial copy, retry sends only the rest |
| W2.04 | fixtures (+ validator nightly) | Blockhash expired → "Took too long" → tap → rebuilt and landed |
| W2.05 | fixtures | Per-bag refusal reasons from attest fixtures |
| W2.06 | validator | Split token accounts merged first, then the whole bag fed |
| W2.07 | fixtures | Sell at market: allow-list, min received, quote expiry and refresh |
| W2.08 | validator | Close empties: rent back equals the closed accounts' lamports |
| W2.09 | validator | First-of-coin and My cards deposit lines equal Rent-derived lamports |
| W3.01 | validator | Rip OG ×1 per injected tier: reveal props equal the decoded `PackRevealed` |
| W3.02 | validator | Fulfil withheld: no `setResult`; pre-aged Pull → refund offered and landed |
| W3.03 | validator | ×10 in on-chain order; Turbo; `RipLine` |
| W3.04 | fixtures | `LiveFlagsChanged`, busy queue, hungry, refilling states |
| W3.05 | validator | My cards props equal the decoded Binder; 9 redeems → 2 transactions, descending |
| W3.06 | validator | Sell back with the stub quote signer: animation only after confirmation; each refusal → Sell at market |
| W3.07 | validator | Feed back; Close My cards shown iff it simulates; withdraw owed |
| W3.08 | validator | Keeper off: prepended settle lands royalties with the memo |
| W3.09 | validator | Verify equals chain for 100 pulls (script rips, page checks each) |
| W3.10 | fixtures | SSE dropped → polling → "On air" off when stale |
| W3.11 | fixtures | Trust lines per authority fixture |

---

## 17. Acceptance and gates

### 17.1 M3.1 (G3.1)

1. X1's acceptance (X1 §12) still holds on the merged code, with master §11.4 M3.1's corrections: 20 fixture wallets classify as expected; a cold mainnet scan ≤ 4 s p95 and a cached one ≤ 300 ms (founder keys, `xray:smoke`); OG images match their snapshots; every share link carries a referral code (golden); a graduated coin with a stale high price and a thin pool is capped at its pool's real reserves.
2. The real Turnstile verifier rejects the 11th request of a minute without a valid token (injected siteverify fake), and fails closed on timeout; the live API refuses to boot without a Turnstile secret.
3. `packages/copy` matches `COPY.md` §1–§3; the lint rule passes; `lint:words` is clean.
4. `packages/web-api` exports every §5.1 B schema with fixtures; the M3.1 routes of §5.1 B run on `api`.
5. W1.01–W1.07 pass; budgets and LCP pass.
6. The build contains no RPC key or secret; `/dev/experience` is absent from production.
7. `web` and `api` run on Railway `dev` per §15.4.
8. Wave 1 is wired (hero, X-ray view, templates) with no edit under `experience/`.

### 17.2 M3.2 (G3.2)

1. W2.01–W2.09 pass on the validator, and E1 (16 fed, 3 taken back) passes on devnet, or on the validator with cloned pump.fun accounts if S1 found none on devnet (master §8.3).
2. Every Feed transaction passes §9 step 3; attested amounts equal the chain balance at signing.
3. The approval count on every button equals the prompts the mock wallet records, in both capability modes.
4. Deposit lines equal Rent-derived lamports at 5,080 and at 6,960 lamports per byte (`RENT_TEST_RATES_LAMPORTS_PER_BYTE`).
5. With `FEED` off, "In the machine" and take-back still render and work.
6. The founder re-runs S5 on the canary (master §11.4).
7. Wave 2 is wired.

### 17.3 M3.3 (G3.3)

1. A test compares the props passed to the reveal and My cards components with the decoded Pull, events and Binder: equal (W3.01, W3.05).
2. No outcome reaches the reveal before `PackRevealed` (W3.02 and the static test).
3. Verify equals the chain for 100 pulls (W3.09).
4. The odds dialog's data equals PARAMS (golden JSON).
5. Trust lines are passed only when true on chain (W3.11).
6. W3.01–W3.11 pass; waves 3 and 4 are wired.

### 17.4 Gate review items (every M3 gate)

- **Data fidelity:** every number on screen traces to chain, config or a labelled quote or estimate; "if sold now" only on `now` values; nothing extrapolated.
- **Security:** CSP present; simulation before every prompt; no RPC key or secret in the bundle; the swap allow-list enforced; the logo proxy cannot reach a host off its list.
- **Custody:** no key handling anywhere; the wallet is the only signer of user transactions.
- **Boundary:** no change under `experience/` or to a replaced template; every visual issue filed as an interface request.
- **Exits:** reachable with every flag off, with the API's non-RPC routes down, and after the season (state injection).
- **Honest counts:** approvals and transaction counts shown equal reality.

---

## 18. Commands

New `apps/web` scripts: `test:e2e:fixtures`, `test:e2e:validator`, `test:e2e:devnet`, `test:chain`, `budget`, `lcp`, `assets:landing`. CI: append job `web` (fixtures project, budgets, LCP, `dist` grep) to `.github/workflows/app.yml`, `test:chain` to the `program` job, and the validator project to `nightly`.

The architect will run, from `app/`:

```
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm lint:words
pnpm program:build && pnpm --filter web test:chain
pnpm --filter web test:e2e:fixtures && pnpm --filter web test:e2e:validator
pnpm --filter web budget && pnpm --filter web lcp
! grep -rniE 'api-key|helius-rpc|x-api-key|BEGIN [A-Z ]*PRIVATE KEY|_SECRET' apps/web/dist
! grep -rl 'dev/experience' apps/web/dist
docker build -f apps/web/Dockerfile ..        # build context: the repo root
```

---

## 19. Do NOT

**Process and boundaries**
- Push to `main` or merge your own PR. M3.2 and M3.3 may start on the previous M3 branch, but each is opened for audit only after the previous M3 PR merged and it rebased.
- Edit `apps/web/src/experience/**`, `apps/web/public/experience/**`, a replaced template, `docs/codex/**`, `AGENTS.md`, the landing, or another lane's files (§4.2). Restyle, re-time, re-order or re-word an experience component; file an interface request instead.
- Add a dependency outside §3, or bump an experience dependency.

**Custody and keys**
- Ask for, accept, store, derive or log a private key or a seed phrase; add a "verify your wallet" step; hold a provider key, RPC key or secret in the browser; log a signature payload, an IP in analytics, or personal data.
- Sign anything server-side for a user, or let the API choose what a user signs beyond the Jupiter route it returns (which the browser checks).

**Numbers and honesty**
- Type an economic number in code; invent, loop or extrapolate a figure; compute price × amount; label anything but a `now` quote "if sold now"; show an estimate outside lists and X-ray; sum quotes into a "pack value".
- Show "On air" without live data, a trust line the chain does not make true, an odds row for a tier the machine cannot pay, or an approval count lower than what the wallet will show.

**Reveal**
- Call `setResult` before `PackRevealed` is decoded and cross-checked, from any other data, or with a guess; let the tier change any timing Codex controls; play the Sell back animation before confirmation.

**Exits**
- Put take-back, Redeem, Sell at market, settle, refund, withdraw owed, Close My cards, Verify or `/fairness` behind a flag, a rate limit or the indexer.

**Words never shipped** (code, comments, strings, docs and tests under `app/`, and every user-facing string)
- grave, graveyard, tomb, tombstone, bury, burial, ghost, ghoul, lich, haunt, wake, funeral, mourner, undertaker, soul, cremate, sweep, plus every other word of AGENTS.md's lists (`packages/config/src/vocabulary.ts`). Never "RIP" as rest in peace.
- No "ZK" wording anywhere.
- In user-facing copy: guaranteed, risk-free, free money, profit, yield, APY, passive income, earn, "verify your wallet"; no casino words.

---

## 20. Report back (in each PR)

1. The new `VERSIONS.md` rows, and the result of every §18 command.
2. Budgets and LCP figures; axe results per route.
3. For M3.1: the X1 corrections applied, the Turnstile path, the Railway `dev` checks of §15.4. For M3.2: the measured Feed bags per transaction used by the planner, the approvals table per wallet with its S5 source. For M3.3: the 100-pull Verify run, the reveal timing (signature → `setResult`) p50 and p95 on the validator.
4. Every interface request filed against the experience layer (expected: House slot flag, `setQuotes`, `setActionState`, an action-availability prop, a nullable value for `'—'`).
5. Every field of `@onepercent/sdk/api` the web needed and did not find, and the state of §5.1 C at each gate.
6. Logo hosts that missed, with counts.
7. Deviations from this brief, and every place you had to stop and decide.
8. Open questions, especially: whether each wallet shows one prompt for a multi-input `signAndSendTransaction` (S5); whether `@anchor-lang/core`'s event parser needs a `Buffer` global in the browser; whether a redeem plus Jupiter swap fits one v0 transaction at `WEB.sellMaxAccounts`.
