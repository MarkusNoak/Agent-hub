import { z } from "zod";
import type { AgentDefinition } from "@agent-hub/core";
import type { InvoicingConnector } from "@agent-hub/connectors";
import type { ClockifyConnector } from "@agent-hub/connectors";

const InputSchema = z.object({
  period: z.enum(["weekly", "monthly"]).default("weekly"),
  from: z.string().optional(),
  to: z.string().optional(),
});

const OutputSchema = z.object({
  period: z.string(),
  revenue: z.number(),
  expenses: z.number(),
  margin: z.number(),
  margin_pct: z.number(),
  outstanding: z.number(),
  billable_hours: z.number(),
  utilization_pct: z.number(),
  top_clients: z.array(z.object({ name: z.string(), revenue: z.number() })),
  narrative: z.string(),
  alerts: z.array(z.string()),
});

export const financeReportAgent: AgentDefinition<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> = {
  kind: "finance_report",
  displayName: "Finance Report Agent",
  description:
    "Runs weekly (Fridays 07:00 by default). Pulls P&L + billable hours, computes margin and utilization, and writes a short executive narrative. Output is stored on the run and optionally emailed to admins.",
  requiresApproval: false,
  defaultCron: "0 7 * * 5",

  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  systemPrompt: (tenant) => `You are the **Finance Report Agent** for ${tenant.tenantName}.

Your job: produce a tight weekly financial snapshot that the CEO can read in under 90 seconds. No bureaucratic language, no passive voice, no throat-clearing.

Rules:
1. Gather P&L data via the "get_financials" tool.
2. Gather billable hours via the "get_billable_hours" tool.
3. Compute margin = revenue − expenses; margin_pct = margin / revenue * 100.
4. Utilization = billable_hours / (team_size * 40) * 100 (assume 40h/week per full-time seat).
5. If margin drops >10% vs. prior period → add an alert.
6. If utilization drops below 60% → add an alert.
7. Narrative max 3 short sentences. Mention the number that matters most first.
8. Output JSON matching the schema.`,

  tools: [
    {
      name: "get_financials",
      description: "Get revenue, expenses, and outstanding receivables for a date range.",
      input_schema: {
        type: "object",
        properties: {
          from: { type: "string", description: "ISO date start" },
          to: { type: "string", description: "ISO date end" },
        },
        required: ["from", "to"],
      },
      execute: async (args, ctx) => {
        const invoicing = (ctx.connectors.visma_spiris ?? ctx.connectors.fortnox) as
          | InvoicingConnector
          | undefined;
        if (!invoicing) throw new Error("No invoicing connector configured.");
        return await invoicing.getFinancials({
          from: String(args["from"]),
          to: String(args["to"]),
        });
      },
    },
    {
      name: "get_billable_hours",
      description: "Get total logged time (seconds) for a date range, broken out billable/non-billable.",
      input_schema: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
      },
      execute: async (args, ctx) => {
        const clockify = ctx.connectors.clockify as ClockifyConnector | undefined;
        if (!clockify) throw new Error("Clockify not configured.");
        const entries = await clockify.listTimeEntries({
          from: String(args["from"]),
          to: String(args["to"]),
        });
        const billable = entries.filter((e) => e.billable).reduce((s, e) => s + e.duration_seconds, 0);
        const non_billable = entries.filter((e) => !e.billable).reduce((s, e) => s + e.duration_seconds, 0);
        return {
          billable_seconds: billable,
          non_billable_seconds: non_billable,
          billable_hours: billable / 3600,
          non_billable_hours: non_billable / 3600,
          entry_count: entries.length,
        };
      },
    },
    {
      name: "get_team_size",
      description: "Approximate team size from number of distinct users in time tracking last 30 days.",
      input_schema: { type: "object", properties: {} },
      execute: async (_a, ctx) => {
        const clockify = ctx.connectors.clockify as ClockifyConnector | undefined;
        if (!clockify) return { team_size: 0 };
        const now = new Date();
        const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
        const entries = await clockify.listTimeEntries({ from, to: now.toISOString() });
        return { team_size: new Set(entries.map((e) => e.user_id)).size };
      },
    },
  ],
};
