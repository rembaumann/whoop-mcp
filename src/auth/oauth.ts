import { randomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_SCOPES, AUTH_URL, TOKEN_URL } from "./config.js";
import { redactSecrets } from "./redact.js";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  authUrl?: string;
  tokenUrl?: string;
  scopes?: readonly string[];
}

/**
 * WHOOP OAuth 2.0 authorization-code client.
 *
 * WHOOP documents the token endpoint fields as a JSON sample and cites
 * RFC 6749. The RFC requires `application/x-www-form-urlencoded`, and that
 * is the body this client sends. The `offline` scope is required for a
 * refresh token.
 *
 * WHOOP also documents that `state` must be eight characters when the app
 * generates it.
 */
export class OAuthClient {
  readonly scopes: readonly string[];
  private readonly fetchImpl: typeof fetch;
  private readonly authUrl: string;
  private readonly tokenUrl: string;

  constructor(private readonly options: OAuthClientOptions) {
    this.scopes = options.scopes ?? DEFAULT_SCOPES;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.authUrl = options.authUrl ?? AUTH_URL;
    this.tokenUrl = options.tokenUrl ?? TOKEN_URL;
  }

  authorizationUrl(state: string): string {
    if (state.length !== 8) {
      throw new Error("WHOOP requires the OAuth state parameter to be exactly 8 characters.");
    }
    const url = new URL(this.authUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("scope", this.scopes.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<TokenResponse> {
    return this.postToken({
      grant_type: "authorization_code",
      code,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      redirect_uri: this.options.redirectUri,
    });
  }

  /**
   * Refresh and rotate tokens. The scope sent here is the previously granted
   * scope (including the data scopes). WHOOP's sample only shows `offline`;
   * sending only that scope would drop access to recovery, sleep, and the rest.
   */
  async refresh(refreshToken: string, scope: string): Promise<TokenResponse> {
    return this.postToken(
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        scope: scope || this.scopes.join(" "),
      },
      [refreshToken],
    );
  }

  private async postToken(
    fields: Record<string, string>,
    extraSecrets: string[] = [],
  ): Promise<TokenResponse> {
    const response = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
    });
    const text = await response.text();
    if (!response.ok) {
      const redacted = redactSecrets(text, [
        this.options.clientSecret,
        this.options.clientId,
        fields.code,
        fields.refresh_token,
        ...extraSecrets,
      ]).slice(0, 500);
      throw new Error(
        `WHOOP token request failed (${response.status} ${response.statusText}). ${redacted}`.trim(),
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("WHOOP token endpoint returned a response that was not JSON.");
    }
    if (!isTokenResponse(body)) {
      throw new Error("WHOOP token endpoint response did not include an access_token.");
    }
    return body;
  }
}

export function createOAuthState(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const chars: string[] = [];
  while (chars.length < 8) {
    const bytes = randomBytes(16);
    for (const byte of bytes) {
      // 62 * 4 = 248, so values 0–247 map evenly onto the alphabet.
      if (byte < 248 && chars.length < 8) {
        chars.push(alphabet[byte % alphabet.length]!);
      }
    }
  }
  return chars.join("");
}

export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isTokenResponse(value: unknown): value is TokenResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.access_token === "string" && record.access_token.length > 0;
}
