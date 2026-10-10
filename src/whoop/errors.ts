export class WhoopApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "WhoopApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AuthRequiredError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Not signed in to WHOOP. Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET, then run `whoop-mcp login`.",
    );
    this.name = "AuthRequiredError";
  }
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
