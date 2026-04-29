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
  searchNoWebsiteCompanies,
  searchCompaniesWithSignal,
  searchRecentlyFundedCompanies,
  findDecisionMaker,
  enrichPersonEmail,
  searchOsmNoWebsite,
  searchOsmByType,
  type ProspectSignal,
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
  max_drafts: z.number().default(10),
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
  apollo_api_key?: string;
};

export const salesAgent: AgentDefinition = {
  kind: "sales",
  displayName: "Sales Agent",
  description:
    "Pulls prospects from company-level signals: Apollo (no-website companies, industry keyword search, funded startups), Allabolag SNI scraping, media RSS, Google CSE, Visma upsell. Matches each to the right revenue line (webb / app / ai-auto / agent_platform / upsell) and drafts personalized outreach. Job-ad sources are secondary fallback only.",
  requiresApproval: true,
  defaultCron: "0 8 * * *",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  systemPrompt: (tenant) => {
    const s = tenant.settings as TenantSettings;
    const metaOn = s.meta_pitch_enabled === true;
    return `Du är Sales Agent för We Know IT AB — ett svenskt digitalbyrå.
Ditt jobb är enkelt: hitta svenska bolag som behöver våra tjänster, hitta en kontaktyta, skriv ett kort mejl.

────────────────────────────────────────
VÅRA TJÄNSTER
• webb_design     — Bolag utan hemsida, eller med uråldrigt utseende. CTA: "gratis 20-min genomgång".
• app_development — Bolag som ska bygga något digitalt (startup, scale-up, funding). CTA: "gratis MVP-scoping".
• ai_automation   — Bolag med tung manuell administration (bokföring, logistik, tillverkning). CTA: "gratis 30-min AI-audit".
• agent_platform  — IT-konsulter, digitala byråer, rekryteringsbolag — behöver intern automation. CTA: "gratis demo".

────────────────────────────────────────
FLÖDE — gör detta varje körning:

1. Kör \`list_recent_outreach\` — skippa bolag vi redan kontaktat.

2. Hämta leads från källorna nedan (börja med google_places_no_website).

3. För varje lead — skippa direkt om något av dessa stämmer:
   • Offentlig sektor (kommun, region, myndighet, skola, sjukhus)
   • Ideell organisation, kyrka, förening
   • Konsumentbolag (B2C e-handel, dagligvaruhandel)
   • Redan kontaktade (från steg 1)

4. Hitta kontaktyta — i denna prioritetsordning:
   a. Telefon från OSM (extra.phone) — alltid föredra detta för lokala bolag utan hemsida
   b. Mejl från hemsidan — kör \`research_company\` om de har en webbsida
   c. info@[domän] som sista utväg — lägg "[VERIFIERA ADRESS]" i ämnesraden

5. Skriv ett kort mejl (max 100 ord, svenska):
   • Hej [Förnamn], / Hej, om inget namn finns
   • Nämn vad de gör och varför vi kontaktar dem specifikt
   • En konkret CTA (erbjud ett gratis samtal/genomgång)
   • Signera: Markus Noaksson, We Know IT

${metaOn ? `   PS — detta mejl skrevs av vår Sales Agent. Variera formuleringen.\n` : ""}
6. Kör \`upsert_lead\` och sedan \`draft_outreach_approval\`.

────────────────────────────────────────
KÄLLOR — kör i denna ordning:

1. osm_no_website
   → Lokala bolag utan hemsida → webb_design
   Kör alltid. Ingen nyckel krävs. Roterar automatiskt.

2. osm_by_type  → ai_automation
   osm_filters: [["office","accountant"],["office","tax_advisor"]], city: "Stockholm"
   osm_filters: [["office","logistics"],["office","company"]], city: "Göteborg"
   label: "Bransch med tung manuell administration — behov av AI-automation"

3. osm_by_type  → app_development
   osm_filters: [["office","it"],["office","software"]], city: "Stockholm"
   osm_filters: [["office","startup"],["office","company"]], city: "Malmö"
   label: "Tech/digital bolag som skalar — behov av apputveckling"

4. osm_by_type  → agent_platform
   osm_filters: [["office","consulting"],["office","it"]], city: "Göteborg"
   label: "IT-konsultbolag — behov av intern automation"

5. fetch_funding_news            → Nystartade/nyfinansierade bolag → app_development

6. apollo_signal_companies × 3   → ai_automation / app_development / agent_platform  (om apollo_api_key)
7. apollo_funded_companies        → app_development  (om apollo_api_key)
8. apollo_no_website_companies    → webb_design  (om apollo_api_key)
9. fetch_no_website_companies     → webb_design  (fallback)

Mål per körning: 3 webb_design · 3 app_development · 2 ai_automation · 2 agent_platform.
Kvalitet före kvantitet — skippa hellre ett tveksamt lead än att skicka en dålig pitch.`;
  },
  tools: [
    {
      name: "list_recent_outreach",
      description:
        "Returns companies the Sales Agent has already drafted/approved/sent outreach to within the last N days (default 14). Call this FIRST on every run.",
      input_schema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Lookback window in days (default 14)" },
        },
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const days = (args["days"] as number) ?? 14;
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
        "Scrape Allabolag.se for companies in ICP-relevant SNI codes with 10–99 employees. SNI codes: 69109 (advokatbyråer), 69200 (redovisning/revision), 71110 (arkitektkontor), 73110 (reklam/kommunikationsbyråer), 70220 (managementkonsulter), 68100 (fastighetsbolag), 62020 (IT-konsultbolag → agent_platform), 73200 (digital marknadsföring/marknadsundersökning → agent_platform), 74909 (övriga konsulter → agent_platform). IT-konsultbolag (62020) är INTE konkurrenter — de är prime targets för agent_platform eftersom de saknar intern automation. Signals → ai_automation or agent_platform.",
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
        "Fetch job ads for digital/tech hiring roles (produktägare, digital projektledare, systemutvecklare, webbutvecklare, apputvecklare, mobilutvecklare, frontend-utvecklare, backend-utvecklare, fullstack-utvecklare, iOS/Android-utvecklare, digital marknadsföring, performance marketing). Companies hiring these roles are scaling their digital capability and need app_development help. Staffing firms are excluded.",
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
      name: "apollo_no_website_companies",
      description:
        "Apollo.io: Search for Swedish companies (10–200 employees) that have no website registered in Apollo's database. Returns verified company data with industry, size, location. FREE — no credits used. Only call if apollo_api_key is set in tenant settings.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
      execute: async (args, ctx) => {
        const apiKey = (ctx.tenant.settings as TenantSettings).apollo_api_key;
        if (!apiKey) return { items: [], count: 0, note: "apollo_api_key not configured" };
        const items = await searchNoWebsiteCompanies({ apiKey, limit: (args["limit"] as number) ?? 10 });
        return { items, count: items.length };
      },
    },
    {
      name: "osm_no_website",
      description:
        "OpenStreetMap/Overpass: Find local Swedish businesses (restaurang, frisör, elektriker, café, etc.) that have no website tag in OSM. PRIMARY source for webb_design leads. Free, no API key needed. Rotates automatically through categories and cities.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 15)" },
          city: { type: "string", description: "Override city, e.g. 'Göteborg'. Leave empty to auto-rotate." },
        },
      },
      execute: async (args) => {
        const items = await searchOsmNoWebsite({
          limit: (args["limit"] as number) ?? 15,
          cityOverride: args["city"] as string | undefined,
        });
        return { items, count: items.length };
      },
    },
    {
      name: "osm_by_type",
      description:
        "OpenStreetMap/Overpass: Find Swedish businesses by OSM type in a specific city. Use for ai_automation (office/accountant, office/company) or app_development (office/it, office/software). Free, no API key needed.",
      input_schema: {
        type: "object",
        properties: {
          osm_filters: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
              description: "OSM key-value pair, e.g. [\"office\", \"accountant\"]",
            },
            description: "List of OSM key-value filters, e.g. [[\"office\",\"accountant\"],[\"office\",\"company\"]]",
          },
          city: { type: "string", description: "Swedish city name, e.g. 'Stockholm'" },
          offer_hint: {
            type: "string",
            enum: ["ai_automation", "app_development", "webb_design", "agent_platform"],
          },
          label: { type: "string", description: "Signal label for the lead" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["osm_filters", "city", "offer_hint", "label"],
      },
      execute: async (args) => {
        const items = await searchOsmByType({
          osmFilters: args["osm_filters"] as Array<[string, string]>,
          city: args["city"] as string,
          offerHint: args["offer_hint"] as ProspectSignal["suggested_offer_hint"],
          label: args["label"] as string,
          limit: (args["limit"] as number) ?? 10,
        });
        return { items, count: items.length };
      },
    },
    {
      name: "apollo_signal_companies",
      description:
        "Apollo.io: Search for Swedish companies actively hiring roles that signal need for WKIT services. signal_type options: 'ai_automation' (hiring admin roles), 'app_development' (hiring dev/tech roles), 'agent_platform' (IT-konsultbolag & digitala byråer). FREE — no credits used. Only call if apollo_api_key is set.",
      input_schema: {
        type: "object",
        properties: {
          signal_type: {
            type: "string",
            enum: ["ai_automation", "app_development", "agent_platform"],
            description: "Type of buying signal to search for",
          },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["signal_type"],
      },
      execute: async (args, ctx) => {
        const apiKey = (ctx.tenant.settings as TenantSettings).apollo_api_key;
        if (!apiKey) return { items: [], count: 0, note: "apollo_api_key not configured" };
        const items = await searchCompaniesWithSignal({
          apiKey,
          signalType: args["signal_type"] as "ai_automation" | "app_development" | "agent_platform",
          limit: (args["limit"] as number) ?? 10,
        });
        return { items, count: items.length };
      },
    },
    {
      name: "apollo_funded_companies",
      description:
        "Apollo.io: Search for Swedish companies that received funding in the last 6 months. Strong signal for app_development — they have money and need to build. FREE — no credits used. Only call if apollo_api_key is set.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 8)" },
        },
      },
      execute: async (args, ctx) => {
        const apiKey = (ctx.tenant.settings as TenantSettings).apollo_api_key;
        if (!apiKey) return { items: [], count: 0, note: "apollo_api_key not configured" };
        const items = await searchRecentlyFundedCompanies({ apiKey, limit: (args["limit"] as number) ?? 8 });
        return { items, count: items.length };
      },
    },
    {
      name: "apollo_find_decision_maker",
      description:
        "Apollo.io: Find the VD/founder/owner at a specific company by domain. Returns name and title — NO email (free, no credits). Use this after research_company when no VD name was found via scraping. Then use the name to generate email_candidates.",
      input_schema: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Company domain, e.g. bolaget.se" },
          company_name: { type: "string", description: "Company name for context" },
        },
        required: ["domain", "company_name"],
      },
      execute: async (args, ctx) => {
        const apiKey = (ctx.tenant.settings as TenantSettings).apollo_api_key;
        if (!apiKey) return { found: false, note: "apollo_api_key not configured" };
        const result = await findDecisionMaker({
          apiKey,
          domain: String(args["domain"]),
          companyName: String(args["company_name"]),
        });
        return result ?? { found: false };
      },
    },
    {
      name: "apollo_enrich_contact",
      description:
        "Apollo.io: Reveal verified email for a known person. COSTS 1 CREDIT — only use as last resort when research_company AND apollo_find_decision_maker both failed to produce any email, AND the lead has score ≥ 80. Requires first_name, last_name, and domain.",
      input_schema: {
        type: "object",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          domain: { type: "string", description: "Company domain, e.g. bolaget.se" },
          apollo_id: { type: "string", description: "Apollo person ID if known (from apollo_find_decision_maker)" },
        },
        required: ["first_name", "last_name", "domain"],
      },
      execute: async (args, ctx) => {
        const apiKey = (ctx.tenant.settings as TenantSettings).apollo_api_key;
        if (!apiKey) return { email: null, note: "apollo_api_key not configured" };
        return enrichPersonEmail({
          apiKey,
          firstName: String(args["first_name"]),
          lastName: String(args["last_name"]),
          domain: String(args["domain"]),
          apolloId: args["apollo_id"] ? String(args["apollo_id"]) : undefined,
        });
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
