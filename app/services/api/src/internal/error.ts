export class SignerError extends Error {
  constructor(
    readonly status: 400 | 401 | 429 | 503,
    readonly reason: string,
    readonly retryAfterS?: number,
    readonly asOfSlot: number | null = null,
  ) {
    super(reason);
    this.name = "SignerError";
  }
}
