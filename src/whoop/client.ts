import { addDays } from "../dates.js";
import type { AppConfig } from "../config.js";
import type { StepsReadResult, WhoopProvider, WhoopReadResult } from "../types.js";
import { loadAccessToken } from "../auth/oauth.js";
import { mapWhoopDays } from "./map.js";
import { mapCycleSteps } from "./steps.js";
import type { WhoopCollection, WhoopCycle, WhoopRecovery, WhoopSleep } from "./types.js";

class WhoopHttpError extends Error {
  constructor(
    readonly status: number,
    label: string,
  ) {
    super(`${label}: HTTP ${status}`);
    this.name = "WhoopHttpError";
  }
}

/**
 * Official Whoop Developer API v2 client.
 * Reads recovery, sleep, and cycle collections. Step counts come from GET /v2/cycle
 * (the same collection as strain). Does not POST, PUT, or DELETE Whoop data.
 */
export class WhoopClient implements WhoopProvider {
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getDays(startDate: string, endDate: string): Promise<WhoopReadResult> {
    let token: string;
    try {
      token = await this.accessToken();
    } catch (err) {
      return { days: [], errors: [errorMessage(err)] };
    }

    const { start, end } = this.queryWindow(startDate, endDate);
    const errors: string[] = [];
    const [recoveries, sleeps, cycles] = await Promise.all([
      this.collect<WhoopRecovery>("/v2/recovery", start, end, token, errors, "recovery"),
      this.collect<WhoopSleep>("/v2/activity/sleep", start, end, token, errors, "sleep"),
      this.collect<WhoopCycle>("/v2/cycle", start, end, token, errors, "cycles"),
    ]);

    const days = mapWhoopDays({
      recoveries,
      sleeps,
      cycles,
      timeZone: this.config.timeZone,
    }).filter((day) => day.date >= startDate && day.date <= endDate);

    return { days, errors };
  }

  /**
   * Step counts for the open cycle and completed cycles in the date window.
   * GET /v2/cycle only. `step_count` is the top-level cycle field; null stays null.
   */
  async getSteps(startDate: string, endDate: string): Promise<StepsReadResult> {
    const empty = (errors: string[]): StepsReadResult => ({
      current: null,
      recent: [],
      baseline_step_count: null,
      baseline_cycles_counted: 0,
      baseline_cycles_omitted: 0,
      errors,
    });

    let token: string;
    try {
      token = await this.accessToken();
    } catch (err) {
      return empty([errorMessage(err)]);
    }

    const { start, end } = this.queryWindow(startDate, endDate);
    const errors: string[] = [];
    const cycles = await this.collect<WhoopCycle>("/v2/cycle", start, end, token, errors, "cycles");
    return { ...mapCycleSteps({ cycles, startDate, endDate }), errors };
  }

  /** Inclusive local dates, padded so a cycle that crosses midnight UTC is still returned. */
  private queryWindow(startDate: string, endDate: string): { start: string; end: string } {
    return {
      start: `${addDays(startDate, -1)}T00:00:00.000Z`,
      end: `${addDays(endDate, 2)}T00:00:00.000Z`,
    };
  }

  private async accessToken(force = false): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const pending = loadAccessToken(this.config, this.fetchImpl, force).finally(() => {
      this.refreshing = null;
    });
    this.refreshing = pending;
    return pending;
  }

  private async collect<T>(
    apiPath: string,
    start: string,
    end: string,
    token: string,
    errors: string[],
    label: string,
  ): Promise<T[]> {
    try {
      return await this.pages<T>(apiPath, start, end, token, label);
    } catch (err) {
      if (err instanceof WhoopHttpError && err.status === 401) {
        try {
          const refreshed = await this.accessToken(true);
          return await this.pages<T>(apiPath, start, end, refreshed, label);
        } catch (retryErr) {
          errors.push(`${label}: ${errorMessage(retryErr)}`);
          return [];
        }
      }
      errors.push(errorMessage(err));
      return [];
    }
  }

  private async pages<T>(
    apiPath: string,
    start: string,
    end: string,
    token: string,
    label: string,
  ): Promise<T[]> {
    const records: T[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const url = new URL(`${this.config.apiBase}${apiPath}`);
      url.searchParams.set("limit", "25");
      url.searchParams.set("start", start);
      url.searchParams.set("end", end);
      if (nextToken) url.searchParams.set("nextToken", nextToken);
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": "whoop-mcp/0.1.0",
        },
      });
      if (!response.ok) throw new WhoopHttpError(response.status, label);
      const body = (await response.json()) as WhoopCollection<T>;
      if (Array.isArray(body.records)) records.push(...body.records);
      nextToken = body.next_token;
      if (!nextToken) break;
    }
    return records;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Whoop request failed";
}
