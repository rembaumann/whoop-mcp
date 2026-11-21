import { localDateFromOffset } from "../dates.js";
import { NULL_STEP_COUNT, type StepCycle, type StepsReadResult } from "../types.js";
import type { WhoopCycle as CycleRecord } from "./types.js";

const WAKE_TO_WAKE = "A WHOOP cycle runs wake-to-wake, not midnight-to-midnight.";

/**
 * Numeric step_count from a cycle record. Null, missing, and non-numbers are not available.
 * They are not coerced (Number(null) and Number("") are 0). A numeric 0 stays 0.
 */
export function readStepCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function mapCycleSteps(input: {
  cycles: CycleRecord[];
  startDate: string;
  endDate: string;
}): Omit<StepsReadResult, "errors"> {
  const cycles = input.cycles.filter(isCycle);
  const open = cycles
    .filter((cycle) => isOpen(cycle))
    .sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  const currentSource = open.at(-1) ?? null;
  const current = currentSource ? toRecord(currentSource, "partial") : null;

  const seen = new Set<number>();
  const recent: StepCycle[] = [];
  for (const cycle of cycles) {
    if (isOpen(cycle)) continue;
    if (current && cycle.id === current.cycle_id) continue;
    if (seen.has(cycle.id)) continue;
    const record = toRecord(cycle, "complete");
    if (!record) continue;
    if (record.date < input.startDate || record.date > input.endDate) continue;
    seen.add(cycle.id);
    recent.push(record);
  }
  recent.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.cycle_id - b.cycle_id);

  const counted = recent.filter((cycle) => cycle.step_count != null);
  return {
    current,
    recent,
    baseline_step_count: mean(counted.map((cycle) => cycle.step_count)),
    baseline_cycles_counted: counted.length,
    baseline_cycles_omitted: recent.length - counted.length,
  };
}

function isCycle(value: CycleRecord | null | undefined): value is CycleRecord {
  return value != null && typeof value.id === "number" && typeof value.start === "string" && value.start.length > 0;
}

/** OpenAPI: `end` is omitted while the member is in the cycle. */
function isOpen(cycle: CycleRecord): boolean {
  return typeof cycle.end !== "string" || cycle.end.length === 0;
}

function toRecord(cycle: CycleRecord, coverage: StepCycle["coverage"]): StepCycle | null {
  const offset = cycle.timezone_offset || "Z";
  const anchor = coverage === "complete" ? cycle.end : cycle.start;
  if (typeof anchor !== "string" || anchor.length === 0) return null;
  let date: string;
  try {
    date = localDateFromOffset(anchor, offset);
  } catch {
    return null;
  }
  const stepCount = readStepCount(cycle.step_count);
  return {
    cycle_id: cycle.id,
    start: cycle.start,
    end: coverage === "complete" ? anchor : null,
    date,
    step_count: stepCount,
    step_count_label: labelFor(stepCount, coverage),
    coverage,
    note: noteFor(stepCount, coverage, cycle.start),
  };
}

function labelFor(stepCount: number | null, coverage: StepCycle["coverage"]): string {
  if (stepCount == null) return NULL_STEP_COUNT;
  const formatted = formatSteps(stepCount);
  return coverage === "partial" ? `${formatted} so far` : formatted;
}

function noteFor(stepCount: number | null, coverage: StepCycle["coverage"], start: string): string {
  if (coverage === "partial") {
    const steps =
      stepCount == null
        ? `step count is ${NULL_STEP_COUNT}, not zero.`
        : `${formatSteps(stepCount)} steps so far.`;
    return `Partial: ${steps} Open cycle started at ${start}. ${WAKE_TO_WAKE} This value updates during the day and is not a finished total.`;
  }
  if (stepCount == null) {
    return `Completed cycle. Step count is ${NULL_STEP_COUNT}, not zero. ${WAKE_TO_WAKE}`;
  }
  return `Completed cycle total: ${formatSteps(stepCount)} steps. ${WAKE_TO_WAKE}`;
}

function formatSteps(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function mean(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (nums.length === 0) return null;
  const average = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  return Math.round(average * 10) / 10;
}
