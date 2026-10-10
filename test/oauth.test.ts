import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import { DEFAULT_SCOPES } from "../src/auth/config.js";
import { login } from "../src/auth/login.js";
import { createOAuthState, OAuthClient } from "../src/auth/oauth.js";
import { TokenStore, fileMode } from "../src/auth/store.js";
import { TokenManager } from "../src/auth/tokens.js";
import { tokenResponse } from "./fixtures.js";

const SECRET = "super-secret-client-value";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

describe("OAuth", () => {
  it("builds an authorize URL with an 8 character state and the offline scope", () => {
    const client = new OAuthClient({
      clientId: "client-id",
      clientSecret: SECRET,
      redirectUri: "http://127.0.0.1:8787/callback",
    });
    const state = createOAuthState();
    assert.equal(state.length, 8);
    const url = new URL(client.authorizationUrl(state));
    assert.equal(url.origin + url.pathname, "https://api.prod.whoop.com/oauth/oauth2/auth");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), state);
    assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:8787/callback");
    const scope = url.searchParams.get("scope") ?? "";
    for (const name of DEFAULT_SCOPES) assert.ok(scope.split(" ").includes(name), name);
  });

  it("exchanges the callback code and stores a refresh token without leaking the secret", async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const directory = await mkdtemp(path.join(tmpdir(), "whoop-mcp-"));
    const store = new TokenStore(path.join(directory, ".whoop-mcp", "tokens.json"));
    let tokenBody = "";

    const oauth = new OAuthClient({
      clientId: "client-id",
      clientSecret: SECRET,
      redirectUri,
      tokenUrl: "https://whoop.example/token",
      fetchImpl: async (_input, init) => {
        tokenBody = String(init?.body ?? "");
        const params = new URLSearchParams(tokenBody);
        assert.equal(params.get("grant_type"), "authorization_code");
        assert.equal(params.get("code"), "auth-code");
        assert.equal(params.get("redirect_uri"), redirectUri);
        assert.equal(init?.headers && new Headers(init.headers).get("content-type"), "application/x-www-form-urlencoded");
        if (params.get("code") === "fail") {
          return new Response(`invalid ${SECRET}`, { status: 400 });
        }
        return Response.json(tokenResponse);
      },
    });

    const logs: string[] = [];
    const stored = await login({
      config: {
        clientId: "client-id",
        clientSecret: SECRET,
        redirectUri,
        tokenPath: store.filePath,
      },
      store,
      oauth,
      log: (message) => logs.push(message),
      openUrl: async (authUrl) => {
        const url = new URL(authUrl);
        const callback = new URL(redirectUri);
        callback.searchParams.set("code", "auth-code");
        callback.searchParams.set("state", url.searchParams.get("state") ?? "");
        const response = await fetch(callback);
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /WHOOP connected/);
        assert.doesNotMatch(html, /auth-code/);
      },
    });

    assert.equal(stored.refresh_token, "refresh-token-value");
    assert.equal((await store.read())?.access_token, "access-token-value");
    assert.equal(await fileMode(store.filePath), 0o600);
    assert.equal(await fileMode(path.dirname(store.filePath)), 0o700);
    assert.ok(logs.some((line) => line.includes("state=")));
    assert.ok(tokenBody.includes("client_secret"));
    assert.equal(logs.join("\n").includes(SECRET), false);
  });

  it("rejects a callback whose state does not match", async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const directory = await mkdtemp(path.join(tmpdir(), "whoop-mcp-"));
    const store = new TokenStore(path.join(directory, "tokens.json"));
    const oauth = new OAuthClient({
      clientId: "client-id",
      clientSecret: SECRET,
      redirectUri,
      fetchImpl: async () => {
        throw new Error("token endpoint should not be called");
      },
    });

    await assert.rejects(
      () =>
        login({
          config: {
            clientId: "client-id",
            clientSecret: SECRET,
            redirectUri,
            tokenPath: store.filePath,
          },
          store,
          oauth,
          log: () => {},
          openUrl: async () => {
            const callback = new URL(redirectUri);
            callback.searchParams.set("code", "auth-code");
            callback.searchParams.set("state", "wrongst8");
            const response = await fetch(callback);
            assert.equal(response.status, 400);
          },
        }),
      /state did not match/,
    );
    assert.equal(await store.read(), null);
  });

  it("redacts the client secret from a failed token response", async () => {
    const oauth = new OAuthClient({
      clientId: "client-id",
      clientSecret: SECRET,
      redirectUri: "http://127.0.0.1:8787/callback",
      tokenUrl: "https://whoop.example/token",
      fetchImpl: async () => new Response(`bad secret ${SECRET} and refresh-token-value`, { status: 400 }),
    });
    await assert.rejects(() => oauth.refresh("refresh-token-value", "offline"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(SECRET), false);
      assert.equal(error.message.includes("refresh-token-value"), false);
      assert.match(error.message, /\[redacted\]/);
      return true;
    });
  });

  it("refreshes a shared token file once when two managers race", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "whoop-mcp-"));
    const store = new TokenStore(path.join(directory, "tokens.json"));
    const now = 1_700_000_000_000;
    await store.write({
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: now - 1000,
      token_type: "bearer",
      scope: "read:recovery offline",
    });

    let refreshCalls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      refreshCalls += 1;
      const params = new URLSearchParams(String(init?.body ?? ""));
      assert.equal(params.get("grant_type"), "refresh_token");
      assert.equal(params.get("refresh_token"), "old-refresh");
      assert.match(params.get("scope") ?? "", /read:recovery/);
      assert.match(params.get("scope") ?? "", /offline/);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        token_type: "bearer",
        scope: "read:recovery offline",
      });
    };

    const managers = [0, 1].map(
      () =>
        new TokenManager({
          store,
          now: () => now,
          oauth: new OAuthClient({
            clientId: "client-id",
            clientSecret: SECRET,
            redirectUri: "http://127.0.0.1:8787/callback",
            tokenUrl: "https://whoop.example/token",
            fetchImpl,
          }),
        }),
    );

    const accessTokens = await Promise.all(managers.map((manager) => manager.getAccessToken()));
    assert.deepEqual(accessTokens, ["new-access", "new-access"]);
    assert.equal(refreshCalls, 1);
    const saved = await store.read();
    assert.equal(saved?.refresh_token, "new-refresh");
    assert.equal(saved?.expires_at, now + 3600 * 1000);
  });
});
