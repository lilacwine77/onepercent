// TODO(packages/copy): use M3's t() once its package is on this branch.
export const COPY = {
  "go.loading": "Opening the machine…",
  "go.expired":
    "This link expired or was already used. Send the command to the bot again.",
  "common.home": "Back to the machine",
  "common.networkError": "The machine didn’t answer. Try again.",
  "common.retry": "Try again",
  "errors.rateLimited": "Too many requests from here. Try again in {s} s.",
} as const;

export function rateLimitedCopy(seconds: number): string {
  return COPY["errors.rateLimited"].replace(
    "{s}",
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
      seconds,
    ),
  );
}
