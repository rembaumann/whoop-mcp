import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { CoachService } from "./logic/service.js";
import { INTENT_TYPES, PLANNED_SESSIONS } from "./types.js";

export const TOOL_NAMES = ["log_intent", "explain_yesterday", "today_training_call"] as const;

export function createServer(service: CoachService): McpServer {
  const server = new McpServer({ name: "whoop-mcp", version: "0.1.0" });

  server.registerTool(
    "log_intent",
    {
      title: "Log intent",
      description:
        "Record a lifestyle or training context event in the local intent store so later recovery explanations are not naive. Writes only to the local store. Does not write to Whoop. Multiple intents per day are allowed. Log only what the user stated; never invent an intent.",
      inputSchema: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("YYYY-MM-DD. Defaults to today in WHOOP_TIMEZONE."),
        type: z.enum(INTENT_TYPES).describe("drinks, late_night, travel, hard_life, hard_training, niggle, or other."),
        note: z.string().optional().describe("Optional free-text note."),
        body_area: z.string().optional().describe("Required when type is niggle. Example: knee, shoulder."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        return toolJson(service.logIntent(args));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "explain_yesterday",
    {
      title: "Explain yesterday",
      description:
        "Was yesterday's recovery in the expected band given logged intents and ~14-day baselines? Returns band expected, unexplained, or insufficient_data. When band is unexplained, hypotheses lists unchecked causes (under-logged strain, unlogged lifestyle, a possible illness-shaped pattern, sleep or sensor gap). Never states that the user is sick. Does not invent intents or metrics.",
      inputSchema: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Recovery date YYYY-MM-DD. Defaults to yesterday in WHOOP_TIMEZONE."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await service.explainYesterday(args));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "today_training_call",
    {
      title: "Today training call",
      description:
        "Recommend today's session from readiness, yesterday's band, and open niggles. call is go, go_lighter, swap, or rest. Heavy squat, deadlift, or bench plus an unexplained recovery is never a silent go. A heavy day after an expected drinks or late-night dip defaults to go_lighter unless readiness is severely low. A relevant open niggle biases against loading that pattern. When call is not go, alternate is a concrete prescription.",
      inputSchema: z.object({
        planned_session: z.enum(PLANNED_SESSIONS),
        optional_notes: z.string().optional().describe('Context such as "Day 4" or how a joint felt.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return toolJson(await service.todayTrainingCall(args));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  return server;
}

function toolJson(value: object) {
  const structuredContent = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : "Tool failed";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}
