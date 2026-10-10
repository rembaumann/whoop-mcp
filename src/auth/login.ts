import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import type { WhoopAppConfig } from "./config.js";
import { createOAuthState, OAuthClient, statesMatch, type TokenResponse } from "./oauth.js";
import { TokenStore, type StoredTokens } from "./store.js";

export interface LoginOptions {
  config: WhoopAppConfig;
  store: TokenStore;
  oauth?: OAuthClient;
  openUrl?: (url: string) => Promise<void> | void;
  timeoutMs?: number;
  log?: (message: string) => void;
  now?: () => number;
}

export async function login(options: LoginOptions): Promise<StoredTokens> {
  const log = options.log ?? ((message) => console.log(message));
  const oauth =
    options.oauth ??
    new OAuthClient({
      clientId: options.config.clientId,
      clientSecret: options.config.clientSecret,
      redirectUri: options.config.redirectUri,
    });
  const redirect = new URL(options.config.redirectUri);
  const state = createOAuthState();
  const authorizationUrl = oauth.authorizationUrl(state);

  const callback = await startCallbackServer({
    hostname: redirect.hostname,
    port: Number(redirect.port),
    pathname: redirect.pathname,
    expectedState: state,
    timeoutMs: options.timeoutMs ?? 5 * 60 * 1000,
  });

  log("Opening your browser to authorize whoop-mcp with WHOOP.");
  log("If it does not open, visit this URL:\n");
  log(authorizationUrl);
  log("");

  const open = options.openUrl ?? openBrowser;
  const opened = Promise.resolve()
    .then(() => open(authorizationUrl))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log(`Could not open a browser (${message}). Use the URL above.`);
    });

  try {
    const code = await callback.code;
    const tokens = await oauth.exchangeAuthorizationCode(code);
    const stored = toStoredTokens(tokens, oauth.scopes.join(" "), options.now ?? Date.now);
    if (!stored.refresh_token) {
      throw new Error(
        "WHOOP did not return a refresh token. Authorize again and include the offline scope (whoop-mcp requests it automatically).",
      );
    }
    await options.store.write(stored);
    log(`Signed in. Tokens saved to ${options.store.filePath}`);
    return stored;
  } finally {
    await opened;
    await callback.close();
  }
}

export async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", reject);
    child.unref();
    resolve();
  });
}

function toStoredTokens(tokens: TokenResponse, fallbackScope: string, now: () => number): StoredTokens {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? "",
    expires_at: now() + (tokens.expires_in || 3600) * 1000,
    token_type: tokens.token_type || "bearer",
    scope: tokens.scope || fallbackScope,
  };
}

interface CallbackServer {
  code: Promise<string>;
  close: () => Promise<void>;
}

async function startCallbackServer(options: {
  hostname: string;
  port: number;
  pathname: string;
  expectedState: string;
  timeoutMs: number;
}): Promise<CallbackServer> {
  let settled = false;
  let resolveCode: (code: string) => void = () => {};
  let rejectCode: (error: Error) => void = () => {};
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    handleCallback(request, response, options, (error, authorizationCode) => {
      if (settled) return;
      settled = true;
      if (error) rejectCode(error);
      else resolveCode(authorizationCode!);
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.hostname, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    throw new Error(
      `Could not listen on ${options.hostname}:${options.port} for the OAuth callback. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCode(new Error("Timed out waiting for the WHOOP authorization redirect."));
  }, options.timeoutMs);

  return {
    code: code.finally(() => clearTimeout(timeout)),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function handleCallback(
  request: IncomingMessage,
  response: ServerResponse,
  options: { pathname: string; expectedState: string },
  done: (error: Error | null, code?: string) => void,
): void {
  const host = request.headers.host ?? "127.0.0.1";
  let url: URL;
  try {
    url = new URL(request.url ?? "/", `http://${host}`);
  } catch {
    sendHtml(response, 400, "Invalid request", "The callback URL could not be read.");
    done(new Error("Received an invalid OAuth callback URL."));
    return;
  }

  if (url.pathname !== options.pathname) {
    sendHtml(response, 404, "Not found", "This page is only the WHOOP login callback.");
    return;
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const description = url.searchParams.get("error_description") ?? oauthError;
    sendHtml(response, 400, "WHOOP authorization was not completed", escapeHtml(description));
    done(new Error(`WHOOP authorization was declined (${oauthError}).`));
    return;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (!code || !statesMatch(options.expectedState, state)) {
    sendHtml(
      response,
      400,
      "Authorization could not be verified",
      "The login state did not match. Close this window and run whoop-mcp login again.",
    );
    done(new Error("OAuth state did not match. Run `whoop-mcp login` again."));
    return;
  }

  sendHtml(
    response,
    200,
    "WHOOP connected",
    "whoop-mcp is authorized. You can close this window and return to the terminal.",
  );
  done(null, code);
}

function sendHtml(response: ServerResponse, status: number, title: string, body: string): void {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 15vh auto; max-width: 32rem; padding: 0 1.5rem; color: #1c1917; }
    h1 { font-size: 1.5rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${body}</p>
</body>
</html>`;
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
