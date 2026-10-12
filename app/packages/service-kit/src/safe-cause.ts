const REDACTED = "<redacted>";
const stableCode = /^[a-z][a-z0-9_]{2,63}$/;
const systemCode = /^(?:[A-Z][A-Z0-9_]{2,63}|[0-9A-Z]{5})$/;

export interface SafeCause {
  code: string;
  detail: string;
}

// Read data properties only: diagnostics must never invoke a getter or toJSON.
function textProperty(value: unknown, name: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  let object: object | null = value;
  for (let depth = 0; object && depth < 5; depth++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (descriptor)
      return typeof descriptor.value === "string"
        ? descriptor.value
        : undefined;
    object = Object.getPrototypeOf(object) as object | null;
  }
  return undefined;
}

function redact(message: string): string {
  let result = message;
  // Also cover opaque credentials appearing without a label, including startup.
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      /API[_-]?KEY|TOKEN|PASSWORD|SECRET|KEYPAIR|LOG_IP_SALT/i.test(name)
    )
      result = result.split(value).join(REDACTED);
  }
  return (
    result
      // JSON.parse may quote a request body or a malformed credential in its error.
      .replace(
        /Unexpected token[\s\S]*is not valid JSON/gi,
        "Unexpected token <redacted> in JSON",
      )
      .replace(/\b[a-z][a-z0-9+.-]*%3a%2f%2f[^\s"'<>]+/gi, REDACTED)
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, REDACTED)
      .replace(/\b(?:mailto|data):[^\s"'<>]+/gi, REDACTED)
      .replace(/\[(?:\s*\d+\s*,){63}\s*\d+\s*\]/g, REDACTED)
      .replace(/\b[1-9A-HJ-NP-Za-km-z]{81,}\b/g, REDACTED)
      .replace(/\b(?:bearer|basic)\s+[^\s,;"'<>]+/gi, REDACTED)
      .replace(
        /\b(?:[a-z0-9]+[-_])*(?:api[-_]?key|(?:access|refresh|auth|id)?token|password|secret|authorization)\b["']?\s*[:=]\s*(?:<redacted>|"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;<>]+)/gi,
        REDACTED,
      )
      .replace(
        /\b(?:access[-_]?|refresh[-_]?|auth[-_]?|id[-_]?)?token\s+[^\s,;"'<>]+/gi,
        REDACTED,
      )
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g,
        REDACTED,
      )
      .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, REDACTED)
      .replace(
        /\b(?:sk|pk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]+\b/g,
        REDACTED,
      )
      .replace(/[A-Za-z0-9_+/-]{32,}={0,2}/g, (candidate) =>
        stableCode.test(candidate) && candidate.includes("_")
          ? candidate
          : REDACTED,
      )
      // eslint-disable-next-line no-control-regex -- Remove log control characters.
      .replace(/[\u0000-\u001f\u007f]/g, " ")
  );
}

/** No stack, request body, or arbitrary error fields cross this boundary. */
export function safeCause(error: unknown): SafeCause {
  try {
    const message =
      typeof error === "string"
        ? error
        : (textProperty(error, "message") ?? "");
    const detail = redact(message);
    const suppliedCode = textProperty(error, "code");
    const name = textProperty(error, "name");
    const code =
      suppliedCode &&
      (stableCode.test(suppliedCode) || systemCode.test(suppliedCode)) &&
      redact(suppliedCode) === suppliedCode
        ? suppliedCode
        : stableCode.test(message) && detail === message
          ? message
          : name &&
              /^[A-Za-z][A-Za-z0-9]{2,63}$/.test(name) &&
              redact(name) === name
            ? name
            : "unknown_error";
    return { code, detail: detail.slice(0, 200) };
  } catch {
    return { code: "unknown_error", detail: "" };
  }
}

/** Fallback for boundaries that do not yet have a service logger. */
export function warnCause(reason: string, error: unknown): void {
  try {
    process.stderr.write(
      `${JSON.stringify({ level: "warn", reason, cause: safeCause(error) })}\n`,
    );
  } catch {
    // A broken diagnostic sink must not change the original fallback or throw.
  }
}
