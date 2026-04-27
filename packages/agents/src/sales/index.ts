import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentDefinition } from "@agent-hub/core";
import { enqueueApproval, LeadSignalSchema } from "@agent-hub/core";
import {
  fetchFundingNews,
  scrapeAllabolag,
  fetchAiReplaceableJobs,
  fetchAppDevSignals,
  searchWeakDigitalPresence,
  fetchVismaUpsellCandidates,
  markVismaUpsellContacted,
  researchCompany,
  validateEmailDomain,
  fetchNoWebsiteCompanies,
} from "@agent-hub/connectors";

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

export const salesAgent: AgentDefinition = {
  kind: "sales",
  displayName: "Sales Agent",
  description:
    "Pulls prospects from 6 free sources (Breakit/ComputerSweden RSS, Allabolag, Arbetsförmedlingen AI-roles, Arbetsförmedlingen growth-roles, Google CSE, Visma upsell), matches each to the right revenue line (webb / app / ai-auto / agent_platform / upsell), and drafts personalized outreach.",
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
    return `You are the **Sales Agent** for ${tenant.tenantName} (We Know IT AB — Swedish tech agency).
You drive five revenue lines using six free data sources. No paid APIs.
────────────────────────────────────────
REVENUE LINES & WKIT OFFERINGS
• webb_design      — Modernize/rebuild websites. Target: companies with outdated or no website. CTA: "gratis 20-min UX-genomgång".
• app_development  — Custom apps, MVPs, integrations. Target: scaling companies, funded startups, companies hiring digital PMs. CTA: "gratis MVP-scoping".
• ai_automation    — Bounded AI integrations (invoice handling, customer service bots, admin automation). Target: companies hiring manual admin roles. CTA: "gratis 30-min AI-audit".
• agent_platform   — Agent Hub sold as SaaS to other agencies/consultancies. Target: professional services firms with manual internal processes. CTA: "20-min demo av plattformen jag körs på".
• upsell           — Existing WKIT customers 14-60 days post-delivery. CTA: "naturligt nästa steg" (warm relationship).

Core ICP: ${coreIcp.industries?.join(", ") ?? "B2B, professional services, tech, real estate, construction"} · ${coreIcp.company_size ?? "10–200 anställda"} · ${coreIcp.geography?.join(", ") ?? "SE/NO/DK/FI"}
Platform ICP: ${platformIcp.industries?.join(", ") ?? "agencies, consulting, recruitment, professional services"} · ${platformIcp.company_size ?? "5–100 anställda"}
Platform pain signals (gold): ${(platformIcp.pains ?? ["manual invoice chasing", "weekly status reports by hand", "founder-led outreach", "manual timereporting"]).join("; ")}

${metaOn ? `META-PITCH RULE (for offer_type=agent_platform):
The outreach MUST include a short PS revealing this email was written by the Sales Agent itself. Vary wording. Example:
  "PS — detta mejl skrevs av vår Sales Agent. Jag godkände det innan det gick ut. Det är produkten jag vill visa dig."
` : ""}
────────────────────────────────────────
TO-EMAIL SELECTION RULE (mandatory — follow exactly):
ALWAYS call research_company first. Then pick to_email in this order:
  1. contact_emails[0] is present → use it. No flag in subject. Highest confidence.
  2. email_candidates[0] is present (generated from VD name) → use it. Add "[VERIFIERA ADRESS]" to subject. Better than info@.
  3. ONLY if BOTH contact_emails AND email_candidates are empty → fall back to info@[domain]. Always add "[VERIFIERA ADRESS]" to subject.
Domain inference: strip "AB"/"HB", replace åäö→aao, remove spaces/special chars, add .se.
Example fallback only: "Branäsgruppen AB" → info@branasgruppen.se (use ONLY when step 1 and 2 both fail).
────────────────────────────────────────
GREETING RULE:
  1. vd_name found → "Hej [Firstname],"
  2. contact_names[0] found → "Hej [Firstname],"
  3. nothing found → "Hej,"
────────────────────────────────────────
STAFFING COMPANY RULE:
SKIP companies that are staffing/recruitment firms hiring on behalf of clients (Adecco, Randstad, Manpower, Poolia, Academic Work, etc.) — they are not the end employer.
EXCEPTION: staffing companies ARE valid prospects for agent_platform (they have heavy internal admin processes).
────────────────────────────────────────
DEDUP RULE (MANDATORY — do this FIRST):
1. Call \`list_recent_outreach\` ONCE at the start of every run.
2. Build a blocklist of those company names + domains (normalize: lowercase, trim, strip "AB"/"AS"/"Inc"/"Ltd").
3. SKIP silently if the company is on the blocklist.
4. Within the same run, also skip a company the SECOND time it appears.
5. The server enforces this: draft_outreach_approval will THROW if a duplicate slips through.
────────────────────────────────────────
DATA SOURCES (call as tools — all free):
1. fetch_funding_news            RSS (Breakit, ComputerSweden, DI, NyTeknik, VA). Funding/growth → app_development.
2. scrape_allabolag              ICP-filter (SNI + 10-99 anställda) → ai_automation or agent_platform.
3. fetch_ai_replaceable_jobs     Arbetsförmedlingen. Admin roles → ai_automation.
4. fetch_app_dev_signals         Arbetsförmedlingen. Digital PMs, developers → app_development.
5. search_weak_digital_presence  Google CSE — queries tuned per service line.
6. fetch_visma_upsell_candidates Befintliga WKIT-kunder 14-60 dagar post-leverans → upsell.
7. fetch_no_website_companies    Allabolag SNI + DNS-check. SMBs without websites → webb_design.
────────────────────────────────────────
ENRICHMENT TOOLS (use after scoring, before upsert_lead):
• research_company      CALL THIS FOR EVERY PROSPECT before drafting.
                        Returns: contact_emails (scraped from site — use first),
                        email_candidates (generated from VD name — use if no contact_emails),
                        vd_name, contact_names, key_facts.
• validate_email_domain DNS MX check. Returns confidence=high/low/unknown.
                        unknown → skip company (domain doesn't resolve).
                        high + contact_emails[0] used → remove [VERIFIERA ADRESS] from subject.
────────────────────────────────────────
DECISION FLOW:
1. Call \`list_recent_outreach\` first.
2. Call all data sources in parallel.
3. For each returned prospect:
   a. If source=funding_news → extract actual company name from headline.
   b. Score ICP fit 0–100. Skip if score < 55.
   c. Pick ONE offer_type (use suggested_offer_hint, refine based on signals).
   d. Call \`research_company\` — required for every prospect.
   e. Call \`validate_email_domain\` on the domain. Skip if confidence=unknown.
   f. Select to_email using TO-EMAIL SELECTION RULE above (steps 1→2→3).
   g. \`upsert_lead\` with all signals + enriched contact data. DO NOT invent lead_id.
   h. \`draft_outreach_approval\` with ≤130-word Swedish email.
      • Use the to_email and greeting from steps f and GREETING RULE.
      • Personalise body using key_facts (employees, revenue, what the company does).
      • Add "[VERIFIERA ADRESS]" to subject ONLY when using email_candidates or info@ fallback.
   i. If source=visma_upsell, call \`mark_visma_upsell_contacted\`.
4. Respect input.max_drafts across all sources.
5. NEVER send — everything queues via draft_outreach_approval.
Offers available: ${offers.join(", ")}.`;
  },
  tools: [
    {
      name: "list_recent_outreach",
      description:
        "Returns companies the Sales Agent has already drafted/approved/sent outreach to within the last N days (default 30). Call this FIRST on every run.",
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
        const { data: approvals } = await supa
          .from("approval_queue")
          .select("payload, created_at, status")
          .eq("tenant_id", ctx.tenant.tenantId)
          .eq("agent_kind", "sales")
          .gte("created_at", since);
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
          const toEmail = String(p["to_email"] ?? "");
          const atIdx = toEmail.indexOf("@");
          const domain = atIdx >= 0 ? toEmail.slice(atIdx + 1).toLowerCase() : undefined;
          if (domain) {
            domains.add(domain);
            raw.push({ company_domain: domain, source: "approval_queue" });
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
            "Do not draft outreach to any company whose normalized name or email domain matches this list.",
        };
      },
    },
    {
      name: "fetch_funding_news",
      description:
        "Fetch recent Swedish funding/growth news from Breakit and ComputerSweden RSS. Returns ProspectSignals where company_name='extract_from_headline' — use the signal text to identify the actual company name. Signals → app_development.",
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
        "Scrape Allabolag.se for companies in ICP-relevant SNI codes with 10–99 employees. Signals → ai_automation or agent_platform.",
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
        "Fetch job ads from Arbetsförmedlingen for roles AI can replace (ekonomiassistent, löneadmin, kundtjänst, orderadmin, hr-admin, fakturahantering). These companies need ai_automation.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
      },
      execute: async (args) => {
        const items = await fetchAiReplaceableJobs({ limit: (args["limit"] as number) ?? 10 });
        return { items, count: items.length };
      },
    },
    {
      name: "fetch_app_dev_signals",
      description:
        "Fetch job ads for growth/scaling roles (produktägare, digital projektledare, systemutvecklare, webbutvecklare). Companies hiring these roles are scaling and need app_development help. Staffing firms are excluded.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
      },
      execute: async (args) => {
        const items = await fetchAppDevSignals({ limit: (args["limit"] as number) ?? 8 });
        return { items, count: items.length };
      },
    },
    {
      name: "search_weak_digital_presence",
      description:
        "Run Google Custom Search with queries tuned per service line: webb_design (advokatbyråer, redovisningsbyråer, byggföretag), app_development (startups, scaleups), agent_platform (konsultbolag, rekryteringsbolag), ai_automation (fastighetsbolag med tung admin). Requires google_api_key + google_cse_id in tenant settings.",
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
          limit: (args["limit"] as number) ?? 8,
        });
        return { items, count: items.length, configured: Boolean(s.google_api_key) };
      },
    },
    {
      name: "fetch_visma_upsell_candidates",
      description:
        "Fetch existing WKIT customers whose projects were completed 14–60 days ago and haven't been contacted for upsell yet. Warm leads — high priority.",
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
      description: "Mark a Visma project as 'upsell contacted' so it isn't resurfaced.",
      input_schema: {
        type: "object",
        properties: {
          project_id: { type: "string" },
        },
        required: ["project_id"],
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        await markVismaUpsellContacted(supa, ctx.tenant.tenantId, String(args["project_id"]));
        return { marked: true };
      },
    },
    {
      name: "research_company",
      description:
        "Enrich a prospect using free Swedish sources: fetches the company website for real contact emails, looks up Allabolag for VD name + company facts, and tries PRoff.se as fallback. Returns vd_name, email_candidates (generated from VD name — not verified but personalized), contact_emails (found on website), and key_facts. PRIORITY: use contact_emails[0] if present; otherwise use email_candidates[0] and address the email to vd_name.",
      input_schema: {
        type: "object",
        properties: {
          company_name: { type: "string", description: "Company name (Swedish, with or without AB/HB)" },
          company_domain: { type: "string", description: "Known domain, e.g. bolaget.se (optional — inferred from name if omitted)" },
        },
        required: ["company_name"],
      },
      execute: async (args) => {
        const result = await researchCompany({
          companyName: String(args["company_name"]),
          companyDomain: args["company_domain"] ? String(args["company_domain"]) : undefined,
        });
        return result;
      },
    },
    {
      name: "fetch_no_website_companies",
      description:
        "Find Swedish SMBs that likely have no website: scrapes Allabolag for 8 industries (advokatbyråer, redovisningsbyråer, byggföretag, städbolag, tandläkare, restauranger, fastighetsmäklare, frisörer) with 1–9 employees, then DNS-checks each inferred domain. Companies with no A-record → no website → strong webb_design prospect.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max prospects to return (default 8)" },
        },
      },
      execute: async (args) => {
        const items = await fetchNoWebsiteCompanies({ limit: (args["limit"] as number) ?? 8 });
        return { items, count: items.length };
      },
    },
    {
      name: "validate_email_domain",
      description:
        "Check if an email domain has MX records (can actually receive mail). Returns confidence=high if MX found, low if only A record, unknown if domain doesn't resolve. Use this to decide whether to flag the email with [VERIFIERA ADRESS] or send with confidence.",
      input_schema: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Domain to check, e.g. bolaget.se (no @ prefix)" },
        },
        required: ["domain"],
      },
      execute: async (args) => {
        return validateEmailDomain(String(args["domain"]));
      },
    },
    {
      name: "upsert_lead",
      description:
        "Insert or update a lead in the tenant's leads table. Unique on (tenant_id, company_domain). Sets stage='researched'. Returns the lead UUID — use this as lead_id in draft_outreach_approval.",
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
            enum: ["funding_news", "allabolag_icp", "job_signal", "digital_presence", "visma_upsell", "manual"],
          },
          offer_type: {
            type: "string",
            enum: ["webb_design", "app_development", "ai_automation", "agent_platform", "upsell"],
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
        "Enqueue a drafted outreach email for human approval. Never sent until approved. to_email must follow TO-EMAIL SELECTION RULE: contact_emails[0] → email_candidates[0] → info@ fallback (last resort only).",
      input_schema: {
        type: "object",
        properties: {
          lead_id: { type: "string" },
          to_email: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          offer_type: {
            type: "string",
            enum: ["webb_design", "app_development", "ai_automation", "agent_platform", "upsell"],
          },
          source: {
            type: "string",
            enum: ["funding_news", "allabolag_icp", "job_signal", "digital_presence", "visma_upsell", "manual"],
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
            "draft_outreach_approval: offer_type=agent_platform requires meta_pitch=true.",
          );
        }
        const leadId = String(args["lead_id"]);
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(leadId)) {
          throw new Error(
            `draft_outreach_approval: lead_id "${leadId}" is not a valid UUID. Call upsert_lead FIRST.`,
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
            `draft_outreach_approval: lead_id ${leadId} does not exist. Call upsert_lead first.`,
          );
        }
        const thisName = (thisLead.company_name as string | null) ?? "";
        const thisDomain = (thisLead.company_domain as string | null) ?? "";
        const norm = (s: string) =>
          s.toLowerCase().trim()
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
                `dedup: ${thisName || thisDomain} already has an active outreach lead in the last 30 days. Skip this company.`,
              );
            }
          }
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
            if (apLeadId && apLeadId === leadId) continue;
            if (thisDomainLc && apDomain && apDomain === thisDomainLc) {
              throw new Error(
                `dedup: domain ${thisDomainLc} already has a sales approval from the last 30 days. Skip this company.`,
              );
            }
          }
        }
        const { approvalId } = await enqueueApproval(supa, {
          tenant: ctx.tenant,
          agentKind: "sales",
          runId: ctx.runId,
          action: "send_email",
          title: `Outreach [${offerType}]: ${args["to_email"]}`,
          summary: metaPitch
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
