import assert from "node:assert/strict";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, it } from "node:test";
import { startHttpServer } from "../src/http.js";
import type { WhoopApi } from "../src/whoop/client.js";
import { profile } from "./fixtures.js";

const api: WhoopApi = {
  async getProfile() {
    return profile;
  },
  async getBodyMeasurement() {
    throw new Error("unused");
  },
  async listCycles() {
    return { records: [] };
  },
  async getCycle() {
    throw new Error("unused");
  },
  async listRecoveries() {
    return { records: [] };
  },
  async getRecoveryForCycle() {
    throw new Error("unused");
  },
  async listSleep() {
    return { records: [] };
  },
  async getSleep() {
    throw new Error("unused");
  },
  async getSleepForCycle() {
    throw new Error("unused");
  },
  async listWorkouts() {
    return { records: [] };
  },
  async getWorkout() {
    throw new Error("unused");
  },
  async revokeAccess() {
    return undefined;
  },
};

describe("Streamable HTTP", () => {
  it("lists and calls tools on loopback", async () => {
    const http = await startHttpServer({
      host: "127.0.0.1",
      port: 0,
      client: api,
      tokenStore: {
        filePath: "/tmp/whoop-mcp-http-test.json",
        async read() {
          return null;
        },
      },
    });
    const client = new Client({ name: "http-test", version: "0.0.0" });
    try {
      const health = await fetch(new URL("/health", http.url));
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });

      await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
      const { tools } = await client.listTools();
      assert.ok(tools.some((tool) => tool.name === "whoop_get_profile"));
      const result = await client.callTool({ name: "whoop_get_profile", arguments: {} });
      const text = result.content[0];
      assert.equal(text?.type, "text");
      if (text?.type === "text") {
        assert.equal(JSON.parse(text.text).user_id, 10129);
      }

      const blocked = await requestText(http.url, { host: "evil.example" });
      assert.equal(blocked.status, 403);
      const loopbackHost = await requestText(http.url, { host: "[::1]" });
      assert.notEqual(loopbackHost.status, 403);
    } finally {
      await client.close().catch(() => undefined);
      await http.close();
    }
  });
});

function requestText(mcpUrl: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const url = new URL(mcpUrl);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", reject);
    req.end("{}");
  });
}
