import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentDefinition } from "@agent-hub/core";
import { enqueueApproval } from "@agent-hub/core";
import type { LinkedInConnector } from "@agent-hub/connectors";

const InputSchema = z.object({
  topic_hint: z.string().optional(),
  post_count: z.number().default(3),
  include_ad_analysis: z.boolean().default(true),
});

const OutputSchema = z.object({
  ad_insights: z.string().optional(),
  post_drafts: z.number(),
  ad_copy_drafts: z.number(),
  summary: z.string(),
});

export const marketingAgent: AgentDefinition<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> = {
  kind: "marketing",
  displayName: "Marketing Agent",
  description:
    "Weekly content pipeline: analyses LinkedIn Ads performance and organic posts, then drafts LinkedIn posts and ad copy improvements — all queued for approval.",
  requiresApproval: true,
  defaultCron: "0 9 * * 1",

  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  systemPrompt: (tenant) => {
    const tone =
      (tenant.settings as { marketing?: { tone?: string } })?.marketing?.tone ??
      "sharp-executive";
    const adsAccountId =
      (tenant.settings as { marketing?: { linkedin_ads_account_id?: string } })?.marketing
        ?.linkedin_ads_account_id ?? null;

    return `You are the **Marketing Agent** for ${tenant.tenantName}.

You run every Monday morning. Your job is a two-part content pipeline:

## Part 1 — Analyse performance
${adsAccountId
  ? `1. Call "get_ad_performance" with account_id="${adsAccountId}" to fetch last 30 days of campaign data.
   - Which campaigns have the best/worst CTR?
   - Which have the highest cost-per-click?
   - Identify the weakest campaign and draft improved ad copy for it.`
  : "1. LinkedIn Ads not configured — skip ad analysis."}
2. Call "get_organic_post_stats" to see which recent posts performed best.
   - Note the top 2 posts by engagement and the bottom 2.
   - Extract what worked: hook style, topic, length.

## Part 2 — Draft content
Based on the analysis + recent business signals:
3. Call "list_recent_wins" for fresh story material.
4. Call "list_recent_leads" to understand what companies you're attracting.
5. Draft ${3} LinkedIn posts via "draft_linkedin_post". Each must:
   - Voice = "${tone}": first person, direct, opinionated
   - Lead with a concrete number, decision, or story — never a question
   - 100–180 words, no hashtags, no corp-speak
   - Be distinct in angle from the others
${adsAccountId
  ? `6. Draft 1–2 improved ad copy variants for the weakest campaign via "draft_ad_copy".`
  : ""}

## Output rules
- Always queue content for approval — never publish directly
- If ad data is unavailable, proceed with organic + lead data only
- Report back with what you drafted and key insights from the analysis`;
  },

  tools: [
    {
      name: "get_ad_performance",
      description: "Fetch LinkedIn Ads campaign performance for the last 30 days.",
      input_schema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "LinkedIn Ads account ID (numeric)" },
        },
        required: ["account_id"],
      },
      execute: async (args, ctx) => {
        const li = ctx.connectors.linkedin as LinkedInConnector | undefined;
        if (!li) return { error: "LinkedIn not configured", campaigns: [] };
        const end = new Date().toISOString().slice(0, 10);
        const start = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
        const campaigns = await li.getAdCampaignStats(String(args["account_id"]), { start, end });
        return { campaigns, period: `${start} → ${end}` };
      },
    },
    {
      name: "get_organic_post_stats",
      description: "Fetch recent organic LinkedIn post performance metrics.",
      input_schema: { type: "object", properties: { count: { type: "number" } } },
      execute: async (args, ctx) => {
        const li = ctx.connectors.linkedin as LinkedInConnector | undefined;
        if (!li) return { error: "LinkedIn not configured", posts: [] };
        const posts = await li.getOrganicPostStats(Number(args["count"] ?? 10));
        return { posts };
      },
    },
    {
      name: "list_recent_leads",
      description: "Recent leads — used to understand what companies we are attracting.",
      input_schema: { type: "object", properties: {} },
      execute: async (_a, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const { data } = await supa
          .from("leads")
          .select("company_name, signal_type, offer_type, stage, created_at")
          .eq("tenant_id", ctx.tenant.tenantId)
          .order("created_at", { ascending: false })
          .limit(20);
        return data ?? [];
      },
    },
    {
      name: "list_recent_wins",
      description: "Leads marked as won — fresh story material for content.",
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
      name: "draft_linkedin_post",
      description: "Queue a LinkedIn post draft for human approval.",
      input_schema: {
        type: "object",
        properties: {
          topic: { type: "string" },
          body: { type: "string" },
          hook: { type: "string", description: "The opening line — makes or breaks the post" },
          cta: { type: "string" },
          inspiration: { type: "string", description: "Which insight drove this angle" },
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
          expiresInHours: 168,
        });
        return { approval_id: approvalId, queued: true };
      },
    },
    {
      name: "draft_ad_copy",
      description: "Queue improved LinkedIn Ads copy for human approval.",
      input_schema: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          headline: { type: "string", description: "Max 150 chars" },
          introductory_text: { type: "string", description: "Max 600 chars" },
          cta_label: { type: "string", enum: ["Apply Now", "Download", "Get Quote", "Learn More", "Sign Up", "Subscribe"] },
          rationale: { type: "string", description: "Why this copy will outperform the current version" },
        },
        required: ["headline", "introductory_text", "rationale"],
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const { approvalId } = await enqueueApproval(supa, {
          tenant: ctx.tenant,
          agentKind: "marketing",
          runId: ctx.runId,
          action: "post_linkedin",
          title: `Ad copy: ${String(args["headline"]).slice(0, 60)}`,
          summary: String(args["rationale"]).slice(0, 200),
          payload: { ...args, type: "ad_copy" },
          expiresInHours: 168,
        });
        return { approval_id: approvalId, queued: true };
      },
    },
  ],
};
