// Manual fixture exercise; excluded from the production API build and not a CI script.
import { serve } from "@hono/node-server";
import { checkBlinks } from "../check.js";
import { CHECK_STATES, createCheckFixture } from "./validation-fixtures.js";

let current = createCheckFixture("off");
const server = serve({
  fetch: (request) => current.fetch(request),
  hostname: "127.0.0.1",
  port: 0,
});
try {
  if (!server.listening)
    await new Promise<void>((yes) => server.once("listening", yes));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture HTTP listener unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  for (const state of CHECK_STATES) {
    current = createCheckFixture(state, origin);
    const result = await checkBlinks({ origin, cluster: "devnet" });
    console.log(`Fixture state: ${state}\n${result.sheet}`);
  }
  for (const state of ["empty", "busy"] as const) {
    current = createCheckFixture("covered5", origin, state);
    const result = await checkBlinks({ origin, cluster: "devnet" });
    console.log(`Fixture X-ray state: ${state}\n${result.sheet}`);
  }
} finally {
  await new Promise<void>((yes, no) =>
    server.close((error) => (error ? no(error) : yes())),
  );
}
