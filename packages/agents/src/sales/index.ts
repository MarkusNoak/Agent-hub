import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentDefinition } from "@agent-hub/core";
import { enqueueApproval, LeadSignalSchema } from "@agent-hub/core";
import {
  fetchFundingNews,
  scrapeAllabolag,
  fetchAiReplaceableJobs,
  searchWeakDigitalPresence,
  fetchVismaUpsellCandidates,
  markVismaUpsellContacted,
} from "@agent-hub/connectors";

// ------------------------------------------------------------
// Sales Agent — FOUR revenue lines + FIVE free data sources.
//
// Revenue lines (offer_type):
//   webb_design       — WKI core
//   app_development   — WKI core
//   ai_automation     — WKI core
//   agent_platform    — Agent Hub SaaS (meta-pitch enabled)
//
// Data sources (zero paid APIs):
//   funding_news      — Breakit / DI / ComputerSweden RSS
//   allabolag_icp     — Allabolag.se SNI + size filter
//   job_signal        — Arbetsförmedlingen Jobs API (open data)
//   digital_presence  — Google Custom Search (100 free queries/day)
//   visma_upsell      — existing customers 14–60 days post-delivery
//
// Based on the WKIT Sales Agent v2 by Markus Noaksson, integrated into
// Agent Hub's tool-use loop with tenant scoping + meta-pitch guardrail.
// ------------------------------------------------------------

const OfferTypeEnum = z.enum([
  "webb_design",
  "app_development",
  "ai_automation",
  "agent_platform",
  "upsell",
]);

const ProspectSourceEnum = z.enum([
  "funding_news",
  "allabolag_icp",
  "job_signal",
  "digital_presence",
  "visma_upsell",
]);

const InputSchema = z.object({
  signal: LeadSignalSchema.optional(),
  company_domain: z.string().optional(),
  company_name: z.string().optional(),
  force_offer_type: OfferTypeEnum.optional(),
  /** Restrict to a subset of sources (default: all five). */
  sources: z.array(ProspectSourceEnum).optional(),
  max_drafts: z.number().default(6),
});

const OutputSchema = z.object({
  leads_processed: z.number(),
  drafts_queued: z.array(
    z.object({
      lead_id: z.string(),
      company: z.string(),
      offer_type: OfferTypeEnum,
      approval_id: z.string(),
      meta_pitch: z.boolean(),
      source: ProspectSourceEnum,
    }),
  ),
  leads_skipped: z.array(z.object({ company: z.string(), reason: z.string() })),
  summary: z.string(),
});

type TenantSettings = {
  icp?: {
    industries?: string[];
    company_size?: string;
    geography?: string[];
  };
  agent_platform_icp?: {
    industries?: string[];
    company_size?: string;
    geography?: string[];
    pains?: string[];
  };
  offer_types?: string[];
  meta_pitch_enabled?: boolean;
  google_api_key?: string;
  google_cse_id?: string;
};

export const salesAgent: AgentDefinition<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> = {
  kind: "sales",
  displayName: "Sales Agent",
  description:
    "Pulls prospects from 5 free sources (Breakit/DI RSS, Allabolag, Arbetsförmedlingen Jobs API, Google CSE, Visma upsell), matches each to the right revenue line (webb / app / ai-auto / agent_platform / upsell), and drafts personalized outreach. Uses a meta-pitch when selling Agent Hub itself.",
  requiresApproval: true,
  defaultCron: "0 8 * * 1-5",

  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  systemPrompt: (tenant) => {
    const s = tenant.settings as TenantSettings;
    const coreIcp = s.icp ?? {};
    const platformIcp = s.agent_platform_icp ?? {};
    const offers = s.offer_types ?? [
      "webb_design",
      "app_development",
      "ai_automation",
      "agent_platform",
    ];
    const metaOn = s.meta_pitch_enabled !== false;

    return `You are the **Sales Agent** for ${tenant.tenantName}.

You drive five revenue lines using five free data sources. No paid APIs.

────────────────────────────────────────
REVENUE LINES

• webb_design — modernize/rebuild sites. CTA: "free 20-min UX audit".
• app_development — custom apps/MVPs. CTA: "free MVP scoping".
• ai_automation — bounded AI integrations. CTA: "free 30-min AI audit".
• agent_platform — Agent Hub sold as SaaS. CTA: "20-min demo of the platform I'm running on".
• upsell — existing customer → next engagement. CTA: "natural next step" (warm).

Core ICP:  ${coreIcp.industries?.join(", ") ?? "any B2B"} · ${coreIcp.company_size ?? "20–500"} · ${coreIcp.geography?.join(", ") ?? "SE/NO/DK/FI"}
Platform ICP:  ${platformIcp.industries?.join(", ") ?? "agencies, consulting, pro services"} · ${platformIcp.company_size ?? "10–200"}
Platform pain signals (gold): ${(platformIcp.pains ?? ["manual invoice chasing", "weekly status reports by hand", "founder-led outreach"]).join("; ")}

${metaOn ? `META-PITCH RULE (for offer_type=agent_platform):
The outreach MUST include a short PS revealing this email was written by the Sales Agent itself. Vary wording. Example:
  "PS — detta mejl skrevs av vår Sales Agent. Jag godkände det innan det gick ut. Det är produkten jag vill visa dig."
` : ""}
────────────────────────────────────────
DEDUP RULE (MANDATORY — do this FIRST):

1. Call \`list_recent_outreach\` ONCE at the start of every run. It returns companies
   we have already drafted/approved/sent outreach to within the last 30 days.
2. Build a blocklist of those company names + domains (normalize: lowercase, trim,
   strip "AB"/"AS"/"Inc"/"Ltd").
3. As you process prospects from any source, SKIP silently if the company is on
   the blocklist. Do NOT call upsert_lead or draft_outreach_approval for them.
4. Within the same run, also skip a company the SECOND time it appears — one
   draft per company per run, no matter how many sources it shows up in.
5. The server enforces this: draft_outreach_approval will THROW if a duplicate
   slips through. If that happens, log it in leads_skipped with reason="dedup"
   and move on — don't retry.

────────────────────────────────────────
DATA SOURCES (call as tools — all free):

1. fetch_funding_news          RSS (Breakit, DI, ComputerSweden). Funding/growth signals → app_development or ai_automation.
2. scrape_allabolag            ICP grund-filter (SNI + 10-99 anställda) → ai_automation or agent_platform depending on pains.
3. fetch_ai_replaceable_jobs   Arbetsförmedlingen Jobs API. Bolag som rekryterar ekonomiassistent/löneadmin/kundtjänst → ai_automation.
4. search_weak_digital_presence  Google CSE (only if google_api_key configured) → webb_design.
5. fetch_visma_upsell_candidates  Befintliga kunder 14-60 dagar post-leverans → upsell (confidence high, relationen är varm).

────────────────────────────────────────
DECISION FLOW:

1. Decide which sources to call based on the day's priorities
   (unless input.sources restricts them). Call them in parallel where possible.
2. For each returned prospect:
   a. If source=funding_news → extract the actual company name from the headline signals.
   b. Score ICP fit 0–100 using the RIGHT ICP:
      - offer_type=agent_platform → platform ICP
      - offer_type=upsell → always high (it's an existing customer)
      - everything else → core ICP
   c. Skip if score < 55, OR if confidence would be "low" (weak signal, unclear ICP).
   d. Pick ONE offer_type matching the source hint + detected pain.
   e. upsert_lead with all signals + detected_pains + source. This MUST happen
      before step f — take the UUID that upsert_lead returns and pass it as
      lead_id in step f. DO NOT invent lead_id values like "vetted_001";
      draft_outreach_approval will reject anything that isn't a real UUID.
   f. draft_outreach_approval with a ≤130-word Swedish email. First line = specific observation about them, not about us.
      - For agent_platform: include the meta-pitch PS.
      - For upsell: natural, warm tone — "nu när [projekt] gått live, vill du höra om nästa steg?"
      - For job_signal: frame as alternative to hire, NOT as threat to the role.
   g. If source=visma_upsell, call mark_visma_upsell_contacted with the project_id so we don't resurface them.
3. Respect input.max_drafts across all sources combined. Aim for a mix.
4. NEVER send — everything queues via draft_outreach_approval.

Offers available: ${offers.join(", ")}.

Output JSON matching the schema with a plain-language summary of which sources fired and what ended up in the queue.`;
  },

  tools: [
    // ────────────────────────────────────────────────────────
    // DEDUP — must be called first each run
    // ────────────────────────────────────────────────────────
    {
      name: "list_recent_outreach",
      description:
        "Returns companies the Sales Agent has already drafted/approved/sent outreach to within the last N days (default 30). Call this FIRST on every run and use the result as a blocklist — do not draft outreach for any company on this list.",
      input_schema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Lookback window in days (default 30)" },
        },
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const days = (args["days"] as number) ?? 30;
        const since = new Date(Date.now() - days * 86400_000).toISOString();

        // Pull recent sales approvals (payload has company info)
        const { data: approvals } = await supa
          .from("approval_queue")
          .select("payload, created_at, status")
          .eq("tenant_id", ctx.tenant.tenantId)
          .eq("agent_kind", "sales")
          .gte("created_at", since);

        // Pull recent leads that reached outreach stage
        const { data: leads } = await supa
          .from("leads")
          .select("company_name, company_domain, stage, updated_at")
          .eq("tenant_id", ctx.tenant.tenantId)
          .in("stage", ["outreach_drafted", "outreach_sent", "in_conversation"])
          .gte("updated_at", since);

        const norm = (s: unknown) =>
          String(s ?? "")
            .toLowerCase()
            .trim()
            .replace(/\b(ab|asa|as|oy|inc|ltd|llc|gmbh|bv)\b\.?/g, "")
            .replace(/[^a-z0-9]+/g, "");

        const companies = new Set<string>();
        const domains = new Set<string>();
        const raw: Array<{ company_name?: string; company_domain?: string; source: string }> = [];

        for (const a of approvals ?? []) {
          const p = (a.payload ?? {}) as Record<string, unknown>;
          // lead info is nested: draft_outreach_approval payload has to_email + lead_id but
          // company_name lives in upsert_lead → leads table. We also stash it in payload.
          const subject = String(p["subject"] ?? "");
          const toEmail = String(p["to_email"] ?? "");
          const atIdx = toEmail.indexOf("@");
          const domain = atIdx >= 0 ? toEmail.slice(atIdx + 1).toLowerCase() : undefined;
          if (domain) {
            domains.add(domain);
            raw.push({ company_domain: domain, source: "approval_queue" });
          }
          // Try to extract company from subject "Outreach [..]: name@domain"
          const match = subject.match(/:\s*([^@\s]+)@/);
          if (match && match[1]) {
            companies.add(norm(match[1]));
          }
        }

        for (const l of leads ?? []) {
          const name = l.company_name as string | null;
          const domain = l.company_domain as string | null;
          if (name) companies.add(norm(name));
          if (domain) domains.add(domain.toLowerCase());
          raw.push({
            company_name: name ?? undefined,
            company_domain: domain ?? undefined,
            source: "leads",
          });
        }

        return {
          lookback_days: days,
          blocked_company_names_normalized: Array.from(companies).filter(Boolean),
          blocked_domains: Array.from(domains).filter(Boolean),
          count: companies.size + domains.size,
          raw_sample: raw.slice(0, 20),
          instruction:
            "Do not draft outreach to any company whose normalized name or email domain matches this list. Normalize by lowercasing, trimming, stripping AB/AS/Inc/Ltd, removing non-alphanumeric.",
        };
      },
    },
    // ────────────────────────────────────────────────────────
    // SOURCES — all free
    // ────────────────────────────────────────────────────────
    {
      name: "fetch_funding_news",
      description:
        "Fetch recent Swedish funding/growth news from Breakit, DI and ComputerSweden RSS. Keywords filtered to funding, expansion, hiring. Returns ProspectSignals where company_name='extract_from_headline' — use the signal text to identify the actual company name.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max items (default 8)" },
        },
      },
      execute: async (args) => {
        const items = await fetchFundingNews({ limit: (args["limit"] as number) ?? 8 });
        return { items, count: items.length };
      },
    },
    {
      name: "scrape_allabolag",
      description:
        "Scrape Allabolag.se for companies in ICP-relevant SNI codes with 10–99 employees. Returns raw company names — verify ICP fit with LLM reasoning before drafting outreach.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
      },
      execute: async (args) => {
        const items = await scrapeAllabolag({ limit: (args["limit"] as number) ?? 6 });
        return { items, count: items.length };
      },
    },
    {
      name: "fetch_ai_replaceable_jobs",
      description:
        "Fetch job ads from Arbetsförmedlingen's open Jobs API (jobsearch.api.jobtechdev.se). Filters on roles that AI agents can substantially replace (ekonomiassistent, löneadmin, kundtjänst, orderadmin). Strong signal that the company has manual ops worth automating.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
      },
      execute: async (args) => {
        const items = await fetchAiReplaceableJobs({ limit: (args["limit"] as number) ?? 8 });
        return { items, count: items.length };
      },
    },
    {
      name: "search_weak_digital_presence",
      description:
        "Run Google Custom Search queries to find SMBs with weak digital presence (good webb_design prospects). Requires google_api_key + google_cse_id in tenant settings — returns empty array if not configured. 100 free queries/day.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
      },
      execute: async (args, ctx) => {
        const s = ctx.tenant.settings as TenantSettings;
        const items = await searchWeakDigitalPresence({
          googleApiKey: s.google_api_key,
          googleCseId: s.google_cse_id,
          limit: (args["limit"] as number) ?? 6,
        });
        return { items, count: items.length, configured: Boolean(s.google_api_key) };
      },
    },
    {
      name: "fetch_visma_upsell_candidates",
      description:
        "Fetch existing WKI customers whose projects were completed 14–60 days ago and haven't been contacted for upsell yet. Confidence is inherently high — relationship is warm. Remember to call mark_visma_upsell_contacted after drafting outreach.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const items = await fetchVismaUpsellCandidates(supa, ctx.tenant.tenantId, {
          limit: (args["limit"] as number) ?? 10,
        });
        return { items, count: items.length };
      },
    },
    {
      name: "mark_visma_upsell_contacted",
      description:
        "Mark a Visma project as 'upsell contacted' so it isn't resurfaced. Call after successfully enqueueing an outreach approval for a visma_upsell lead.",
      input_schema: {
        type: "object",
        properties: {
          project_id: { type: "string" },
        },
        required: ["project_id"],
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        await markVismaUpsellContacted(
          supa,
          ctx.tenant.tenantId,
          String(args["project_id"]),
        );
        return { marked: true };
      },
    },
    // ────────────────────────────────────────────────────────
    // WRITE TOOLS — lead + approval
    // ────────────────────────────────────────────────────────
    {
      name: "upsert_lead",
      description:
        "Insert or update a lead in the tenant's leads table. Unique on (tenant_id, company_domain). Sets stage='researched'.",
      input_schema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          company_domain: { type: "string" },
          contact_name: { type: "string" },
          contact_email: { type: "string" },
          contact_linkedin: { type: "string" },
          signal_type: { type: "string" },
          signal_summary: { type: "string" },
          source: {
            type: "string",
            enum: [
              "funding_news",
              "allabolag_icp",
              "job_signal",
              "digital_presence",
              "visma_upsell",
              "manual",
            ],
          },
          offer_type: {
            type: "string",
            enum: [
              "webb_design",
              "app_development",
              "ai_automation",
              "agent_platform",
              "upsell",
            ],
          },
          score: { type: "number" },
          detected_pains: { type: "array", items: { type: "string" } },
        },
        required: ["company_name", "signal_type", "offer_type", "score"],
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const { detected_pains, source, ...rest } = args as Record<string, unknown> & {
          detected_pains?: string[];
          source?: string;
        };
        const row = {
          ...rest,
          tenant_id: ctx.tenant.tenantId,
          stage: "researched",
          metadata: {
            detected_pains: detected_pains ?? [],
            source: source ?? "manual",
          },
        };
        const { data, error } = await supa
          .from("leads")
          .upsert(row, { onConflict: "tenant_id,company_domain" })
          .select("id")
          .single();
        if (error) throw new Error(`upsert_lead: ${error.message}`);
        return { lead_id: (data as { id: string }).id };
      },
    },
    {
      name: "draft_outreach_approval",
      description:
        "Enqueue a drafted outreach email for human approval. When offer_type='agent_platform' the body MUST include a meta-pitch line. Never sent until approved.",
      input_schema: {
        type: "object",
        properties: {
          lead_id: { type: "string" },
          to_email: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          offer_type: {
            type: "string",
            enum: [
              "webb_design",
              "app_development",
              "ai_automation",
              "agent_platform",
              "upsell",
            ],
          },
          source: {
            type: "string",
            enum: [
              "funding_news",
              "allabolag_icp",
              "job_signal",
              "digital_presence",
              "visma_upsell",
              "manual",
            ],
          },
          confidence: { type: "string", enum: ["high", "medium"] },
          meta_pitch: { type: "boolean" },
        },
        required: ["lead_id", "to_email", "subject", "body", "offer_type"],
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const offerType = String(args["offer_type"]);
        const metaPitch = Boolean(args["meta_pitch"]);
        const settings = ctx.tenant.settings as TenantSettings;
        const metaOn = settings.meta_pitch_enabled !== false;

        if (offerType === "agent_platform" && metaOn && !metaPitch) {
          throw new Error(
            "draft_outreach_approval: offer_type=agent_platform requires meta_pitch=true. Rewrite the body to reveal that the email was drafted by the Sales Agent.",
          );
        }

        // ────── LEAD EXISTENCE CHECK ──────
        // Reject made-up lead_id values. The LLM must call upsert_lead first
        // and use the UUID it returns. Otherwise drafts end up in approval_queue
        // without any matching row in the leads table.
        const leadId = String(args["lead_id"]);
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(leadId)) {
          throw new Error(
            `draft_outreach_approval: lead_id "${leadId}" is not a valid UUID. You must call upsert_lead FIRST to create the lead record in the leads table, then pass the UUID it returns here. Do NOT invent lead_id values.`,
          );
        }

        const { data: thisLead } = await supa
          .from("leads")
          .select("id, company_name, company_domain")
          .eq("tenant_id", ctx.tenant.tenantId)
          .eq("id", leadId)
          .maybeSingle();

        if (!thisLead) {
          throw new Error(
            `draft_outreach_approval: lead_id ${leadId} does not exist in the leads table for this tenant. Call upsert_lead first to create the lead, then use the returned id.`,
          );
        }

        // ────── DEDUP GUARD ──────
        // Block if the same company (by normalized name OR domain) has an
        // outreach-stage lead or a sales approval within the last 30 days.
        const thisName = (thisLead.company_name as string | null) ?? "";
        const thisDomain = (thisLead.company_domain as string | null) ?? "";
        const norm = (s: string) =>
          s
            .toLowerCase()
            .trim()
            .replace(/\b(ab|asa|as|oy|inc|ltd|llc|gmbh|bv)\b\.?/g, "")
            .replace(/[^a-z0-9]+/g, "");
        const thisNameNorm = norm(thisName);
        const thisDomainLc = thisDomain.toLowerCase();

        if (thisNameNorm || thisDomainLc) {
          const since = new Date(Date.now() - 30 * 86400_000).toISOString();
          const { data: otherLeads } = await supa
            .from("leads")
            .select("id, company_name, company_domain, stage, updated_at")
            .eq("tenant_id", ctx.tenant.tenantId)
            .in("stage", ["outreach_drafted", "outreach_sent", "in_conversation"])
            .gte("updated_at", since)
            .neq("id", leadId);

          for (const other of otherLeads ?? []) {
            const nn = norm((other.company_name as string | null) ?? "");
            const dd = ((other.company_domain as string | null) ?? "").toLowerCase();
            if ((thisNameNorm && nn && nn === thisNameNorm) || (thisDomainLc && dd && dd === thisDomainLc)) {
              throw new Error(
                `dedup: ${thisName || thisDomain} already has an active outreach lead in the last 30 days (${other.stage}). Skip this company and continue with other prospects.`,
              );
            }
          }

          // Also check pending/approved/sent sales approvals in the queue.
          const { data: recentApprovals } = await supa
            .from("approval_queue")
            .select("id, payload, created_at, status")
            .eq("tenant_id", ctx.tenant.tenantId)
            .eq("agent_kind", "sales")
            .gte("created_at", since);

          for (const ap of recentApprovals ?? []) {
            const p = (ap.payload ?? {}) as Record<string, unknown>;
            const apTo = String(p["to_email"] ?? "").toLowerCase();
            const apAtIdx = apTo.indexOf("@");
            const apDomain = apAtIdx >= 0 ? apTo.slice(apAtIdx + 1) : "";
            const apLeadId = String(p["lead_id"] ?? "");
            if (apLeadId && apLeadId === leadId) continue; // same lead = re-draft ok (shouldn't happen but fine)
            if (thisDomainLc && apDomain && apDomain === thisDomainLc) {
              throw new Error(
                `dedup: domain ${thisDomainLc} already has a sales approval (${ap.status}) from the last 30 days. Skip this company.`,
              );
            }
          }
        }
        // ────── END DEDUP GUARD ──────

        const { approvalId } = await enqueueApproval(supa, {
          tenant: ctx.tenant,
          agentKind: "sales",
          runId: ctx.runId,
          action: "send_email",
          title: `Outreach [${offerType}]: ${args["to_email"]}`,
          summary:
            metaPitch
              ? `Meta-pitch outreach — ${offerType}`
              : `Outreach — ${offerType} (${args["source"] ?? "manual"})`,
          payload: args,
          expiresInHours: 48,
        });
        await supa
          .from("leads")
          .update({ stage: "outreach_drafted" })
          .eq("tenant_id", ctx.tenant.tenantId)
          .eq("id", String(args["lead_id"]));
        return { approval_id: approvalId, queued: true, meta_pitch: metaPitch };
      },
    },
  ],
};