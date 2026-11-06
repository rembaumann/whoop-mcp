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
import { NULL_STEP_COUNT, STEP_BASELINE_NOTE, type WhoopProvider } from "../src/types.js";
import { WhoopClient } from "../src/whoop/client.js";
import { mapCycleSteps, readStepCount } from "../src/whoop/steps.js";
import type { WhoopCycle as ApiCycle } from "../src/whoop/types.js";

test("readStepCount does not coerce null, missing, or strings into zero", () => {
  assert.equal(readStepCount(undefined), null);
  assert.equal(readStepCount(null), null);
  assert.equal(readStepCount("0"), null);
  assert.equal(readStepCount(""), null);
  assert.equal(readStepCount(Number.NaN), null);
  assert.equal(readStepCount(Number.POSITIVE_INFINITY), null);
  assert.equal(readStepCount(0), 0);
  assert.equal(readStepCount(8234), 8234);
});

test("null step counts are omitted from the baseline and an open cycle stays partial", () => {
  const mapped = mapCycleSteps({
    startDate: "2026-11-03",
    endDate: "2026-11-05",
    cycles: [
      cycle({
        id: 21,
        start: "2026-11-02T11:00:00.000Z",
        end: "2026-11-03T11:00:00.000Z",
        step_count: null,
      }),
      cycle({
        id: 22,
        start: "2026-11-02T12:00:00.000Z",
        end: "2026-11-03T12:00:00.000Z",
        step_count: 0,
      }),
      cycle({
        id: 20,
        start: "2026-11-03T11:00:00.000Z",
        end: "2026-11-04T11:00:00.000Z",
        step_count: 9800,
      }),
      cycle({
        id: 26,
        start: "2026-09-30T12:00:00.000Z",
        end: "2026-10-01T12:00:00.000Z",
        step_count: 100,
      }),
      cycle({
        id: 27,
        start: "2026-11-04T11:00:00.000Z",
        step_count: 15000,
        score_state: "PENDING_SCORE",
      }),
    ],
  });

  assert.equal(mapped.current?.cycle_id, 27);
  assert.equal(mapped.current?.coverage, "partial");
  assert.equal(mapped.current?.end, null);
  assert.equal(mapped.current?.start, "2026-11-04T11:00:00.000Z");
  assert.equal(mapped.current?.step_count, 15000);
  assert.equal(mapped.current?.step_count_label, "15000 so far");
  assert.match(mapped.current?.note ?? "", /Partial:/);
  assert.match(mapped.current?.note ?? "", /so far/);
  assert.match(mapped.current?.note ?? "", /2026-11-04T11:00:00\.000Z/);
  assert.match(mapped.current?.note ?? "", /wake-to-wake/);

  assert.deepEqual(
    mapped.recent.map((row) => row.cycle_id),
    [21, 22, 20],
  );
  assert.equal(mapped.recent[0]?.step_count, null);
  assert.equal(mapped.recent[0]?.step_count_label, NULL_STEP_COUNT);
  assert.match(mapped.recent[0]?.note ?? "", /not zero/);
  assert.equal(mapped.recent[1]?.step_count, 0);
  assert.equal(mapped.recent[1]?.step_count_label, "0");
  assert.equal(mapped.baseline_step_count, 4900);
  assert.equal(mapped.baseline_cycles_counted, 2);
  assert.equal(mapped.baseline_cycles_omitted, 1);
  assert.equal(
    mapped.recent.some((row) => row.cycle_id === 27 || row.step_count === 15000),
    false,
  );
});

test("a missing open-cycle step count is not available, and it is not averaged as zero", () => {
  const mapped = mapCycleSteps({
    startDate: "2026-11-05",
    endDate: "2026-11-05",
    cycles: [
      cycle({
        id: 1,
        start: "2026-11-04T11:00:00.000Z",
        step_count: null,
        score_state: "PENDING_SCORE",
      }),
      cycle({
        id: 2,
        start: "2026-11-03T11:00:00.000Z",
        end: "2026-11-04T11:00:00.000Z",
        step_count: null,
      }),
    ],
  });

  assert.equal(mapped.current?.coverage, "partial");
  assert.equal(mapped.current?.step_count, null);
  assert.equal(mapped.current?.step_count_label, "not available");
  assert.match(mapped.current?.note ?? "", /not available, not zero/);
  assert.match(mapped.current?.note ?? "", /2026-11-04T11:00:00\.000Z/);
  assert.deepEqual(mapped.recent, []);
  assert.equal(mapped.baseline_step_count, null);
  assert.notEqual(mapped.baseline_step_count, 0);
  assert.equal(mapped.baseline_cycles_counted, 0);
});

test("a real zero averages as zero and a null cycle does not", () => {
  const onlyZero = mapCycleSteps({
    startDate: "2026-11-05",
    endDate: "2026-11-05",
    cycles: [
      cycle({
        id: 1,
        start: "2026-11-04T11:00:00.000Z",
        end: "2026-11-05T11:00:00.000Z",
        step_count: 0,
      }),
    ],
  });
  assert.equal(onlyZero.baseline_step_count, 0);
  assert.equal(onlyZero.baseline_cycles_counted, 1);

  const onlyNull = mapCycleSteps({
    startDate: "2026-11-05",
    endDate: "2026-11-05",
    cycles: [
      cycle({
        id: 1,
        start: "2026-11-04T11:00:00.000Z",
        end: "2026-11-05T11:00:00.000Z",
        step_count: null,
      }),
    ],
  });
  assert.equal(onlyNull.baseline_step_count, null);
  assert.equal(onlyNull.baseline_cycles_counted, 0);
  assert.equal(onlyNull.baseline_cycles_omitted, 1);
  assert.equal(onlyNull.recent[0]?.step_count_label, "not available");
});

test("get_steps GETs /v2/cycle only and keeps null step_count null", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-steps-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: Date.now() + 3_600_000,
    token_type: "bearer",
    scope: "read:recovery read:sleep read:cycles offline",
  });

  const calls: Array<{ method: string; pathname: string; next: string | null; start: string | null; end: string | null }> = [];
  const pageOne = [
    cycle({ id: 21, start: "2026-11-02T11:00:00.000Z", end: "2026-11-03T11:00:00.000Z", step_count: null }),
    cycle({ id: 22, start: "2026-11-02T12:00:00.000Z", end: "2026-11-03T12:00:00.000Z", step_count: 0 }),
    cycle({ id: 20, start: "2026-11-03T11:00:00.000Z", end: "2026-11-04T11:00:00.000Z", step_count: 9800 }),
    cycle({ id: 26, start: "2026-09-30T12:00:00.000Z", end: "2026-10-01T12:00:00.000Z", step_count: 100 }),
  ];
  const pageTwo = [
    cycle({ id: 23, start: "2026-11-04T11:00:00.000Z", end: "2026-11-05T11:00:00.000Z" }),
    {
      ...cycle({ id: 24, start: "2026-11-04T12:00:00.000Z", end: "2026-11-05T12:00:00.000Z" }),
      step_count: "12",
    },
    {
      ...cycle({ id: 25, start: "2026-11-04T13:00:00.000Z", end: "2026-11-05T13:00:00.000Z" }),
      step_count: undefined,
      score: { strain: 4, step_count: 999 },
    },
    cycle({
      id: 27,
      start: "2026-11-05T11:30:00.000Z",
      step_count: 4210,
      score_state: "PENDING_SCORE",
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
    assert.equal(url.pathname, "/developer/v2/cycle");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-123");
    const next = url.searchParams.get("nextToken");
    const body = next
      ? { records: pageTwo }
      : { records: pageOne, next_token: "page-2" };
    assert.equal(next === null || next === "page-2", true);
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await new WhoopClient(app, fetchImpl).getSteps("2026-11-03", "2026-11-05");
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "GET"],
  );
  assert.deepEqual(calls.map((call) => call.pathname), ["/developer/v2/cycle", "/developer/v2/cycle"]);
  assert.equal(calls[0]?.start, "2026-11-02T00:00:00.000Z");
  assert.equal(calls[0]?.end, "2026-11-07T00:00:00.000Z");
  assert.equal(calls[1]?.next, "page-2");
  assert.deepEqual(result.errors, []);

  assert.equal(result.current?.cycle_id, 27);
  assert.equal(result.current?.coverage, "partial");
  assert.equal(result.current?.step_count, 4210);
  assert.equal(result.current?.step_count_label, "4210 so far");
  assert.equal(result.current?.start, "2026-11-05T11:30:00.000Z");
  assert.match(result.current?.note ?? "", /so far/);

  const byId = new Map(result.recent.map((row) => [row.cycle_id, row]));
  assert.equal(byId.has(26), false);
  assert.equal(byId.has(27), false);
  assert.equal(byId.get(21)?.step_count, null);
  assert.equal(byId.get(21)?.step_count_label, "not available");
  assert.equal(byId.get(22)?.step_count, 0);
  assert.equal(byId.get(23)?.step_count, null);
  assert.equal(byId.get(24)?.step_count, null);
  assert.equal(byId.get(25)?.step_count, null);
  assert.equal(
    result.recent.some((row) => row.step_count === 12 || row.step_count === 999 || row.step_count === 100),
    false,
  );
  assert.equal(result.baseline_step_count, 4900);
  assert.equal(result.baseline_cycles_counted, 2);
  assert.equal(result.baseline_cycles_omitted, 4);
  const serialized = JSON.stringify(result);
  assert.match(serialized, /"step_count":null/);
  assert.match(serialized, /"step_count":0/);
  assert.doesNotMatch(serialized, /"step_count":12/);
  assert.doesNotMatch(serialized, /"step_count":999/);
});

test("a failed cycle read does not invent a zero step count", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-steps-err-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: Date.now() + 3_600_000,
    token_type: "bearer",
    scope: "read:cycles offline",
  });
  const methods: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    return new Response("nope", { status: 500 });
  };
  const result = await new WhoopClient(app, fetchImpl).getSteps("2026-11-05", "2026-11-05");
  assert.deepEqual(methods, ["GET"]);
  assert.equal(result.current, null);
  assert.deepEqual(result.recent, []);
  assert.equal(result.baseline_step_count, null);
  assert.match(result.errors.join(" "), /HTTP 500/);
});

test("getSteps uses today in the configured timezone and does not call getDays", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-steps-svc-"));
  const calls: string[] = [];
  const whoop: WhoopProvider = {
    async getDays() {
      calls.push("getDays");
      return { days: [], errors: [] };
    },
    async getSteps(start, end) {
      calls.push(`getSteps ${start} ${end}`);
      return {
        current: {
          cycle_id: 3,
          start: "2026-11-05T11:00:00.000Z",
          end: null,
          date: "2026-11-05",
          step_count: null,
          step_count_label: NULL_STEP_COUNT,
          coverage: "partial",
          note: "Partial: step count is not available, not zero. Open cycle started at 2026-11-05T11:00:00.000Z.",
        },
        recent: [],
        baseline_step_count: null,
        baseline_cycles_counted: 0,
        baseline_cycles_omitted: 0,
        errors: [],
      };
    },
  };
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    whoop,
    fixedClock("2026-11-05", "America/New_York"),
  );

  const result = await service.getSteps({});
  assert.deepEqual(calls, ["getSteps 2026-10-23 2026-11-05"]);
  assert.equal(result.window.time_zone, "America/New_York");
  assert.equal(result.current?.step_count, null);
  assert.equal(result.null_step_count, "not available");
  assert.equal(result.baseline_step_count, null);
  assert.equal(result.baseline_note, STEP_BASELINE_NOTE);
  assert.equal(result.baseline_cycles_counted, 0);

  const oneDay = await service.getSteps({ days: 1 });
  assert.equal(oneDay.window.start, "2026-11-05");
  assert.equal(oneDay.window.end, "2026-11-05");
  await assert.rejects(() => service.getSteps({ days: 0 }), /days must be an integer/);
  assert.equal(calls.includes("getDays"), false);
});

test("get_steps tool returns the partial cycle and does not turn null into zero", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-steps-tool-"));
  let requested = "";
  const whoop: WhoopProvider = {
    async getDays() {
      return { days: [], errors: [] };
    },
    async getSteps(start, end) {
      requested = `${start} ${end}`;
      return {
        current: {
          cycle_id: 3,
          start: "2026-11-05T11:00:00.000Z",
          end: null,
          date: "2026-11-05",
          step_count: null,
          step_count_label: "not available",
          coverage: "partial",
          note: "Partial: step count is not available, not zero. Open cycle started at 2026-11-05T11:00:00.000Z.",
        },
        recent: [
          {
            cycle_id: 2,
            start: "2026-11-04T11:00:00.000Z",
            end: "2026-11-05T11:00:00.000Z",
            date: "2026-11-05",
            step_count: 9800,
            step_count_label: "9800",
            coverage: "complete",
            note: "Completed cycle total: 9800 steps.",
          },
        ],
        baseline_step_count: 9800,
        baseline_cycles_counted: 1,
        baseline_cycles_omitted: 0,
        errors: [],
      };
    },
  };
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    whoop,
    fixedClock("2026-11-05", "UTC"),
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
  const tool = listed.tools.find((item) => item.name === "get_steps");
  assert.ok(tool);
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.match(tool.description ?? "", /partial/i);
  assert.match(tool.description ?? "", /null/i);
  assert.match(tool.description ?? "", /read:cycles/);

  const called = (await session.call("tools/call", { name: "get_steps", arguments: { days: 7 } })) as {
    isError?: boolean;
    structuredContent?: {
      current: { step_count: number | null; coverage: string; start: string; step_count_label: string };
      recent: Array<{ step_count: number | null }>;
      baseline_step_count: number | null;
      null_step_count: string;
    };
    content?: Array<{ text?: string }>;
  };
  assert.notEqual(called.isError, true);
  assert.equal(requested, "2026-10-30 2026-11-05");
  assert.equal(called.structuredContent?.current.step_count, null);
  assert.equal(called.structuredContent?.current.coverage, "partial");
  assert.equal(called.structuredContent?.current.step_count_label, "not available");
  assert.equal(called.structuredContent?.current.start, "2026-11-05T11:00:00.000Z");
  assert.equal(called.structuredContent?.recent[0]?.step_count, 9800);
  assert.equal(called.structuredContent?.baseline_step_count, 9800);
  assert.equal(called.structuredContent?.null_step_count, "not available");
  const text = called.content?.[0]?.text ?? "";
  assert.match(text, /not available/);
  assert.match(text, /2026-11-05T11:00:00.000Z/);
  assert.equal(text.includes('"step_count": 0'), false);
  await server.close();
});

function cycle(partial: Partial<ApiCycle> & Pick<ApiCycle, "id" | "start">): ApiCycle {
  return {
    timezone_offset: "-05:00",
    score_state: "SCORED",
    score: { strain: 8 },
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
