import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { readTokens, writeTokens } from "../src/auth/tokens.js";
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


test("mapLastWakeTime returns null sleep and awake_now false when no sleeps are returned", () => {
  const mapped = mapLastWakeTime({ today: "2026-11-22", sleeps: [] });
  assert.equal(mapped.sleep, null);
  assert.equal(mapped.awake_now, false);
});

test("mapLastWakeTime ignores records missing a start", () => {
  const mapped = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      {
        id: "no-start",
        end: "2026-11-22T12:00:00.000Z",
        timezone_offset: "-05:00",
        score_state: "SCORED",
        nap: false,
      } as WhoopSleep,
      sleep({
        id: "empty-start",
        start: "",
        end: "2026-11-22T12:00:00.000Z",
      }),
    ],
  });
  assert.equal(mapped.sleep, null);
  assert.equal(mapped.awake_now, false);
});

test("mapLastWakeTime treats an invalid start as unusable even when end is valid", () => {
  const mapped = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "bad-start",
        start: "not-a-timestamp",
        end: "2026-11-22T12:00:00.000Z",
      }),
    ],
  });
  assert.equal(mapped.sleep, null);
  assert.equal(mapped.awake_now, true);
});

test("mapLastWakeTime treats a missing, empty, or invalid end as still asleep", () => {
  for (const end of [undefined, "", "not-a-timestamp"] as const) {
    const mapped = mapLastWakeTime({
      today: "2026-11-22",
      sleeps: [
        sleep({
          id: "open",
          start: "2026-11-22T04:00:00.000Z",
          end,
          score_state: "PENDING_SCORE",
        }),
      ],
    });
    assert.equal(mapped.sleep?.start, "2026-11-21T23:00:00.000-05:00");
    assert.equal(mapped.sleep?.end, null);
    assert.equal(mapped.sleep?.wake_date, null);
    assert.equal(mapped.sleep?.score_state, "PENDING_SCORE");
    assert.equal(mapped.awake_now, false, `end=${String(end)}`);
  }
});

test("mapLastWakeTime preserves UNSCORABLE and drops empty or non-string score_state", () => {
  const unscorable = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "unscorable",
        start: "2026-11-22T04:00:00.000Z",
        end: "2026-11-22T12:00:00.000Z",
        score_state: "UNSCORABLE",
      }),
    ],
  });
  assert.equal(unscorable.sleep?.score_state, "UNSCORABLE");
  assert.equal(unscorable.awake_now, true);

  const empty = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "empty-score",
        start: "2026-11-22T04:00:00.000Z",
        end: "2026-11-22T12:00:00.000Z",
        score_state: "",
      }),
    ],
  });
  assert.equal(empty.sleep?.score_state, null);

  const missing = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      {
        id: "no-score",
        start: "2026-11-22T04:00:00.000Z",
        end: "2026-11-22T12:00:00.000Z",
        timezone_offset: "-05:00",
        nap: false,
      } as WhoopSleep,
    ],
  });
  assert.equal(missing.sleep?.score_state, null);
});

test("mapLastWakeTime treats nap as a nap only when nap is strictly true", () => {
  const loose = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "string-nap",
        start: "2026-11-22T18:00:00.000Z",
        end: "2026-11-22T18:30:00.000Z",
        nap: "true" as unknown as boolean,
      }),
    ],
  });
  assert.equal(loose.sleep?.end, "2026-11-22T13:30:00.000-05:00");
  assert.equal(loose.awake_now, true);

  const omitted = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      {
        id: "no-nap-flag",
        start: "2026-11-22T04:00:00.000Z",
        end: "2026-11-22T12:00:00.000Z",
        timezone_offset: "-05:00",
        score_state: "SCORED",
      } as WhoopSleep,
    ],
  });
  assert.equal(omitted.sleep?.wake_date, "2026-11-22");
  assert.equal(omitted.awake_now, true);
});

test("mapLastWakeTime formats a wake after local midnight on the next calendar date", () => {
  const mapped = mapLastWakeTime({
    today: "2026-11-23",
    sleeps: [
      sleep({
        id: "after-midnight",
        start: "2026-11-22T04:30:00.000Z",
        end: "2026-11-23T05:15:00.000Z",
      }),
    ],
  });
  assert.equal(mapped.sleep?.start, "2026-11-21T23:30:00.000-05:00");
  assert.equal(mapped.sleep?.end, "2026-11-23T00:15:00.000-05:00");
  assert.equal(mapped.sleep?.wake_date, "2026-11-23");
  assert.equal(mapped.awake_now, true);
});

test("mapLastWakeTime uses the record offset on DST boundaries and does not invent a zone", () => {
  const spring = mapLastWakeTime({
    today: "2026-03-08",
    sleeps: [
      sleep({
        id: "spring-forward",
        start: "2026-03-08T04:30:00.000Z",
        end: "2026-03-08T11:00:00.000Z",
        timezone_offset: "-04:00",
      }),
    ],
  });
  assert.equal(spring.sleep?.start, "2026-03-08T00:30:00.000-04:00");
  assert.equal(spring.sleep?.end, "2026-03-08T07:00:00.000-04:00");
  assert.equal(spring.sleep?.wake_date, "2026-03-08");
  assert.equal(spring.sleep?.timezone_offset, "-04:00");
  assert.equal(spring.awake_now, true);

  const firstHour = mapLastWakeTime({
    today: "2026-11-01",
    sleeps: [
      sleep({
        id: "fall-back-edt",
        start: "2026-11-01T03:00:00.000Z",
        end: "2026-11-01T05:30:00.000Z",
        timezone_offset: "-04:00",
      }),
    ],
  });
  assert.equal(firstHour.sleep?.end, "2026-11-01T01:30:00.000-04:00");
  assert.equal(firstHour.sleep?.wake_date, "2026-11-01");
  assert.equal(firstHour.awake_now, true);

  const secondHour = mapLastWakeTime({
    today: "2026-11-01",
    sleeps: [
      sleep({
        id: "fall-back-est",
        start: "2026-11-01T03:00:00.000Z",
        end: "2026-11-01T06:30:00.000Z",
        timezone_offset: "-05:00",
      }),
    ],
  });
  assert.equal(secondHour.sleep?.end, "2026-11-01T01:30:00.000-05:00");
  assert.equal(secondHour.sleep?.wake_date, "2026-11-01");
  assert.equal(secondHour.awake_now, true);
});

test("awake_now is false when wake_date in the record offset is not today", () => {
  const mapped = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "tokyo-next-day",
        start: "2026-11-22T08:00:00.000Z",
        end: "2026-11-22T16:30:00.000Z",
        timezone_offset: "+09:00",
      }),
    ],
  });
  assert.equal(mapped.sleep?.end, "2026-11-23T01:30:00.000+09:00");
  assert.equal(mapped.sleep?.wake_date, "2026-11-23");
  assert.equal(mapped.sleep?.timezone_offset, "+09:00");
  assert.equal(mapped.awake_now, false);
});

test("mapLastWakeTime normalizes a missing or invalid timezone_offset to Z", () => {
  const missing = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      {
        id: "no-offset",
        start: "2026-11-22T07:04:00.000Z",
        end: "2026-11-22T12:04:00.000Z",
        score_state: "SCORED",
        nap: false,
      } as WhoopSleep,
    ],
  });
  assert.equal(missing.sleep?.start, "2026-11-22T07:04:00.000Z");
  assert.equal(missing.sleep?.end, "2026-11-22T12:04:00.000Z");
  assert.equal(missing.sleep?.wake_date, "2026-11-22");
  assert.equal(missing.sleep?.timezone_offset, "Z");
  assert.equal(missing.awake_now, true);

  const invalid = mapLastWakeTime({
    today: "2026-11-22",
    sleeps: [
      sleep({
        id: "named-zone",
        start: "2026-11-22T07:04:00.000Z",
        end: "2026-11-22T12:04:00.000Z",
        timezone_offset: "America/New_York",
      }),
    ],
  });
  assert.equal(invalid.sleep?.end, "2026-11-22T12:04:00.000Z");
  assert.equal(invalid.sleep?.timezone_offset, "Z");
});

test("getLastWakeTime retries once after HTTP 401 using a forced official token refresh", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-401-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: Date.now() + 3_600_000,
    token_type: "bearer",
    scope: "read:recovery read:sleep read:cycles offline",
  });

  const calls: Array<{ method: string; pathname: string; auth: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ method, pathname: url.pathname, auth });
    if (url.pathname === "/oauth/oauth2/token") {
      assert.equal(method, "POST");
      assert.equal(url.host, "api.prod.whoop.com");
      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "refresh-789",
          expires_in: 3600,
          token_type: "bearer",
          scope: "read:recovery read:sleep read:cycles offline",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    assert.equal(method, "GET");
    assert.equal(url.pathname, "/developer/v2/activity/sleep");
    assert.equal(url.searchParams.get("limit"), "5");
    if (auth === "Bearer access-123") {
      return new Response("expired", { status: 401 });
    }
    assert.equal(auth, "Bearer fresh-access");
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
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.pathname}`),
    ["GET /developer/v2/activity/sleep", "POST /oauth/oauth2/token", "GET /developer/v2/activity/sleep"],
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.awake_now, true);
  assert.equal(result.sleep?.end, "2026-11-22T07:04:00.000-05:00");
  assert.equal(readTokens(app.tokenPath)?.access_token, "fresh-access");
  assert.equal(fs.existsSync(app.intentPath), false);
});

test("getLastWakeTime records a failed 401 refresh and does not write", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-401-fail-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: Date.now() + 3_600_000,
    token_type: "bearer",
    scope: "read:recovery read:sleep read:cycles offline",
  });
  const methods: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    methods.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/oauth/oauth2/token") {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("expired", { status: 401 });
  };
  const result = await new WhoopClient(app, fetchImpl).getLastWakeTime("2026-11-22");
  assert.deepEqual(methods, ["GET /developer/v2/activity/sleep", "POST /oauth/oauth2/token"]);
  assert.equal(result.sleep, null);
  assert.equal(result.awake_now, false);
  assert.match(result.errors.join(" "), /sleep:.*invalid_grant/);
  assert.equal(readTokens(app.tokenPath)?.access_token, "access-123");
  assert.equal(fs.existsSync(app.intentPath), false);
});

test("getLastWakeTime records a missing token and does not call the API", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-no-token-"));
  const app = config(dir);
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error("fetch should not run");
  };
  const result = await new WhoopClient(app, fetchImpl).getLastWakeTime("2026-11-22");
  assert.equal(calls, 0);
  assert.equal(result.sleep, null);
  assert.equal(result.awake_now, false);
  assert.match(result.errors.join(" "), /no token stored/);
});

test("getLastWakeTime treats a missing or non-array records field as no sleeps", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-records-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: Date.now() + 3_600_000,
    token_type: "bearer",
    scope: "read:recovery read:sleep read:cycles offline",
  });
  for (const body of [{}, { records: null }, { records: { id: "nope" } }]) {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    const result = await new WhoopClient(app, fetchImpl).getLastWakeTime("2026-11-22");
    assert.equal(result.sleep, null);
    assert.equal(result.awake_now, false);
    assert.deepEqual(result.errors, []);
  }
});

test("getLastWakeTime records a malformed JSON body and does not write", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-json-"));
  const app = config(dir);
  writeTokens(app.tokenPath, {
    access_token: "access-123",
    refresh_token: "refresh-456",
    expires_at: Date.now() + 3_600_000,
    token_type: "bearer",
    scope: "read:recovery read:sleep read:cycles offline",
  });
  const fetchImpl: typeof fetch = async () =>
    new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } });
  const result = await new WhoopClient(app, fetchImpl).getLastWakeTime("2026-11-22");
  assert.equal(result.sleep, null);
  assert.equal(result.awake_now, false);
  assert.equal(result.errors.length > 0, true);
  assert.equal(fs.existsSync(app.intentPath), false);
});

test("lastWakeTime reports missing when no non-nap sleep is in the last 5 records", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-missing-"));
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    stubWhoop({
      async getLastWakeTime() {
        return { sleep: null, awake_now: true, errors: [] };
      },
    }),
    fixedClock("2026-11-22", "America/New_York"),
  );
  const result = await service.lastWakeTime();
  assert.equal(result.start, null);
  assert.equal(result.end, null);
  assert.equal(result.score_state, null);
  assert.equal(result.wake_date, null);
  assert.equal(result.awake_now, true);
  assert.equal(result.time_zone, "America/New_York");
  assert.deepEqual(result.missing, ["No non-nap sleep in the last 5 records."]);
});

test("lastWakeTime surfaces provider errors in missing and does not add the empty-sleep note", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-err-svc-"));
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    stubWhoop({
      async getLastWakeTime() {
        return { sleep: null, awake_now: false, errors: ["sleep: HTTP 403"] };
      },
    }),
    fixedClock("2026-11-22", "America/New_York"),
  );
  const result = await service.lastWakeTime();
  assert.equal(result.end, null);
  assert.equal(result.awake_now, false);
  assert.deepEqual(result.missing, ["sleep: HTTP 403"]);
});

test("lastWakeTime returns a blank result when the provider throws", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-throw-"));
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    stubWhoop({
      async getLastWakeTime() {
        throw new Error("Whoop read failed");
      },
    }),
    fixedClock("2026-11-22", "America/New_York"),
  );
  const result = await service.lastWakeTime();
  assert.equal(result.start, null);
  assert.equal(result.end, null);
  assert.equal(result.score_state, null);
  assert.equal(result.wake_date, null);
  assert.equal(result.awake_now, false);
  assert.equal(result.time_zone, "America/New_York");
  assert.deepEqual(result.missing, ["Whoop read failed"]);
});

test("lastWakeTime passes through an in-progress or unscorable sleep", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-states-"));
  const pending = await new CoachService(
    new JsonIntentStore(path.join(dir, "pending.json")),
    stubWhoop({
      async getLastWakeTime() {
        return {
          sleep: {
            start: "2026-11-21T23:00:00.000-05:00",
            end: null,
            score_state: "PENDING_SCORE",
            wake_date: null,
            timezone_offset: "-05:00",
          },
          awake_now: false,
          errors: [],
        };
      },
    }),
    fixedClock("2026-11-22", "America/New_York"),
  ).lastWakeTime();
  assert.equal(pending.end, null);
  assert.equal(pending.wake_date, null);
  assert.equal(pending.score_state, "PENDING_SCORE");
  assert.equal(pending.awake_now, false);
  assert.deepEqual(pending.missing, []);

  const unscorable = await new CoachService(
    new JsonIntentStore(path.join(dir, "unscorable.json")),
    stubWhoop({
      async getLastWakeTime() {
        return {
          sleep: {
            start: "2026-11-21T23:12:00.000-05:00",
            end: "2026-11-22T07:04:00.000-05:00",
            score_state: "UNSCORABLE",
            wake_date: "2026-11-22",
            timezone_offset: "-05:00",
          },
          awake_now: true,
          errors: [],
        };
      },
    }),
    fixedClock("2026-11-22", "America/New_York"),
  ).lastWakeTime();
  assert.equal(unscorable.end, "2026-11-22T07:04:00.000-05:00");
  assert.equal(unscorable.score_state, "UNSCORABLE");
  assert.equal(unscorable.awake_now, true);
  assert.deepEqual(unscorable.missing, []);
});

test("last_wake_time tool reports missing when no non-nap sleep is returned", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-sleep-tool-missing-"));
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    stubWhoop(),
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
  const called = (await rpc.call("tools/call", { name: "last_wake_time", arguments: {} })) as {
    structuredContent?: { end?: string | null; awake_now?: boolean; missing?: string[] };
  };
  assert.equal(called.structuredContent?.end, null);
  assert.equal(called.structuredContent?.awake_now, false);
  assert.deepEqual(called.structuredContent?.missing, ["No non-nap sleep in the last 5 records."]);
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


function stubWhoop(overrides: Partial<WhoopProvider> = {}): WhoopProvider {
  return {
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
      return { sleep: null, awake_now: false, errors: [] };
    },
    ...overrides,
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
