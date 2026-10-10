import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SCOPES } from "./config.js";
import { OAuthClient } from "./oauth.js";
import { redactSecrets } from "./redact.js";
import { TokenStore, type StoredTokens } from "./store.js";

const EXPIRY_SKEW_MS = 60_000;
const LOCK_STALE_MS = 30_000;

export interface TokenManagerOptions {
  store: TokenStore;
  oauth: OAuthClient;
  /** Clock override for tests. */
  now?: () => number;
}

/**
 * Loads a stored access token and refreshes it before use.
 *
 * WHOOP rotates refresh tokens and invalidates the previous access token as
 * soon as a refresh succeeds. Concurrent refreshes are serialized with an
 * in-process promise and a lock file so a second request reuses the new pair
 * instead of presenting the already-spent refresh token.
 */
export class TokenManager {
  private inFlight: Promise<StoredTokens> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: TokenManagerOptions) {
    this.now = options.now ?? Date.now;
  }

  async getAccessToken(): Promise<string> {
    const current = await this.options.store.read();
    if (!current) {
      throw new Error(
        "Not signed in to WHOOP. Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET, then run `whoop-mcp login`.",
      );
    }
    if (current.expires_at - this.now() > EXPIRY_SKEW_MS) {
      return current.access_token;
    }
    const refreshed = await this.refresh(current.access_token);
    return refreshed.access_token;
  }

  /**
   * Refresh even if the local expiry still looks valid. Used after WHOOP
   * returns 401. If another caller already rotated the token, this returns
   * the new access token without spending the refresh token again.
   */
  async forceRefresh(staleAccessToken: string): Promise<string> {
    const refreshed = await this.refresh(staleAccessToken);
    return refreshed.access_token;
  }

  async current(): Promise<StoredTokens | null> {
    return this.options.store.read();
  }

  private refresh(staleAccessToken: string): Promise<StoredTokens> {
    if (!this.inFlight) {
      this.inFlight = this.refreshLocked(staleAccessToken).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async refreshLocked(staleAccessToken: string): Promise<StoredTokens> {
    const lockPath = `${this.options.store.filePath}.lock`;
    return withFileLock(lockPath, async () => {
      const current = await this.options.store.read();
      if (!current) {
        throw new Error("Not signed in to WHOOP. Run `whoop-mcp login`.");
      }
      const stillFresh = current.expires_at - this.now() > EXPIRY_SKEW_MS;
      if (current.access_token !== staleAccessToken && stillFresh) {
        return current;
      }
      const scope = ensureOffline(current.scope || DEFAULT_SCOPES.join(" "));
      let response;
      try {
        response = await this.options.oauth.refresh(current.refresh_token, scope);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          redactSecrets(`${message} Run \`whoop-mcp login\` if the refresh token is no longer valid.`, [
            current.access_token,
            current.refresh_token,
          ]),
        );
      }
      const stored: StoredTokens = {
        access_token: response.access_token,
        refresh_token: response.refresh_token || current.refresh_token,
        expires_at: this.now() + (response.expires_in || 3600) * 1000,
        token_type: response.token_type || "bearer",
        scope: response.scope || scope,
      };
      await this.options.store.write(stored);
      return stored;
    });
  }
}

function ensureOffline(scope: string): string {
  const parts = scope.split(/\s+/).filter(Boolean);
  if (!parts.includes("offline")) parts.push("offline");
  return parts.join(" ");
}

async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(String(process.pid));
        return await fn();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() - started > 15_000) {
        throw new Error("Timed out waiting to refresh the WHOOP access token.");
      }
      await delay(40 + Math.floor(Math.random() * 40));
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
