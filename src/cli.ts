#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type WhoopAppConfig } from "./auth/config.js";
import { login } from "./auth/login.js";
import { OAuthClient } from "./auth/oauth.js";
import { TokenStore } from "./auth/store.js";
import { TokenManager } from "./auth/tokens.js";
import { startHttpServer } from "./http.js";
import { createWhoopServer } from "./server.js";
import { WhoopClient } from "./whoop/client.js";
import { SERVER_NAME, VERSION } from "./version.js";

export type Command =
  | { kind: "help" }
  | { kind: "stdio" }
  | { kind: "http"; port: number; host: string }
  | { kind: "login" }
  | { kind: "logout"; revoke: boolean }
  | { kind: "status" };

export function parseArgs(argv: string[]): Command {
  if (argv.length === 0) return { kind: "stdio" };
  const [first, ...rest] = argv;
  if (first === "--help" || first === "-h" || first === "help") return { kind: "help" };
  if (first === "login") {
    rejectExtra(rest);
    return { kind: "login" };
  }
  if (first === "status") {
    rejectExtra(rest);
    return { kind: "status" };
  }
  if (first === "logout") {
    if (rest.length === 0) return { kind: "logout", revoke: false };
    if (rest.length === 1 && rest[0] === "--revoke") return { kind: "logout", revoke: true };
    throw new Error(`Unknown argument: ${rest.find((arg) => arg !== "--revoke") ?? ""}`);
  }

  const flags = first === "serve" ? rest : argv;
  if (first !== "serve" && flags[0] && !flags[0].startsWith("--")) {
    throw new Error(`Unknown command: ${first}`);
  }

  let transport: "stdio" | "http" = "stdio";
  let port = 3333;
  let host = "127.0.0.1";
  let sawBind = false;

  for (let index = 0; index < flags.length; index += 1) {
    const arg = flags[index]!;
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--transport") {
      const value = flags[++index];
      if (value !== "stdio" && value !== "http") {
        throw new Error("--transport must be stdio or http.");
      }
      transport = value;
    } else if (arg === "--http") {
      transport = "http";
    } else if (arg === "--port" || arg.startsWith("--port=")) {
      sawBind = true;
      port = parsePort(arg === "--port" ? flags[++index] : arg.slice("--port=".length));
    } else if (arg === "--host" || arg.startsWith("--host=")) {
      sawBind = true;
      const value = arg === "--host" ? flags[++index] : arg.slice("--host=".length);
      if (!value) throw new Error("--host requires a value.");
      host = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (sawBind && transport !== "http") {
    throw new Error("--port and --host apply to HTTP transport (`--transport http`).");
  }
  return transport === "http" ? { kind: "http", port, host } : { kind: "stdio" };
}

function rejectExtra(args: string[]): void {
  if (args.length > 0) throw new Error(`Unknown argument: ${args[0]}`);
}

function parsePort(value: string | undefined): number {
  const port = Number(value);
  if (!value || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer from 1 to 65535.");
  }
  return port;
}

export function helpText(): string {
  return `${SERVER_NAME} ${VERSION}

Read your WHOOP data from an MCP client. Tokens stay on this machine.

Usage:
  whoop-mcp                         Start the MCP server on stdio
  whoop-mcp login                   Authorize in the browser and store tokens
  whoop-mcp status                  Show whether a token is stored (no secrets)
  whoop-mcp logout                  Delete the local token file
  whoop-mcp logout --revoke         Also revoke the grant at WHOOP (DELETE /v2/user/access)
  whoop-mcp serve --transport http  Streamable HTTP on 127.0.0.1:3333
  whoop-mcp --help

Environment:
  WHOOP_CLIENT_ID        Client ID from your own WHOOP developer app
  WHOOP_CLIENT_SECRET    Client secret from that app
  WHOOP_REDIRECT_URI     Default http://127.0.0.1:8787/callback (must be registered)
  WHOOP_TOKEN_PATH       Default ~/.whoop-mcp/tokens.json
  WHOOP_CONFIG_PATH      Optional JSON file with client_id and client_secret
`;
}

async function main(): Promise<void> {
  const command = parseArgs(process.argv.slice(2));
  if (command.kind === "help") {
    console.log(helpText());
    return;
  }

  const config = await loadConfig();
  if (command.kind === "login") {
    await login({ config, store: new TokenStore(config.tokenPath) });
    return;
  }
  if (command.kind === "status") {
    await printStatus(config);
    return;
  }
  if (command.kind === "logout") {
    await logout(config, command.revoke);
    return;
  }

  const server = createWhoopServer(runtimeDeps(config));
  if (command.kind === "stdio") {
    await server.connect(new StdioServerTransport());
    return;
  }

  if (command.host !== "127.0.0.1" && command.host !== "localhost" && command.host !== "::1") {
    console.error(
      `Warning: binding to ${command.host}. This serves personal health data. Keep it on a private network.`,
    );
  }
  const http = await startHttpServer({ ...runtimeDeps(config), host: command.host, port: command.port });
  console.error(`whoop-mcp listening on ${http.url}`);
}

function runtimeDeps(config: WhoopAppConfig) {
  const store = new TokenStore(config.tokenPath);
  const oauth = new OAuthClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });
  const tokens = new TokenManager({ store, oauth });
  const client = new WhoopClient({ tokens });
  return { client, tokenStore: store };
}

async function printStatus(config: WhoopAppConfig): Promise<void> {
  const store = new TokenStore(config.tokenPath);
  const tokens = await store.read();
  console.log(`Config: client id ${config.clientId}`);
  console.log(`Redirect URI: ${config.redirectUri}`);
  console.log(`Token file: ${config.tokenPath}`);
  if (!tokens) {
    console.log("Signed in: no");
    console.log("Run `whoop-mcp login` to authorize.");
    return;
  }
  console.log("Signed in: yes");
  console.log(`Access token expires: ${new Date(tokens.expires_at).toISOString()}`);
  console.log(`Scopes: ${tokens.scope}`);
}

async function logout(config: WhoopAppConfig, revoke: boolean): Promise<void> {
  const store = new TokenStore(config.tokenPath);
  if (revoke) {
    const tokens = await store.read();
    if (!tokens) {
      console.log("No local token to revoke.");
    } else {
      const deps = runtimeDeps(config);
      await deps.client.revokeAccess();
      console.log("Revoked this app's access at WHOOP.");
    }
  }
  await store.clear();
  console.log(`Removed ${config.tokenPath}`);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
