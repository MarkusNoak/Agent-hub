import { z } from "zod";
import type { AgentDefinition, ToolContext } from "@agent-hub/core";
import { enqueueApproval } from "@agent-hub/core";
import type { InvoicingConnector } from "@agent-hub/connectors";

// ------------------------------------------------------------
// I/O schemas
// ------------------------------------------------------------
const InputSchema = z.object({
  /** Optional — when triggered by webhook we pass the invoice id; when cron, we scan all. */
  invoice_id: z.string().optional(),
  /** Days-overdue thresholds at which to escalate. Default from agent config. */
  reminder_days: z.array(z.number()).default([3, 7, 14]),
  escalate_days: z.number().default(30),
});

const OutputSchema = z.object({
  processed_count: z.number(),
  reminders_drafted: z.array(
    z.object({
      invoice_id: z.string(),
      customer: z.string(),
      days_overdue: z.number(),
      level: z.enum(["friendly", "firm", "final"]),
      approval_id: z.string(),
    }),
  ),
  summary: z.string(),
});

// ------------------------------------------------------------
// Agent
// ------------------------------------------------------------
export const invoiceAgent: AgentDefinition<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  kind: "invoice",
  displayName: "Invoice Agent",
  description:
    "Monitors unpaid invoices from the tenant's invoicing system (Visma/Fortnox). Drafts escalating reminders and queues them for human approval before sending.",
  requiresApproval: true,
  defaultCron: "0 9 * * *", // daily 09:00

  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  systemPrompt: (tenant) => `You are the **Invoice Agent** for ${tenant.tenantName}.

Your job: protect cash flow by chasing unpaid invoices politely and consistently, without the CEO having to remember. You operate on invoices that exist in the tenant's invoicing system (Visma Spiris or Fortnox — abstracted behind the "invoicing" tool).

Rules:
1. For each unpaid invoice past due date, decide the appropriate reminder level:
   - 1–7 days overdue → "friendly"
   - 8–21 days overdue → "firm"
   - 22+ days overdue → "final"
2. Never send reminders directly. Draft the reminder and enqueue an approval.
3. Never remind on the same invoice more than once per 3 days (check audit_log via tools if needed).
4. Compose messages in the customer's preferred language. Default Swedish for SE customers, English otherwise.
5. Be warm but clear. Include invoice number, amount, due date, and a payment link if available.
6. Output final JSON matching the output schema.`,

  tools: [
    {
      name: "list_overdue_invoices",
      description: "List invoices that are unpaid and past their due date.",
      input_schema: {
        type: "object",
        properties: {
          from: { type: "string", description: "ISO date lower bound (issue date)" },
        },
      },
      execute: async (_args, ctx) => {
        const inv = ctx.connectors.visma_spiris as InvoicingConnector | undefined;
        const fnx = ctx.connectors.fortnox as InvoicingConnector | undefined;
        const active = inv?.kind === "visma_spiris" ? inv : fnx?.kind === "fortnox" ? fnx : null;
        if (!active) throw new Error("No invoicing connector configured for this tenant.");
        const invoices = await active.listInvoices({ status: "overdue" });
        return invoices.map((i) => ({
          id: i.id,
          number: i.number,
          customer: i.customer_name,
          customer_email: i.customer_email,
          amount: i.amount_total - i.amount_paid,
          currency: i.currency,
          due_at: i.due_at,
          days_overdue: Math.floor(
            (Date.now() - new Date(i.due_at).getTime()) / (1000 * 60 * 60 * 24),
          ),
        }));
      },
    },
    {
      name: "draft_reminder_approval",
      description:
        "Enqueue a reminder draft for human approval. The reminder will NOT be sent until approved.",
      input_schema: {
        type: "object",
        properties: {
          invoice_id: { type: "string" },
          customer_name: { type: "string" },
          customer_email: { type: "string" },
          subject: { type: "string" },
          body_html: { type: "string" },
          level: { type: "string", enum: ["friendly", "firm", "final"] },
          days_overdue: { type: "number" },
        },
        required: ["invoice_id", "customer_email", "subject", "body_html", "level"],
      },
      execute: async (args, ctx) => {
        const { approvalId } = await enqueueApproval(
          (ctx.supabase as { raw: () => import("@supabase/supabase-js").SupabaseClient }).raw(),
          {
            tenant: ctx.tenant,
            agentKind: "invoice",
            runId: ctx.runId,
            action: "send_invoice_reminder",
            title: `Reminder: ${args["customer_name"]} · Invoice ${args["invoice_id"]}`,
            summary: `Level: ${args["level"]} · ${args["days_overdue"]} days overdue`,
            payload: args,
            expiresInHours: 48,
          },
        );
        return { approval_id: approvalId, queued: true };
      },
    },
  ],
};
