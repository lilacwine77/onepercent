# Local visual fixtures

For headless desktop and mobile captures, run from `app/`:

```sh
pnpm --filter web test:e2e:captures
```

Playwright uses its cached Chromium with one worker and starts/stops the local
fixture server itself. The runner builds the harness, then serves the compiled
assets with Vite preview. No browser import uses `/@fs` or the checkout path.
The six surfaces (Rip selection, before signing, Verify,
fairness, live and token) each run at 1440 × 1000 and 390 × 844. Screenshots use
`page.screenshot` and are saved under the system temporary directory in
`onepercent-m33-captures/`. Each page retains the visible sample-data banner.
The checks include loaded content, horizontal overflow and uncaught page errors.
These display fixtures do not replace the W3 local-validator scenarios.

Run from `app/` with the pinned pnpm environment:

```
node --preserve-symlinks apps/web/e2e/visual/start.mjs
```

Open `http://127.0.0.1:5174/verify/42`, `/fairness`, `/live`, `/token` or `/rip`.
The isolated Vite config replaces only the two bridge modules with typed visual fixtures. The real app shell, route loading, experience components, fonts, tokens and responsive styles render unchanged. No production file imports this harness. Every API request is intercepted locally; no signer, transaction or remote request is used. The banner explicitly labels the sample data. These captures are visual evidence only, never a chain validation result.

The Rip selection supports its normal edition and quantity controls. Pressing Rip opens its actual pre-sign dialog with sample cost lines. The fixture cannot send a transaction.

The harness has its own HTML and React entry. It never imports the production
bootstrap, and reuses the container's React root if the entry is evaluated again.
Fixture module ids stay inside Vite's temporary root. Workspace-relative paths
and pnpm dependency resolution are preserved through aliases, including when the
checkout contains percent signs, spaces or other URL-sensitive characters.
Build output is temporary and removed when the runner exits.

The shell's `getSlot` and `getBlockTime` calls are served by the local fixture
RPC using the recorded config. Unrecorded API requests never reach an external
service and fail the capture check. Both the production web build and this
harness reject implicit global byte-buffer references in emitted JavaScript.
The SDK event decoder uses native byte arrays. Affected pinned Solana codecs
(borsh, buffer-layout, Anchor, SPL Token and bigint-buffer) receive an explicit
module-local import of the existing buffer package. bn.js uses that same package
instead of probing a window shim. Neither the app entry nor browser globals are
modified. The static guard permits explicit local bindings and property names,
but rejects unresolved references and browser-global accesses in every chunk.

Validate the bundle without starting a browser or server, from `app/`:

```sh
node --preserve-symlinks apps/web/e2e/visual/start.mjs build
```
