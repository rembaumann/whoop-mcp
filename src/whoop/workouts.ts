import { addDays, formatOffsetDateTime, localDateFromOffset, normalizeOffset, startOfLocalDayUtc } from "../dates.js";
import type { WorkoutRecord, WorkoutZoneDurations, WorkoutsReadResult } from "../types.js";
import type { WhoopWorkout, WhoopZoneDurations } from "./types.js";

const ZONE_KEYS = [
  "zone_zero_milli",
  "zone_one_milli",
  "zone_two_milli",
  "zone_three_milli",
  "zone_four_milli",
  "zone_five_milli",
] as const;

type ZoneMilliKey = (typeof ZONE_KEYS)[number];
type ZoneMinuteKey = keyof WorkoutZoneDurations;

const ZONE_MINUTE: Record<ZoneMilliKey, ZoneMinuteKey> = {
  zone_zero_milli: "zone_zero_minutes",
  zone_one_milli: "zone_one_minutes",
  zone_two_milli: "zone_two_minutes",
  zone_three_milli: "zone_three_minutes",
  zone_four_milli: "zone_four_minutes",
  zone_five_milli: "zone_five_minutes",
};

/**
 * Map official workout records into the tool payload.
 * Missing or non-numeric scores stay null. sport_id is only set when Whoop still sends a number;
 * it is not inferred from sport_name.
 */
export function mapWorkouts(input: {
  workouts: WhoopWorkout[];
  startDate: string;
  endDate: string;
  timeZone: string;
}): Omit<WorkoutsReadResult, "errors"> {
  const startMs = Date.parse(startOfLocalDayUtc(input.startDate, input.timeZone));
  const endMs = Date.parse(startOfLocalDayUtc(addDays(input.endDate, 1), input.timeZone));
  const seen = new Set<string>();
  const workouts: WorkoutRecord[] = [];
  for (const raw of input.workouts) {
    const record = toRecord(raw);
    if (!record) continue;
    const started = Date.parse(raw.start);
    if (Number.isNaN(started) || started < startMs || started >= endMs) continue;
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    workouts.push(record);
  }
  workouts.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return { workouts };
}

function toRecord(workout: WhoopWorkout): WorkoutRecord | null {
  if (typeof workout?.id !== "string" || workout.id.length === 0) return null;
  if (typeof workout.start !== "string" || workout.start.length === 0) return null;
  if (typeof workout.end !== "string" || workout.end.length === 0) return null;
  const offset = normalizeOffset(workout.timezone_offset);
  let start: string;
  let end: string;
  let date: string;
  try {
    start = formatOffsetDateTime(workout.start, offset);
    end = formatOffsetDateTime(workout.end, offset);
    date = localDateFromOffset(workout.start, offset);
  } catch {
    return null;
  }
  const scored = workout.score_state === "SCORED" && workout.score != null && typeof workout.score === "object";
  const score = scored ? workout.score : undefined;
  return {
    id: workout.id,
    date,
    start,
    end,
    duration_minutes: durationMinutes(workout.start, workout.end),
    sport_name: readSportName(workout.sport_name),
    sport_id: readNumber(workout.sport_id),
    score_state: typeof workout.score_state === "string" && workout.score_state.length > 0 ? workout.score_state : null,
    strain: readNumber(score?.strain),
    average_heart_rate: readNumber(score?.average_heart_rate),
    max_heart_rate: readNumber(score?.max_heart_rate),
    zone_durations: readZones(score),
  };
}

function readSportName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 ? name : null;
}

/** Numeric values only. Null, missing, and non-numbers stay null (not coerced to 0). */
export function readNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function durationMinutes(start: string, end: string): number | null {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  return Math.round(((endMs - startMs) / 60_000) * 10) / 10;
}

function readZones(score: WhoopWorkout["score"] | undefined): WorkoutZoneDurations | null {
  if (!score) return null;
  const raw =
    score.zone_durations && typeof score.zone_durations === "object"
      ? score.zone_durations
      : score.zone_duration && typeof score.zone_duration === "object"
        ? score.zone_duration
        : null;
  if (!raw) return null;
  const zones = {} as WorkoutZoneDurations;
  let present = false;
  for (const key of ZONE_KEYS) {
    const milli = readNumber((raw as WhoopZoneDurations)[key]);
    zones[ZONE_MINUTE[key]] = milli == null ? null : Math.round((milli / 60_000) * 10) / 10;
    if (milli != null) present = true;
  }
  return present ? zones : null;
}
