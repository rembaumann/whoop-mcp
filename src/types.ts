export const INTENT_TYPES = [
  "drinks",
  "late_night",
  "travel",
  "hard_life",
  "hard_training",
  "niggle",
  "other",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

export interface Intent {
  id: string;
  date: string;
  type: IntentType;
  note?: string;
  body_area?: string;
  created_at: string;
}

/** One local day of Whoop metrics. Null means the field was not scored. */
export interface DayRecord {
  date: string;
  recovery: number | null;
  hrv: number | null;
  rhr: number | null;
  sleep_performance: number | null;
  strain: number | null;
}

export interface WhoopReadResult {
  days: DayRecord[];
  errors: string[];
}

/** Shown wherever a cycle has no numeric step_count. Never render that case as 0. */
export const NULL_STEP_COUNT = "not available" as const;

/** How baseline_step_count is computed. Kept on the tool payload so a null baseline is not read as zero. */
export const STEP_BASELINE_NOTE =
  "Mean of completed cycles in this window with a numeric step_count. Null and missing step counts are omitted, not treated as zero. The open cycle's partial count is not included.";

/** One wake-to-wake cycle's steps. step_count null means Whoop had no step data. */
export interface StepCycle {
  cycle_id: number;
  /** ISO start. For the open cycle this is when the so-far count began. */
  start: string;
  /** ISO end of a completed cycle. Null while the cycle is still open. */
  end: string | null;
  /** Local date of `end` for a completed cycle, or of `start` while the cycle is open. */
  date: string;
  step_count: number | null;
  /** Number, "N so far" while open, or "not available". */
  step_count_label: string;
  /** "partial" is steps so far. "complete" is a finished cycle total. */
  coverage: "partial" | "complete";
  note: string;
}

export interface StepsReadResult {
  current: StepCycle | null;
  recent: StepCycle[];
  baseline_step_count: number | null;
  baseline_cycles_counted: number;
  baseline_cycles_omitted: number;
  errors: string[];
}

export interface StepsResult {
  window: { start: string; end: string; time_zone: string };
  current: StepCycle | null;
  recent: StepCycle[];
  baseline_step_count: number | null;
  baseline_cycles_counted: number;
  baseline_cycles_omitted: number;
  baseline_note: string;
  null_step_count: typeof NULL_STEP_COUNT;
  missing: string[];
}

/** Read-only Whoop access. v0 never writes lifestyle data or step counts back to Whoop. */
export interface WhoopProvider {
  getDays(startDate: string, endDate: string): Promise<WhoopReadResult>;
  getSteps(startDate: string, endDate: string): Promise<StepsReadResult>;
}

export interface Clock {
  timeZone: string;
  now(): Date;
}

export interface Evidence {
  metric: string;
  value: number | null;
  baseline: number | null;
  delta: number | null;
  unit: string | null;
  text: string;
}

export interface Hypothesis {
  id: string;
  label: string;
  detail: string;
}

export type Band = "expected" | "unexplained" | "insufficient_data";

export interface ExplainResult {
  date: string;
  band: Band;
  summary: string;
  evidence: Evidence[];
  matched_intents: Intent[];
  hypotheses?: Hypothesis[];
  missing: string[];
}

export const PLANNED_SESSIONS = [
  "heavy_squat",
  "heavy_deadlift",
  "heavy_bench",
  "accessories",
  "light",
  "rest",
] as const;

export type PlannedSession = (typeof PLANNED_SESSIONS)[number];

export type TrainingCall = "go" | "go_lighter" | "swap" | "rest";

export interface TrainingResult {
  call: TrainingCall;
  rationale: string;
  alternate: string | null;
  evidence: Evidence[];
  missing: string[];
}

export interface LogIntentResult {
  confirmation: string;
  intent: Intent;
  count_on_date: number;
}

export interface Baselines {
  recovery: number | null;
  hrv: number | null;
  rhr: number | null;
  sleep_performance: number | null;
  strain: number | null;
}
