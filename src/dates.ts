import type { Clock } from "./types.js";

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function formatInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function todayInZone(clock: Clock): string {
  return formatInZone(clock.now(), clock.timeZone);
}

export function systemClock(timeZone: string): Clock {
  return { timeZone, now: () => new Date() };
}

/** Noon-equivalent UTC instant that stays on `today` in US timezones and UTC. */
export function fixedClock(today: string, timeZone: string): Clock {
  return {
    timeZone,
    now: () => new Date(`${today}T16:00:00.000Z`),
  };
}

export function parseOffsetMinutes(offset: string): number {
  if (offset === "Z" || offset === "z") return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Calendar date of an instant in a fixed UTC offset (`+hh:mm`, `-hh:mm`, or `Z`). */
export function localDateFromOffset(isoUtc: string, offset: string): string {
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid timestamp: ${isoUtc}`);
  }
  const shifted = new Date(ms + parseOffsetMinutes(offset) * 60_000);
  return shifted.toISOString().slice(0, 10);
}
