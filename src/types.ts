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

/** Read-only Whoop access. v0 never writes lifestyle data back to Whoop. */
export interface WhoopProvider {
  getDays(startDate: string, endDate: string): Promise<WhoopReadResult>;
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
