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
import type { WhoopWorkout } from "../src/whoop/types.js";
import { durationMinutes, mapWorkouts, readNumber } from "../src/whoop/workouts.js";

test("readNumber does not coerce null, missing, or strings into zero", () => {
  assert.equal(readNumber(undefined), null);
  assert.equal(readNumber(null), null);
  assert.equal(readNumber("0"), null);
  assert.equal(readNumber(""), null);
  assert.equal(readNumber(Number.NaN), null);
  assert.equal(readNumber(Number.POSITIVE_INFINITY), null);
  assert.equal(readNumber(0), 0);
  assert.equal(readNumber(8.2463), 8.2463);
});

test("mapWorkouts keeps official fields, drops out-of-window rows, and does not invent sport_id", () => {
  const mapped = mapWorkouts({
    startDate: "2026-11-16",
    endDate: "2026-11-22",
    timeZone: "America/New_York",
    workouts: [
      workout({
        id: "before",
        start: "2026-11-16T04:59:00.000Z",
        end: "2026-11-16T05:30:00.000Z",
        sport_name: "running",
      }),
      workout({
        id: "first",
        start: "2026-11-16T05:00:00.000Z",
        end: "2026-11-16T05:25:00.000Z",
        sport_name: "Stairmaster",
        score: {
          strain: 7.1,
          average_heart_rate: 130,
          max_heart_rate: 150,
          zone_durations: {
            zone_zero_milli: 60_000,
            zone_one_milli: 120_000,
            zone_two_milli: 0,
          },
        },
      }),
      workout({
        id: "unscored",
        start: "2026-11-18T16:00:00.000Z",
        end: "2026-11-18T16:40:00.000Z",
        sport_name: "weight lifting",
        score_state: "PENDING_SCORE",
        score: { strain: 99, average_heart_rate: 200, max_heart_rate: 200 },
      }),
      workout({
        id: "no-id-sport",
        start: "2026-11-20T18:00:00.000Z",
        end: "2026-11-20T18:30:00.000Z",
        sport_name: "cycling",
        score: { strain: 0, average_heart_rate: 110, max_heart_rate: 140 },
      }),
      {
        ...workout({
          id: "legacy-id",
          start: "2026-11-21T15:00:00.000Z",
          end: "2026-11-21T16:00:00.000Z",
          sport_name: "running",
        }),
        sport_id: 1,
      },
      workout({
        id: "last",
        start: "2026-11-23T04:59:00.000Z",
        end: "2026-11-23T05:20:00.000Z",
        sport_name: "walking",
        score: { strain: 4.2, average_heart_rate: 100, max_heart_rate: 120 },
      }),
      workout({
        id: "after",
        start: "2026-11-23T05:00:00.000Z",
        end: "2026-11-23T05:20:00.000Z",
        sport_name: "yoga",
      }),
      {
        ...workout({
          id: "first",
          start: "2026-11-16T05:00:00.000Z",
          end: "2026-11-16T05:25:00.000Z",
          sport_name: "Stairmaster",
        }),
      },
    ],
  });

  assert.deepEqual(
    mapped.workouts.map((item) => item.id),
    ["first", "unscored", "no-id-sport", "legacy-id", "last"],
  );

  const first = mapped.workouts[0];
  assert.equal(first?.date, "2026-11-16");
  assert.equal(first?.start, "2026-11-16T00:00:00.000-05:00");
  assert.equal(first?.end, "2026-11-16T00:25:00.000-05:00");
  assert.equal(first?.duration_minutes, 25);
  assert.equal(first?.sport_name, "Stairmaster");
  assert.equal(first?.sport_id, null);
  assert.equal(first?.strain, 7.1);
  assert.equal(first?.average_heart_rate, 130);
  assert.equal(first?.max_heart_rate, 150);
  assert.deepEqual(first?.zone_durations, {
    zone_zero_minutes: 1,
    zone_one_minutes: 2,
    zone_two_minutes: 0,
    zone_three_minutes: null,
    zone_four_minutes: null,
    zone_five_minutes: null,
  });

  const pending = mapped.workouts[1];
  assert.equal(pending?.score_state, "PENDING_SCORE");
  assert.equal(pending?.strain, null);
  assert.equal(pending?.average_heart_rate, null);
  assert.equal(pending?.max_heart_rate, null);
  assert.equal(pending?.zone_durations, null);
  assert.equal(pending?.duration_minutes, 40);

  const noId = mapped.workouts[2];
  assert.equal(noId?.sport_id, null);
  assert.equal(noId?.strain, 0);

  const legacy = mapped.workouts[3];
  assert.equal(legacy?.sport_id, 1);
  assert.equal(legacy?.duration_minutes, 60);

  const last = mapped.workouts[4];
  assert.equal(last?.date, "2026-11-22");
  assert.equal(last?.start, "2026-11-22T23:59:00.000-05:00");
});

test("durationMinutes returns null for invalid or inverted timestamps", () => {
  assert.equal(durationMinutes("2026-11-16T12:00:00.000Z", "2026-11-16T12:30:00.000Z"), 30);
  assert.equal(durationMinutes("2026-11-16T12:00:00.000Z", "2026-11-16T12:00:06.000Z"), 0.1);
  assert.equal(durationMinutes("not-a-date", "2026-11-16T12:00:00.000Z"), null);
  assert.equal(durationMinutes("2026-11-16T13:00:00.000Z", "2026-11-16T12:00:00.000Z"), null);
});

test("mapWorkouts reads zone_duration when the official zone_durations field is absent", () => {
  const mapped = mapWorkouts({
    startDate: "2026-11-16",
    endDate: "2026-11-16",
    timeZone: "America/New_York",
    workouts: [
      workout({
        id: "typo-zones",
        start: "2026-11-16T16:00:00.000Z",
        end: "2026-11-16T16:20:00.000Z",
        sport_name: "activity",
        score: {
          strain: 3,
          zone_duration: { zone_zero_milli: 180_000, zone_one_milli: "nope" as unknown as number },
        },
      }),
    ],
  });
  assert.deepEqual(mapped.workouts[0]?.zone_durations, {
    zone_zero_minutes: 3,
    zone_one_minutes: null,
    zone_two_minutes: null,
    zone_three_minutes: null,
    zone_four_minutes: null,
    zone_five_minutes: null,
  });
});

test("getWorkouts GETs /v2/activity/workout only and follows next_token pages", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-workouts-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: Date.now() + 3_600_000,
    token_type: "bearer",
    scope: "read:recovery read:sleep read:cycles read:workout offline",
  });

  const calls: Array<{ method: string; pathname: string; next: string | null; start: string | null; end: string | null }> = [];
  const pageOne = [
    workout({
      id: "one",
      start: "2026-11-17T15:00:00.000Z",
      end: "2026-11-17T15:30:00.000Z",
      sport_name: "Stairmaster",
      score: { strain: 6.5, average_heart_rate: 128, max_heart_rate: 148 },
    }),
  ];
  const pageTwo = [
    workout({
      id: "two",
      start: "2026-11-19T15:00:00.000Z",
      end: "2026-11-19T15:20:00.000Z",
      sport_name: "weight lifting",
      score: { strain: 10.2, average_heart_rate: 132, max_heart_rate: 160 },
    }),
  ];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      method,
      pathname: url.pathname,
      next: url.searchParams.get("nextToken"),
      start: url.searchParams.get("start"),
      end: url.searchParams.get("end"),
    });
    assert.equal(method, "GET");
    assert.equal(url.pathname, "/developer/v2/activity/workout");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-123");
    const next = url.searchParams.get("nextToken");
    const body = next ? { records: pageTwo } : { records: pageOne, next_token: "page-2" };
    assert.equal(next === null || next === "page-2", true);
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await new WhoopClient(app, fetchImpl).getWorkouts("2026-11-16", "2026-11-22");
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
  assert.deepEqual(calls.map((call) => call.pathname), [
    "/developer/v2/activity/workout",
    "/developer/v2/activity/workout",
  ]);
  assert.equal(calls[0]?.start, "2026-11-15T05:00:00.000Z");
  assert.equal(calls[0]?.end, "2026-11-24T05:00:00.000Z");
  assert.equal(calls[1]?.next, "page-2");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.workouts.map((item) => item.id),
    ["one", "two"],
  );
  assert.equal(result.workouts[0]?.sport_name, "Stairmaster");
  assert.equal(result.workouts[0]?.strain, 6.5);
  assert.equal(result.workouts[1]?.duration_minutes, 20);
});

test("getWorkouts records an HTTP error and does not write", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-workouts-err-"));
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
  const result = await new WhoopClient(app, fetchImpl).getWorkouts("2026-11-16", "2026-11-22");
  assert.deepEqual(methods, ["GET"]);
  assert.deepEqual(result.workouts, []);
  assert.match(result.errors.join(" "), /HTTP 403/);
  assert.equal(fs.existsSync(app.intentPath), false);
});

test("getWorkouts uses today in the configured timezone and defaults to seven days", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-workouts-svc-"));
  const calls: string[] = [];
  const whoop: WhoopProvider = {
    async getDays() {
      calls.push("getDays");
      return { days: [], errors: [] };
    },
    async getSteps() {
      calls.push("getSteps");
      return {
        current: null,
        recent: [],
        baseline_step_count: null,
        baseline_cycles_counted: 0,
        baseline_cycles_omitted: 0,
        errors: [],
      };
    },
    async getWorkouts(start, end) {
      calls.push(`getWorkouts ${start} ${end}`);
      return {
        workouts: [
          {
            id: "one",
            date: "2026-11-16",
            start: "2026-11-16T12:00:00.000-05:00",
            end: "2026-11-16T12:25:00.000-05:00",
            duration_minutes: 25,
            sport_name: "Stairmaster",
            sport_id: null,
            score_state: "SCORED",
            strain: 6.5,
            average_heart_rate: 128,
            max_heart_rate: 148,
            zone_durations: null,
          },
        ],
        errors: [],
      };
    },
    async getLastWakeTime() {
      return { sleep: null, awake_now: false, errors: [] };
    },

  };
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    whoop,
    fixedClock("2026-11-22", "America/New_York"),
  );

  const result = await service.getWorkouts({});
  assert.deepEqual(calls, ["getWorkouts 2026-11-16 2026-11-22"]);
  assert.equal(result.window.time_zone, "America/New_York");
  assert.equal(result.workouts[0]?.sport_name, "Stairmaster");
  assert.equal(result.missing.length, 0);

  const ranged = await service.getWorkouts({ start: "2026-11-20" });
  assert.equal(ranged.window.start, "2026-11-20");
  assert.equal(ranged.window.end, "2026-11-22");
  const ended = await service.getWorkouts({ end: "2026-11-20" });
  assert.equal(ended.window.start, "2026-11-14");
  assert.equal(ended.window.end, "2026-11-20");
  await assert.rejects(() => service.getWorkouts({ start: "2026-11-22", end: "2026-11-16" }), /start must be on or before end/);
  await assert.rejects(() => service.getWorkouts({ start: "2026-01-01", end: "2026-05-01" }), /90 days/);
  assert.equal(calls.includes("getDays"), false);
  assert.equal(calls.includes("getSteps"), false);
});

test("get_workouts tool is read-only and returns mapped sessions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-workouts-tool-"));
  let requested = "";
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
    async getWorkouts(start, end) {
      requested = `${start} ${end}`;
      return {
        workouts: [
          {
            id: "one",
            date: "2026-11-16",
            start: "2026-11-16T12:00:00.000-05:00",
            end: "2026-11-16T12:25:00.000-05:00",
            duration_minutes: 25,
            sport_name: "Stairmaster",
            sport_id: null,
            score_state: "SCORED",
            strain: 6.5,
            average_heart_rate: 128,
            max_heart_rate: 148,
            zone_durations: null,
          },
        ],
        errors: [],
      };
    },
    async getLastWakeTime() {
      return { sleep: null, awake_now: false, errors: [] };
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
  const session = rpcSession(clientTransport);

  await session.call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "whoop-mcp-test", version: "0.0.0" },
  });
  await session.notify("notifications/initialized");
  const listed = (await session.call("tools/list", {})) as {
    tools: Array<{ name: string; description?: string; annotations?: { readOnlyHint?: boolean } }>;
  };
  const tool = listed.tools.find((item) => item.name === "get_workouts");
  assert.ok(tool);
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.match(tool.description ?? "", /read:workout/);
  assert.match(tool.description ?? "", /Does not write/i);

  const called = (await session.call("tools/call", {
    name: "get_workouts",
    arguments: { start: "2026-11-16", end: "2026-11-22" },
  })) as {
    isError?: boolean;
    structuredContent?: {
      window: { start: string; end: string; time_zone: string };
      workouts: Array<{ sport_name: string | null; duration_minutes: number | null; strain: number | null }>;
    };
  };
  assert.notEqual(called.isError, true);
  assert.equal(requested, "2026-11-16 2026-11-22");
  assert.equal(called.structuredContent?.window.start, "2026-11-16");
  assert.equal(called.structuredContent?.window.end, "2026-11-22");
  assert.equal(called.structuredContent?.workouts[0]?.sport_name, "Stairmaster");
  assert.equal(called.structuredContent?.workouts[0]?.duration_minutes, 25);
  assert.equal(called.structuredContent?.workouts[0]?.strain, 6.5);
  await server.close();
});

function workout(partial: Partial<WhoopWorkout> & Pick<WhoopWorkout, "id" | "start" | "end">): WhoopWorkout {
  return {
    timezone_offset: "-05:00",
    score_state: "SCORED",
    sport_name: "activity",
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
