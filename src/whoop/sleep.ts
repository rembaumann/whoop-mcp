import { formatOffsetDateTime, localDateFromOffset, normalizeOffset } from "../dates.js";
import type { LastWakeTimeReadResult, LastWakeTimeSleep } from "../types.js";
import type { WhoopSleep } from "./types.js";

function instant(stamp: string | null | undefined): number {
  if (typeof stamp !== "string" || stamp.length === 0) return Number.NaN;
  return Date.parse(stamp);
}

function hasEnd(sleep: WhoopSleep): sleep is WhoopSleep & { end: string } {
  return typeof sleep.end === "string" && sleep.end.length > 0 && !Number.isNaN(instant(sleep.end));
}

function isNap(sleep: WhoopSleep): boolean {
  return sleep.nap === true;
}

function recency(sleep: WhoopSleep): number {
  const start = instant(sleep.start);
  if (!Number.isNaN(start)) return start;
  return hasEnd(sleep) ? instant(sleep.end) : Number.NEGATIVE_INFINITY;
}

function compareRecency(a: WhoopSleep, b: WhoopSleep): number {
  return recency(b) - recency(a);
}

function toSleep(raw: WhoopSleep): LastWakeTimeSleep | null {
  if (typeof raw?.start !== "string" || raw.start.length === 0) return null;
  if (Number.isNaN(instant(raw.start))) return null;
  const offset = normalizeOffset(raw.timezone_offset);
  let start: string;
  try {
    start = formatOffsetDateTime(raw.start, offset);
  } catch {
    return null;
  }
  if (!hasEnd(raw)) {
    return {
      start,
      end: null,
      score_state: typeof raw.score_state === "string" && raw.score_state.length > 0 ? raw.score_state : null,
      wake_date: null,
      timezone_offset: offset,
    };
  }
  try {
    return {
      start,
      end: formatOffsetDateTime(raw.end, offset),
      score_state: typeof raw.score_state === "string" && raw.score_state.length > 0 ? raw.score_state : null,
      wake_date: localDateFromOffset(raw.end, offset),
      timezone_offset: offset,
    };
  } catch {
    return {
      start,
      end: null,
      score_state: typeof raw.score_state === "string" && raw.score_state.length > 0 ? raw.score_state : null,
      wake_date: null,
      timezone_offset: offset,
    };
  }
}

/**
 * Pick the most recent non-nap sleep and whether the member is awake now.
 * awake_now looks at the latest sleep of any kind: it must have an end whose
 * local date (from timezone_offset) is `today`.
 */
export function mapLastWakeTime(input: { sleeps: WhoopSleep[]; today: string }): Omit<LastWakeTimeReadResult, "errors"> {
  const ranked = [...input.sleeps].filter((sleep) => typeof sleep?.start === "string" && sleep.start.length > 0).sort(compareRecency);
  const latest = ranked[0];
  const nonNap = ranked.find((sleep) => !isNap(sleep));
  let awake_now = false;
  if (latest && hasEnd(latest)) {
    try {
      awake_now = localDateFromOffset(latest.end, normalizeOffset(latest.timezone_offset)) === input.today;
    } catch {
      awake_now = false;
    }
  }
  return { sleep: nonNap ? toSleep(nonNap) : null, awake_now };
}
