import { addDays, isIsoDate, todayInZone } from "../dates.js";
import { JsonIntentStore } from "../store/intents.js";
import type {
  Clock,
  ExplainResult,
  IntentType,
  LogIntentResult,
  PlannedSession,
  TrainingResult,
  WhoopProvider,
} from "../types.js";
import { explainDay } from "./explain.js";
import { trainingCall } from "./training.js";

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
}
