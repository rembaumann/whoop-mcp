import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { writeTokens } from "../src/auth/tokens.js";
import type { AppConfig } from "../src/config.js";
import { fixedClock } from "../src/dates.js";
import { CoachService } from "../src/logic/service.js";
import { createServer } from "../src/server.js";
import { JsonIntentStore } from "../src/store/intents.js";
import type { WhoopProvider } from "../src/types.js";
import { WhoopClient } from "../src/whoop/client.js";
import { mapLastWakeTime } from "../src/whoop/sleep.js";
import type { WhoopSleep } from "../src/whoop/types.js";

test("mapLastWakeTime picks the latest non-nap and formats times with timezone_offset", () => {
  const mapped = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "older",
        start: "2026-11-20T04:00:00.000Z",
        end: "2026-11-20T11:00:00.000Z",
      }),
      sleep({
        id: "nap",
        start: "2026-11-22T18:00:00.000Z",
        end: "2026-11-22T18:40:00.000Z",
        nap: true,
      }),
      sleep({
        id: "night",
        start: "2026-11-22T04:12:00.000Z",
        end: "2026-11-22T12:04:00.000Z",
        score_state: "SCORED",
      }),
    ],
  });

  assert.equal(mapped.sleep?.start, "2026-11-21T23:12:00.000-05:00");
  assert.equal(mapped.sleep?.end, "2026-11-22T07:04:00.000-05:00");
  assert.equal(mapped.sleep?.wake_date, "2026-11-22");
  assert.equal(mapped.sleep?.score_state, "SCORED");
  assert.equal(mapped.sleep?.timezone_offset, "-05:00");
  assert.equal(mapped.awake_now, true);
});

test("awake_now is false when the latest sleep has no end", () => {
  const mapped = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "in-progress",
        start: "2026-11-22T04:00:00.000Z",
        end: null,
        score_state: "PENDING_SCORE",
      }),
    ],
  });
  assert.equal(mapped.sleep?.start, "2026-11-21T23:00:00.000-05:00");
  assert.equal(mapped.sleep?.end, null);
  assert.equal(mapped.sleep?.wake_date, null);
  assert.equal(mapped.sleep?.score_state, "PENDING_SCORE");
  assert.equal(mapped.awake_now, false);
});

test("awake_now is false when the latest sleep ended on a previous local date", () => {
  const mapped = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "yesterday",
        start: "2026-11-20T04:00:00.000Z",
        end: "2026-11-20T12:00:00.000Z",
      }),
    ],
  });
  assert.equal(mapped.sleep?.wake_date, "2026-11-20");
  assert.equal(mapped.awake_now, false);
});

test("awake_now uses the latest sleep including naps", () => {
  const mapped = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "night",
        start: "2026-11-22T04:00:00.000Z",
        end: "2026-11-22T12:00:00.000Z",
      }),
      sleep({
        id: "nap-open",
        start: "2026-11-22T18:00:00.000Z",
        end: null,
        nap: true,
        score_state: "PENDING_SCORE",
      }),
    ],
  });
  assert.equal(mapped.sleep?.end, "2026-11-22T07:00:00.000-05:00");
  assert.equal(mapped.awake_now, false);
});

test("mapLastWakeTime returns null sleep when only naps are present", () => {
  const mapped = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "nap",
        start: "2026-11-22T18:00:00.000Z",
        end: "2026-11-22T18:30:00.000Z",
        nap: true,
      }),
    ],
  });
  assert.equal(mapped.sleep, null);
  assert.equal(mapped.awake_now, true);
});

test("getLastWakeTime GETs /v2/activity/sleep?limit=5 only and does not write", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: Date.now() + 3_600_000,
    token_type: "bearer",
    scope: "read:recovery read:sleep read:cycles offline",
  });

  const calls: Array<{ method: string; pathname: string; search: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, pathname: url.pathname, search: url.search });
    assert.equal(method, "GET");
    assert.equal(url.pathname, "/developer/v2/activity/sleep");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.get("start"), null);
    assert.equal(url.searchParams.get("end"), null);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-123");
    return new Response(
      JSON.stringify({
        records: [
          sleep({
            id: "night",
            start: "2026-11-22T04:12:00.000Z",
            end: "2026-11-22T12:04:00.000Z",
          }),
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await new WhoopClient(app, fetchImpl).getLastWakeTime("2026-11-22");
  assert.deepEqual(calls, [{ method: "GET", pathname: "/developer/v2/activity/sleep", search: "?limit=5" }]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.awake_now, true);
  assert.equal(result.sleep?.end, "2026-11-22T07:04:00.000-05:00");
  assert.equal(fs.existsSync(app.intentPath), false);
});

test("getLastWakeTime records an HTTP error and does not write", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-err-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: Date.now() + 3_600_000,
    token_type: "bearer",
    scope: "read:recovery read:sleep read:cycles offline",
  });
  const methods: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    return new Response("nope", { status: 403 });
  };
  const result = await new WhoopClient(app, fetchImpl).getLastWakeTime("2026-11-22");
  assert.deepEqual(methods, ["GET"]);
  assert.equal(result.sleep, null);
  assert.equal(result.awake_now, false);
  assert.match(result.errors.join(" "), /HTTP 403/);
});

test("lastWakeTime uses today in the configured timezone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-svc-"));
  const todays: string[] = [];
  const whoop: WhoopProvider = {
    async getDays() {
      return { days: [], errors: [] };
    },
    async getSteps() {
      return {
        current: null,
        recent: [],
        baseline_step_count: null,
        baseline_cycles_counted: 0,
        baseline_cycles_omitted: 0,
        errors: [],
      };
    },
    async getWorkouts() {
      return { workouts: [], errors: [] };
    },
    async getLastWakeTime(today) {
      todays.push(today);
      return {
        sleep: {
          start: "2026-11-21T23:12:00.000-05:00",
          end: "2026-11-22T07:04:00.000-05:00",
          score_state: "SCORED",
          wake_date: "2026-11-22",
          timezone_offset: "-05:00",
        },
        awake_now: true,
        errors: [],
      };
    },
  };
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    whoop,
    fixedClock("2026-11-22", "America/New_York"),
  );
  const result = await service.lastWakeTime();
  assert.deepEqual(todays, ["2026-11-22"]);
  assert.equal(result.start, "2026-11-21T23:12:00.000-05:00");
  assert.equal(result.end, "2026-11-22T07:04:00.000-05:00");
  assert.equal(result.score_state, "SCORED");
  assert.equal(result.awake_now, true);
  assert.equal(result.wake_date, "2026-11-22");
  assert.equal(result.time_zone, "America/New_York");
  assert.deepEqual(result.missing, []);
});

test("last_wake_time tool is read-only and returns the mapped sleep", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-tool-"));
  const whoop: WhoopProvider = {
    async getDays() {
      return { days: [], errors: [] };
    },
    async getSteps() {
      return {
        current: null,
        recent: [],
        baseline_step_count: null,
        baseline_cycles_counted: 0,
        baseline_cycles_omitted: 0,
        errors: [],
      };
    },
    async getWorkouts() {
      return { workouts: [], errors: [] };
    },
    async getLastWakeTime() {
      return {
        sleep: {
          start: "2026-11-21T23:12:00.000-05:00",
          end: "2026-11-22T07:04:00.000-05:00",
          score_state: "SCORED",
          wake_date: "2026-11-22",
          timezone_offset: "-05:00",
        },
        awake_now: true,
        errors: [],
      };
    },
  };
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    whoop,
    fixedClock("2026-11-22", "America/New_York"),
  );
  const server = createServer(service);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();
  const rpc = rpcSession(clientTransport);
  const init = (await rpc.call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "whoop-mcp-test", version: "0.0.0" },
  })) as { protocolVersion?: string };
  assert.ok(init.protocolVersion);
  await rpc.notify("notifications/initialized");
  const listed = (await rpc.call("tools/list", {})) as { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
  const tool = listed.tools.find((item) => item.name === "last_wake_time");
  assert.ok(tool);
  assert.equal(tool?.annotations?.readOnlyHint, true);
  const called = (await rpc.call("tools/call", { name: "last_wake_time", arguments: {} })) as {
    structuredContent?: { end?: string; awake_now?: boolean; time_zone?: string };
  };
  assert.equal(called.structuredContent?.end, "2026-11-22T07:04:00.000-05:00");
  assert.equal(called.structuredContent?.awake_now, true);
  assert.equal(called.structuredContent?.time_zone, "America/New_York");
  await server.close();
});

function sleep(partial: Partial<WhoopSleep> & Pick<WhoopSleep, "id" | "start">): WhoopSleep {
  return {
    timezone_offset: "-05:00",
    score_state: "SCORED",
    nap: false,
    ...partial,
  };
}

function config(dir: string): AppConfig {
  return {
    clientId: "client-id",
    clientSecret: "super-secret-value",
    redirectUri: "http://127.0.0.1:8787/callback",
    timeZone: "America/New_York",
    dataDir: dir,
    apiBase: "https://api.prod.whoop.com/developer",
    tokenPath: path.join(dir, "tokens.json"),
    intentPath: path.join(dir, "intents.json"),
  };
}

interface RpcResult {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

function rpcSession(transport: InMemoryTransport) {
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  transport.onmessage = (message) => {
    const rpc = message as RpcResult;
    if (rpc.id == null) return;
    const waiter = pending.get(rpc.id);
    if (!waiter) return;
    pending.delete(rpc.id);
    if (rpc.error) waiter.reject(new Error(rpc.error.message ?? "rpc error"));
    else waiter.resolve(rpc.result);
  };

  return {
    call(method: string, params: unknown): Promise<unknown> {
      const id = nextId;
      nextId += 1;
      const result = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 5_000);
      });
      void transport.send({ jsonrpc: "2.0", id, method, params });
      return result;
    },
    notify(method: string): Promise<void> {
      return transport.send({ jsonrpc: "2.0", method });
    },
  };
}
