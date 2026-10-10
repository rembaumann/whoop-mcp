import { API_BASE_URL } from "../auth/config.js";
import { AuthRequiredError, WhoopApiError } from "./errors.js";
import type {
  CollectionQuery,
  Cycle,
  Paginated,
  Recovery,
  Sleep,
  UserBasicProfile,
  UserBodyMeasurement,
  Workout,
} from "./types.js";

export interface WhoopApi {
  getProfile(): Promise<UserBasicProfile>;
  getBodyMeasurement(): Promise<UserBodyMeasurement>;
  listCycles(query?: CollectionQuery): Promise<Paginated<Cycle>>;
  getCycle(cycleId: number): Promise<Cycle>;
  listRecoveries(query?: CollectionQuery): Promise<Paginated<Recovery>>;
  getRecoveryForCycle(cycleId: number): Promise<Recovery>;
  listSleep(query?: CollectionQuery): Promise<Paginated<Sleep>>;
  getSleep(sleepId: string): Promise<Sleep>;
  getSleepForCycle(cycleId: number): Promise<Sleep>;
  listWorkouts(query?: CollectionQuery): Promise<Paginated<Workout>>;
  getWorkout(workoutId: string): Promise<Workout>;
  revokeAccess(): Promise<void>;
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Called after a 401. Must return a new access token. */
  forceRefresh(staleAccessToken: string): Promise<string>;
}

export interface WhoopClientOptions {
  tokens: TokenProvider;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/**
 * Read-only client for https://api.prod.whoop.com/developer/v2.
 * Paths and query names match the public OpenAPI document.
 */
export class WhoopClient implements WhoopApi {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: WhoopClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? API_BASE_URL).replace(/\/$/, "");
  }

  getProfile(): Promise<UserBasicProfile> {
    return this.get("/v2/user/profile/basic");
  }

  getBodyMeasurement(): Promise<UserBodyMeasurement> {
    return this.get("/v2/user/measurement/body");
  }

  listCycles(query: CollectionQuery = {}): Promise<Paginated<Cycle>> {
    return this.get("/v2/cycle", query);
  }

  getCycle(cycleId: number): Promise<Cycle> {
    return this.get(`/v2/cycle/${cycleId}`);
  }

  listRecoveries(query: CollectionQuery = {}): Promise<Paginated<Recovery>> {
    return this.get("/v2/recovery", query);
  }

  getRecoveryForCycle(cycleId: number): Promise<Recovery> {
    return this.get(`/v2/cycle/${cycleId}/recovery`);
  }

  listSleep(query: CollectionQuery = {}): Promise<Paginated<Sleep>> {
    return this.get("/v2/activity/sleep", query);
  }

  getSleep(sleepId: string): Promise<Sleep> {
    return this.get(`/v2/activity/sleep/${encodeURIComponent(sleepId)}`);
  }

  getSleepForCycle(cycleId: number): Promise<Sleep> {
    return this.get(`/v2/cycle/${cycleId}/sleep`);
  }

  listWorkouts(query: CollectionQuery = {}): Promise<Paginated<Workout>> {
    return this.get("/v2/activity/workout", query);
  }

  getWorkout(workoutId: string): Promise<Workout> {
    return this.get(`/v2/activity/workout/${encodeURIComponent(workoutId)}`);
  }

  /** DELETE /v2/user/access — revoke the current user's grant. */
  async revokeAccess(): Promise<void> {
    await this.get("/v2/user/access", {}, "DELETE");
  }

  private async get<T>(path: string, query: CollectionQuery = {}, method = "GET"): Promise<T> {
    return this.request(path, query, method, 0);
  }

  private async request<T>(
    path: string,
    query: CollectionQuery,
    method: string,
    attempt: number,
  ): Promise<T> {
    const accessToken = await this.options.tokens.getAccessToken();
    const url = new URL(`${this.baseUrl}${path}`);
    if (query.limit !== undefined) url.searchParams.set("limit", String(query.limit));
    if (query.start) url.searchParams.set("start", query.start);
    if (query.end) url.searchParams.set("end", query.end);
    if (query.nextToken) url.searchParams.set("nextToken", query.nextToken);

    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 401 && attempt === 0) {
      await this.options.tokens.forceRefresh(accessToken);
      return this.request(path, query, method, 1);
    }

    const text = await response.text();
    if (!response.ok) {
      throw toApiError(response, text);
    }
    if (response.status === 204 || text.length === 0) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WhoopApiError(
        `WHOOP returned a ${response.status} response that was not JSON.`,
        response.status,
      );
    }
  }
}

function toApiError(response: Response, text: string): Error {
  const resetHeader = response.headers.get("x-ratelimit-reset");
  const resetSeconds = resetHeader ? Number(resetHeader) : undefined;
  const detail = text.replace(/\s+/g, " ").trim().slice(0, 300);

  if (response.status === 401) {
    return new AuthRequiredError(
      "WHOOP rejected the access token. Run `whoop-mcp login` again.",
    );
  }
  if (response.status === 404) {
    return new WhoopApiError(
      detail ? `WHOOP could not find that record. ${detail}` : "WHOOP could not find that record.",
      404,
    );
  }
  if (response.status === 429) {
    const wait =
      resetSeconds !== undefined && Number.isFinite(resetSeconds)
        ? ` Try again in about ${resetSeconds} seconds.`
        : "";
    return new WhoopApiError(
      `WHOOP rate limit reached (100 requests/minute and 10,000/day by default).${wait}`,
      429,
      resetSeconds,
    );
  }
  return new WhoopApiError(
    `WHOOP request failed (${response.status}${detail ? `: ${detail}` : ""}).`,
    response.status,
  );
}
