import assert from "node:assert/strict";
import test from "node:test";
import { baselinesBefore, isMateriallyOff, isSeverelyLow } from "../src/logic/metrics.js";
import type { Baselines, DayRecord } from "../src/types.js";

const baselines: Baselines = {
  recovery: 55,
  hrv: 60,
  rhr: 54,
  sleep_performance: 82,
  strain: null,
};

function day(partial: Partial<DayRecord>): DayRecord {
  return {
    date: "2026-03-15",
    recovery: 55,
    hrv: 60,
    rhr: 54,
    sleep_performance: 82,
    strain: null,
    ...partial,
  };
}

test("material threshold matches evals/cases.md", () => {
  assert.equal(isMateriallyOff(day({ recovery: 40 }), baselines), true);
  assert.equal(isMateriallyOff(day({ recovery: 41 }), baselines), false);
  assert.equal(isMateriallyOff(day({ hrv: 51 }), baselines), true);
  assert.equal(isMateriallyOff(day({ hrv: 52 }), baselines), false);
  assert.equal(isMateriallyOff(day({ rhr: 60 }), baselines), true);
  assert.equal(isMateriallyOff(day({ rhr: 59 }), baselines), false);
});

test("severe threshold is recovery <= 25 or RHR baseline + 10", () => {
  assert.equal(isSeverelyLow(day({ recovery: 25 }), baselines), true);
  assert.equal(isSeverelyLow(day({ recovery: 26, rhr: 63 }), baselines), false);
  assert.equal(isSeverelyLow(day({ recovery: 38, rhr: 64 }), baselines), true);
});

test("14-day baseline excludes the target date", () => {
  const days: DayRecord[] = [];
  for (let index = 1; index <= 14; index += 1) {
    const dayNumber = String(index).padStart(2, "0");
    days.push(day({ date: `2026-03-${dayNumber}`, recovery: 55, hrv: 60, rhr: 54, sleep_performance: 82 }));
  }
  days.push(day({ date: "2026-03-15", recovery: 10, hrv: 10, rhr: 90, sleep_performance: 10 }));
  const computed = baselinesBefore(days, "2026-03-15");
  assert.equal(computed.recovery, 55);
  assert.equal(computed.hrv, 60);
  assert.equal(computed.rhr, 54);
  assert.equal(computed.sleep_performance, 82);
});
