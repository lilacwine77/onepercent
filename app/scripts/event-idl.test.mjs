import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { eventIdl, eventTypes, writeEventIdl } from "./event-idl.mjs";
import { PROGRAM_IDS } from "./anchor-cluster.mjs";

const app = new URL("../", import.meta.url);
const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, app), "utf8"));

async function snapshots() {
  return Promise.all([
    readJson("packages/sdk/src/events/m1.json"),
    readJson("packages/sdk/src/events/m2-provisional.json"),
    readJson("packages/sdk/src/events/m4.json"),
    readJson("packages/sdk/src/events/p3.json"),
  ]);
}

function joined(idls) {
  return {
    ...idls[0],
    events: idls.flatMap((idl) => idl.events),
    types: idls.flatMap((idl) => idl.types),
  };
}

function canonical(idl) {
  const final = eventIdl(idl);
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    ...final,
    events: [...final.events].sort(byName),
    types: [...final.types].sort(byName),
  };
}

test("generated events equal the committed final IDL, including referenced types", async () => {
  const idl = await readJson("packages/sdk/src/idl/onepercent.json");
  const idls = await snapshots();
  assert.equal(idl.address, PROGRAM_IDS.localnet);
  assert.equal(idls[0].address, PROGRAM_IDS.localnet);
  for (const artifact of idls)
    if (artifact.address !== undefined)
      assert.equal(artifact.address, PROGRAM_IDS.localnet);
  const snapshot = joined(idls);
  assert.deepEqual(canonical(snapshot), canonical(idl));
  assert.equal(snapshot.events.length, 40);
  assert(snapshot.events.some(({ name }) => name === "ReferralRedirected"));
  for (const name of [
    "ExecBegun",
    "ExecEnded",
    "SoldBack",
    "CardFedBack",
    "OwedWithdrawn",
    "BinderClosed",
  ]) {
    assert(
      snapshot.events.some((event) => event.name === name),
      name,
    );
  }
});

test(
  "generated events equal target/idl after a program build",
  {
    skip: !existsSync(new URL("target/idl/onepercent.json", app)),
  },
  async () => {
    const idl = await readJson("target/idl/onepercent.json");
    // Cluster builds emit their selected identity; committed SDK artifacts stay
    // localnet. Check the identity explicitly before comparing the complete ABI.
    assert(
      [PROGRAM_IDS.localnet, PROGRAM_IDS.devnet].includes(idl.address),
      "Unknown generated deployment identity",
    );
    assert.deepEqual(
      canonical(joined(await snapshots())),
      canonical({ ...idl, address: PROGRAM_IDS.localnet }),
    );
  },
);

test("event TypeScript shapes and names use only the final program IDL", async () => {
  const idls = await snapshots();
  assert.equal(
    await readFile(new URL("packages/sdk/src/events/types.ts", app), "utf8"),
    await eventTypes(idls),
  );
});

function sampleIdl() {
  return {
    address: "11111111111111111111111111111111",
    metadata: { name: "onepercent", version: "0.0.0", spec: "0.1.0" },
    instructions: [],
    events: [{ name: "SoldBack", discriminator: [1, 2, 3, 4, 5, 6, 7, 8] }],
    types: [
      {
        name: "SoldBack",
        type: {
          kind: "struct",
          fields: [{ name: "receipt", type: { defined: { name: "Receipt" } } }],
        },
      },
      {
        name: "Receipt",
        type: { kind: "struct", fields: [{ name: "amount", type: "u64" }] },
      },
      { name: "Unused", type: { kind: "struct", fields: [] } },
    ],
  };
}

test("event generation keeps transitive types once and excludes unrelated types", async () => {
  const final = eventIdl(sampleIdl());
  assert.deepEqual(
    final.types.map(({ name }) => name),
    ["SoldBack", "Receipt"],
  );
  const types = await eventTypes([final]);
  assert.equal(types.match(/export interface SoldBack\b/g)?.length, 1);
  assert.equal(types.match(/export interface Receipt\b/g)?.length, 1);
  assert(!types.includes("Unused"));
});

test("event generation rejects duplicate types, names and discriminators", () => {
  const idl = sampleIdl();
  assert.throws(
    () => eventIdl({ ...idl, types: [...idl.types, idl.types[0]] }),
    /Duplicate event type definitions/,
  );
  assert.throws(
    () => eventIdl({ ...idl, events: [...idl.events, idl.events[0]] }),
    /Duplicate event names/,
  );
  assert.throws(
    () =>
      eventIdl({
        ...idl,
        events: [...idl.events, { ...idl.events[0], name: "Other" }],
      }),
    /Duplicate event discriminators/,
  );
});

test("event generation partitions the final ABI without duplicate event definitions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "onepercent-event-idl-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const appDirectory = pathToFileURL(`${directory}/`);
  const eventsDirectory = new URL("packages/sdk/src/events/", appDirectory);
  await mkdir(eventsDirectory, { recursive: true });
  const previous = await snapshots();
  const legacyPath = new URL("m2-provisional.json", eventsDirectory);
  await writeFile(legacyPath, JSON.stringify(previous[1]));
  const idl = joined(previous);
  await writeEventIdl(idl, appDirectory);
  const generated = await Promise.all(
    ["m1.json", "m2-provisional.json", "m4.json", "p3.json"].map(async (path) =>
      JSON.parse(await readFile(new URL(path, eventsDirectory), "utf8")),
    ),
  );
  assert.deepEqual(canonical(joined(generated)), canonical(idl));
  assert.deepEqual(generated, previous);
  assert.equal(
    new Set(joined(generated).events.map(({ name }) => name)).size,
    40,
  );
  const definitions = joined(generated).types;
  assert.equal(
    new Set(definitions.map(({ name }) => name)).size,
    definitions.length,
  );
  assert.equal(
    await readFile(new URL("types.ts", eventsDirectory), "utf8"),
    await eventTypes(generated),
  );
  const oldSnapshot = await readFile(legacyPath, "utf8");
  const changed = structuredClone(idl);
  changed.types.find(({ name }) => name === "SoldBack").type.fields.reverse();
  await assert.rejects(
    writeEventIdl(changed, appDirectory),
    /Final IDL differs from the S1 event ABI: SoldBack/,
  );
  assert.equal(await readFile(legacyPath, "utf8"), oldSnapshot);
});

test("the shared S1 and S4 name table covers the final IDL exactly once", async () => {
  const idl = await readJson("packages/sdk/src/idl/onepercent.json");
  const source = await readFile(
    new URL("packages/sdk/src/events/names.ts", app),
    "utf8",
  );
  const table = source.match(
    /export const ONEPERCENT_EVENT_STREAM_EVENTS = \{([\s\S]*?)\n\} as const/,
  )?.[1];
  assert(table, "Missing shared event name table");
  const names = [...table.matchAll(/^ {2}([A-Za-z0-9_]+): /gm)].map(
    (match) => match[1],
  );
  assert.equal(names.length, 40);
  assert.deepEqual(names.sort(), idl.events.map(({ name }) => name).sort());
  assert.equal(new Set(names).size, names.length);
  const publicSource = await readFile(
    new URL("services/api/src/public/events.ts", app),
    "utf8",
  );
  assert(
    publicSource.includes("onepercentEventStreamName(row.name, row.data)"),
  );
  assert(publicSource.includes('from "@onepercent/sdk/events"'));
});
