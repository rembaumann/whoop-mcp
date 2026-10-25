import type { DayRecord, ExplainResult, Hypothesis, Intent } from "../types.js";
import {
  baselinesBefore,
  evidenceFor,
  formatNumber,
  intentExplains,
  intentsForRecoveryDate,
  isMateriallyOff,
} from "./metrics.js";

export const UNEXPLAINED_HYPOTHESES: Hypothesis[] = [
  {
    id: "under_logged_strain",
    label: "Under-logged strain",
    detail:
      "A hard session may be missing from the Whoop record, so yesterday's load is under-counted. Check whether a workout was not recorded.",
  },
  {
    id: "unlogged_lifestyle",
    label: "Unlogged lifestyle",
    detail:
      "Alcohol, a late night, travel, or a hard non-training day can move recovery the same way and was not in the intent log.",
  },
  {
    id: "illness_shaped_pattern",
    label: "Possible illness-shaped pattern",
    detail:
      "Low recovery with higher resting heart rate and lower HRV can match an illness-shaped pattern. This is one unchecked cause among others, not a conclusion.",
  },
  {
    id: "sleep_sensor_gap",
    label: "Sleep or sensor gap",
    detail: "A short or fragmented sleep, or a strap contact gap, can pull the score down without a logged cause.",
  },
];

export function explainDay(input: {
  date: string;
  intents: Intent[];
  days: DayRecord[];
  errors: string[];
}): ExplainResult {
  const day = input.days.find((candidate) => candidate.date === input.date) ?? null;
  const missing = [...input.errors];

  if (!day || day.recovery == null) {
    if (!missing.some((item) => /recovery/i.test(item))) missing.push("recovery");
    return {
      date: input.date,
      band: "insufficient_data",
      summary: `Recovery for ${input.date} was not returned by Whoop, so this day cannot be placed in a band. Logged intents were not used to fill in a score.`,
      evidence: [],
      matched_intents: [],
      missing,
    };
  }

  const baselines = baselinesBefore(input.days, input.date);
  if (baselines.recovery == null) {
    missing.push("recovery_baseline");
    return {
      date: input.date,
      band: "insufficient_data",
      summary: `Recovery for ${input.date} is ${formatNumber(day.recovery)}%, but there is no 14-day recovery baseline to compare it with.`,
      evidence: evidenceFor(day, baselines),
      matched_intents: [],
      missing,
    };
  }

  const matched = intentsForRecoveryDate(input.intents, input.date).filter((intent) =>
    intentExplains(intent, day, baselines),
  );
  const evidence = evidenceFor(day, baselines);
  const material = isMateriallyOff(day, baselines);

  if (material && matched.length === 0) {
    return {
      date: input.date,
      band: "unexplained",
      summary: `Recovery ${formatNumber(day.recovery)}% is off baseline (14-day baseline ${formatNumber(baselines.recovery)}%), with HRV ${metric(day.hrv)} ms vs ${metric(baselines.hrv)} ms and resting heart rate ${metric(day.rhr)} bpm vs ${metric(baselines.rhr)} bpm. There is no logged explanation for this dip.`,
      evidence,
      matched_intents: [],
      hypotheses: UNEXPLAINED_HYPOTHESES,
      missing,
    };
  }

  if (material) {
    return {
      date: input.date,
      band: "expected",
      summary: expectedDipSummary(day, baselines.recovery, baselines, matched),
      evidence,
      matched_intents: matched,
      missing,
    };
  }

  return {
    date: input.date,
    band: "expected",
    summary: inBandSummary(day, baselines, matched),
    evidence,
    matched_intents: matched,
    missing,
  };
}

function expectedDipSummary(
  day: DayRecord,
  recoveryBaseline: number,
  baselines: ReturnType<typeof baselinesBefore>,
  matched: Intent[],
): string {
  const names = matched.map((intent) => intent.type.replaceAll("_", " ")).join(" and ");
  return `Recovery ${formatNumber(day.recovery ?? 0)}% vs the 14-day baseline of ${formatNumber(recoveryBaseline)}% lines up with logged ${names}. HRV ${metric(day.hrv)} ms vs ${metric(baselines.hrv)} ms, resting heart rate ${metric(day.rhr)} bpm vs ${metric(baselines.rhr)} bpm, and sleep performance ${metric(day.sleep_performance)}% vs ${metric(baselines.sleep_performance)}% are in the evidence.`;
}

function inBandSummary(
  day: DayRecord,
  baselines: ReturnType<typeof baselinesBefore>,
  matched: Intent[],
): string {
  const recovery = `Recovery ${metric(day.recovery)}% vs the 14-day baseline of ${metric(baselines.recovery)}%`;
  const support = `HRV ${metric(day.hrv)} ms vs ${metric(baselines.hrv)} ms, resting heart rate ${metric(day.rhr)} bpm vs ${metric(baselines.rhr)} bpm, and sleep performance ${metric(day.sleep_performance)}% vs ${metric(baselines.sleep_performance)}%`;
  if (matched.length === 0) {
    return `${recovery}. ${support}. The day is inside the expected band.`;
  }
  const names = matched.map((intent) => intent.type.replaceAll("_", " ")).join(" and ");
  return `${recovery}. ${support}. Logged ${names} lines up with the softer numbers, and the day stays inside the expected band.`;
}

function metric(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return formatNumber(value);
}
