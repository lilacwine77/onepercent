import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebConfigResponse, BeaconEvent } from "@onepercent/web-api";
import { ConfigResponse, FeatureFlags } from "@onepercent/sdk/api";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { createXrayDependencies } from "../../../../services/api/src/xray/deps.js";
const config = JSON.parse(
  await readFile(
    new URL(
      "../../../../packages/web-api/fixtures/config.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const webConfig = JSON.parse(
  await readFile(
    new URL(
      "../../../../packages/web-api/fixtures/web-config.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const publicConfig = ConfigResponse.parse({
  ...config,
  asOfSlot: Number(config.asOfSlot),
  phase: 0,
  flags: {
    ...Object.fromEntries(
      Object.keys(FeatureFlags.shape).map((key) => [key, false]),
    ),
    ...config.flags,
  },
});
WebConfigResponse.parse(webConfig);
const rpcReplay = Object.fromEntries(
  await Promise.all(
    ["getSlot", "getBlockTime"].map(async (method) => [
      method,
      JSON.parse(
        await readFile(
          new URL(`../rpc-replay/${method}.json`, import.meta.url),
          "utf8",
        ),
      ).response,
    ]),
  ),
);
// X1's recorded/synthetic source carries provenance, classification and reserve caps.
const xray = await createXrayDependencies({
  XRAY_SOURCE: "fixtures",
  PUBLIC_WEB_URL: "http://127.0.0.1:4173",
  PUBLIC_API_URL: "http://127.0.0.1:4173",
});
const stringify = (body: unknown) =>
  JSON.stringify(body, (_, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
export const fixtureServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  function json(body: unknown, status = 200) {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(stringify(body));
  }
  try {
    if (/^\/api\/link\/session\/[a-f0-9]{32}$/.test(url.pathname))
      return json({
        status: "open",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        botUsername: "OnePercentBot",
      });
    if (url.pathname === "/api/config") return json(publicConfig);
    if (url.pathname === "/api/web/config") return json(webConfig);
    if (url.pathname === "/api/rpc") {
      let text = "";
      for await (const chunk of request) text += chunk;
      const { method, id } = JSON.parse(text);
      if (!rpcReplay[method])
        return json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: "No recorded fixture for this method",
          },
        });
      return json({ ...rpcReplay[method], id });
    }
    if (url.pathname === "/api/beacon") {
      let text = "";
      for await (const chunk of request) text += chunk;
      BeaconEvent.parse(JSON.parse(text));
      response.writeHead(204);
      response.end();
      return;
    }
    if (/^\/api\/xray\/[^/]+$/.test(url.pathname)) {
      const result = await xray.service.get(
        decodeURIComponent(url.pathname.split("/")[3]!),
        { ref: url.searchParams.get("ref") ?? undefined },
      );
      XrayResultSchema.parse(result);
      return json(result);
    }
    if (/^\/api\/xray\/[^/]+\/card.png$/.test(url.pathname)) {
      const result = await xray.service.getRecord(url.pathname.split("/")[3]!);
      const { renderCardPng } =
        await import("../../../../services/api/src/cards/render.js");
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(Buffer.from(await renderCardPng(result, "landscape")));
      return;
    }
    if (url.pathname === "/api/stream") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      response.write('event: ping\ndata: {"ts":1800000000}\n\n');
      request.on("close", () => response.end());
      return;
    }
    if (url.pathname === "/api/events") return json([]);
    return json({ error: "not_found" }, 404);
  } catch {
    return json({ error: "fixture_error" }, 500);
  }
});
if (process.argv[1] === fileURLToPath(import.meta.url))
  fixtureServer.listen(4174, "127.0.0.1", () =>
    console.log("Fixture API ready on 4174"),
  );
