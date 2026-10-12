# M3.3 local validator checks

The runner uses disposable signers exported to a temporary directory and the
existing production sBPFv3 artifact with the mock VRF program. It never reads a
configured wallet and never starts a Rust build. Artifacts are read in place.

From `app/`, use the pinned pnpm with explicit paths:

```sh
ONEPERCENT_VALIDATOR_ARTIFACT_DIR=/path/to/existing/target/deploy \
FIXTURE_EXPORT_BINARY=/path/to/existing/target/debug/deps/export_fixtures-hash \
SOLANA_TEST_VALIDATOR=/path/to/solana-test-validator-4.3.0 \
CARGO_BUILD_JOBS=3 RUST_TEST_THREADS=2 VITEST_MAX_WORKERS=2 \
pnpm --filter web test:e2e:validator:run
```

The default public report is `onepercent-w3-validator.json` in the system
temporary directory; override its full path with `WEB_VALIDATOR_REPORT`. It contains artifact hashes, transaction signatures,
100 fresh Pull addresses, adapter checks and local timing. Temporary accounts,
signers and ledger are removed even after failure. The supplied artifact can
come from another worktree; the report therefore records its path and hashes
instead of implying it was built from the current branch.

The chain checks cover an x10 Pull, pending requests without reveal evidence,
confirmed event and Binder equality, descending Redeem transactions, Settle
without a keeper, and Verify through the same loader used by the page. Timing
includes the explicit mock callback and verification reads; it is not a devnet
provider latency measurement or proof of the provider's randomness.

To also check all 100 Pulls in the browser, first run a production web preview,
built with `CLUSTER=localnet`, `VITE_CLUSTER=devnet` and `PROGRAM_ID` set to
the program address from the local fixture manifest. Then set `WEB_VALIDATOR_URL` to its origin and `WEB_VALIDATOR_BROWSER=1` on the
same command. The runner invokes the validator Playwright project before
stopping the validator. Its same-origin RPC requests are forwarded to that live
local bank. This does not certify production API admission or indexer delivery.
`browserVerified` becomes true only if this browser run passes.

W3 remains a combined gate. Browser interactions for Rip, Turbo, RipLine,
refund controls and My cards require their browser scenarios. The P2 Sell,
Feed back, withdraw owed and Close actions use builder fixtures until the P2
program is integrated. Devnet provisioning and real-provider validation are
separate from this local run.

## Existing-artifact results on 2026-10-09

- `docs/codex/reports/M3.3-verify-100-local.json`: 100 fresh Pulls and 385
  confirmed local transactions. The current Verify loader, callback cross-check,
  Binder equality, x10 order, Redeem and Settle passed. Local mock timing was
  1,121 ms p50 and 1,416 ms p95, including explicit fulfillment and validation.
- `docs/codex/reports/M3.3-specials-local.json`: 24 confirmed transactions,
  including all six injected tiers, pre-aged refund, special-card Redeem gates,
  keeperless Settle with its royalty memo, and nine Redeems in two transactions.

These are Node-to-validator results. They do not certify browser interaction,
P2 execution, a devnet deployment, or the provider proof. Existing M4.2 artifacts
were read in place and identified by SHA-256; their exact build commit is not
certified. No Rust build was started and no target directory was copied.

For the six-tier SDK checks, set `WEB_VALIDATOR_SDK_CHECKS=1`. For a persistent
local browser session, set `WEB_VALIDATOR_SERVE=1` and
`WEB_VALIDATOR_PREVIEW_URL=http://127.0.0.1:4173`. The runner prints a loopback
`/__w3` controls URL and holds the validator until Stop is pressed. It serves the
production preview, real RPC, and the API's account readers. The test wallet
uses the existing mock-wallet code with signing in Node; only public metadata
and signed bytes cross into the browser. Controls provide chosen mock callbacks,
flags-off/busy/stale response fixtures, the 100-Pull run and public evidence links.

The persistent mode injects specials into a backed local fixture mint and the
pre-aged Pending Pull at genesis. This tests callback and Redeem behavior, not
Meteora launch provisioning. The test harness lives outside `src` and is never
included in the production bundle. Run the Playwright project headless with
cached Chromium. No visible browser is needed. The current macOS sandbox can
refuse the browser process before any page opens; such a failure must not be
reported as W3 acceptance.
