import { expect, it } from "vitest";
import { ItemLimiter, WEB_LIMITER_MAX_IPS } from "./limits.js";
it("enforces a rolling item budget without spending a partially admitted batch", () => {
  let now = 0;
  const limiter = new ItemLimiter(5, () => now);
  expect(limiter.take("a", 2).allowed).toBe(true);
  now = 30_000;
  expect(limiter.take("a", 2).allowed).toBe(true);
  expect(limiter.take("a", 2)).toEqual({ allowed: false, retryAfter: 30 });
  expect(limiter.take("a", 1).allowed).toBe(true);
  now = 60_000;
  expect(limiter.take("a", 3)).toEqual({ allowed: false, retryAfter: 30 });
  expect(limiter.take("a", 2).allowed).toBe(true);
  expect(limiter.take("b", 5).allowed).toBe(true);
});
it("expires only oldest inactive buckets while preserving an active IP at capacity", () => {
  let now = 0;
  const limiter = new ItemLimiter(2, () => now);
  for (let i = 0; i < WEB_LIMITER_MAX_IPS; i++)
    expect(limiter.take(String(i)).allowed).toBe(true);
  now = 30_000;
  expect(limiter.take("0").allowed).toBe(true);
  expect(limiter.take("new").allowed).toBe(false);
  now = 60_000;
  expect(limiter.take("new").allowed).toBe(true);
  expect(limiter.take("0", 2)).toEqual({ allowed: false, retryAfter: 30 });
  expect(limiter.take("0").allowed).toBe(true);
});
