/** Explicit local screenshot server. This config is never part of the app build. */
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type PreviewServer } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { browserParams } from "../../scripts/browser-params.mjs";
import {
  browserBufferGuard,
  browserByteDependencies,
} from "../../scripts/browser-buffer.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(
    resolve(here, "../../../../packages/web-api/fixtures/config.json"),
    "utf8",
  ),
);
const web = JSON.parse(
  readFileSync(
    resolve(here, "../../../../packages/web-api/fixtures/web-config.json"),
    "utf8",
  ),
);
const fixtures = (): Plugin => {
  let root: string;
  const serveFixtures = (server: Pick<PreviewServer, "middlewares">) => {
    server.middlewares.use((request, response, next) => {
      const url = request.url?.split("?")[0];
      if (!url?.startsWith("/api/")) return next();
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      if (url === "/api/config") return response.end(JSON.stringify(config));
      if (url === "/api/web/config") return response.end(JSON.stringify(web));
      if (url === "/api/rpc" && request.method === "POST") {
        // The shell's clock is the only RPC consumer of these display fixtures.
        // No RPC bytes are forwarded to a network or used to sign transactions.
        void (async () => {
          let body = "";
          for await (const chunk of request) body += chunk;
          const { id, method } = JSON.parse(body) as {
            id: unknown;
            method: string;
          };
          const result =
            method === "getSlot"
              ? Number(config.asOfSlot)
              : method === "getBlockTime"
                ? config.season.snapshotTs
                : undefined;
          if (result === undefined) response.statusCode = 400;
          response.end(
            JSON.stringify(
              result === undefined
                ? {
                    jsonrpc: "2.0",
                    id,
                    error: {
                      code: -32601,
                      message: "Unrecorded visual fixture RPC method",
                    },
                  }
                : { jsonrpc: "2.0", id, result },
            ),
          );
        })().catch(() => {
          response.statusCode = 400;
          response.end(
            JSON.stringify({ error: "Invalid visual fixture RPC request" }),
          );
        });
        return;
      }
      if (url === "/api/beacon") {
        response.statusCode = 204;
        return response.end();
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ code: "unrecorded_visual_fixture" }));
    });
  };
  return {
    name: "onepercent-local-visual-fixtures",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    resolveId(source) {
      if (source.endsWith("/bridge/PublicLive"))
        return resolve(root, "e2e/visual/PublicFixture.tsx");
      if (source.endsWith("/bridge/RipLive"))
        return resolve(root, "e2e/visual/RipFixture.tsx");
    },
    configureServer: serveFixtures,
    configurePreviewServer: serveFixtures,
  };
};
export default defineConfig({
  define: {
    "import.meta.env.VITE_PREVIEW": JSON.stringify("0"),
    __WEB_DEPLOYMENT__: JSON.stringify({
      cluster: "devnet",
      programId: JSON.parse(
        readFileSync(
          resolve(here, "../../../../packages/sdk/src/idl/onepercent.json"),
          "utf8",
        ),
      ).address,
    }),
  },
  plugins: [
    fixtures(),
    react(),
    browserParams(),
    { ...browserByteDependencies(), enforce: "pre" },
    browserBufferGuard(),
  ],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 5174, strictPort: true, proxy: {} },
  preview: { host: "127.0.0.1", port: 5174, strictPort: true, proxy: {} },
});
