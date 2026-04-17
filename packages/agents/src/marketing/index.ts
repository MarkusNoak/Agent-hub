import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentDefinition } from "@agent-hub/core";
import { enqueueApproval } from "@agent-hub/core";
import type { LinkedInConnector } from "@agent-hub/connectors";

const InputSchema = z.object({
  topic_hint: z.string().optional(),
  count: z.number().default(3),
});

const OutputSchema = z.object({
  drafts: z.array(
    z.object({
      topic: z.string(),
      body: z.string(),
      hook: z.string(),
      cta: z.string(),
      approval_id: z.string(),
    }),
  ),
  summary: z.string(),
});

export const marketingAgent: AgentDefinition<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> = {
  kind: "marketing",
  displayName: "Marketing Agent",
  description:
    "Monthly LinkedIn content drafter. Picks 2–3 topics based on recent wins, signals, and CEO voice; drafts posts; queues for approval.",
  requiresApproval: true,
  defaultCron: "0 10 1 * *",

  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  systemPrompt: (tenant) => {
    const tone =
      (tenant.settings as { marketing?: { tone?: string } })?.marketing?.tone ??
      "sharp-executive";
    return `You are the **Marketing Agent** for ${tenant.tenantName}.

Your job: propose LinkedIn content the CEO will actually recognize as their own voice — no corp-speak, no emojis, no cliches.

Voice = "${tone}":
- First person, direct, opinionated
- Leads with a concrete number, decision, or story
- 100–180 words per post
- No hashtags unless genuinely useful
- No emojis unless CEO config explicitly enables them

Topic sources:
- Recent leads won (use "list_recent_leads")
- Product/agent launches
- Lessons from running a services business
- Opinions on tech/industry

Rules:
1. Draft N=input.count posts. Each must be distinct in angle.
2. For each draft, identify hook (first line), body, and call-to-action.
3. Queue each draft for approval via "draft_linkedin_approval".
4. Never publish directly.
5. Output JSON matching the schema.`;
  },

  tools: [
    {
      name: "list_recent_leads",
      description: "Get recent leads (any stage) for inspiration — e.g. what kind of companies are we matching with.",
      input_schema: { type: "object", properties: {} },
      execute: async (_a, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const { data, error } = await supa
          .from("leads")
          .select("company_name, signal_type, offer_type, stage, created_at")
          .eq("tenant_id", ctx.tenant.tenantId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    },
    {
      name: "list_recent_wins",
      description: "Get projects marked as won this quarter.",
      input_schema: { type: "object", properties: {} },
      execute: async (_a, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const { data } = await supa
          .from("leads")
          .select("company_name, offer_type, updated_at")
          .eq("tenant_id", ctx.tenant.tenantId)
          .eq("stage", "won")
          .order("updated_at", { ascending: false })
          .limit(10);
        return data ?? [];
      },
    },
    {
      name: "draft_linkedin_approval",
      description: "Enqueue a LinkedIn post draft for human approval.",
      input_schema: {
        type: "object",
        properties: {
          topic: { type: "string" },
          body: { type: "string" },
          hook: { type: "string" },
          cta: { type: "string" },
          visibility: { type: "string", enum: ["PUBLIC", "CONNECTIONS"] },
        },
        required: ["topic", "body", "hook"],
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const { approvalId } = await enqueueApproval(supa, {
          tenant: ctx.tenant,
          agentKind: "marketing",
          runId: ctx.runId,
          action: "post_linkedin",
          title: `LinkedIn: ${args["topic"]}`,
          summary: String(args["hook"]).slice(0, 200),
          payload: args,
          expiresInHours: 72,
        });
        return { approval_id: approvalId };
      },
    },
    {
      name: "preview_linkedin_post",
      description: "Optional: get a live preview via the LinkedIn API (does NOT publish).",
      input_schema: {
        type: "object",
        properties: { body: { type: "string" } },
        required: ["body"],
      },
      execute: async (args, ctx) => {
        const li = ctx.connectors.linkedin as LinkedInConnector | undefined;
        if (!li) return { preview: String(args["body"]) };
        return await li.draftPost({ body: String(args["body"]) });
      },
    },
  ],
};
