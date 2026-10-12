# Public hit-list checks

`onepct-ops hitlist check|recheck <mint> --class major|trending` uses the X2
listing evidence gatherer and evaluators. Set `DATABASE_URL` and the public
`SOLANA_RPC_URL` (or `RPC_URL`), with the service's Jupiter and Hermes credentials.
The evidence RPC genesis must match the command's cluster. Reports are stored
in `hitlist_reports` and `reports/hitlist/<UTC date>/<mint>.json`.

`hitlist add` requires the newest report to pass, match the mint/class, and be
within `SERVICES.stock.hitlistReportMaxAgeSeconds`. Its cap comes from the X2
report. MAJOR feed ids come from the published launch list; TRENDING uses its
canonical PumpSwap pool. The deployed $1PCT mint is always refused.

The extension returns ATA creation and `admin_list_mint` to the existing CLI
runner. Devnet uses that runner's local signing path. Mainnet produces its
unsigned Squads proposal material and retains governance timelocks. This module
receives no signer. TRENDING notice starts at the on-chain listing slot's block
time; publication must precede the first buy by the configured notice period.
