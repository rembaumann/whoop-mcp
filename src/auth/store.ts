import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch milliseconds when the access token expires. */
  expires_at: number;
  token_type: string;
  scope: string;
}

export class TokenStore {
  constructor(readonly filePath: string) {}

  async read(): Promise<StoredTokens | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Token file ${this.filePath} is not valid JSON. Run \`whoop-mcp login\` again.`,
      );
    }
    if (!isStoredTokens(parsed)) {
      throw new Error(
        `Token file ${this.filePath} is missing access_token or refresh_token. Run \`whoop-mcp login\` again.`,
      );
    }
    return parsed;
  }

  async write(tokens: StoredTokens): Promise<void> {
    const directory = path.dirname(this.filePath);
    // Only tighten a directory we created, or the dedicated ~/.whoop-mcp folder.
    // Never chmod an unrelated parent such as /tmp when WHOOP_TOKEN_PATH points there.
    const created = await mkdir(directory, { recursive: true, mode: 0o700 });
    if (created || path.basename(directory) === ".whoop-mcp") {
      await chmod(directory, 0o700);
    }
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(tokens, null, 2) + "\n", {
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600);
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

function isStoredTokens(value: unknown): value is StoredTokens {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.access_token === "string" &&
    record.access_token.length > 0 &&
    typeof record.refresh_token === "string" &&
    record.refresh_token.length > 0 &&
    typeof record.expires_at === "number" &&
    typeof record.token_type === "string" &&
    typeof record.scope === "string"
  );
}

export async function fileMode(filePath: string): Promise<number> {
  const info = await stat(filePath);
  return info.mode & 0o777;
}
