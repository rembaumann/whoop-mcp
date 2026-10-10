import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Scopes required to read every resource this server exposes, plus refresh tokens. */
export const DEFAULT_SCOPES = [
  "read:profile",
  "read:body_measurement",
  "read:cycles",
  "read:recovery",
  "read:sleep",
  "read:workout",
  "offline",
] as const;

export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8787/callback";

export const API_BASE_URL = "https://api.prod.whoop.com/developer";
export const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

export interface WhoopAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenPath: string;
  configPath?: string;
}

interface ConfigFile {
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
}

export function defaultConfigDir(): string {
  return path.join(os.homedir(), ".whoop-mcp");
}

export function defaultTokenPath(): string {
  return path.join(defaultConfigDir(), "tokens.json");
}

export function defaultConfigPath(): string {
  return process.env.WHOOP_CONFIG_PATH?.trim() || path.join(defaultConfigDir(), "config.json");
}

/**
 * Credentials come from the environment first, then ~/.whoop-mcp/config.json.
 * Nothing in this repository stores a client secret.
 */
export async function loadConfig(): Promise<WhoopAppConfig> {
  const configPath = defaultConfigPath();
  const file = await readConfigFile(configPath);

  const clientId = process.env.WHOOP_CLIENT_ID?.trim() || file?.client_id?.trim() || "";
  const clientSecret = process.env.WHOOP_CLIENT_SECRET?.trim() || file?.client_secret?.trim() || "";
  const redirectUri =
    process.env.WHOOP_REDIRECT_URI?.trim() || file?.redirect_uri?.trim() || DEFAULT_REDIRECT_URI;
  const tokenPath = process.env.WHOOP_TOKEN_PATH?.trim() || defaultTokenPath();

  if (!clientId || !clientSecret) {
    throw new Error(
      [
        "Missing WHOOP client credentials.",
        "Create an app at https://developer-dashboard.whoop.com/ and then either:",
        "  export WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET",
        `  or copy config.example.json to ${configPath}`,
        "The redirect URI must be registered on that app. Default: " + DEFAULT_REDIRECT_URI,
      ].join("\n"),
    );
  }

  validateRedirectUri(redirectUri);

  return {
    clientId,
    clientSecret,
    redirectUri,
    tokenPath,
    configPath: file ? configPath : undefined,
  };
}

export function validateRedirectUri(redirectUri: string): URL {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new Error(`WHOOP_REDIRECT_URI is not a valid URL: ${redirectUri}`);
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !local) {
    throw new Error(
      `The local login command only supports http://127.0.0.1 or http://localhost redirect URIs so it can catch the callback. Received: ${redirectUri}`,
    );
  }
  if (!url.port) {
    throw new Error(`WHOOP_REDIRECT_URI must include a port. Received: ${redirectUri}`);
  }
  return url;
}

async function readConfigFile(configPath: string): Promise<ConfigFile | undefined> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse ${configPath} as JSON.`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${configPath} must be a JSON object with client_id and client_secret.`);
  }
  return parsed as ConfigFile;
}
