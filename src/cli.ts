#!/usr/bin/env node
import { runAuthFlow } from "./auth/oauth.js";
import { loadConfig } from "./config.js";
import { start } from "./index.js";

const command = process.argv[2] ?? "serve";

if (command === "auth") {
  runAuthFlow(loadConfig()).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else if (command === "serve") {
  start().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  console.error("Usage: whoop-mcp <serve|auth>");
  process.exit(1);
}
