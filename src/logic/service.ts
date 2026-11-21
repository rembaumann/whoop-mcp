import { addDays, isIsoDate, todayInZone } from "../dates.js";
import { JsonIntentStore } from "../store/intents.js";
import {
  NULL_STEP_COUNT,
  STEP_BASELINE_NOTE,
  type Clock,
  type ExplainResult,
  type IntentType,
  type LogIntentResult,
  type PlannedSession,
  type StepsResult,
  type TrainingResult,
  type WhoopProvider,
} from "../types.js";
import { explainDay } from "./explain.js";
import { trainingCall } from "./training.js";

const DEFAULT_STEP_DAYS = 14;
const MAX_STEP_DAYS = 30;

const INTENT_TYPES = new Set<IntentType>([
  "drinks",
  "late_night",
  "travel",
  "hard_life",
  "hard_training",
  "niggle",
  "other",
]);

export class CoachService {
  constructor(
    private readonly store: JsonIntentStore,
    private readonly whoop: WhoopProvider,
    private readonly clock: Clock,
  ) {}

  logIntent(input: {
    date?: string;
    type: IntentType;
    note?: string;
    body_area?: string;
  }): LogIntentResult {
    if (!INTENT_TYPES.has(input.type)) {
      throw new Error(`type must be one of ${[...INTENT_TYPES].join(", ")}.`);
    }
    const date = input.date ?? todayInZone(this.clock);
    if (!isIsoDate(date)) throw new Error("date must be YYYY-MM-DD.");
    const bodyArea = input.body_area?.trim();
    if (input.type === "niggle" && !bodyArea) {
      throw new Error("body_area is required when type is niggle.");
    }
    const note = input.note?.trim();
    const intent = this.store.add({
      date,
      type: input.type,
      note: note || undefined,
      body_area: bodyArea || undefined,
    });
    const count = this.store.list().filter((item) => item.date === date).length;
    return {
      confirmation: `Stored ${intent.type} intent for ${date}.`,
      intent,
      count_on_date: count,
    };
  }

  async explainYesterday(input: { date?: string } = {}): Promise<ExplainResult> {
    const date = input.date ?? addDays(todayInZone(this.clock), -1);
    if (!isIsoDate(date)) throw new Error("date must be YYYY-MM-DD.");
    try {
      const read = await this.whoop.getDays(addDays(date, -21), date);
      return explainDay({
        date,
        intents: this.store.list(),
        days: read.days,
        errors: read.errors,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Whoop read failed";
      return {
        date,
        band: "insufficient_data",
        summary: `Whoop data could not be read for ${date}.`,
        evidence: [],
        matched_intents: [],
        missing: ["recovery", message],
      };
    }
  }

  async todayTrainingCall(input: {
    planned_session: PlannedSession;
    optional_notes?: string;
  }): Promise<TrainingResult> {
    const today = todayInZone(this.clock);
    let days: Awaited<ReturnType<WhoopProvider["getDays"]>>["days"] = [];
    let errors: string[] = [];
    try {
      const read = await this.whoop.getDays(addDays(today, -21), today);
      days = read.days;
      errors = read.errors;
    } catch (err) {
      errors = [err instanceof Error ? err.message : "Whoop read failed"];
    }
    const yesterday = await this.explainYesterday({});
    return trainingCall({
      planned_session: input.planned_session,
      optional_notes: input.optional_notes,
      today,
      days,
      errors,
      intents: this.store.list(),
      yesterday,
    });
  }

  /**
   * Open-cycle steps so far, plus completed wake-to-wake totals.
   * Null step counts stay null and are left out of the baseline.
   */
  async getSteps(input: { days?: number } = {}): Promise<StepsResult> {
    const days = input.days ?? DEFAULT_STEP_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > MAX_STEP_DAYS) {
      throw new Error(`days must be an integer from 1 to ${MAX_STEP_DAYS}.`);
    }
    const end = todayInZone(this.clock);
    const start = addDays(end, 1 - days);
    const window = { start, end, time_zone: this.clock.timeZone };
    const blank = (missing: string[]): StepsResult => ({
      window,
      current: null,
      recent: [],
      baseline_step_count: null,
      baseline_cycles_counted: 0,
      baseline_cycles_omitted: 0,
      baseline_note: STEP_BASELINE_NOTE,
      null_step_count: NULL_STEP_COUNT,
      missing,
    });
    try {
      const read = await this.whoop.getSteps(start, end);
      return {
        window,
        current: read.current,
        recent: read.recent,
        baseline_step_count: read.baseline_step_count,
        baseline_cycles_counted: read.baseline_cycles_counted,
        baseline_cycles_omitted: read.baseline_cycles_omitted,
        baseline_note: STEP_BASELINE_NOTE,
        null_step_count: NULL_STEP_COUNT,
        missing: read.errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Whoop read failed";
      return blank([message]);
    }
  }
}
