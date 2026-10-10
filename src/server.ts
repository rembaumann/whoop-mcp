import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { StoredTokens } from "./auth/store.js";
import { SERVER_NAME, VERSION } from "./version.js";
import type { WhoopApi } from "./whoop/client.js";
import { assertActivityId, assertCycleId, toWhoopCollectionQuery } from "./whoop/query.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const collectionInput = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Page size from 1 to 25. WHOOP defaults to 10 when this is omitted."),
  start: z
    .string()
    .optional()
    .describe(
      "Inclusive lower bound. ISO-8601 date-time, or YYYY-MM-DD interpreted as 00:00:00.000Z.",
    ),
  end: z
    .string()
    .optional()
    .describe(
      "Exclusive upper bound. ISO-8601 date-time, or YYYY-MM-DD meaning through the end of that UTC day. WHOOP defaults this to now when omitted.",
    ),
  next_token: z
    .string()
    .optional()
    .describe(
      "The next_token value from the previous page. Sent to WHOOP as the nextToken query parameter. Omit for the first page.",
    ),
};

const cycleIdInput = {
  cycle_id: z
    .number()
    .int()
    .positive()
    .describe("Physiological cycle id (the integer `id` on a cycle, or `cycle_id` on recovery and sleep)."),
};

export interface AuthStatusSource {
  filePath: string;
  read(): Promise<StoredTokens | null>;
}

export interface WhoopServerDeps {
  client: WhoopApi;
  tokenStore: AuthStatusSource;
}

export function createWhoopServer(deps: WhoopServerDeps): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: VERSION,
  });

  server.registerTool(
    "whoop_auth_status",
    {
      title: "WHOOP auth status",
      description:
        "Report whether a local WHOOP OAuth token is stored, when it expires, and which scopes were granted. Does not return tokens or the client secret.",
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    async () => {
      try {
        const tokens = await deps.tokenStore.read();
        if (!tokens) {
          return ok({
            authenticated: false,
            token_path: deps.tokenStore.filePath,
            hint: "Run `whoop-mcp login` after setting WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET.",
          });
        }
        return ok({
          authenticated: true,
          expires_at: new Date(tokens.expires_at).toISOString(),
          scope: tokens.scope,
          token_type: tokens.token_type,
          token_path: deps.tokenStore.filePath,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "whoop_get_profile",
    {
      title: "Get WHOOP profile",
      description:
        "Get the authenticated member's basic profile (GET /v2/user/profile/basic). Returns user_id, email, first_name, and last_name. Requires the read:profile scope.",
      annotations: READ_ONLY,
    },
    async () => call(() => deps.client.getProfile()),
  );

  server.registerTool(
    "whoop_get_body_measurement",
    {
      title: "Get WHOOP body measurements",
      description:
        "Get the authenticated member's body measurements (GET /v2/user/measurement/body). Returns height_meter, weight_kilogram, and max_heart_rate. Requires the read:body_measurement scope.",
      annotations: READ_ONLY,
    },
    async () => call(() => deps.client.getBodyMeasurement()),
  );

  server.registerTool(
    "whoop_list_cycles",
    {
      title: "List WHOOP cycles",
      description:
        "List physiological cycles, newest first (GET /v2/cycle). Each record includes start, end, timezone_offset, score_state, optional step_count, and when SCORED a score with strain (0–21), kilojoule, average_heart_rate, and max_heart_rate. `end` is omitted for the cycle currently in progress. Requires read:cycles.",
      inputSchema: collectionInput,
      annotations: READ_ONLY,
    },
    async (args) => call(() => deps.client.listCycles(toWhoopCollectionQuery(args))),
  );

  server.registerTool(
    "whoop_get_cycle",
    {
      title: "Get a WHOOP cycle",
      description:
        "Get one physiological cycle by id (GET /v2/cycle/{cycleId}), including day strain when score_state is SCORED. Requires read:cycles.",
      inputSchema: cycleIdInput,
      annotations: READ_ONLY,
    },
    async ({ cycle_id }) => call(() => deps.client.getCycle(assertCycleId(cycle_id))),
  );

  server.registerTool(
    "whoop_list_recoveries",
    {
      title: "List WHOOP recoveries",
      description:
        "List recoveries, sorted by the related sleep's start time, newest first (GET /v2/recovery). Records include cycle_id, sleep_id, score_state, and when SCORED a score with recovery_score (0–100), resting_heart_rate, hrv_rmssd_milli, user_calibrating, and on WHOOP 4.0+ spo2_percentage and skin_temp_celsius. Requires read:recovery.",
      inputSchema: collectionInput,
      annotations: READ_ONLY,
    },
    async (args) => call(() => deps.client.listRecoveries(toWhoopCollectionQuery(args))),
  );

  server.registerTool(
    "whoop_get_recovery_for_cycle",
    {
      title: "Get WHOOP recovery for a cycle",
      description:
        "Get the recovery for one physiological cycle (GET /v2/cycle/{cycleId}/recovery). Use cycle_id from whoop_list_cycles or whoop_list_recoveries. Requires read:recovery.",
      inputSchema: cycleIdInput,
      annotations: READ_ONLY,
    },
    async ({ cycle_id }) =>
      call(() => deps.client.getRecoveryForCycle(assertCycleId(cycle_id))),
  );

  server.registerTool(
    "whoop_list_sleep",
    {
      title: "List WHOOP sleep",
      description:
        "List sleep activities, newest first (GET /v2/activity/sleep). Records include id (UUID), cycle_id, nap, score_state, and when SCORED a score with stage_summary (millisecond totals for in-bed, awake, light, slow-wave, and REM sleep), sleep_needed, respiratory_rate, and performance, consistency, and efficiency percentages. Requires read:sleep.",
      inputSchema: collectionInput,
      annotations: READ_ONLY,
    },
    async (args) => call(() => deps.client.listSleep(toWhoopCollectionQuery(args))),
  );

  server.registerTool(
    "whoop_get_sleep",
    {
      title: "Get a WHOOP sleep",
      description:
        "Get one sleep activity by its UUID (GET /v2/activity/sleep/{sleepId}). The id comes from whoop_list_sleep or from a recovery's sleep_id. Requires read:sleep.",
      inputSchema: {
        sleep_id: z.string().describe("Sleep UUID, the `id` field from a sleep record."),
      },
      annotations: READ_ONLY,
    },
    async ({ sleep_id }) => call(() => deps.client.getSleep(assertActivityId(sleep_id, "sleep_id"))),
  );

  server.registerTool(
    "whoop_get_sleep_for_cycle",
    {
      title: "Get WHOOP sleep for a cycle",
      description:
        "Get the sleep associated with one physiological cycle (GET /v2/cycle/{cycleId}/sleep). Returns the same Sleep object as whoop_get_sleep. Requires read:sleep.",
      inputSchema: cycleIdInput,
      annotations: READ_ONLY,
    },
    async ({ cycle_id }) => call(() => deps.client.getSleepForCycle(assertCycleId(cycle_id))),
  );

  server.registerTool(
    "whoop_list_workouts",
    {
      title: "List WHOOP workouts",
      description:
        "List workouts, newest first (GET /v2/activity/workout). Records include id (UUID), sport_name, score_state, and when SCORED a score with strain (0–21), average_heart_rate, max_heart_rate, kilojoule, percent_recorded, optional distance_meter and altitude fields, and zone_durations (zone_zero_milli through zone_five_milli). Requires read:workout.",
      inputSchema: collectionInput,
      annotations: READ_ONLY,
    },
    async (args) => call(() => deps.client.listWorkouts(toWhoopCollectionQuery(args))),
  );

  server.registerTool(
    "whoop_get_workout",
    {
      title: "Get a WHOOP workout",
      description:
        "Get one workout by its UUID (GET /v2/activity/workout/{workoutId}). Requires read:workout.",
      inputSchema: {
        workout_id: z.string().describe("Workout UUID, the `id` field from a workout record."),
      },
      annotations: READ_ONLY,
    },
    async ({ workout_id }) =>
      call(() => deps.client.getWorkout(assertActivityId(workout_id, "workout_id"))),
  );

  return server;
}

async function call<T>(fn: () => Promise<T>) {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error calling WHOOP.";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}
