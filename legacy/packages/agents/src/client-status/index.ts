import { z } from "zod";
import type { AgentDefinition } from "@agent-hub/core";
import type { ClockifyConnector, TrelloConnector } from "@agent-hub/connectors";

const InputSchema = z.object({
  risk_threshold_hours: z.number().default(8),
  client_filter: z.string().optional(),
});

const OutputSchema = z.object({
  clients: z.array(
    z.object({
      name: z.string(),
      project_ids: z.array(z.string()),
      status: z.enum(["healthy", "watch", "at_risk"]),
      logged_hours_week: z.number(),
      variance_pct: z.number(),
      blockers: z.array(z.string()),
      recommendation: z.string(),
    }),
  ),
  executive_summary: z.string(),
});

export const clientStatusAgent: AgentDefinition<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> = {
  kind: "client_status",
  displayName: "Client Status Agent",
  description:
    "Cross-references Clockify time entries with Trello cards per client to produce a weekly health snapshot. Flags risk before it becomes escalation.",
  requiresApproval: false,
  defaultCron: "0 9 * * 1",

  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  systemPrompt: (tenant) => `You are the **Client Status Agent** for ${tenant.tenantName}.

Your job: give the CEO a Monday-morning snapshot of every active client so they know which fires to put out *before* a customer calls.

Status definitions:
- **healthy** — on budget, no blockers, recent progress visible in Trello
- **watch** — one yellow signal (variance 10–20%, 1 blocker, no progress 3+ days)
- **at_risk** — two or more yellow signals, or variance >20%, or explicit blocker card

Rules:
1. For each active Trello board (one per client), get cards + time logged last 7 days.
2. Score each client using the rules above.
3. For at_risk clients, write a concrete recommendation ("book 30min with X to unblock Y").
4. Executive summary ≤3 sentences. Lead with the single most urgent client.
5. Output JSON matching the schema.`,

  tools: [
    {
      name: "list_client_boards",
      description: "List all Trello boards that represent a client project.",
      input_schema: { type: "object", properties: {} },
      execute: async (_a, ctx) => {
        const trello = ctx.connectors.trello as TrelloConnector | undefined;
        if (!trello) throw new Error("Trello not configured");
        return await trello.listBoards();
      },
    },
    {
      name: "get_board_health",
      description: "Pull cards, blockers, and due dates from a Trello board.",
      input_schema: {
        type: "object",
        properties: { board_id: { type: "string" } },
        required: ["board_id"],
      },
      execute: async (args, ctx) => {
        const trello = ctx.connectors.trello as TrelloConnector | undefined;
        if (!trello) throw new Error("Trello not configured");
        const cards = await trello.listCards(String(args["board_id"]));
        const blockers = cards.filter((c) => c.labels.includes("blocker"));
        const overdue = cards.filter(
          (c) => c.due && new Date(c.due) < new Date() && c.list_name !== "Done",
        );
        return {
          total_cards: cards.length,
          blockers: blockers.map((c) => c.name),
          overdue_cards: overdue.map((c) => c.name),
          in_progress: cards.filter((c) => c.list_name === "Doing").length,
          done_this_week: cards.filter(
            (c) =>
              c.list_name === "Done" &&
              c.due &&
              new Date(c.due).getTime() > Date.now() - 7 * 86400_000,
          ).length,
        };
      },
    },
    {
      name: "get_time_for_project",
      description: "Get hours logged for a Clockify project last N days.",
      input_schema: {
        type: "object",
        properties: {
          project_id: { type: "string" },
          days: { type: "number" },
        },
        required: ["project_id"],
      },
      execute: async (args, ctx) => {
        const clockify = ctx.connectors.clockify as ClockifyConnector | undefined;
        if (!clockify) return { hours: 0, note: "Clockify not configured" };
        const days = Number(args["days"] ?? 7);
        const now = new Date();
        const from = new Date(now.getTime() - days * 86400_000).toISOString();
        const entries = await clockify.listTimeEntries({
          from,
          to: now.toISOString(),
          projectId: String(args["project_id"]),
        });
        return {
          hours: entries.reduce((s, e) => s + e.duration_seconds, 0) / 3600,
          entry_count: entries.length,
        };
      },
    },
    {
      name: "get_budget_utilization",
      description: "Compare logged hours to the budgeted estimate for a project.",
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
  ],
};
