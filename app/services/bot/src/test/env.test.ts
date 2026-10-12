import "./setup.js";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../env.js";

describe("bot alerts flag", () => {
  it("enables alerts only for the exact on value", () => {
    expect(parseEnv({ FLAG_BOT_ALERTS: "on" }).FLAG_BOT_ALERTS).toBe("on");
  });
  it.each([undefined, "", "off", "ON", "true", "enabled", " on", "on "])(
    "treats %s as off without preventing startup",
    (value) => {
      expect(parseEnv({ FLAG_BOT_ALERTS: value }).FLAG_BOT_ALERTS).toBe("off");
    },
  );
});

describe("API origin transport", () => {
  it.each([
    "https://api.onepercent.test",
    "https://8.8.8.8",
    "http://localhost:3000",
    "http://api.localhost:3000",
    "http://api:3000",
    "http://api.internal:3000",
    "http://api.railway.internal:3000",
    "http://api.local:3000",
    "http://127.0.0.1:3000",
    "http://10.1.2.3:3000",
    "http://172.16.0.1:3000",
    "http://172.31.255.254:3000",
    "http://192.168.1.1:3000",
    "http://169.254.1.1:3000",
    "http://[::1]:3000",
    "http://[fc00::1]:3000",
    "http://[fd00::1]:3000",
    "http://[fe80::1]:3000",
  ])("accepts a secure or private origin (%s)", (url) => {
    expect(parseEnv({ PUBLIC_API_URL: url }).PUBLIC_API_URL).toBe(url);
  });
  it.each([
    "http://api.onepercent.test",
    "http://8.8.8.8",
    "http://172.15.255.255",
    "http://172.32.0.1",
    "http://192.169.0.1",
    "http://[2001:db8::1]",
    "http://127.0.0.1.public.test",
    "http://api.internal.public.test",
    "http://api.localhost.public.test",
    "https://user:password@api.onepercent.test",
    "https://api.onepercent.test/path",
  ])("rejects an insecure public or malformed origin (%s)", (url) => {
    expect(() => parseEnv({ PUBLIC_API_URL: url })).toThrow();
  });
});
