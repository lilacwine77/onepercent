# Program events

`@onepercent/sdk/events` exposes a strict event decoder and the invocation-frame
parser used by the indexer and keeper. Public keys are base58 strings; `u64` and
`i64` are `bigint`; field names preserve the program's IDL names.

`m1.json` contains the address, metadata, 21 events and their referenced types
from the final M1 IDL, including `ReferralRedirected`. `pnpm sdk:idl` regenerates
it from `target/idl/onepercent.json`, together with the TypeScript event shapes.
`node --test scripts/event-idl.test.mjs` checks the committed SDK IDL and, after
a program build, `target/idl`. The event tests also compare every schema with
Anchor's independent Borsh encoder.

`ONEPERCENT_EVENT_STREAM_EVENTS` is the only S1/S4 publication table. The API's
`PROGRAM_EVENT_STREAM_NAMES` export aliases this same object; the final referral
redirect is a `settle` event. Tests require exact coverage of the event IDLs.

`m2-provisional.json` retains its original filename and contains the six M2
section 8 events, now checked against P0's generated IDL. `m4.json` contains the
eight appended season schemas. D18 leaves the Final Pull instructions as stubs;
their reserved event schemas do not imply that claims are available. Power-On
uses the existing `phase` stream category. Other M4 events are decoded and
retained, with public stream routes deferred to M4.2.

Pass `topLevelProgramIds` from the transaction message to get exact `ixIndex`
values, including instructions that produce no invocation logs. Without the
message, the keeper may parse notifications, but indexes count logged root
invocations only and must not be persisted.

The parser accepts only `Program data:` in the innermost program frame and
discards events when that frame or an ancestor fails. It skips failed
transactions. Unknown and malformed payloads reserve their ordinal and set
`unknownEvent`; an invalid frame stack sets `malformed` and returns no events.
Either flag requires account reconciliation. `truncated` requires reconciliation
of every transaction account; events from unclosed frames are discarded because
the omitted suffix could contain a failed CPI. Completed top-level frames remain
usable.

`p3.json` adds `KeeperHistoryStarted`, `RevealTimestamped`, `BucketListed` and
`SellHistoryUpdated` without changing historical event payloads. They are
administrative diagnostics with no public stream category. Account reads remain
the authority for the [keeper window proofs](../../../../programs/onepercent/P3-KEEPER-HISTORY.md).
