import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InputError } from "../src/whoop/errors.js";
import { assertActivityId, assertCycleId, toWhoopCollectionQuery } from "../src/whoop/query.js";

describe("collection query", () => {
  it("maps next_token to nextToken and keeps an explicit limit", () => {
    assert.deepEqual(
      toWhoopCollectionQuery({
        limit: 25,
        start: "2022-04-24T02:25:44.774Z",
        end: "2022-04-24T10:25:44.774Z",
        next_token: "MTIzOjEyMzEyMw",
      }),
      {
        limit: 25,
        start: "2022-04-24T02:25:44.774Z",
        end: "2022-04-24T10:25:44.774Z",
        nextToken: "MTIzOjEyMzEyMw",
      },
    );
  });

  it("treats a date-only end as an exclusive UTC bound", () => {
    assert.deepEqual(toWhoopCollectionQuery({ start: "2022-04-24", end: "2022-04-24" }), {
      start: "2022-04-24T00:00:00.000Z",
      end: "2022-04-25T00:00:00.000Z",
    });
  });

  it("converts zoned timestamps to UTC", () => {
    const query = toWhoopCollectionQuery({ end: "2022-04-24T10:25:44.774-05:00" });
    assert.equal(query.end, "2022-04-24T15:25:44.774Z");
  });

  it("rejects a page size above WHOOP's maximum of 25", () => {
    assert.throws(() => toWhoopCollectionQuery({ limit: 26 }), InputError);
  });

  it("rejects a calendar date that does not exist", () => {
    assert.throws(() => toWhoopCollectionQuery({ start: "2022-02-31" }), /not a real calendar date/);
  });

  it("rejects ids that could change the request path", () => {
    assert.throws(() => assertActivityId("../profile", "sleep_id"), InputError);
    assert.equal(assertActivityId("ecfc6a15-4661-442f-a9a4-f160dd7afae8", "sleep_id"), "ecfc6a15-4661-442f-a9a4-f160dd7afae8");
    assert.throws(() => assertCycleId(0), InputError);
    assert.equal(assertCycleId(93845), 93845);
  });
});
