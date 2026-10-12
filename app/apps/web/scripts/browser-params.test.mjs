import assert from "node:assert/strict";
import test from "node:test";
import * as config from "@onepercent/config";
import { browserParams, browserParamsSource } from "./browser-params.mjs";

test("browser SDK parameters match source values exactly without carrying server configuration", async () => {
  const source = browserParamsSource();
  const projected = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  for (const [name, value] of Object.entries(projected)) {
    if (
      name === "SERVICES" ||
      name === "meteoraForCluster" ||
      name === "parseProgramCluster"
    )
      continue;
    assert.deepEqual(value, config[name], name);
  }
  assert.deepEqual(projected.SERVICES, {
    api: {
      rpcMaxDataSliceBytes: config.SERVICES.api.rpcMaxDataSliceBytes,
      rpcPerMinutePerIp: config.SERVICES.api.rpcPerMinutePerIp,
    },
    indexer: { deckChunkBytes: config.SERVICES.indexer.deckChunkBytes },
    transport: { rpcTimeoutMs: config.SERVICES.transport.rpcTimeoutMs },
    landing: { cuMarginBps: config.SERVICES.landing.cuMarginBps },
  });
  assert.equal(
    Number.isSafeInteger(projected.SERVICES.api.rpcPerMinutePerIp),
    true,
  );
  assert.ok(projected.SERVICES.api.rpcPerMinutePerIp > 0);
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("zod"), false);
  assert.equal(source.includes("import "), false);
  assert.equal(projected.servicesSchema, undefined);
  const plugin = browserParams();
  assert.equal(plugin.resolveId("@onepercent/config/web"), undefined);
  assert.equal(plugin.load(plugin.resolveId("@onepercent/config")), source);
});

test("M4 launch selectors preserve authoritative success and rejection without runtime server code", async () => {
  const compile = async (settings) =>
    import(
      `data:text/javascript;base64,${Buffer.from(browserParamsSource(settings)).toString("base64")}`
    );
  const current = await compile(config);
  if (!config.meteoraForCluster)
    assert.equal(current.meteoraForCluster, undefined);
  for (const reason of [
    "METEORA_DBC_CONFIG is PENDING for mainnet",
    "METEORA_DBC_CONFIG cannot use a test key on mainnet",
  ]) {
    const settings = {
      ...config,
      METEORA_BY_CLUSTER: {
        localnet: { dbcConfig: "local" },
        devnet: { dbcConfig: "dev" },
        mainnet: { dbcConfig: "PENDING" },
      },
      meteoraForCluster(cluster) {
        if (cluster === "mainnet") throw new Error(reason);
        return this.METEORA_BY_CLUSTER[cluster];
      },
    };
    const projected = await compile(settings);
    assert.deepEqual(
      projected.meteoraForCluster("localnet"),
      settings.meteoraForCluster("localnet"),
    );
    assert.deepEqual(
      projected.meteoraForCluster("devnet"),
      settings.meteoraForCluster("devnet"),
    );
    assert.throws(() => projected.meteoraForCluster("mainnet"), {
      message: reason,
    });
    assert.throws(
      () => projected.meteoraForCluster("toString"),
      /Unknown program cluster/,
    );
    assert.equal(browserParamsSource(settings).includes("process.env"), false);
  }
  if (config.meteoraForCluster)
    for (const cluster of ["localnet", "devnet", "mainnet"]) {
      try {
        assert.deepEqual(
          current.meteoraForCluster(cluster),
          config.meteoraForCluster(cluster),
        );
      } catch (error) {
        assert.throws(() => current.meteoraForCluster(cluster), {
          message: error.message,
        });
      }
    }
});

test("browser cluster parsing preserves SDK aliases and rejection", async () => {
  const projected = await import(
    `data:text/javascript;base64,${Buffer.from(browserParamsSource()).toString("base64")}`
  );
  for (const cluster of [
    undefined,
    "localnet",
    "devnet",
    "mainnet",
    "mainnet-beta",
  ])
    assert.equal(
      projected.parseProgramCluster(cluster),
      config.parseProgramCluster(cluster),
    );
  for (const cluster of ["", "unknown", "toString"])
    assert.throws(() => projected.parseProgramCluster(cluster));
});
