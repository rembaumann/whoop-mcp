import { InputError } from "./errors.js";
import type { CollectionQuery } from "./types.js";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CollectionArgs {
  limit?: number;
  start?: string;
  end?: string;
  next_token?: string;
}

/**
 * Turn tool arguments into WHOOP collection query parameters.
 *
 * WHOOP's `end` is exclusive. A date-only end of `2022-04-24` therefore
 * becomes `2022-04-25T00:00:00.000Z`, so the whole UTC day is included.
 * Date-only values are interpreted as UTC calendar days.
 */
export function toWhoopCollectionQuery(args: CollectionArgs): CollectionQuery {
  const query: CollectionQuery = {};

  if (args.limit !== undefined) {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 25) {
      throw new InputError("limit must be an integer from 1 to 25 (WHOOP's maximum page size).");
    }
    query.limit = args.limit;
  }

  if (args.start !== undefined && args.start !== "") {
    query.start = normalizeBound(args.start, "start");
  }

  if (args.end !== undefined && args.end !== "") {
    query.end = normalizeBound(args.end, "end");
  }

  if (args.next_token !== undefined && args.next_token !== "") {
    query.nextToken = args.next_token;
  }

  return query;
}

export function assertActivityId(id: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new InputError(
      `${label} must be the id WHOOP returned (letters, numbers, underscores, or hyphens).`,
    );
  }
  return id;
}

export function assertCycleId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InputError("cycle_id must be a positive integer WHOOP cycle id.");
  }
  return id;
}

function normalizeBound(value: string, bound: "start" | "end"): string {
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (
      utc.getUTCFullYear() !== year ||
      utc.getUTCMonth() !== month - 1 ||
      utc.getUTCDate() !== day
    ) {
      throw new InputError(`${bound} is not a real calendar date: ${value}`);
    }
    if (bound === "end") {
      utc.setUTCDate(utc.getUTCDate() + 1);
    }
    return utc.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InputError(
      `${bound} must be an ISO-8601 date-time (for example 2022-04-24T02:25:44.774Z) or a UTC date (YYYY-MM-DD). Received: ${value}`,
    );
  }
  return parsed.toISOString();
}
