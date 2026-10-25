import type { Baselines, DayRecord, Evidence, Intent } from "../types.js";

/**
 * Thresholds from evals/cases.md.
 * HRV is materially off at or below 15% under the 14-day baseline (baseline * 0.85).
 */
export function baselinesBefore(days: DayRecord[], targetDate: string): Baselines {
  const prior = days
    .filter((day) => day.date < targetDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
  return {
    recovery: mean(prior.map((day) => day.recovery)),
    hrv: mean(prior.map((day) => day.hrv)),
    rhr: mean(prior.map((day) => day.rhr)),
    sleep_performance: mean(prior.map((day) => day.sleep_performance)),
    strain: mean(prior.map((day) => day.strain)),
  };
}

export function isMateriallyOff(day: DayRecord, baselines: Baselines): boolean {
  if (day.recovery != null && day.recovery <= 40) return true;
  if (day.rhr != null && baselines.rhr != null && day.rhr >= baselines.rhr + 6) return true;
  if (day.hrv != null && baselines.hrv != null && day.hrv <= baselines.hrv * 0.85) return true;
  return false;
}

export function isSeverelyLow(day: DayRecord | null, baselines: Baselines): boolean {
  if (!day) return false;
  if (day.recovery != null && day.recovery <= 25) return true;
  if (day.rhr != null && baselines.rhr != null && day.rhr >= baselines.rhr + 10) return true;
  return false;
}

export function recoveryDip(recovery: number | null, baseline: number | null): boolean {
  if (recovery == null || baseline == null) return false;
  return recovery <= baseline - 10;
}

/** Intents on the recovery date, plus drinks/late_night from the evening before. */
export function intentsForRecoveryDate(intents: Intent[], date: string): Intent[] {
  const previous = shift(date, -1);
  return intents.filter(
    (intent) =>
      intent.date === date ||
      (intent.date === previous && (intent.type === "drinks" || intent.type === "late_night")),
  );
}

export function intentExplains(intent: Intent, day: DayRecord, baselines: Baselines): boolean {
  if (intent.type === "niggle" || intent.type === "other") return false;
  const recoveryDown =
    day.recovery != null && baselines.recovery != null && day.recovery <= baselines.recovery - 10;
  const sleepDown =
    day.sleep_performance != null &&
    baselines.sleep_performance != null &&
    day.sleep_performance <= baselines.sleep_performance - 10;
  const hrvDown = day.hrv != null && baselines.hrv != null && day.hrv <= baselines.hrv * 0.9;
  const rhrUp = day.rhr != null && baselines.rhr != null && day.rhr >= baselines.rhr + 3;

  if (intent.type === "late_night") return sleepDown || recoveryDown;
  if (intent.type === "drinks") return recoveryDown || sleepDown || hrvDown || rhrUp || isMateriallyOff(day, baselines);
  return isMateriallyOff(day, baselines) || recoveryDown || sleepDown || hrvDown || rhrUp;
}

export function evidenceFor(day: DayRecord, baselines: Baselines): Evidence[] {
  const items: Evidence[] = [];
  pushMetric(items, "recovery", day.recovery, baselines.recovery, "%", (value, baseline, delta) => {
    return `Recovery ${formatNumber(value)}% vs 14-day baseline ${formatMaybe(baseline)}% (${signed(delta)} points).`;
  });
  pushMetric(items, "hrv", day.hrv, baselines.hrv, "ms", (value, baseline, delta) => {
    return `HRV ${formatNumber(value)} ms vs 14-day baseline ${formatMaybe(baseline)} ms (${signed(delta)} ms).`;
  });
  pushMetric(items, "rhr", day.rhr, baselines.rhr, "bpm", (value, baseline, delta) => {
    return `Resting heart rate ${formatNumber(value)} bpm vs 14-day baseline ${formatMaybe(baseline)} bpm (${signed(delta)} bpm).`;
  });
  pushMetric(
    items,
    "sleep_performance",
    day.sleep_performance,
    baselines.sleep_performance,
    "%",
    (value, baseline, delta) => {
      return `Sleep performance ${formatNumber(value)}% vs 14-day baseline ${formatMaybe(baseline)}% (${signed(delta)} points).`;
    },
  );
  if (day.strain != null) {
    pushMetric(items, "strain", day.strain, baselines.strain, "strain", (value, baseline, delta) => {
      if (baseline == null || delta == null) return `Cycle strain ${formatNumber(value)}.`;
      return `Cycle strain ${formatNumber(value)} vs 14-day baseline ${formatNumber(baseline)} (${signed(delta)}).`;
    });
  }
  return items;
}

export function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatMaybe(value: number | null): string {
  if (value == null) return "n/a";
  return formatNumber(value);
}

function pushMetric(
  items: Evidence[],
  metric: string,
  value: number | null,
  baseline: number | null,
  unit: string,
  text: (value: number, baseline: number | null, delta: number | null) => string,
): void {
  if (value == null) return;
  const delta = baseline == null ? null : round1(value - baseline);
  items.push({
    metric,
    value,
    baseline,
    delta,
    unit,
    text: text(value, baseline, delta),
  });
}

function mean(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function signed(delta: number | null): string {
  if (delta == null) return "n/a";
  const text = formatNumber(delta);
  return delta > 0 ? `+${text}` : text;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function shift(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}
