import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { fixedClock } from "../src/dates.js";
import { CoachService } from "../src/logic/service.js";
import { createServer, TOOL_NAMES } from "../src/server.js";
import { JsonIntentStore } from "../src/store/intents.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WhoopProvider } from "../src/types.js";

test("stdio server registers exactly the three v0 tools", async () => {
  assert.deepEqual([...TOOL_NAMES], ["log_intent", "explain_yesterday", "today_training_call"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-server-"));
  const whoop: WhoopProvider = {
    async getDays() {
      return { days: [], errors: ["recovery: fixture"] };
    },
  };
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    whoop,
    fixedClock("2026-03-16", "UTC"),
  );
  const server = createServer(service);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();

  const names = await listTools(clientTransport);
  assert.deepEqual(names.sort(), [...TOOL_NAMES].sort());
  await server.close();
});

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  result?: {
    tools?: Array<{ name: string }>;
    protocolVersion?: string;
  };
  error?: { message?: string };
}

function listTools(transport: InMemoryTransport): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let stage: "initialize" | "list" = "initialize";
    const timer = setTimeout(() => reject(new Error("timed out listing tools")), 5_000);
    transport.onmessage = (message) => {
      const rpc = message as JsonRpcMessage;
      if (rpc.id == null) return;
      if (rpc.error) {
        clearTimeout(timer);
        reject(new Error(rpc.error.message ?? "rpc error"));
        return;
      }
      if (stage === "initialize") {
        stage = "list";
        void transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        void transport.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        return;
      }
      clearTimeout(timer);
      resolve((rpc.result?.tools ?? []).map((tool) => tool.name));
    };
    void transport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "whoop-mcp-test", version: "0.0.0" },
      },
    });
  });
}
