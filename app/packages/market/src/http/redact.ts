/** Provider text is never needed for control flow beyond separately extracted flags. */
export function redact(
  message: string,
  secrets: readonly string[] = [],
): string {
  let safe = message;
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join("[REDACTED]");
  }
  return safe
    .replace(/Bearer\s+[^\s,;"']+/gi, "[REDACTED]")
    .replace(
      /(?:x-api-key|api[_-]?key|authorization)["']?\s*[:=]\s*["']?[^\s,;"']+/gi,
      "[REDACTED]",
    )
    .replace(/https?:\/\/[^\s<>"']+/gi, (candidate) => {
      try {
        return new URL(candidate).host;
      } catch {
        return "[REDACTED URL]";
      }
    });
}
