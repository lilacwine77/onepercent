# X-ray integration

X1 reads Solana wallets. It connects no wallet and creates no transactions.

From `app/`, build the shared packages with `pnpm build:libs`. Run the API with
`XRAY_SOURCE=fixtures pnpm --filter api dev` and the web with `pnpm --filter web dev`.
Only the synthetic fixture wallet addresses are available in fixture mode.
Optional fixture aliases `trencher.sns`, `mixed.sns` and `clean.sns` require
`XRAY_SNS_ENABLED=true`. Configure the public origins and
`VITE_API_URL` when using different ports.

## Contract changes for X3

Import `XrayResultSchema` and `XrayResult` from
`@onepercent/eligibility/xray-result` (browser-safe).

- `counts.feedable` counts snapshot-confirmed bags only.
- `counts.checkAtFeed` counts unknown/unchecked snapshot bags. These retain the
  `feedable` bucket with `reasonCode: "snapshot_at_feed"`; show their separate
  "to check at Feed" label. `bags = feedable + checkAtFeed + notFeedable`.
- [DECISIONS.md D8](../../../../../docs/codex/DECISIONS.md) accepts stable
  `reasonCode` values beside display text and the `checkAtFeed` counter.
- `decimals` and `amountUi` may both be null for `mint_missing`,
  `mint_unparseable` or a failed mint-safety code, with exactly the `not_in_set`
  bucket and no `valueSol` (D8). `mint_missing` means the account is absent;
  present accounts preserve the precise safety failure. Display "Amount
  unavailable". Unreadable mints alone never make the whole scan fail.
- Every share page/image/intent URL carries `ref`. A valid incoming address or
  alias is preserved, otherwise the scanned address is used. Referrals are applied
  after the shared address cache is read. The web stores the first valid incoming
  code for the browser session under `onepercent.referral` for the later Rip flow.

## Reserve values and partial results

X1.1 uses `@onepercent/market`'s additive `getSellValues` for proved pump.fun
mints. Active curves use the held amount and virtual reserves; completed curves
use the canonical PumpSwap pool and both token vaults. Pool pricing includes its
signed virtual quote reserves; spendable quote reserves exclude accrued protocol
and creator fees. A gross sale amount above spendable reserves is unavailable, never clipped
into a plausible value. This deliberately omits the narrow boundary where the
actual retained LP fee could make a PumpSwap sale fit; the frozen aggregate fee
allowance is not enough to prove that exact LP split.

The frozen 125 bps allowances remain unchanged. Each scan verifies the on-chain
SOL fee schedules fit those allowances, then applies conservative integer
rounding. Unknown schedules and custom creator rates suppress the value. This is
a reserve-derived conservative display value, not a signed or routed swap quote;
existing approved `≈ … SOL est.` copy remains. No new economics or copy is shipped.
The public Pump fee/trade documentation and sanitized fee-config fixture are
referenced in `packages/market/tests/sell-values.test.ts`.

Mint and curve reads share four workers with at most `XRAY.accountsPerBatch`
accounts per RPC. Market reads pool/vault accounts in the same bounded batches.
Only deterministic PDA addresses are memoized; reserve evidence is always live.
Jupiter gets at most one metadata call for up to
`MARKET.jupiter.tokensMintsPerCall` (100) in-set ids, ranked by reserve value.
Token info is cached per mint for `MARKET.tokenInfo.cacheTtlMs`; only present
valid results are cached, within the bounded LRU. X-ray no longer requests SOL/USD.
DAS metadata is independent and capped at 1,500 ms. Token-2022 names and symbols
also come from the inline metadata extension in already-read mint bytes; its URI
is not treated as an image or fetched. Not-in-set mints get no price or
value. Tokens v2 supplies no ATH; the scan does not invent one or fetch wallet-wide
prices to calculate it. Both existing unpriced-entry-tolerant price parsers remain.

D25 governs `XrayResult.valuesPartial?: boolean`. Each reserve lookup starts as
`UNREAD`; only missing or aborted value evidence makes a result partial. Read
accounts with no route, non-SOL quotes, insufficient real reserves, unsupported
fees, custom creator fees or malformed data are final unvalued states. Their scans
are cached normally. Metadata/name failures never make a result partial.
Partial scans are never cached; complete results keep `XRAY.cacheSeconds`.
The UI uses approved `xray.result.partial` and displays `common.noValue` only in
Has a bid.

Mint and curve reads are essential: any failed batch rejects the scan instead of
publishing unknown membership as a clean wallet. Successfully read absent or
malformed mints keep D8's `mint_missing`/`mint_unparseable` distinction. There is
no unavailable-membership classification path. Independent mint and curve reads
overlap through a shared four-batch admission limit.

In-set origin bags remain bags with or without a value. Card condition/title and
one-liner use membership evidence only: the scanner disables price-based dust
and drawdown copy, preserving the existing card-copy interface and approved text.
Values determine sellable entries/totals only; out-of-set bags stay unvalued.
D9 address-only input is unchanged. D25 supersedes the X-ray's former Price v3
valuation path; D7's SOL/USD age bound is unused by the scan.

The separate PNG cache
is capped at 500 entries and uses asynchronous raster rendering.

[DECISIONS.md D9](../../../../../docs/codex/DECISIONS.md) makes the default input
address-only, labelled "Solana wallet address". SNS resolution is disabled unless
`XRAY_SNS_ENABLED=true`; then only the `.sns` suffix is accepted. The previous
registry suffix remains unavailable during its migration.

## Manual provider checks

Keep credentials outside the repository. Load the authorized `.env.local` in the
process environment, then run `pnpm --filter api xray:smoke <address|name>`.
The script prints first/repeat counts, valued bags, partial/cache flags, timings
and actual Jupiter request attempts, including retries; never commit raw real wallet
scan output. A repeat of a partial result is intentionally another live scan. SNS failures tell the visitor `Use the wallet address`.

The manual recorder in this directory can be run from `services/api/` using
`node --env-file=/absolute/path/to/.env.local --import tsx src/xray/record-provider-fixtures.ts`.
It records only the known synthetic wallet and public mint account descriptors;
nonempty parsing examples are labelled synthetic derivatives. The eligibility
recorder retains the raw mainnet mint/curve provenance.

Provider calls have bounded deadlines. A scan retains its 10-second server
budget. After token inventory arrives, it reserves 20% of the remaining budget
(up to 2 seconds) for classification, serialization and cloning. A slow inventory
cannot consume a fixed enrichment allowance before mint/curve reads start.
CPU derivations yield every 16 entries, independently of 100-account RPC batches.
Parsed token accounts and mint safety results are reused within one scan only;
classification runs before waiting for optional metadata.
Optional enrichment is cancelled at that cutoff; successful batches survive
cancellation, and expired queued requests cannot fetch. Loading the initial token
account inventory remains essential: an unavailable inventory reports
`upstream_failed`/`scan_timeout`, not a fabricated empty wallet.
Keyless Jupiter remains 0.5 requests/second and the keyed default remains 1.
No paid Jupiter plan is required.

`scale.test.ts` exercises 2,000 token accounts, 600 pump.fun origins, four-worker
RPC batches, the real one-request-per-second Jupiter limiter with one metadata call, continuous
429s, stalled providers, essential-read failures and final unvalued states. The default API test runner finishes the other suites
before starting the wall-clock scale suite, so unrelated renderer workers do not
compete with its strict 10-second measurement. Focused test arguments still pass
through unchanged. Network access is disabled in automated tests.
