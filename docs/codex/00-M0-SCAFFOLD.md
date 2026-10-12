# Codex brief — M0: monorepo scaffold (The 1% Machine)

Issued 2026-10-08 by the architect. This milestone sets up the workspace only. **No economic or on-chain business logic in M0.** The full master brief (`docs/codex/00-MASTER-BRIEF.md`) and the M1 brief follow; the product model is `docs/codex/MODEL.md` once published (summary below).

## 0. Context in 6 lines

- Product: "The 1% Machine" on Solana. Trenchers **Feed** their memecoin bags (pump.fun-born tokens) into the machine; people **Rip** packs (0.1 / 0.25 / 0.5 / 1 SOL) containing 5 cards = 4 dust cards (deposited bags) + 1 hit (liquid token bought by the machine). Cards live in **My cards** with **Redeem** (tokens to wallet), **Sell back** (instant SOL at a discount), **Feed**, **Keep**. Native token **$1PCT** launched on pump.fun the same day.
- This repo today is the **landing site** (Vite + vanilla JS + Three.js) deployed by Railway from `main` via the root `Dockerfile` (+ `.dockerignore` whitelist). **Every push to `main` redeploys onepercent.fun.**
- The app is built as a separate **pnpm workspace in `app/`** so the landing and its deploy stay untouched until the switch-over milestone.
- You (Codex) implement milestone by milestone; the architect audits each one against the acceptance criteria below before the next brief is issued.
- Naming and art direction: `AGENTS.md` (app section). Never use the forbidden words listed there.
- If anything here is ambiguous or impossible, **stop and report** instead of guessing.

## 1. Rules for this milestone

1. Work on branch `feat/m0-scaffold` (from `main`). Open a PR; **never push to `main`**.
2. **Do not modify any landing file**: root `package.json`, `package-lock.json`, `index.html`, `src/`, `public/`, `scripts/`, `tests/`, `Dockerfile`, `Caddyfile`, `.dockerignore`, `vite.library.config.js`. Root `npm ci && npm test && npm run build` must behave exactly as before.
3. No secrets, keypairs or private keys in git. Program keypairs (`app/target/deploy/*.json`) and any `*.keypair.json` are gitignored. Provide `.env.example` files only.
4. Pin exact versions in lockfiles. Record every toolchain/library version you chose in `app/VERSIONS.md` with the date and where you verified it.
5. TypeScript `strict: true` everywhere. ESM. Node 22 LTS.

## 2. Target layout (create exactly this)

```
app/
  package.json            # private workspace root, scripts below
  pnpm-workspace.yaml     # apps/*, services/*, packages/*
  .nvmrc                  # 22
  .npmrc                  # engine-strict=true
  tsconfig.base.json
  eslint.config.js        # typescript-eslint, flat config
  .prettierrc             # match root prettier defaults
  .gitignore              # node_modules, dist, target, .anchor, test-ledger, *.keypair.json, .env*, !.env.example
  .env.example            # every env var used by any package, with comments, no values
  README.md               # how to install, run, test (all commands below)
  VERSIONS.md
  Anchor.toml             # [programs.localnet] onepercent = "<local program id>", cluster localnet
  Cargo.toml              # [workspace] members = ["programs/*"], resolver = "2"
  rust-toolchain.toml     # the Rust version required by the chosen Anchor release
  programs/
    onepercent/           # Anchor program skeleton (see §3)
  tests/
    onepercent.test.ts    # program smoke test (see §3)
  apps/
    web/                  # Vite + React + TS (see §4)
  services/
    api/                  # Node 22 TS HTTP API (see §5)
    worker/               # Node 22 TS background worker (see §5)
    bot/                  # Node 22 TS Telegram bot, non-custodial (see §5)
  packages/
    config/               # all parameters, single source of truth (see §6)
    sdk/                  # TS client for the program (see §7)
```

## 3. On-chain program skeleton (`app/programs/onepercent`)

- Toolchain: **Anchor 0.32.1** (anchor-lang + anchor-cli), with the matching Agave/Solana CLI stable release. Record both in `VERSIONS.md`.
- MagicBlock VRF (added in M1, **not in M0**): `ephemeral-rollups-sdk = "=0.17.3"` with features **`anchor-compat` + `vrf`**. Do not use the `anchor` feature: in 0.17.3 it maps to `anchor-modern`, which requires anchor-lang 1.x, while `anchor-compat` accepts anchor-lang `>=0.28, <1.0` (verified on the crate's Cargo.toml, 2026-10-08).
- Program name `onepercent`. One instruction only for M0: `ping(ctx)` with no accounts besides the signer, which emits `event Pong { version: u16 }` with `version = 1`. Nothing else.
- `tests/onepercent.test.ts`: starts the local validator via `anchor test` (or LiteSVM if you prefer — justify in README), calls `ping`, asserts the `Pong` event with `version == 1`.
- `anchor build` must also produce the IDL; a script `pnpm sdk:idl` copies `target/idl/onepercent.json` and `target/types/onepercent.ts` into `packages/sdk/src/idl/` (committed).

## 4. `app/apps/web` (Vite + React + TypeScript)

- Single page placeholder that already uses the brand tokens (exact values):
  - cream `#fff1e7` (page background), ink `#26062e` (text), lilac `#d5a2f1` (accent), plum `#2c1235`, X-ray navy→violet `#243969 → #120d30`, X-ray cyan `#92ebf0`.
  - Fonts: Fraunces 600/700 (display, letter-spacing −0.055em) and DM Sans 400/500 via `@fontsource/*` (same packages as the landing).
  - Content: wordmark "1%", headline "Bags in. Packs out.", subline "Go for the 1%.", and a status line fetched from the API `GET /health` ("API: ok" / "API: unreachable").
- No wallet integration yet (comes in a later milestone). No Three.js yet.
- `pnpm --filter web dev|build|test` work; one Vitest test renders the page and finds the headline.

## 5. Services (`app/services/*`)

Common: TypeScript, `zod` env validation that fails fast with a readable error, `pino` logging, graceful shutdown on SIGINT/SIGTERM, Vitest unit tests, a `Dockerfile` per service (node:22-alpine, multi-stage, non-root user) — not wired to Railway yet.

- `api`: HTTP server (Hono or Fastify — choose one, justify in README). Routes: `GET /health` → `{ ok: true, version, commit }`; CORS limited to `WEB_ORIGIN`. Test: `/health` returns 200 and the shape above.
- `worker`: long-running process with a `tick()` every `WORKER_TICK_MS` that only logs a heartbeat; `GET /health` on `WORKER_HEALTH_PORT`. Test: `tick()` is called and does not throw.
- `bot`: Telegram bot using `grammY`. It starts only if `TELEGRAM_BOT_TOKEN` is set; otherwise it logs "bot disabled" and exits 0. One command `/start` replying "Bags in. Packs out." The bot must **never** ask for, receive, store or derive private keys or seed phrases — add this sentence as a code comment at the top of the entry file. Test: the `/start` handler returns the expected text (unit test the handler, no network).

## 6. `app/packages/config` — parameters (single source of truth)

- Export typed constants + a `zod` schema + a `validateParams()` that is run in tests. Values are **provisional** (the calibrated values arrive with the M1 brief); add `// PROVISIONAL — from MODEL.md 2026-10-08` on each block.
- All amounts as integers: lamports (`bigint`), token base units (`bigint`), basis points (`number`, 10_000 = 100%).

```ts
export const PACK_EDITIONS = [
  { id: 'original',    name: 'The Original', priceLamports: 100_000_000n },
  { id: 'blue_shift',  name: 'Blue Shift',   priceLamports: 250_000_000n },
  { id: 'signature',   name: 'Signature',    priceLamports: 500_000_000n },
  { id: 'after_hours', name: 'After Hours',  priceLamports: 1_000_000_000n },
] as const;

export const CARDS_PER_PACK = { dust: 4, hit: 1 } as const;

// Split of every pack price, in bps of the price. Must sum to exactly 10_000.
export const PACK_SPLIT_BPS = {
  stock: 7_200,             // machine buys hit tokens
  royaltyPerDustCard: 200,  // paid instantly to the depositor of each pulled dust card (x4 = 800)
  jackpot: 500,
  burn1pct: 500,            // buy & burn $1PCT
  referral: 200,            // to team if no referrer
  team: 800,
} as const;

export const HIT_TIERS = [
  { id: 'silver', label: 'Silver Foil', valueBps: 5_000 },   // 0.5x pack price
  { id: 'blue',   label: 'Blue Foil',   valueBps: 15_000 },  // 1.5x
  { id: 'holo',   label: 'Holo Foil',   valueBps: 40_000 },  // 4x
  { id: 'black',  label: 'Black Foil',  valueBps: 150_000 }, // 15x
] as const;
// Odds per edition: NOT set in M0 (calibrated in M1). Export `HIT_ODDS = null` with a TODO(M1).

export const SELL_BACK = { payoutBps: 8_700, quoteTtlSeconds: 60 } as const;
export const SEASON = { durationDays: 7 } as const;
export const TOKEN_1PCT = {
  decimals: 6,
  totalSupply: 1_000_000_000_000_000n,     // 1B * 10^6 (pump.fun)
  devBuyBps: 400,                           // 4%, disclosed, 100% to The 1% cards
  onePctCardAmount: 10_000_000_000_000n,   // 10M * 10^6
  onePctCardCount: 4,
  teamAllocation: 0n,
  holderTier: { minBalance: 1_000_000_000_000n, onePctOddsMultiplierBps: 15_000 }, // >=1M tokens -> x1.5
} as const;
export const FEED_RULES = {
  launchpads: ['pump.fun'],
  minHoldSeconds: 72 * 3600,
  oneCardPerWalletPerMint: true,
  maxCardsPerWallet: null, // TODO(M1): set from spec
} as const;
```

- Tests (`validateParams`): split sums to 10_000; 4 dust × royalty bps == 800; prices strictly increasing; tier values strictly increasing; dev buy == 4 cards × card amount (`40_000_000 * 10^6 == totalSupply * 400 / 10_000`); team allocation is 0.

## 7. `app/packages/sdk`

- Exports `PROGRAM_ID` (read from the IDL address), the generated IDL/types, and a `ping(connectionOrRpc, signer)` helper used by the program test. Use the Solana TS client you will standardize on (`@solana/kit` or `@solana/web3.js` + `@coral-xyz/anchor` — choose, justify in README, and keep it consistent across packages). Unit test: `PROGRAM_ID` equals the IDL address.

## 8. Scripts (`app/package.json`)

| Script | Does |
|---|---|
| `pnpm install` | installs all workspaces |
| `pnpm lint` / `pnpm format:check` | eslint + prettier on all packages |
| `pnpm typecheck` | `tsc --noEmit` on all packages |
| `pnpm test` | Vitest in all TS packages |
| `pnpm build` | builds all TS packages + web |
| `pnpm anchor:build` / `pnpm anchor:test` | `anchor build` / `anchor test` |
| `pnpm sdk:idl` | copies IDL + types into `packages/sdk` |

## 9. CI (`.github/workflows/app.yml`)

- Triggers on pull requests and pushes touching `app/**` or the workflow file.
- Job `ts`: setup Node 22 + pnpm, `pnpm install --frozen-lockfile`, `lint`, `format:check`, `typecheck`, `test`, `build`.
- Job `program`: install the pinned Solana/Agave CLI and Anchor (via `avm`), cache `~/.cargo`, `app/target`; run `anchor build` and `anchor test`.
- Do not add any workflow that touches the landing or deploys anything.

## 10. Acceptance criteria (the architect will run these)

1. `git diff main --stat` shows changes only under `app/`, `.github/workflows/app.yml`, and nothing else.
2. From repo root: `npm ci && npm test && npm run build` pass exactly as on `main`.
3. From `app/`: `pnpm install --frozen-lockfile && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` all pass.
4. From `app/`: `pnpm anchor:build && pnpm anchor:test` pass; the `ping` test sees `Pong { version: 1 }`.
5. `pnpm --filter api dev` then `curl localhost:$PORT/health` → `{"ok":true,...}`; the web page shows "API: ok".
6. Bot exits 0 with "bot disabled" when `TELEGRAM_BOT_TOKEN` is unset.
7. `packages/config` tests pass, including the split-sum and dev-buy invariants.
8. No secret, keypair or `.env` file committed (`git ls-files | grep -Ei 'keypair|\.env$|id\.json'` returns nothing except `.env.example`).
9. CI green on the PR.
10. `app/README.md` and `app/VERSIONS.md` exist and are accurate.

## 11. Do NOT

- Do not implement packs, feeding, cards, VRF, swaps, pricing, the token, or any money movement.
- Do not touch the landing or anything that would trigger a production redeploy.
- Do not add mainnet/devnet deployment scripts or RPC keys.
- Do not invent economic numbers beyond §6.
- Do not use these words in code, strings or docs: grave, graveyard, tomb, tombstone, bury, burial, ghost, ghoul, lich, haunt, wake, funeral, mourner, undertaker, soul, cremate.

## 12. Report back

When done, post in the PR: the version table (`VERSIONS.md`), the commands you ran with their results, any deviation from this brief and why, and open questions.
