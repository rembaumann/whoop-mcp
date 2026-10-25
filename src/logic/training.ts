import { addDays } from "../dates.js";
import type { DayRecord, ExplainResult, Intent, PlannedSession, TrainingCall, TrainingResult } from "../types.js";
import { baselinesBefore, evidenceFor, formatNumber, isMateriallyOff, isSeverelyLow, recoveryDip } from "./metrics.js";

const HEAVY = new Set<PlannedSession>(["heavy_squat", "heavy_deadlift", "heavy_bench"]);

const SESSION_AREAS: Record<string, string[]> = {
  heavy_squat: ["knee", "hip", "back", "ankle", "quad", "groin", "adductor", "hamstring", "glute"],
  heavy_deadlift: ["back", "hip", "hamstring", "knee", "lumbar", "glute", "spine"],
  heavy_bench: ["shoulder", "elbow", "wrist", "pec", "chest"],
};

export function trainingCall(input: {
  planned_session: PlannedSession;
  optional_notes?: string;
  today: string;
  days: DayRecord[];
  errors: string[];
  intents: Intent[];
  yesterday: ExplainResult;
}): TrainingResult {
  const session = input.planned_session;
  const resolved = resolveReadiness(input.days, input.today);
  const record = resolved.record;
  const baselines = baselinesBefore(input.days, resolved.baselineBefore);
  const niggles = relevantNiggles(openNiggles(input.intents, input.today), session);
  const lifestyle = hasExplainingLifestyle(input.intents, input.today, input.yesterday);
  const severe = isSeverelyLow(record, baselines);
  const material = record ? isMateriallyOff(record, baselines) : false;
  const dipped = recoveryDip(record?.recovery ?? null, baselines.recovery);

  const evidence = record ? evidenceFor(record, baselines) : [];
  for (const niggle of niggles) {
    evidence.push({
      metric: "niggle",
      value: null,
      baseline: null,
      delta: null,
      unit: null,
      text: `Open niggle: ${niggle.body_area} logged ${niggle.date}.`,
    });
  }
  evidence.push({
    metric: "yesterday_band",
    value: null,
    baseline: null,
    delta: null,
    unit: null,
    text: `Yesterday (${input.yesterday.date}) band is ${input.yesterday.band}.`,
  });

  const missing = [...resolved.missing, ...input.errors];
  const lift = liftName(session);

  if (session === "rest") {
    return finish("go", "The plan is already a rest day. Take it.", null, evidence, missing);
  }

  if (HEAVY.has(session) && niggles.length > 0) {
    const area = niggles[0]?.body_area ?? "logged area";
    if (severe) {
      return finish(
        "rest",
        `Open ${area} niggle plus severely low readiness. Do not load the ${lift} today.`,
        severeAlternate(lift),
        evidence,
        missing,
      );
    }
    return finish(
      "go_lighter",
      `Open niggle on the ${area} conflicts with heavy ${lift}. Recovery ${metric(record?.recovery)}% vs baseline ${metric(baselines.recovery)}% does not clear that pattern.`,
      niggleAlternate(lift, area),
      evidence,
      missing,
    );
  }

  if (!record) {
    return finish(
      "go_lighter",
      `No recovery score is on file for ${input.today}, so ${session} is capped until Whoop data is in.`,
      `Skip hard efforts. Technique work at or below 60% only until a recovery score is available.`,
      evidence,
      missing,
    );
  }

  if (HEAVY.has(session) && severe) {
    const after = lifestyle ? " after logged drinks or a late night" : "";
    return finish(
      "rest",
      `Readiness is severely low${after} (recovery ${metric(record.recovery)}%, resting heart rate ${metric(record.rhr)} bpm). Heavy ${lift} is not the session today.`,
      severeAlternate(lift),
      evidence,
      missing,
    );
  }

  if (HEAVY.has(session) && input.yesterday.band === "unexplained") {
    const notes = input.optional_notes ? ` Notes: ${input.optional_notes}.` : "";
    return finish(
      "go_lighter",
      `Yesterday's recovery is off baseline with no logged explanation, so heavy ${lift} should not be a full send.${notes}`,
      dropTopSets(lift, input.optional_notes),
      evidence,
      missing,
    );
  }

  if (HEAVY.has(session) && lifestyle && (dipped || material)) {
    return finish(
      "go_lighter",
      `The dip lines up with logged drinks or a late night, and recovery ${metric(record.recovery)}% is below the 14-day baseline of ${metric(baselines.recovery)}% without being severely low. Heavy ${lift} goes lighter.`,
      dropTopSets(lift, input.optional_notes),
      evidence,
      missing,
    );
  }

  if (HEAVY.has(session) && material) {
    return finish(
      "go_lighter",
      `Today's metrics are materially off the 14-day baseline, so heavy ${lift} is capped.`,
      dropTopSets(lift, input.optional_notes),
      evidence,
      missing,
    );
  }

  if (HEAVY.has(session)) {
    return finish(
      "go",
      `Heavy ${lift} is a go. Recovery ${metric(record.recovery)}% is not materially off the 14-day baseline of ${metric(baselines.recovery)}%, and yesterday's band is ${input.yesterday.band}.`,
      null,
      evidence,
      missing,
    );
  }

  if (severe) {
    return finish(
      "go_lighter",
      `Readiness is severely low, so keep ${session} easy.`,
      "Shorten the session: easy accessories only, stop around RPE 6, and skip anything that feels like a top set.",
      evidence,
      missing,
    );
  }

  if (input.yesterday.band === "unexplained" && (material || dipped)) {
    return finish(
      "go_lighter",
      `Yesterday is off baseline with no logged explanation. ${session} can stay on the plan at a lower effort.`,
      "Keep the accessories, drop a set, and stop if heart rate will not settle.",
      evidence,
      missing,
    );
  }

  const lifestyleNote = lifestyle ? " after logged drinks or a late night" : "";
  return finish(
    "go",
    `${session} can go ahead. Recovery ${metric(record.recovery)}% vs the 14-day baseline of ${metric(baselines.recovery)}% is not a reason to cancel a non-heavy session${lifestyleNote}.`,
    null,
    evidence,
    missing,
  );
}

function finish(
  call: TrainingCall,
  rationale: string,
  alternate: string | null,
  evidence: TrainingResult["evidence"],
  missing: string[],
): TrainingResult {
  if (call !== "go" && (!alternate || !alternate.trim())) {
    throw new Error("today_training_call requires a concrete alternate when the call is not go.");
  }
  return {
    call,
    rationale,
    alternate: call === "go" ? null : alternate!.trim(),
    evidence,
    missing,
  };
}

function resolveReadiness(
  days: DayRecord[],
  today: string,
): { record: DayRecord | null; baselineBefore: string; missing: string[] } {
  const exact = days.find((day) => day.date === today && day.recovery != null);
  if (exact) return { record: exact, baselineBefore: today, missing: [] };
  const prior = days
    .filter((day) => day.date < today && day.recovery != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = prior.at(-1) ?? null;
  if (!latest) {
    return { record: null, baselineBefore: today, missing: ["recovery"] };
  }
  return {
    record: latest,
    baselineBefore: latest.date,
    missing: [`today_recovery: using most recent score from ${latest.date}`],
  };
}

function openNiggles(intents: Intent[], today: string): Intent[] {
  const start = addDays(today, -7);
  return intents.filter((intent) => intent.type === "niggle" && intent.date >= start && intent.date <= today);
}

function relevantNiggles(niggles: Intent[], session: PlannedSession): Intent[] {
  const areas = SESSION_AREAS[session] ?? [];
  return niggles.filter((niggle) => {
    const area = (niggle.body_area ?? "").toLowerCase();
    if (!area) return false;
    return areas.some((candidate) => area.includes(candidate) || candidate.includes(area));
  });
}

function hasExplainingLifestyle(intents: Intent[], today: string, yesterday: ExplainResult): boolean {
  const prior = addDays(today, -1);
  const recent = intents.some(
    (intent) =>
      (intent.date === today || intent.date === prior) &&
      (intent.type === "drinks" || intent.type === "late_night"),
  );
  const matched =
    yesterday.band === "expected" &&
    yesterday.matched_intents.some((intent) => intent.type === "drinks" || intent.type === "late_night");
  return recent || matched;
}

function liftName(session: PlannedSession): string {
  if (session === "heavy_squat") return "squat";
  if (session === "heavy_deadlift") return "deadlift";
  if (session === "heavy_bench") return "bench";
  return session;
}

function dropTopSets(lift: string, notes?: string): string {
  const day = notes?.match(/day\s*\d+/i)?.[0];
  const prefix = day ? `${day}: ` : "";
  return `${prefix}Drop top sets 5-10% on the ${lift}; keep accessories. If bar speed fades, stop at technique work at or below 60%.`;
}

function severeAlternate(lift: string): string {
  return `Skip heavy ${lift}. Replace the session with a walk or mobility only; no working sets today. Reassess tomorrow before loading the ${lift} again.`;
}

function niggleAlternate(lift: string, area: string): string {
  return `Skip heavy ${lift} top sets. Reduce ${lift} load to technique work at or below 60% so the ${area} stays under less load, and keep accessories that do not stress the ${area}.`;
}

function metric(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return formatNumber(value);
}
