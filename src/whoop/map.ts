import { formatInZone, localDateFromOffset } from "../dates.js";
import type { DayRecord } from "../types.js";
import type { WhoopCycle, WhoopRecovery, WhoopSleep } from "./types.js";

export function mapWhoopDays(input: {
  recoveries: WhoopRecovery[];
  sleeps: WhoopSleep[];
  cycles: WhoopCycle[];
  timeZone: string;
}): DayRecord[] {
  const sleepById = new Map(input.sleeps.map((sleep) => [sleep.id, sleep]));
  const cycleById = new Map(input.cycles.map((cycle) => [cycle.id, cycle]));
  const byDate = new Map<string, DayRecord>();

  const bucket = (date: string): DayRecord => {
    let row = byDate.get(date);
    if (!row) {
      row = {
        date,
        recovery: null,
        hrv: null,
        rhr: null,
        sleep_performance: null,
        strain: null,
      };
      byDate.set(date, row);
    }
    return row;
  };

  for (const recovery of input.recoveries) {
    if (recovery.score_state !== "SCORED" || !recovery.score) continue;
    const sleep = sleepById.get(recovery.sleep_id);
    const cycle = cycleById.get(recovery.cycle_id);
    const date = recoveryDate(recovery, sleep, cycle, input.timeZone);
    const row = bucket(date);
    if (row.recovery != null) continue;
    if (typeof recovery.score.recovery_score === "number") row.recovery = recovery.score.recovery_score;
    if (typeof recovery.score.hrv_rmssd_milli === "number") row.hrv = recovery.score.hrv_rmssd_milli;
    if (typeof recovery.score.resting_heart_rate === "number") row.rhr = recovery.score.resting_heart_rate;
    if (sleep && !sleep.nap && sleep.score_state === "SCORED" && typeof sleep.score?.sleep_performance_percentage === "number") {
      row.sleep_performance = sleep.score.sleep_performance_percentage;
    }
  }

  for (const sleep of input.sleeps) {
    if (sleep.nap || sleep.score_state !== "SCORED") continue;
    if (typeof sleep.score?.sleep_performance_percentage !== "number") continue;
    const row = bucket(localDateFromOffset(sleep.end, sleep.timezone_offset));
    if (row.sleep_performance == null) row.sleep_performance = sleep.score.sleep_performance_percentage;
  }

  for (const cycle of input.cycles) {
    if (cycle.score_state !== "SCORED" || typeof cycle.score?.strain !== "number") continue;
    const when = cycle.end ?? cycle.start;
    const row = bucket(localDateFromOffset(when, cycle.timezone_offset));
    if (row.strain == null || cycle.score.strain > row.strain) row.strain = cycle.score.strain;
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function recoveryDate(
  recovery: WhoopRecovery,
  sleep: WhoopSleep | undefined,
  cycle: WhoopCycle | undefined,
  timeZone: string,
): string {
  if (sleep && !sleep.nap) return localDateFromOffset(sleep.end, sleep.timezone_offset);
  if (cycle?.end) return localDateFromOffset(cycle.end, cycle.timezone_offset);
  if (cycle) return localDateFromOffset(cycle.start, cycle.timezone_offset);
  return formatInZone(new Date(recovery.created_at), timeZone);
}
