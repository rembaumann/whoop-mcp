import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WhoopClient, type TokenProvider } from "../src/whoop/client.js";
import { AuthRequiredError, WhoopApiError } from "../src/whoop/errors.js";
import { cycle, recovery } from "./fixtures.js";

const BASE = "https://api.test/developer";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("WhoopClient", () => {
  it("sends the bearer token and WHOOP query parameter names", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const tokens: TokenProvider = {
      async getAccessToken() {
        return "access-1";
      },
      async forceRefresh() {
        throw new Error("should not refresh");
      },
    };
    const client = new WhoopClient({
      tokens,
      baseUrl: BASE,
      fetchImpl: async (input, init) => {
        const url = input instanceof URL ? input : new URL(String(input));
        requests.push({
          url: url.toString(),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return jsonResponse({ records: [cycle], next_token: "next-page" });
      },
    });

    const page = await client.listCycles({
      limit: 10,
      start: "2022-04-24T00:00:00.000Z",
      end: "2022-04-25T00:00:00.000Z",
      nextToken: "cursor",
    });

    assert.equal(page.next_token, "next-page");
    assert.equal(page.records?.[0]?.score?.strain, 5.2951527);
    const url = new URL(requests[0]!.url);
    assert.equal(url.pathname, "/developer/v2/cycle");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("start"), "2022-04-24T00:00:00.000Z");
    assert.equal(url.searchParams.get("end"), "2022-04-25T00:00:00.000Z");
    assert.equal(url.searchParams.get("nextToken"), "cursor");
    assert.equal(requests[0]!.authorization, "Bearer access-1");
  });

  it("refreshes once after a 401 and retries with the new token", async () => {
    const authorizations: string[] = [];
    let refreshes = 0;
    const tokens: TokenProvider = {
      async getAccessToken() {
        return refreshes === 0 ? "expired" : "fresh";
      },
      async forceRefresh(stale) {
        assert.equal(stale, "expired");
        refreshes += 1;
        return "fresh";
      },
    };
    const client = new WhoopClient({
      tokens,
      baseUrl: BASE,
      fetchImpl: async (_input, init) => {
        const authorization = new Headers(init?.headers).get("authorization");
        authorizations.push(authorization ?? "");
        if (authorization === "Bearer expired") return jsonResponse({ error: "expired" }, 401);
        return jsonResponse(recovery);
      },
    });

    const result = await client.getRecoveryForCycle(93845);
    assert.equal(result.score?.recovery_score, 44);
    assert.deepEqual(authorizations, ["Bearer expired", "Bearer fresh"]);
    assert.equal(refreshes, 1);
  });

  it("does not loop when the refreshed token is also rejected", async () => {
    let calls = 0;
    const client = new WhoopClient({
      tokens: {
        async getAccessToken() {
          return calls === 0 ? "expired" : "still-bad";
        },
        async forceRefresh() {
          return "still-bad";
        },
      },
      baseUrl: BASE,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ message: "nope" }, 401);
      },
    });

    await assert.rejects(() => client.getProfile(), AuthRequiredError);
    assert.equal(calls, 2);
  });

  it("reports rate-limit resets from WHOOP headers", async () => {
    const client = new WhoopClient({
      tokens: {
        async getAccessToken() {
          return "access";
        },
        async forceRefresh() {
          return "access";
        },
      },
      baseUrl: BASE,
      fetchImpl: async () => jsonResponse({ message: "slow down" }, 429, { "x-ratelimit-reset": "3" }),
    });

    await assert.rejects(() => client.listWorkouts(), (error: unknown) => {
      assert.ok(error instanceof WhoopApiError);
      assert.equal(error.status, 429);
      assert.match(error.message, /3 seconds/);
      return true;
    });
  });

  it("encodes activity ids and uses the documented paths", async () => {
    const paths: string[] = [];
    const client = new WhoopClient({
      tokens: {
        async getAccessToken() {
          return "access";
        },
        async forceRefresh() {
          return "access";
        },
      },
      baseUrl: BASE,
      fetchImpl: async (input) => {
        paths.push(input instanceof URL ? input.pathname : new URL(String(input)).pathname);
        return jsonResponse({ ok: true });
      },
    });

    await client.getSleep("ecfc6a15-4661-442f-a9a4-f160dd7afae8");
    await client.getWorkout("ecfc6a15-4661-442f-a9a4-f160dd7afae8");
    await client.getSleepForCycle(93845);
    await client.getBodyMeasurement();
    assert.deepEqual(paths, [
      "/developer/v2/activity/sleep/ecfc6a15-4661-442f-a9a4-f160dd7afae8",
      "/developer/v2/activity/workout/ecfc6a15-4661-442f-a9a4-f160dd7afae8",
      "/developer/v2/cycle/93845/sleep",
      "/developer/v2/user/measurement/body",
    ]);
  });
});
