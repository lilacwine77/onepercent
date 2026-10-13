import assert from "node:assert/strict";
import test from "node:test";
import { MACHINE_OPENS_AT, countdownAt } from "../src/launch-countdown.js";

test("launch is October 13 at 17:45 UTC, with tabular time parts", () => {
  assert.equal(
    new Date(MACHINE_OPENS_AT).toISOString(),
    "2026-10-13T17:45:00.000Z",
  );
  assert.deepEqual(countdownAt(Date.parse("2026-10-13T14:42:53Z")), {
    live: false,
    parts: ["03", "02", "07"],
  });
});

test("the final partial second stays closed and zero opens the Machine", () => {
  assert.deepEqual(countdownAt(MACHINE_OPENS_AT - 1), {
    live: false,
    parts: ["00", "00", "01"],
  });
  for (const now of [MACHINE_OPENS_AT, MACHINE_OPENS_AT + 60_000]) {
    assert.deepEqual(countdownAt(now), {
      live: true,
      parts: ["00", "00", "00"],
    });
  }
});

test("a delayed update uses elapsed wall time, including hour rollover", () => {
  assert.deepEqual(countdownAt(MACHINE_OPENS_AT - 3_600_000).parts, [
    "01",
    "00",
    "00",
  ]);
  assert.deepEqual(countdownAt(MACHINE_OPENS_AT - 3_585_000).parts, [
    "00",
    "59",
    "45",
  ]);
  assert.deepEqual(countdownAt(MACHINE_OPENS_AT - 90_061_000).parts, [
    "25",
    "01",
    "01",
  ]);
});
