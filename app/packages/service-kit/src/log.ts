import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { isIP } from "node:net";
import { format } from "node:util";
import pino, { type DestinationStream, type Logger } from "pino";
import bs58 from "bs58";

const REDACTED = "[redacted]";
const sensitiveName =
  /secret|privatekey|keypair|mnemonic|seedphrase|authorization|apikey|password|internaltoken|logipsalt|^token$|^body$|^requestbody$/i;
const ipName = /^(ip|clientip|remoteaddress|xforwardedfor|xrealip)$/i;
const urlPattern = /\b(?:https?|wss?|postgres(?:ql)?|rediss?):\/\/[^\s"<>]+/gi;

export function isEncodedKeypair(value: string): boolean {
  let bytes: Uint8Array | undefined;
  let der: Buffer | undefined;
  try {
    const encoded = value.trim();
    if (encoded.startsWith("[")) {
      const candidate: unknown = JSON.parse(encoded);
      if (
        !Array.isArray(candidate) ||
        candidate.length !== 64 ||
        !candidate.every(
          (byte: unknown) =>
            typeof byte === "number" &&
            Number.isInteger(byte) &&
            byte >= 0 &&
            byte <= 255,
        )
      )
        return false;
      bytes = Uint8Array.from(candidate as number[]);
    } else {
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(encoded)) return false;
      bytes = bs58.decode(encoded);
    }
    if (bytes.length !== 64) return false;
    der = Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      bytes.subarray(0, 32),
    ]);
    const publicKey = createPublicKey(
      createPrivateKey({ key: der, type: "pkcs8", format: "der" }),
    )
      .export({ type: "spki", format: "der" })
      .subarray(-32);
    return publicKey.equals(bytes.subarray(32));
  } catch {
    return false;
  } finally {
    bytes?.fill(0);
    der?.fill(0);
  }
}

export interface LogSanitizerOptions {
  ipSalt: string;
  secretValues?: readonly string[];
}

export interface ServiceLogBase {
  service: string;
  role: string;
  cluster: string;
  version: string;
  commit: string;
}

export function hashClientIp(ipSalt: string, ip: string): string {
  if (!ipSalt) throw new Error("LOG_IP_SALT is required");
  return createHash("sha256").update(ipSalt).update(ip).digest("hex");
}

/** All diagnostic boundaries use this before serializing untrusted values. */
export function sanitizeLogValue(
  value: unknown,
  options: LogSanitizerOptions,
): unknown {
  if (!options.ipSalt) throw new Error("LOG_IP_SALT is required");
  const seen = new WeakSet<object>();
  const secrets = (options.secretValues ?? []).filter(Boolean);
  const string = (input: string): string => {
    let result = input;
    for (const secret of secrets) result = result.split(secret).join(REDACTED);
    result = result.replace(urlPattern, (url) => {
      try {
        return new URL(url).host;
      } catch {
        return "[invalid-url]";
      }
    });
    result = result
      .replace(/\bapi[-_]?key\s*=[^\s&;,]*/gi, REDACTED)
      .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
      .replace(/\b[1-9A-HJ-NP-Za-km-z]{64,88}\b/g, (candidate) =>
        isEncodedKeypair(candidate) ? REDACTED : candidate,
      )
      .replace(/\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/g, (candidate) =>
        (JSON.parse(candidate) as number[]).every((byte) => byte <= 255)
          ? REDACTED
          : candidate,
      );
    return isIP(result) ? hashClientIp(options.ipSalt, result) : result;
  };
  const visit = (input: unknown, key = ""): unknown => {
    const normalized = key.replace(/[^a-z0-9]/gi, "");
    if (sensitiveName.test(normalized)) return REDACTED;
    if (ipName.test(normalized) && typeof input === "string") {
      return hashClientIp(options.ipSalt, input);
    }
    if (typeof input === "string") return string(input);
    if (typeof input === "bigint") return input.toString();
    if (input === null || typeof input !== "object") return input;
    if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer)
      return REDACTED;
    if (input instanceof URL) return input.host;
    if (input instanceof Date) return input.toISOString();
    if (seen.has(input)) return "[circular]";
    seen.add(input);
    if (input instanceof Error) {
      return {
        type: string(input.name),
        message: string(input.message),
        ...(input.stack ? { stack: string(input.stack) } : {}),
        ...(input.cause === undefined ? {} : { cause: visit(input.cause) }),
      };
    }
    if (Array.isArray(input)) {
      if (
        input.length === 64 &&
        input.every(
          (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
        )
      )
        return REDACTED;
      return input.map((item) => visit(item));
    }
    const output: Record<string, unknown> = {};
    for (const [name, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(input),
    )) {
      // Do not invoke an untrusted object's getters or toJSON during logging.
      if (
        [
          "toJSON",
          "__proto__",
          "prototype",
          "constructor",
          "hasOwnProperty",
        ].includes(name) ||
        typeof descriptor.value === "function"
      )
        continue;
      output[string(name)] =
        "value" in descriptor ? visit(descriptor.value, name) : REDACTED;
    }
    return output;
  };
  return visit(value);
}

export function createServiceLogger(
  base: ServiceLogBase,
  options: LogSanitizerOptions & {
    level?: string;
    destination?: DestinationStream;
  },
): Logger {
  const sanitize = (value: unknown) => sanitizeLogValue(value, options);
  const fields = (value: unknown): Record<string, unknown> => {
    const output = sanitize(value) as Record<string, unknown>;
    for (const key of Object.keys(base)) delete output[key];
    return output;
  };
  const logger = pino(
    {
      level: options.level ?? "info",
      base: sanitize(base) as ServiceLogBase,
      hooks: {
        logMethod(args, method) {
          const [first, ...rest] = args;
          if (first !== null && typeof first === "object") {
            const object = first instanceof Error ? { err: first } : first;
            method.call(
              this,
              fields(object),
              sanitize(format(...rest.map(sanitize))) as string,
            );
          } else {
            method.call(
              this,
              sanitize(format(...args.map(sanitize))) as string,
            );
          }
        },
      },
    },
    options.destination,
  );
  function secureBindings<Levels extends string>(
    instance: Logger<Levels>,
  ): Logger<Levels> {
    const child = instance.child.bind(instance);
    instance.child = (bindings, childOptions) =>
      secureBindings(child(fields(bindings), childOptions));
    const setBindings = instance.setBindings.bind(instance);
    instance.setBindings = (bindings) => setBindings(fields(bindings));
    return instance;
  }
  return secureBindings(logger);
}
