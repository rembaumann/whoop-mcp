import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, it } from "node:test";
import type { StoredTokens } from "../src/auth/store.js";
import { createWhoopServer } from "../src/server.js";
import type { WhoopApi } from "../src/whoop/client.js";
import type { CollectionQuery } from "../src/whoop/types.js";
import { bodyMeasurement, cycle, profile, recovery, sleep, workout } from "./fixtures.js";

class FakeWhoop implements WhoopApi {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  getProfile() {
    return this.record("getProfile", [], profile);
  }
  getBodyMeasurement() {
    return this.record("getBodyMeasurement", [], bodyMeasurement);
  }
  listCycles(query?: CollectionQuery) {
    return this.record("listCycles", [query], { records: [cycle], next_token: "MTIzOjEyMzEyMw" });
  }
  getCycle(cycleId: number) {
    return this.record("getCycle", [cycleId], cycle);
  }
  listRecoveries(query?: CollectionQuery) {
    return this.record("listRecoveries", [query], { records: [recovery] });
  }
  getRecoveryForCycle(cycleId: number) {
    return this.record("getRecoveryForCycle", [cycleId], recovery);
  }
  listSleep(query?: CollectionQuery) {
    return this.record("listSleep", [query], { records: [sleep] });
  }
  getSleep(sleepId: string) {
    return this.record("getSleep", [sleepId], sleep);
  }
  getSleepForCycle(cycleId: number) {
    return this.record("getSleepForCycle", [cycleId], sleep);
  }
  listWorkouts(query?: CollectionQuery) {
    return this.record("listWorkouts", [query], { records: [workout] });
  }
  getWorkout(workoutId: string) {
    return this.record("getWorkout", [workoutId], workout);
  }
  revokeAccess() {
    return this.record("revokeAccess", [], undefined);
  }

  private record<T>(method: string, args: unknown[], value: T): Promise<T> {
    this.calls.push({ method, args });
    return Promise.resolve(value);
  }
}

async function connect(api: WhoopApi, tokens: StoredTokens | null = null) {
  const server = createWhoopServer({
    client: api,
    tokenStore: {
      filePath: "/tmp/whoop-tokens.json",
      async read() {
        return tokens;
      },
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content[0];
  assert.ok(block && block.type === "text" && block.text);
  return block.text;
}

describe("MCP tools", () => {
  it("lists the read tools", async () => {
    const client = await connect(new FakeWhoop());
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        "whoop_auth_status",
        "whoop_get_body_measurement",
        "whoop_get_cycle",
        "whoop_get_profile",
        "whoop_get_recovery_for_cycle",
        "whoop_get_sleep",
        "whoop_get_sleep_for_cycle",
        "whoop_get_workout",
        "whoop_list_cycles",
        "whoop_list_recoveries",
        "whoop_list_sleep",
        "whoop_list_workouts",
      ],
    );
    await client.close();
  });

  it("returns profile, body, recovery, sleep, cycle, and workout payloads", async () => {
    const api = new FakeWhoop();
    const client = await connect(api);

    const profileResult = JSON.parse(textOf(await client.callTool({ name: "whoop_get_profile", arguments: {} })));
    assert.equal(profileResult.email, "jsmith123@whoop.com");

    const body = JSON.parse(textOf(await client.callTool({ name: "whoop_get_body_measurement", arguments: {} })));
    assert.equal(body.height_meter, 1.8288);

    const cycles = JSON.parse(
      textOf(
        await client.callTool({
          name: "whoop_list_cycles",
          arguments: { start: "2022-04-24", end: "2022-04-24", limit: 10, next_token: "page-1" },
        }),
      ),
    );
    assert.equal(cycles.records[0].score.strain, 5.2951527);
    assert.equal(cycles.next_token, "MTIzOjEyMzEyMw");
    assert.deepEqual(api.calls.find((call) => call.method === "listCycles")?.args[0], {
      limit: 10,
      start: "2022-04-24T00:00:00.000Z",
      end: "2022-04-25T00:00:00.000Z",
      nextToken: "page-1",
    });

    const oneCycle = JSON.parse(
      textOf(await client.callTool({ name: "whoop_get_cycle", arguments: { cycle_id: 93845 } })),
    );
    assert.equal(oneCycle.id, 93845);

    const recoveries = JSON.parse(textOf(await client.callTool({ name: "whoop_list_recoveries", arguments: {} })));
    assert.equal(recoveries.records[0].score.hrv_rmssd_milli, 31.813562);

    const oneRecovery = JSON.parse(
      textOf(await client.callTool({ name: "whoop_get_recovery_for_cycle", arguments: { cycle_id: 93845 } })),
    );
    assert.equal(oneRecovery.sleep_id, recovery.sleep_id);

    const sleeps = JSON.parse(textOf(await client.callTool({ name: "whoop_list_sleep", arguments: {} })));
    assert.equal(sleeps.records[0].score.stage_summary.total_rem_sleep_time_milli, 5879573);

    const oneSleep = JSON.parse(
      textOf(await client.callTool({ name: "whoop_get_sleep", arguments: { sleep_id: sleep.id } })),
    );
    assert.equal(oneSleep.nap, false);

    const cycleSleep = JSON.parse(
      textOf(await client.callTool({ name: "whoop_get_sleep_for_cycle", arguments: { cycle_id: 93845 } })),
    );
    assert.equal(cycleSleep.id, sleep.id);

    const workouts = JSON.parse(textOf(await client.callTool({ name: "whoop_list_workouts", arguments: {} })));
    assert.equal(workouts.records[0].sport_name, "running");
    assert.equal(workouts.records[0].score.zone_durations.zone_five_milli, 300000);

    const oneWorkout = JSON.parse(
      textOf(await client.callTool({ name: "whoop_get_workout", arguments: { workout_id: workout.id } })),
    );
    assert.equal(oneWorkout.score.distance_meter, 1772.77035916);

    await client.close();
  });

  it("returns a tool error for a bad sleep id without calling WHOOP", async () => {
    const api = new FakeWhoop();
    const client = await connect(api);
    const result = await client.callTool({
      name: "whoop_get_sleep",
      arguments: { sleep_id: "../user/profile/basic" },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /sleep_id/);
    assert.equal(api.calls.length, 0);
    await client.close();
  });

  it("reports auth status without tokens", async () => {
    const client = await connect(new FakeWhoop(), {
      access_token: "do-not-leak",
      refresh_token: "also-secret",
      expires_at: Date.parse("2026-04-24T00:00:00.000Z"),
      token_type: "bearer",
      scope: "read:profile offline",
    });
    const status = JSON.parse(textOf(await client.callTool({ name: "whoop_auth_status", arguments: {} })));
    assert.equal(status.authenticated, true);
    assert.equal(status.scope, "read:profile offline");
    assert.equal(JSON.stringify(status).includes("do-not-leak"), false);
    assert.equal(JSON.stringify(status).includes("also-secret"), false);
    await client.close();
  });
});
