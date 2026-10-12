import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  type Connection,
} from "@solana/web3.js";
import { FeatureFlags } from "@onepercent/sdk/api";
import {
  fetchBinder,
  fetchMintDecimals,
  fetchPull,
  pullPda,
} from "@onepercent/sdk";
import type { Page } from "@playwright/test";
import { createPublicData } from "../../../../services/api/src/public/data/index.js";
import type { Manifest } from "../../../../scripts/e2e-validator.js";
import { installWallet } from "../mock-wallet/index.js";
import { randomnessForTier } from "../helpers/validator.js";
import { fulfillLocal } from "../helpers/vrf.js";
import { readMachine } from "../../src/data/chain.js";
import { editionModels, editionLiveFlags } from "../../src/adapters/edition.js";

async function body(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    assert(size <= 131072, "Local request too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
/** Local validation only. This module is outside src and absent from production. */
export async function serveValidator(input: {
  rpc: Connection;
  manifest: Manifest;
  reportPath: string;
  run100(): Promise<void>;
  writeReport(): Promise<void>;
}) {
  const { rpc, manifest } = input;
  assert.equal(new URL(rpc.rpcEndpoint).hostname, "127.0.0.1");
  const preview = new URL(
    process.env.WEB_VALIDATOR_PREVIEW_URL ?? "http://127.0.0.1:4173",
  );
  assert(preview.protocol === "http:" && preview.hostname === "127.0.0.1");
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(manifest.wallets.buyer.secretKey),
  );
  const callbacks = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  let walletScript = "globalThis.__name = (fn) => fn;\n";
  await installWallet(
    {
      async exposeFunction(
        name: string,
        fn: (...args: unknown[]) => Promise<unknown>,
      ) {
        callbacks.set(name, fn);
        walletScript += `globalThis.${name} = async (...args) => { const r = await fetch('/__w3/wallet/${name}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }); const v = await r.json(); if (!r.ok) throw new Error(v.error); return v.result; };\n`;
      },
      async addInitScript(fn: (...args: unknown[]) => unknown, args: unknown) {
        walletScript += `(${fn.toString()})(${JSON.stringify(args)});\n`;
      },
    } as unknown as Page,
    { signer: buyer, rpc },
  );
  let paused = false;
  let busy = false;
  let stale = false;
  const flags = FeatureFlags.parse(
    Object.fromEntries(
      Object.keys(FeatureFlags.shape).map((name) => [
        name,
        ["PACKS", "FEED", "TV_LIVE"].includes(name),
      ]),
    ),
  );
  const reader = createPublicData({
    runtime: {
      env: { CLUSTER: "devnet", PROGRAM_ID: PROGRAM_ID.toBase58() },
      rpc: {
        async request(
          method: string,
          params: unknown[],
          schema: { parse(value: unknown): unknown },
        ) {
          const response = await fetch(rpc.rpcEndpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          });
          const value = (await response.json()) as {
            result: unknown;
            error?: unknown;
          };
          assert(!value.error);
          return schema.parse(value.result);
        },
        async chainNow() {
          const account = await rpc.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
          assert(account);
          return account.data.readBigInt64LE(32);
        },
      },
      pool: {
        query: async () => {
          throw new Error("Indexer unavailable in the local harness");
        },
      },
    } as unknown as Parameters<typeof createPublicData>[0]["runtime"],
    flags,
    vrf: async () => ({
      queue: manifest.queue,
      occupancyBps: 0,
      oldestItemAgeSeconds: 0,
      busy: false,
    }),
  });
  let origin = "";
  let running = false;
  let status = "Ready";
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");
    const json = (value: unknown, code = 200) => {
      response.writeHead(code, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify(value, (_, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      );
    };
    try {
      assert(
        request.headers.host === new URL(origin).host,
        "Invalid local host",
      );
      if (request.method === "POST" && request.headers.origin)
        assert(
          request.headers.origin === origin,
          "Only same-origin local controls are accepted",
        );
      if (
        url.pathname.startsWith("/__w3/wallet/") &&
        request.method === "POST"
      ) {
        const fn = callbacks.get(url.pathname.split("/").at(-1)!);
        assert(fn);
        const args = JSON.parse((await body(request)).toString()) as unknown[];
        assert(Array.isArray(args));
        return json({ result: await fn(...args) });
      }
      if (url.pathname === "/__w3/wallet.js") {
        response.writeHead(200, {
          "content-type": "text/javascript",
          "cache-control": "no-store",
        });
        response.end(walletScript);
        return;
      }
      if (url.pathname === "/__w3/report")
        return json(JSON.parse(await readFile(input.reportPath, "utf8")));
      if (url.pathname === "/__w3/status") return json({ status, running });
      if (url.pathname === "/__w3/control" && request.method === "POST") {
        const value = JSON.parse((await body(request)).toString()) as {
          action: string;
          tier?: number;
        };
        if (["normal", "flagsOff", "busy", "stale"].includes(value.action)) {
          paused = value.action === "flagsOff";
          busy = value.action === "busy";
          stale = value.action === "stale";
          status = `Read mode: ${value.action}`;
          return json({ status });
        }
        if (value.action === "stop") {
          json({ stopped: true });
          finish();
          return;
        }
        if (value.action === "run100") {
          assert(!running);
          running = true;
          status = "Running 100 fresh Pulls";
          void input
            .run100()
            .then(input.writeReport)
            .then(
              () => {
                status = "100 fresh Pulls verified";
              },
              (error: unknown) => {
                status = error instanceof Error ? error.message : String(error);
              },
            )
            .finally(() => {
              running = false;
            });
          return json({ started: true });
        }
        assert(!running && value.action === "fulfill");
        const binder = await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey);
        assert(binder && binder.pull_nonce > 0);
        const address = pullPda(
          PROGRAM_ID,
          buyer.publicKey,
          binder.pull_nonce - 1,
        )[0];
        const pending = await fetchPull(PROGRAM_ID, rpc, address);
        assert(pending?.status === 1);
        const queue = new PublicKey(manifest.queue);
        const requestIndex =
          (await rpc.getAccountInfo(queue))!.data.readUInt32LE(0) - 1;
        const snapshot = await readMachine(rpc, PROGRAM_ID);
        const edition = editionModels({
          ...snapshot,
          deckLen: snapshot.deck.len,
          vrf: {
            queue: manifest.queue,
            occupancyBps: 0,
            oldestItemAgeSeconds: 0,
            busy: false,
          },
        })[pending.edition]!;
        const randomness = value.tier
          ? randomnessForTier(
              pending.seq,
              pending.edition,
              value.tier,
              editionLiveFlags(edition),
            )
          : createHash("sha256").update(`w3-control:${pending.seq}`).digest();
        const signature = await fulfillLocal(
          rpc,
          buyer,
          queue,
          address,
          requestIndex,
          randomness,
        );
        status = `Pull ${pending.seq} fulfilled`;
        return json({ signature, pull: address.toBase58(), seq: pending.seq });
      }
      if (url.pathname === "/__w3") {
        const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local W3 controls</title></head><body><h1>Local W3 controls</h1><p>Disposable local validator. Mock VRF. Test fixture balances.</p><nav><a href="/rip">Rip</a> <a href="/cards">My cards</a> <a href="/fairness">Fairness</a> <a href="/live">Live</a> <a href="/token">Token</a></nav><p id="status"></p><p>${[1, 2, 3, 4, 5, 6].map((tier) => `<button data-action="fulfill" data-tier="${tier}">Fulfill ${["Silver", "Blue", "Holo", "Black", "Jackpot", "The 1%"][tier - 1]}</button>`).join(" ")}</p><p><button data-action="normal">Normal reads</button> <button data-action="flagsOff">Flags off</button> <button data-action="busy">Busy VRF</button> <button data-action="stale">Stale service</button></p><button data-action="run100">Run 100 fresh Pulls</button> <button data-action="stop">Stop validator</button><p><a href="/__w3/report">Public report</a></p><ol id="pulls"></ol><script src="/__w3/controls.js"></script></body></html>`;
        response.writeHead(200, {
          "content-type": "text/html",
          "cache-control": "no-store",
        });
        response.end(html);
        return;
      }
      if (url.pathname === "/__w3/controls.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(
          `document.querySelectorAll('button[data-action]').forEach(b => b.onclick = async () => {const r = await fetch('/__w3/control', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:b.dataset.action,tier:Number(b.dataset.tier)||undefined})});document.querySelector('#status').textContent=JSON.stringify(await r.json());}); async function refresh(){try{const r=await fetch('/__w3/status').then(r=>r.json());document.querySelector('#status').textContent=r.status;const report=await fetch('/__w3/report').then(r=>r.json());document.querySelector('#pulls').replaceChildren(...(report.pulls||[]).map(p=>{const li=document.createElement('li');const a=document.createElement('a');a.href='/verify/'+p.address;a.textContent='Verify Pull '+p.seq;li.append(a);return li;}));}catch{}setTimeout(refresh,3000);}refresh();`,
        );
        return;
      }
      if (url.pathname === "/api/rpc") {
        const upstream = await fetch(rpc.rpcEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: await body(request),
        });
        response.writeHead(upstream.status, {
          "content-type": "application/json",
        });
        response.end(await upstream.text());
        return;
      }
      if (url.pathname === "/api/config") {
        if (stale) return json({ error: "unavailable" }, 503);
        const config = await reader.config();
        return json({
          ...config,
          flags: paused
            ? { ...config.flags, PACKS: false, FEED: false, TV_LIVE: false }
            : config.flags,
        });
      }
      if (url.pathname === "/api/machine") {
        if (stale) return json({ error: "unavailable" }, 503);
        const machine = await reader.machine();
        return json({
          ...machine,
          vrf: busy ? { ...machine.vrf, busy: true } : machine.vrf,
        });
      }
      if (url.pathname === "/api/web/config")
        return json({
          lookupTable: null,
          adminMultisig: null,
          flags: { XRAY: false },
          modes: { rip: "live", cards: "live", verify: "live", feed: "live" },
        });
      if (url.pathname === "/api/values") {
        const requestBody = JSON.parse((await body(request)).toString()) as {
          items: { mint: string; amount: string }[];
        };
        return json({
          items: await Promise.all(
            requestBody.items.map(async (item) => ({
              ...item,
              symbol: null,
              name: null,
              logo: null,
              decimals: (await fetchMintDecimals(rpc, new PublicKey(item.mint)))
                .decimals,
              value: { status: "unavailable", reason: "CAP_UNAVAILABLE" },
            })),
          ),
        });
      }
      if (url.pathname === "/api/events") return json([]);
      if (url.pathname.startsWith("/api/"))
        return json({ error: "unavailable" }, 503);
      const upstream = await fetch(new URL(url.pathname + url.search, preview));
      const headers = Object.fromEntries(upstream.headers.entries());
      delete headers["content-length"];
      delete headers["content-encoding"];
      if (upstream.headers.get("content-type")?.includes("text/html")) {
        const html = (await upstream.text()).replace(
          "<head>",
          '<head><script src="/__w3/wallet.js"></script>',
        );
        response.writeHead(upstream.status, headers);
        response.end(html);
      } else {
        response.writeHead(upstream.status, headers);
        response.end(Buffer.from(await upstream.arrayBuffer()));
      }
    } catch (error) {
      json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  console.log(`W3 local browser controls: ${origin}/__w3`);
  await done;
  await new Promise<void>((yes) => server.close(() => yes()));
}
