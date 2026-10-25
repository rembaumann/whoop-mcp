import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAuthorizeUrl, exchangeAuthorizationCode, normalizeRedirectUri, randomState, scrubSecrets } from "../src/auth/oauth.js";
import { readTokens, writeTokens } from "../src/auth/tokens.js";
import { WHOOP_SCOPES, type AppConfig } from "../src/config.js";
import { WhoopClient } from "../src/whoop/client.js";

function config(dir: string): AppConfig {
  return {
    clientId: "client-id",
    clientSecret: "super-secret-value",
    redirectUri: "http://127.0.0.1:8787/callback",
    timeZone: "UTC",
    dataDir: dir,
    apiBase: "https://api.prod.whoop.com/developer",
    tokenPath: path.join(dir, "tokens.json"),
    intentPath: path.join(dir, "intents.json"),
  };
}

test("redirect URI normalization drops a trailing slash and keeps the host", () => {
  assert.equal(normalizeRedirectUri("http://localhost:8080/callback/"), "http://localhost:8080/callback");
  assert.equal(normalizeRedirectUri("  http://127.0.0.1:8787/callback  "), "http://127.0.0.1:8787/callback");
  assert.notEqual(normalizeRedirectUri("http://localhost:8080/callback"), normalizeRedirectUri("http://127.0.0.1:8080/callback"));
});

test("authorize URL requests recovery, sleep, cycle, and offline scopes", () => {
  const app = config(fs.mkdtempSync(path.join(os.tmpdir(), "whoop-oauth-")));
  const state = randomState();
  assert.equal(state.length, 8);
  const url = new URL(buildAuthorizeUrl(app, state));
  assert.equal(url.origin + url.pathname, "https://api.prod.whoop.com/oauth/oauth2/auth");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), app.redirectUri);
  assert.equal(url.searchParams.get("state"), state);
  const scope = url.searchParams.get("scope") ?? "";
  for (const name of WHOOP_SCOPES) assert.ok(scope.split(" ").includes(name), name);
  assert.equal(url.searchParams.get("client_secret"), null);
});

test("authorization code exchange stores tokens and does not persist the client secret", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-token-"));
  const app = config(dir);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.equal(url, "https://api.prod.whoop.com/oauth/oauth2/token");
    assert.equal(init?.method, "POST");
    const body = String(init?.body);
    assert.match(body, /grant_type=authorization_code/);
    assert.match(body, /client_secret=super-secret-value/);
    return new Response(
      JSON.stringify({
        access_token: "access-123",
        refresh_token: "refresh-456",
        expires_in: 3600,
        token_type: "bearer",
        scope: WHOOP_SCOPES.join(" "),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const tokens = await exchangeAuthorizationCode(app, "auth-code", fetchImpl);
  assert.equal(tokens.access_token, "access-123");
  assert.equal(tokens.refresh_token, "refresh-456");
  const serialized = JSON.stringify(tokens);
  assert.equal(serialized.includes("super-secret-value"), false);
  assert.equal(scrubSecrets("failed for super-secret-value", app).includes("super-secret-value"), false);
});

test("Whoop client reads recovery, sleep, and cycles and does not write intents", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-client-"));
  const app = config(dir);
  fs.writeFileSync(
    app.tokenPath,
    JSON.stringify({
      access_token: "access-123",
      refresh_token: "refresh-456",
      expires_at: Date.now() + 3_600_000,
      token_type: "bearer",
      scope: WHOOP_SCOPES.join(" "),
    }),
  );

  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    assert.equal(init?.method, "GET");
    assert.match(url, /^https:\/\/api\.prod\.whoop\.com\/developer\/v2\//);
    return new Response(JSON.stringify({ records: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await new WhoopClient(app, fetchImpl).getDays("2026-03-01", "2026-03-15");
  assert.deepEqual(result.days, []);
  assert.deepEqual(result.errors, []);
  const paths = calls.map((call) => new URL(call.url).pathname).sort();
  assert.deepEqual(paths, ["/developer/v2/activity/sleep", "/developer/v2/cycle", "/developer/v2/recovery"]);
  assert.equal(fs.existsSync(app.intentPath), false);
  assert.equal(readTokens(app.tokenPath)?.access_token, "access-123");
});

test("expired token refresh stays on the official token host", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-refresh-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "expired-access",
    refresh_token: "refresh-456",
    expires_at: Date.now() - 1_000,
    token_type: "bearer",
    scope: WHOOP_SCOPES.join(" "),
  });

  const hosts: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    hosts.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
    if (url.host === "api.prod.whoop.com" && url.pathname === "/oauth/oauth2/token") {
      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "refresh-789",
          expires_in: 3600,
          token_type: "bearer",
          scope: WHOOP_SCOPES.join(" "),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    assert.equal(url.host, "api.prod.whoop.com");
    assert.equal(init?.method, "GET");
    const auth = new Headers(init?.headers).get("authorization");
    assert.equal(auth, "Bearer fresh-access");
    return new Response(JSON.stringify({ records: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await new WhoopClient(app, fetchImpl).getDays("2026-03-01", "2026-03-02");
  assert.deepEqual(result.errors, []);
  assert.ok(hosts.some((call) => call === "POST api.prod.whoop.com/oauth/oauth2/token"));
  assert.equal(hosts.some((call) => !call.includes("api.prod.whoop.com")), false);
  assert.equal(readTokens(app.tokenPath)?.access_token, "fresh-access");
  assert.equal(JSON.stringify(readTokens(app.tokenPath)).includes("super-secret-value"), false);
});
