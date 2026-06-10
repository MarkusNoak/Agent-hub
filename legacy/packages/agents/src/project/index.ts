import { z } from "zod";
import type { AgentDefinition } from "@agent-hub/core";
import type { TrelloConnector, ClockifyConnector, SlackConnector } from "@agent-hub/connectors";

const InputSchema = z.object({
  variance_threshold_pct: z.number().default(15),
  project_id: z.string().optional(),
});

const OutputSchema = z.object({
  alerts: z.array(
    z.object({
      project: z.string(),
      kind: z.enum(["variance", "milestone_miss", "stale_card", "scope_creep"]),
      severity: z.enum(["info", "warn", "critical"]),
      detail: z.string(),
      recommendation: z.string(),
    }),
  ),
  healthy_projects: z.array(z.string()),
  summary: z.string(),
});

export const projectAgent: AgentDefinition<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> = {
  kind: "project",
  displayName: "Project Agent",
  description:
    "Watches milestones, budget variance, and card staleness across all active projects. Runs every 4 hours. Surfaces alerts to the PM.",
  requiresApproval: false,
  defaultCron: "0 */4 * * *",

  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  systemPrompt: (tenant) => `You are the **Project Agent** for ${tenant.tenantName}.

Your job: catch project drift before it becomes a crisis.

Alert taxonomy:
- **variance** — logged hours exceed budget by more than threshold (%)
- **milestone_miss** — a card with a due date passed without moving to Done
- **stale_card** — card in "Doing" >7 days with no activity
- **scope_creep** — >3 new cards added to "To Do" this week without corresponding budget note

Rules:
1. Pull project list via "list_projects".
2. For each, fetch time data + Trello board state.
3. Emit alerts per the taxonomy. Severity:
   - info: 10-19% variance, 1 stale card
   - warn: 20-30% variance, 2+ stale cards, 1 missed milestone
   - critical: >30% variance, 2+ missed milestones, blocker unresolved 3+ days
4. Each alert includes a one-line recommendation ("re-baseline budget", "cut scope", "escalate").
5. If critical alerts exist, notify PM on Slack.
6. Output JSON matching the schema.`,

  tools: [
    {
      name: "list_projects",
      description: "List all active Clockify projects with budget estimates.",
      input_schema: { type: "object", properties: {} },
      execute: async (_a, ctx) => {
        const clockify = ctx.connectors.clockify as ClockifyConnector | undefined;
        if (!clockify) throw new Error("Clockify not configured");
        return await clockify.getProjects();
      },
    },
    {
      name: "get_project_variance",
      description: "Get budget vs. actual for a project.",
      input_schema: {
        type: "object",
        properties: { project_id: { type: "string" } },
        required: ["project_id"],
      },
      execute: async (args, ctx) => {
        const clockify = ctx.connectors.clockify as ClockifyConnector | undefined;
        if (!clockify) throw new Error("Clockify not configured");
        return await clockify.getBudgetUtilization(String(args["project_id"]));
      },
    },
    {
      name: "get_trello_board_state",
      description: "Get list-level breakdown of cards for a board.",
      input_schema: {
        type: "object",
        properties: { board_id: { type: "string" } },
        required: ["board_id"],
      },
      execute: async (args, ctx) => {
        const trello = ctx.connectors.trello as TrelloConnector | undefined;
        if (!trello) throw new Error("Trello not configured");
        const cards = await trello.listCards(String(args["board_id"]));
        const byList = cards.reduce<Record<string, number>>((acc, c) => {
          acc[c.list_name] = (acc[c.list_name] ?? 0) + 1;
          return acc;
        }, {});
        const now = Date.now();
        const stale = cards.filter(
          (c) =>
            c.list_name === "Doing" &&
            c.due &&
            now - new Date(c.due).getTime() > 7 * 86400_000,
        );
        return {
          by_list: byList,
          stale_in_progress: stale.map((c) => ({ id: c.id, name: c.name, url: c.url })),
          total: cards.length,
        };
      },
    },
    {
      name: "notify_pm",
      description: "Send a Slack DM or channel message to the project manager.",
      input_schema: {
        type: "object",
        properties: {
          channel: { type: "string" },
          message: { type: "string" },
        },
        required: ["channel", "message"],
      },
      execute: async (args, ctx) => {
        const slack = ctx.connectors.slack as SlackConnector | undefined;
        if (!slack) return { sent: false };
        await slack.postMessage(String(args["channel"]), String(args["message"]));
        return { sent: true };
      },
    },
  ],
};
