import assert from "node:assert/strict";
import test from "node:test";
import { localDateFromOffset } from "../src/dates.js";
import { mapWhoopDays } from "../src/whoop/map.js";

test("local date applies the Whoop timezone offset", () => {
  assert.equal(localDateFromOffset("2022-04-24T10:25:44.774Z", "-05:00"), "2022-04-24");
  assert.equal(localDateFromOffset("2022-04-24T03:30:00.000Z", "-05:00"), "2022-04-23");
});

test("maps scored recovery, sleep, and cycle strain onto the wake date", () => {
  const days = mapWhoopDays({
    timeZone: "America/New_York",
    recoveries: [
      {
        cycle_id: 93845,
        sleep_id: "123e4567-e89b-12d3-a456-426614174000",
        created_at: "2022-04-24T11:25:44.774Z",
        score_state: "SCORED",
        score: {
          recovery_score: 44,
          resting_heart_rate: 64,
          hrv_rmssd_milli: 31.813562,
        },
      },
    ],
    sleeps: [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        start: "2022-04-24T02:25:44.774Z",
        end: "2022-04-24T10:25:44.774Z",
        timezone_offset: "-05:00",
        nap: false,
        score_state: "SCORED",
        score: { sleep_performance_percentage: 98 },
      },
      {
        id: "nap",
        start: "2022-04-24T16:00:00.000Z",
        end: "2022-04-24T17:00:00.000Z",
        timezone_offset: "-05:00",
        nap: true,
        score_state: "SCORED",
        score: { sleep_performance_percentage: 10 },
      },
    ],
    cycles: [
      {
        id: 93845,
        start: "2022-04-24T02:25:44.774Z",
        end: "2022-04-24T10:25:44.774Z",
        timezone_offset: "-05:00",
        score_state: "SCORED",
        score: { strain: 5.2951527 },
      },
    ],
  });

  assert.equal(days.length, 1);
  assert.equal(days[0]?.date, "2022-04-24");
  assert.equal(days[0]?.recovery, 44);
  assert.equal(days[0]?.rhr, 64);
  assert.equal(days[0]?.hrv, 31.813562);
  assert.equal(days[0]?.sleep_performance, 98);
  assert.equal(days[0]?.strain, 5.2951527);
});

test("pending recovery is not turned into a score", () => {
  const days = mapWhoopDays({
    timeZone: "UTC",
    recoveries: [
      {
        cycle_id: 1,
        sleep_id: "missing",
        created_at: "2026-03-15T12:00:00.000Z",
        score_state: "PENDING_SCORE",
      },
    ],
    sleeps: [],
    cycles: [],
  });
  assert.equal(days.length, 0);
});
