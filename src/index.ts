#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { systemClock } from "./dates.js";
import { CoachService } from "./logic/service.js";
import { createServer } from "./server.js";
import { JsonIntentStore } from "./store/intents.js";
import { WhoopClient } from "./whoop/client.js";

export async function start(): Promise<void> {
  const config = loadConfig();
  const service = new CoachService(new JsonIntentStore(config.intentPath), new WhoopClient(config), systemClock(config.timeZone));
  const server = createServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("whoop-mcp running on stdio");
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  start().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
