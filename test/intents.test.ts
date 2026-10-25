import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fixedClock } from "../src/dates.js";
import { CoachService } from "../src/logic/service.js";
import { JsonIntentStore } from "../src/store/intents.js";
import type { WhoopProvider } from "../src/types.js";

test("log_intent writes only the local store and counts the day", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-intents-"));
  const calls: string[] = [];
  const whoop: WhoopProvider = {
    async getDays() {
      calls.push("getDays");
      return { days: [], errors: [] };
    },
  };
  const service = new CoachService(
    new JsonIntentStore(path.join(dir, "intents.json")),
    whoop,
    fixedClock("2026-03-16", "America/New_York"),
  );

  assert.throws(() => service.logIntent({ type: "niggle" }), /body_area/);
  const first = service.logIntent({ type: "drinks", note: "one beer" });
  const second = service.logIntent({ type: "late_night", date: "2026-03-16" });
  assert.equal(first.count_on_date, 1);
  assert.equal(second.count_on_date, 2);
  assert.equal(first.intent.date, "2026-03-16");
  assert.deepEqual(calls, []);

  const file = fs.readFileSync(path.join(dir, "intents.json"), "utf8");
  assert.match(file, /drinks/);
  assert.match(file, /late_night/);
  const mode = fs.statSync(path.join(dir, "intents.json")).mode & 0o777;
  assert.equal(mode, 0o600);
});
