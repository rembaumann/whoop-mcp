import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Scopes for recovery, sleep, and cycle/strain, plus offline so refresh tokens are issued. */
export const WHOOP_SCOPES = ["read:recovery", "read:sleep", "read:cycles", "offline"] as const;

export const WHOOP_AUTHORIZE_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
export const DEFAULT_API_BASE = "https://api.prod.whoop.com/developer";

export interface AppConfig {
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  timeZone: string;
  dataDir: string;
  apiBase: string;
  tokenPath: string;
  intentPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const fileEnv = readDotEnv(path.join(cwd, ".env"));
  const get = (key: string) => {
    const fromEnv = env[key];
    if (fromEnv != null && fromEnv !== "") return fromEnv;
    return fileEnv[key] ?? "";
  };
  const dataDir = get("WHOOP_DATA_DIR") || path.join(os.homedir(), ".whoop-mcp");
  return {
    clientId: emptyToNull(get("WHOOP_CLIENT_ID")),
    clientSecret: emptyToNull(get("WHOOP_CLIENT_SECRET")),
    redirectUri: emptyToNull(get("WHOOP_REDIRECT_URI")),
    timeZone: get("WHOOP_TIMEZONE") || env.TZ || "UTC",
    dataDir,
    apiBase: (get("WHOOP_API_BASE") || DEFAULT_API_BASE).replace(/\/$/, ""),
    tokenPath: path.join(dataDir, "tokens.json"),
    intentPath: path.join(dataDir, "intents.json"),
  };
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Minimal KEY=VALUE loader. Does not expand variables or override existing process env. */
export function readDotEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
