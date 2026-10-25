import fs from "node:fs";
import path from "node:path";

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  /** Epoch milliseconds when the access token expires. */
  expires_at: number;
  token_type: string;
  scope: string;
}

export function readTokens(filePath: string): StoredTokens | null {
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as StoredTokens;
  if (!parsed?.access_token || typeof parsed.expires_at !== "number") return null;
  return parsed;
}

export function writeTokens(filePath: string, tokens: StoredTokens): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, 0o600);
}
