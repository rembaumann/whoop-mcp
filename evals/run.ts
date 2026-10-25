import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, fixedClock } from "../src/dates.js";
import { CoachService } from "../src/logic/service.js";
import { JsonIntentStore } from "../src/store/intents.js";
import type { DayRecord, ExplainResult, IntentType, TrainingResult, WhoopProvider } from "../src/types.js";

interface Expectation {
  band?: string;
  call?: string | string[];
  matched_types?: string[];
  hypotheses_min?: number;
  hypothesis_themes_min?: number;
  evidence_empty?: boolean;
  evidence_metrics?: string[];
  missing_includes?: string;
  text_includes?: string[];
  text_forbids?: string[];
  alternate_includes?: string[];
}

interface FixtureIntent {
  date: string;
  type: IntentType;
  note?: string;
  body_area?: string;
}

interface EvalCase {
  id: string;
  title: string;
  tool: "explain_yesterday" | "today_training_call";
  input: { date?: string; planned_session?: string; optional_notes?: string };
  intents: FixtureIntent[];
  days: Record<string, Partial<DayRecord> | null>;
  expect: Expectation;
}

interface FixtureFile {
  timezone: string;
  today: string;
  baselines: { recovery: number; hrv: number; rhr: number; sleep_performance: number };
  cases: EvalCase[];
}

const DIAGNOSIS = [/you(?:'re| are) sick/i, /you(?:'re| are) ill\b/i, /you have (?:an )?illness/i];

const HYPOTHESIS_THEMES: RegExp[] = [
  /under-?logged strain/i,
  /unlogged (lifestyle|alcohol)/i,
  /illness-shaped/i,
  /sleep or sensor|sensor gap/i,
];

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "cases.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureFile;

const failures: string[] = [];

for (const evalCase of fixture.cases) {
  try {
    const result = await runCase(fixture, evalCase);
    assertCase(evalCase, result);
    console.log(`PASS ${evalCase.id} ${evalCase.title}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`FAIL ${evalCase.id} ${evalCase.title}: ${message}`);
    console.error(`FAIL ${evalCase.id} ${evalCase.title}`);
    console.error(message);
  }
}

try {
  await runSmoke(fixture);
  console.log("PASS smoke log drinks → explain yesterday → heavy squat call");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  failures.push(`FAIL smoke: ${message}`);
  console.error("FAIL smoke");
  console.error(message);
}

if (fixture.cases.length !== 10) {
  failures.push(`Expected 10 eval cases, found ${fixture.cases.length}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}

console.log(`\n${fixture.cases.length}/10 eval cases passed, smoke passed`);

async function runCase(file: FixtureFile, evalCase: EvalCase): Promise<ExplainResult | TrainingResult> {
  const { service } = buildService(file, evalCase.intents, evalCase.days);
  if (evalCase.tool === "explain_yesterday") {
    return service.explainYesterday(evalCase.input);
  }
  const planned = evalCase.input.planned_session;
  if (
    planned !== "heavy_squat" &&
    planned !== "heavy_deadlift" &&
    planned !== "heavy_bench" &&
    planned !== "accessories" &&
    planned !== "light" &&
    planned !== "rest"
  ) {
    throw new Error(`Case ${evalCase.id} is missing planned_session`);
  }
  return service.todayTrainingCall({
    planned_session: planned,
    optional_notes: evalCase.input.optional_notes,
  });
}

function assertCase(evalCase: EvalCase, result: ExplainResult | TrainingResult): void {
  const blob = JSON.stringify(result);
  const expect = evalCase.expect;

  for (const pattern of DIAGNOSIS) {
    assert.equal(pattern.test(blob), false, `diagnosis language matched ${pattern}`);
  }
  for (const phrase of expect.text_forbids ?? []) {
    assert.equal(blob.toLowerCase().includes(phrase.toLowerCase()), false, `forbidden phrase "${phrase}"`);
  }
  for (const phrase of expect.text_includes ?? []) {
    assert.equal(blob.includes(phrase), true, `missing text "${phrase}" in ${blob}`);
  }

  if ("band" in result) {
    if (expect.band) assert.equal(result.band, expect.band, `band ${result.band}`);
    if (expect.matched_types) {
      const actual = result.matched_intents.map((intent) => intent.type).sort();
      assert.deepEqual(actual, [...expect.matched_types].sort(), `matched intents ${actual.join(",")}`);
    }
    const logged = new Set(evalCase.intents.map((intent) => intent.type));
    for (const intent of result.matched_intents) {
      assert.equal(logged.has(intent.type), true, `invented intent ${intent.type}`);
    }
    if (result.band === "unexplained") {
      assert.ok(result.hypotheses && result.hypotheses.length >= (expect.hypotheses_min ?? 2), "hypotheses missing");
      const themeHits = HYPOTHESIS_THEMES.filter((theme) =>
        result.hypotheses!.some((item) => theme.test(`${item.label} ${item.detail}`)),
      );
      assert.ok(
        themeHits.length >= (expect.hypothesis_themes_min ?? 2),
        `hypothesis themes ${themeHits.length}`,
      );
    }
    if (expect.evidence_empty) assert.equal(result.evidence.length, 0, "evidence should be empty");
    for (const metric of expect.evidence_metrics ?? []) {
      assert.ok(
        result.evidence.some((item) => item.metric === metric && item.value != null),
        `evidence missing ${metric}`,
      );
    }
    if (expect.missing_includes) {
      assert.match(result.missing.join(" "), new RegExp(expect.missing_includes, "i"));
    }
    if (result.band !== "insufficient_data") {
      assert.ok(
        result.evidence.some((item) => item.metric === "recovery" && item.value != null && item.baseline != null),
        "recovery evidence should cite a value and a baseline",
      );
    }
  }

  if ("call" in result) {
    const allowed = expect.call == null ? [] : Array.isArray(expect.call) ? expect.call : [expect.call];
    assert.ok(allowed.includes(result.call), `call ${result.call} not in ${allowed.join("|")}`);
    if (result.call !== "go") {
      assert.equal(typeof result.alternate, "string");
      assert.ok(result.alternate && result.alternate.trim().length > 0, "alternate required when call is not go");
    }
    for (const phrase of expect.alternate_includes ?? []) {
      assert.ok(result.alternate?.includes(phrase), `alternate missing "${phrase}": ${result.alternate}`);
    }
  }
}

async function runSmoke(file: FixtureFile): Promise<void> {
  const days: Record<string, Partial<DayRecord> | null> = {
    "2026-03-15": { recovery: 36, hrv: 48, rhr: 58, sleep_performance: 71 },
    "2026-03-16": { recovery: 38, hrv: 50, rhr: 57, sleep_performance: 74 },
  };
  const whoop = trackingProvider(buildDays(file, days));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-mcp-smoke-"));
  const store = new JsonIntentStore(path.join(dir, "intents.json"));
  const service = new CoachService(store, whoop, fixedClock(file.today, file.timezone));

  const logged = service.logIntent({ type: "drinks", date: "2026-03-15", note: "two drinks" });
  assert.equal(logged.count_on_date, 1);
  assert.equal(logged.intent.type, "drinks");
  assert.equal(whoop.calls.length, 0, "log_intent must not call Whoop");

  const explained = await service.explainYesterday({});
  assert.equal(explained.band, "expected");
  assert.ok(explained.matched_intents.some((intent) => intent.type === "drinks"));
  assert.ok(whoop.calls.every((call) => call.startsWith("getDays ")));

  const call = await service.todayTrainingCall({
    planned_session: "heavy_squat",
    optional_notes: "Day 4",
  });
  assert.notEqual(call.call, "go");
  assert.ok(call.alternate && call.alternate.trim().length > 0);
  assert.equal(DIAGNOSIS.some((pattern) => pattern.test(JSON.stringify({ explained, call }))), false);

  const onDisk = fs.readFileSync(path.join(dir, "intents.json"), "utf8");
  assert.match(onDisk, /drinks/);
  assert.doesNotMatch(onDisk, /api\.prod\.whoop\.com/);
}

function buildService(
  file: FixtureFile,
  intents: FixtureIntent[],
  overlays: Record<string, Partial<DayRecord> | null>,
): { service: CoachService } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-mcp-eval-"));
  const store = new JsonIntentStore(path.join(dir, "intents.json"));
  const service = new CoachService(store, trackingProvider(buildDays(file, overlays)), fixedClock(file.today, file.timezone));
  for (const intent of intents) service.logIntent(intent);
  return { service };
}

function buildDays(file: FixtureFile, overlays: Record<string, Partial<DayRecord> | null>): DayRecord[] {
  const start = addDays(file.today, -20);
  const days: DayRecord[] = [];
  for (let date = start; date <= file.today; date = addDays(date, 1)) {
    days.push({
      date,
      recovery: file.baselines.recovery,
      hrv: file.baselines.hrv,
      rhr: file.baselines.rhr,
      sleep_performance: file.baselines.sleep_performance,
      strain: null,
    });
  }
  for (const [date, overlay] of Object.entries(overlays)) {
    const index = days.findIndex((day) => day.date === date);
    if (overlay == null) {
      if (index >= 0) days.splice(index, 1);
      continue;
    }
    if (index < 0) {
      days.push({
        date,
        recovery: null,
        hrv: null,
        rhr: null,
        sleep_performance: null,
        strain: null,
        ...overlay,
      });
    } else {
      days[index] = { ...days[index], ...overlay, date };
    }
  }
  return days;
}

function trackingProvider(days: DayRecord[]): WhoopProvider & { calls: string[] } {
  return {
    calls: [],
    async getDays(start, end) {
      this.calls.push(`getDays ${start} ${end}`);
      return {
        days: days.filter((day) => day.date >= start && day.date <= end),
        errors: [],
      };
    },
  };
}
