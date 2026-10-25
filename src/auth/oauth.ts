import crypto from "node:crypto";
import http from "node:http";
import { WHOOP_AUTHORIZE_URL, WHOOP_SCOPES, WHOOP_TOKEN_URL, type AppConfig } from "../config.js";
import { readTokens, writeTokens, type StoredTokens } from "./tokens.js";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export function randomState(): string {
  return crypto.randomBytes(4).toString("hex");
}

export function buildAuthorizeUrl(config: AppConfig, state: string): string {
  if (!config.clientId || !config.redirectUri) {
    throw new Error("WHOOP_CLIENT_ID and WHOOP_REDIRECT_URI are required.");
  }
  if (state.length !== 8) {
    throw new Error("Whoop requires the OAuth state parameter to be 8 characters.");
  }
  const url = new URL(WHOOP_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", WHOOP_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeAuthorizationCode(
  config: AppConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredTokens> {
  return requestToken(
    config,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: required(config.redirectUri, "WHOOP_REDIRECT_URI"),
      client_id: required(config.clientId, "WHOOP_CLIENT_ID"),
      client_secret: required(config.clientSecret, "WHOOP_CLIENT_SECRET"),
    },
    fetchImpl,
  );
}

export async function refreshAccessToken(
  config: AppConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredTokens> {
  return requestToken(
    config,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: required(config.clientId, "WHOOP_CLIENT_ID"),
      client_secret: required(config.clientSecret, "WHOOP_CLIENT_SECRET"),
      scope: "offline",
    },
    fetchImpl,
  );
}

export async function runAuthFlow(config: AppConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  required(config.clientId, "WHOOP_CLIENT_ID");
  required(config.clientSecret, "WHOOP_CLIENT_SECRET");
  const redirectUri = required(config.redirectUri, "WHOOP_REDIRECT_URI");
  const state = randomState();
  const authorizeUrl = buildAuthorizeUrl(config, state);
  console.error("Open this URL to authorize Whoop (official OAuth only):");
  console.error(authorizeUrl);
  const code = await waitForAuthorizationCode(new URL(redirectUri), state);
  const tokens = await exchangeAuthorizationCode(config, code, fetchImpl);
  writeTokens(config.tokenPath, tokens);
  console.error(`Saved tokens to ${config.tokenPath}`);
}

export async function loadAccessToken(
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
  forceRefresh = false,
): Promise<string> {
  const stored = readTokens(config.tokenPath);
  if (!stored) {
    throw new Error("whoop_auth: no token stored. Run `npm run auth`.");
  }
  const stillValid = stored.expires_at - Date.now() > 60_000;
  if (!forceRefresh && stillValid) return stored.access_token;
  if (!stored.refresh_token) {
    throw new Error("whoop_auth: access token expired and no refresh token is stored. Run `npm run auth`.");
  }
  const refreshed = await refreshAccessToken(config, stored.refresh_token, fetchImpl);
  writeTokens(config.tokenPath, refreshed);
  return refreshed.access_token;
}

async function requestToken(
  config: AppConfig,
  fields: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<StoredTokens> {
  const body = new URLSearchParams(fields);
  const response = await fetchImpl(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await response.text();
  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`Whoop token endpoint returned HTTP ${response.status} with a non-JSON body.`);
  }
  if (!response.ok || !parsed.access_token) {
    const reason = parsed.error_description || parsed.error || `HTTP ${response.status}`;
    throw new Error(`Whoop token request failed: ${scrubSecrets(reason, config)}`);
  }
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
  const tokens: StoredTokens = {
    access_token: parsed.access_token,
    expires_at: Date.now() + expiresIn * 1000,
    token_type: parsed.token_type ?? "bearer",
    scope: parsed.scope ?? WHOOP_SCOPES.join(" "),
  };
  if (parsed.refresh_token) tokens.refresh_token = parsed.refresh_token;
  return tokens;
}

function waitForAuthorizationCode(redirect: URL, expectedState: string): Promise<string> {
  const port = redirect.port ? Number(redirect.port) : redirect.protocol === "https:" ? 443 : 80;
  const host = redirect.hostname;
  const pathname = redirect.pathname || "/";

  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname !== pathname) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Whoop authorization failed. You can close this window.");
        finish(new Error(`Whoop authorization failed: ${error}`));
        return;
      }
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (state !== expectedState || !code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Authorization response did not match this login attempt.");
        finish(new Error("OAuth state mismatch or missing code."));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>whoop-mcp</title><p>Whoop authorized. You can close this window.</p>");
      finish(null, code);
    });

    const timer = setTimeout(() => {
      finish(new Error("Timed out waiting for the Whoop redirect. Re-run `npm run auth`."));
    }, 180_000);

    function finish(err: Error | null, code?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (err) reject(err);
      else resolve(code ?? "");
    }

    server.on("error", (err) => finish(err));
    server.listen(port, host);
  });
}

function required(value: string | null, name: string): string {
  if (!value) throw new Error(`${name} is required. See .env.example.`);
  return value;
}

export function scrubSecrets(text: string, config: AppConfig): string {
  let out = text;
  for (const secret of [config.clientSecret, config.clientId]) {
    if (secret && secret.length > 3) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/access_token["'=:\s]+[A-Za-z0-9._\-]+/gi, "access_token=[redacted]");
}
