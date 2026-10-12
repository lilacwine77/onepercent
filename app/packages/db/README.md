# M2 database

Postgres 17, `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11 and `pg` 8.23.0.
`@types/pg` 8.23.1 was published on 2026-08-17. All direct dependencies are pinned.

From `app/`:

```sh
pnpm --filter @onepercent/db generate
DATABASE_URL=postgresql://onepercent:local-development-only@localhost:5432/onepercent pnpm --filter @onepercent/db migrate
pnpm --filter @onepercent/db test
```

The local URL is for `compose.yaml` only. Supply production credentials through the
service environment. In the deployed API/worker package, which must include
`@onepercent/db` as a direct production dependency, use this Railway pre-deploy
command (Node only; no pnpm, tsx or source files required):

```sh
node node_modules/@onepercent/db/dist/migrate-cli.js
```

The package includes `dist/` and `drizzle/` explicitly and also exposes the
`onepct-db-migrate` executable. The workspace `migrate` script delegates to the
same CLI through tsx for local development. The migrator serializes concurrent
deploys with a session advisory lock and
checks Postgres 17 and hashes of already-applied migrations before applying new
ones with Drizzle's node-postgres migrator. It never logs connection errors or URLs.

Migrations are forward-only. After merge, never edit a migration or its journal
entry. Generate a new migration after rebasing; never hand-merge migration
metadata. A destructive change takes two releases: first stop readers and writers
from using the old field, then remove it in a subsequent release. There is no
rollback/down command. CI regenerates and fails on a difference, including new
untracked migration files.

`0000_m2_core.sql` contains all 22 tables from M2 §11.2, including K1's plans,
trades and hit-list reports. The insert-only guards for `attestation_log` and
`quote_log` are SQL triggers in the same migration; Drizzle does not model triggers.
They reject updates, deletes and truncation. Pulls are identified by `seq`; their
address index is non-unique because a recreated Binder can reuse an address.
Sell back events are keyed by `(signature, event_index)` so one transaction can
contain multiple events. Service-role ownership of writes is
part of the service contract: this package does not create deployment credentials.

All token/SOL amounts use `numeric(20,0)`, a bigint adapter, and u64 SQL range
checks. Arrays of amounts use the same adapter and range checks. Times use
`timestamptz`; ordering uses four bigint columns and composite indexes. JSON
boundaries validate with zod, reject unsafe integers and JS bigints, and require
decimal strings for amounts. Raw chain events and K1 report bodies remain JSON
objects so later S1/K1 code can validate its draft-IDL-specific shape without a
schema change. Attestation bags have a dedicated strict schema. Public keys are
stored as text; their request and RPC boundaries perform public-key validation.

## Integration

```sh
SERVICES_INTEGRATION=1 TEST_DATABASE_URL=postgresql://onepercent:local-development-only@localhost:5432/onepercent pnpm --filter @onepercent/db test
```

Without `SERVICES_INTEGRATION=1`, the Postgres tests are explicitly skipped locally.
With the flag, a missing or non-local `TEST_DATABASE_URL` fails the suite. The supplied test role
must be able to create a database: the suite creates a uniquely named empty
database, migrates it, tests u64 round-trips, raw-event deletion, log immutability,
concurrent migration runs and alert deduplication, then removes that test database.
It does not delete or truncate the database named in the URL.

## API and implementation decisions

- `createDatabase(PoolConfig)` returns `{ db, pool, close }`; `Database` is the
  typed Drizzle client. Lifecycle and pool options belong to the service runtime.
- `applyMigrations(pool)` applies the committed migration directory. Schema
  objects and JSON/u64 validators are exported from `@onepercent/db`.
- `recordAlert(db, { key, severity, payload, dedupeSeconds })` records every
  occurrence and returns `true` to exactly one concurrent caller per notification
  window. `severity` is `info`, `warning` or `critical`. The caller sanitizes the
  payload and sends the webhook. A `notified_at` operational column tracks the
  last claimed notification, independently of `last_at`, so a steady incident
  cannot postpone notification indefinitely. A failed webhook may be retried at
  the next window; persistence does not imply webhook delivery.
- `stock_plans.state`, `stock_plans.plan` and `hitlist_reports.report` hold full
  validated JSON evidence. K1 gets searchable mint, slot, time, execution status,
  quote, measured delta and slippage columns; dry runs can have no signature or
  measured delta. The report stores the quoted cap; it does not derive one.
- `randomness` is text for the S1 codec's encoded bytes; `reveal_order` is the
  per-slot reveal position. No economic defaults or product odds are stored here.

## Launch season migration

`0002_m4_season_services.sql` adds the fee-event and Block-0 mirrors, durable
Power-On/readiness state, operational executor trades and the executor's
independent transaction journal. It adds nullable `packs.live_flags`; only
replayed or newly indexed `PackRevealed` evidence fills existing rows. The
forward migration does not guess old per-pack liveness or modify earlier
migration files. Final Pull claim and holder-attestation tables are outside
D18 launch scope.
