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
  findDecisionMaker,
  enrichPersonEmail,
  upsertProspectCompany,
  storeResearchResult,
  queryEnrichedCompanies,
  isBlocklistedCompany,
  searchSwedishDecisionMakers,
} from "@agent-hub/connectors";

const OfferTypeEnum = z.enum([
  "webb_design",
  "app_development",
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
  max_drafts: z.number().default(15),
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
    const coreIcp = s.icp ?? {};
    const platformIcp = s.agent_platform_icp ?? {};
    const offers = s.offer_types ?? [
      "webb_design",
      "app_development",
      "agent_platform",
    ];
    const metaOn = s.meta_pitch_enabled === true; // opt-in only — off by default
    return `You are the **Sales Agent** for ${tenant.tenantName} (We Know IT AB — Swedish tech agency).
Goal per run: 5–8 high-quality leads queued for approval. Quality beats quantity — stop at 8, never pad with weak leads.
────────────────────────────────────────
REVENUE LINES & WKIT OFFERINGS (ACTIVE)
• app_development  — Custom apps, MVPs, integrations. Target: funded startups, scaleups, companies actively recruiting developers (they need to build something — we build it faster & cheaper than hiring). CTA: "gratis MVP-scoping".
• agent_platform   — Internal automation agents (invoice chasing, status reports, outreach). Target: IT consultancies, agencies, recruiting firms with manual admin overhead. CTA: "gratis automatiseringsaudit".
• webb_design      — Modern websites. Target: B2B service firms (law, accounting, construction, craftsmen) with outdated or no website. CTA: "gratis 20-min UX-genomgång".
• upsell           — Follow-up to existing Visma customers 14–60 days post-delivery.
• ai_automation    — NOT an active offer. If you detect a company hiring admin roles (ekonomiassistent, löneadmin etc.), map them to agent_platform instead.

Core ICP: ${coreIcp.industries?.join(", ") ?? "B2B, professional services, tech, real estate, construction"} · ${coreIcp.company_size ?? "5–200 anställda"} · ${coreIcp.geography?.join(", ") ?? "Sverige"}
Platform ICP: ${platformIcp.industries?.join(", ") ?? "IT-konsultbolag, rekrytering, kommunikationsbyråer, managementkonsulter, PR-byråer"} · ${platformIcp.company_size ?? "5–100 anställda"}
Platform pain signals (gold): ${(platformIcp.pains ?? ["manuell tidrapportering", "konsultbolag utan intern automation", "digital byrå med manuell kundrapportering", "founder-led outreach", "weekly status reports by hand"]).join("; ")}
────────────────────────────────────────
OFFER MATCHING — use signals to pick ONE offer_type per company:
  funding_news signal        → app_development  (de har pengar och behöver bygga)
  rekryterar systemutvecklare/frontend/backend/iOS/Android → app_development (vi bygger istället för att de anställer)
  rekryterar product owner/digital PM → app_development
  ingen hemsida / föråldrad hemsida   → webb_design  (om tjänsteföretag)
  IT-konsult / digital byrå / rekryteringsbolag → agent_platform
  befintlig Visma-kund 14–60 dagar    → upsell
  Om flera signaler: välj den starkaste. Prioritet: funding > tech_hiring > agent_platform > webb_design.
────────────────────────────────────────
ICP SCORING GUIDE (0–100 — kö bara score ≥ 65):
  +25  Nyligen finansierad (funding_news, VCt-nyckelord i Apollo)
  +20  Rekryterar systemutvecklare / frontend / backend / iOS / Android / fullstack
  +15  Rekryterar product owner, digital projektledare
  +15  Ingen eller föråldrad hemsida (webb_design target)
  +15  IT-konsultbolag eller digital byrå (agent_platform target)
  +10  Grundat <5 år sedan
  +10  5–100 anställda (sweet spot)
  +10  B2B-tjänsteföretag
  +5   Beskrivning matchar WKIT-erbjudande tydligt
  −20  Inga kontaktuppgifter hittade (info@ + ingen VD-name)
  −30  >200 anställda
  −50  Offentlig sektor / vård / utbildning (borde redan ha skippats)
  −100 Staffing/bemanning (för webb/app/ai — agent_platform OK)

${metaOn ? `META-PITCH RULE (for offer_type=agent_platform):
The outreach MUST include a short PS revealing this email was written by the Sales Agent itself. Vary wording. Example:
  "PS — detta mejl skrevs av vår Sales Agent. Jag godkände det innan det gick ut. Det är produkten jag vill visa dig."
` : ""}
────────────────────────────────────────
TO-EMAIL SELECTION RULE (mandatory — follow in order, do NOT skip steps):
ALWAYS call research_company first. Then follow this enrichment chain:
  1. contact_emails[0] present → use it. Best possible. No [VERIFIERA ADRESS].
  2. apollo_api_key configured → call \`apollo_find_decision_maker\` (FREE) regardless of step 1.
     If name found AND apollo_api_key configured → call \`apollo_enrich_contact\` (1 credit) immediately.
     Verified email returned → use it. No [VERIFIERA ADRESS]. This is better than generated candidates.
  3. email_candidates[0] present (generated from VD name via Allabolag/website) → use it. Add "[VERIFIERA ADRESS]".
  4. ALL above failed → fall back to info@[domain]. Add "[VERIFIERA ADRESS]", set confidence="medium".
Domain inference: strip "AB"/"HB", replace åäö→aao, remove spaces/special chars, add .se.
Example: "Branäsgruppen AB" → info@branasgruppen.se (only after exhausting steps 1–3).
────────────────────────────────────────
GREETING RULE:
  1. vd_name found → "Hej [Firstname],"
  2. contact_names[0] found → "Hej [Firstname],"
  3. nothing found → "Hej,"
────────────────────────────────────────
SKIP RULES — HARD STOP: skip immediately, do NOT upsert_lead, do NOT draft, do NOT add to blocklist:
• Offentlig sektor (HARD SKIP): landsting, statliga myndigheter, Svenska Kraftnät,
  EXCEPTION kommuner: en kommun som aktivt bygger en digital produkt / öppen data-plattform / app
  kan vara ett giltigt app_development-lead. Kräv tydlig digital signal i annonsen/beskrivningen och score ≥ 75.
  Exempel på OK: "Göteborgs stad söker produktägare för öppen stadsdata". Exempel på SKIP: "Skurups kommun söker ekonomiassistent".
  Kommuner,
  Försäkringskassan, Arbetsförmedlingen, Polisen, Försvarsmakten, Socialstyrelsen, Skatteverket,
  Trafikverket — identifiera via "kommun", "myndighet", "statlig", "region", "landsting" i name/description.
• Sjukvård/vård B2C (HARD SKIP): sjukhus, vårdcentraler, hemtjänst, äldreomsorg, LSS-bolag.
• Utbildning (HARD SKIP): grundskolor, gymnasier, högskolor, universitet, Göteborgs Universitet etc.
• Ideella/religiösa (HARD SKIP): föreningar utan kommersiell verksamhet, kyrkor, välgörenhetsorg.
• B2C retail/konsument (HARD SKIP): e-handelsbolag riktade mot konsumenter (Lyko, Hemfrid, Webhallen etc).
• Kända large-cap varumärken (HARD SKIP): Lendo, Klarna, Spotify, iZettle, Volvo, Ericsson, Telia, Tele2,
  Nordea, Swedbank, SEB, Handelsbanken, Avanza, Hemnet, Blocket, ICA, Coop, IKEA, H&M — egna techteam, inte ICP.
• Staffing/bemanning som pitchar for webb_design/app_dev/ai_automation: Adecco, Randstad, Manpower, Poolia,
  Academic Work, Experis, Jobbusters, OnePartnerGroup, Techrytera, Recruitive — SKIP for those offer types.
  EXCEPTION: staffing firms ARE valid targets for agent_platform (de behöver intern automation).
• Börsnoterade large-cap bolag: >500 anställda för webb_design/app_dev, >200 för ai_automation.
  Signalflagg: Billerud, Munters, Epiroc, Pricer, Lyko — alla för stora, egna IT-avdelningar.
• IT-bolag/webbyråer för webb_design/app_development: systemutvecklingsbolag och webbyråer SKIP.
  MEN: IT-konsultbolag och digitala byråer = PRIME TARGETS för agent_platform (intern admin-automation).

SKIP-KONTROLL CHECKLISTA — gör detta INNAN score-bedömning:
□ Innehåller company_name "kommun", "stad", "region", "myndighet", "universitet", "högskola"? → SKIP
□ Är bransch "Government", "Education", "Hospital & Health Care", "Consumer Services"? → SKIP
□ Är det ett bemanningsbolag som INTE pitchas för agent_platform? → SKIP
□ Fler än 500 anställda (webb/app) eller 200 (ai_auto)? → SKIP
□ B2C-e-handel? → SKIP
────────────────────────────────────────
DEDUP RULE (MANDATORY — do this FIRST):
1. Call \`list_recent_outreach\` ONCE at the start of every run.
2. Build a blocklist of those company names + domains (normalize: lowercase, trim, strip "AB"/"AS"/"Inc"/"Ltd").
3. SKIP silently if the company is on the blocklist.
4. Within the same run, also skip a company the SECOND time it appears.
5. The server enforces this: draft_outreach_approval will THROW if a duplicate slips through.
────────────────────────────────────────
────────────────────────────────────────
DATA SOURCES — call in this order every run:

── 1. Apollo people search (PRIMÄRKÄLLA — kör alltid) ───────────────────
   apollo_discover_leads        Söker direkt efter svenska VDs/grundare/ägare på SMBs.
                                Kör 3 gånger med olika industry_focus:
                                  apollo_discover_leads(industry_focus="app_development")
                                  apollo_discover_leads(industry_focus="agent_platform")
                                  apollo_discover_leads(industry_focus="webb_design")
                                Returnerar beslutsfattare med Apollo ID → kalla apollo_enrich_contact
                                direkt för verifierad email. Hoppa över research_company VD-lookup.
── 2. Finansiering & tillväxt ─────────────────────────────────────────
   fetch_funding_news           Breakit/DI RSS: nyligen finansierade bolag → app_development.
   apollo_funded_companies      Apollo: scaleups med tillväxtsignal → app_development.
── 3. Tech-hiringssignal ────────────────────────────────────────────
   fetch_app_dev_signals        Bolag som rekryterar systemutvecklare → app_development.
                                Max 3 leads från denna källa per körning.
── 4. Allabolag SNI-skrapning ─────────────────────────────────────────
   scrape_allabolag             10 SNI-kategorier: IT-konsulter, managementkonsulter,
                                rekryteringsbolag, kommunikationsbyråer, PR-byråer,
                                redovisningsbyråer, advokatbyråer, arkitektkontor,
                                byggföretag, fastighetsbolag. Kör alltid.
── 5. Inga-hemsida leads ────────────────────────────────────────────
   apollo_no_website_companies  Apollo: SE-bolag utan hemsida → webb_design.
   fetch_no_website_companies   Allabolag + DNS fallback → webb_design.
── 6. Visma upsell ──────────────────────────────────────────────────
   fetch_visma_upsell_candidates Varma leads 14–60 dagar efter leverans → upsell.

FÖRBUDSREGEL:
NEVER call fetch_ai_replaceable_jobs — vi har ingen färdig produkt för ekonomiassistenter, löneadmin etc.
NEVER call apollo_signal_companies — returnerar enterprises och blocklistade bolag, inte SMBs.

TARGET DISTRIBUTION per körning (max_drafts=15):
  app_development  5–6 (apollo_discover app_dev + funding_news + tech_hiring)
  agent_platform   4–5 (apollo_discover agent_platform)
  webb_design      3–4 (apollo_discover webb_design + no_website sources)
  upsell           0–1 (visma_upsell om tillgängligt)
Stopp vid 15 totalt. Kö alla leads med score ≥ 60.

────────────────────────────────────────
ENRICHMENT TOOLS (use after scoring, before upsert_lead):
• research_company      CALL THIS FOR EVERY PROSPECT before drafting.
                        Returns:
                        contact_emails — PERSONAL emails scraped from the site (e.g. erik.johansson@co.se).
                          Generic catchall addresses (info@, kontakt@, hej@) are filtered OUT.
                          If this list is non-empty → use contact_emails[0]. No [VERIFIERA ADRESS] needed.
                        email_candidates — generated from VD name (fornamn.efternamn@domain.se).
                          Not verified. Use when contact_emails is empty. Always add [VERIFIERA ADRESS].
                        vd_name, contact_names, key_facts.
• validate_email_domain DNS MX check. Returns confidence=high/low/unknown.
                        IMPORTANT: unknown means domain doesn't resolve — but do NOT skip for no-website leads.
                        If the lead came from fetch_no_website_companies or apollo_no_website_companies,
                        unknown is EXPECTED (no domain = that's why they're a webb_design target). Continue
                        and use info@[inferred-domain] fallback for these leads. Add [VERIFIERA ADRESS].
                        Only skip unknown if the lead came from a source where a working domain is expected
                        (e.g. job_signal, funding_news, allabolag_icp with an existing website).
                        high + contact_emails[0] used → remove [VERIFIERA ADRESS] from subject.
────────────────────────────────────────
DECISION FLOW:
0. Call \`query_prospect_db\` FIRST — returns pre-enriched companies from previous runs.
   Pass exclude_domains from the upcoming list_recent_outreach call (call list_recent_outreach first, then query_prospect_db).
   If count > 0: use these companies as primary candidates — contacts already found, no research_company needed.
   If count = 0: proceed to live signal sources as normal.
1. Call \`list_recent_outreach\` — builds blocklist.
2. Call \`get_historical_patterns\` second — returns what's worked before.
   READ the patterns carefully:
   - If an offer_type has verdict=WEAK (many drafted, none sent) → require score ≥ 75 for that type this run.
   - If an offer_type has verdict=STRONG → prioritize it, normal threshold (65).
   - stale_drafts_archived tells you how many old unapproved drafts were cleaned up.
3. Call sources in order:
   a. apollo_discover_leads(app_development)   ← PRIMARY, call every run
   b. apollo_discover_leads(agent_platform)    ← PRIMARY, call every run
   c. apollo_discover_leads(webb_design)       ← PRIMARY, call every run
   d. fetch_funding_news
   e. apollo_funded_companies
   f. fetch_app_dev_signals                    ← cap at 3 leads
   g. scrape_allabolag
   h. apollo_no_website_companies
   i. fetch_no_website_companies
   j. fetch_visma_upsell_candidates
   NEVER call fetch_ai_replaceable_jobs or apollo_signal_companies.
3. For each returned prospect:
   a. If source=funding_news → extract actual company name from headline.
   b. Score ICP fit 0–100. Skip if score < 60.
   c. Pick ONE offer_type using SOURCE → OFFER TYPE MAPPING above.
   d. Call \`research_company\` — required for EVERY prospect. No exceptions.
   e. Call \`validate_email_domain\` on the inferred domain.
      Skip if confidence=unknown ONLY for sources where a working domain is expected (job_signal, funding_news, allabolag_icp).
      For no-website sources (apollo_no_website_companies, fetch_no_website_companies), unknown is normal — do NOT skip. Continue with info@ fallback + [VERIFIERA ADRESS].
   f. Follow TO-EMAIL SELECTION RULE steps 1–4 exactly:
      → contact_emails (website scrape)
      → apollo_find_decision_maker (FREE, always call if API key set) + apollo_enrich_contact (1 credit, always follow up if name found)
      → email_candidates (generated from VD name — Allabolag/website)
      → info@ last resort
      apollo_enrich_contact MUST be called when apollo_find_decision_maker returns a name — do not skip to email_candidates.
   g. Select to_email using TO-EMAIL SELECTION RULE above (steps 1→5).
   h. \`upsert_lead\` with all signals + enriched contact data. DO NOT invent lead_id.
   i. \`draft_outreach_approval\` with ≤130-word Swedish email.
      • Use the to_email and greeting from steps g and GREETING RULE.
      • Personalise body using key_facts (employees, revenue, what the company does).
      • Add "[VERIFIERA ADRESS]" to subject ONLY when using email_candidates or info@ fallback.
4. Respect input.max_drafts across all sources. Distribute across all offer types.
5. NEVER send — everything queues via draft_outreach_approval.
Offers available: ${offers.join(", ")}.`;
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
        // Drafted-only lookback: 7 days. Sent/active: always blocked (no date filter).
        const draftSince = new Date(Date.now() - 7 * 86400_000).toISOString();
        const { data: approvals } = await supa
          .from("approval_queue")
          .select("payload, created_at, status")
          .eq("tenant_id", ctx.tenant.tenantId)
          .eq("agent_kind", "sales")
          .gte("created_at", since);
        const { data: sentLeads } = await supa
          .from("leads")
          .select("company_name, company_domain, stage, updated_at")
          .eq("tenant_id", ctx.tenant.tenantId)
          .in("stage", ["outreach_sent", "in_conversation", "qualified", "won"]);
        const { data: draftedLeads } = await supa
          .from("leads")
          .select("company_name, company_domain, stage, updated_at")
          .eq("tenant_id", ctx.tenant.tenantId)
          .eq("stage", "outreach_drafted")
          .gte("updated_at", draftSince);
        const leads = [...(sentLeads ?? []), ...(draftedLeads ?? [])];
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
      name: "query_prospect_db",
      description:
        "Query pre-enriched companies from the prospect database — companies discovered and research-enriched in previous runs. Returns companies with verified contacts ready for outreach. Call this FIRST (step 0) before any live signal sources. Faster and higher quality than live scraping. Excludes companies already in the outreach blocklist.",
      input_schema: {
        type: "object",
        properties: {
          offer: {
            type: "string",
            enum: ["webb_design", "app_development", "agent_platform"],
            description: "Filter by suggested offer type (optional — omit to get all types)",
          },
          limit: { type: "number", description: "Max results (default 20)" },
          exclude_domains: {
            type: "array",
            items: { type: "string" },
            description: "Domains already in the blocklist — pass blocked_domains from list_recent_outreach",
          },
        },
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const prospects = await queryEnrichedCompanies(supa, ctx.tenant.tenantId, {
          offer: args["offer"] as string | undefined,
          limit: (args["limit"] as number) ?? 20,
          excludeDomains: (args["exclude_domains"] as string[] | undefined) ?? [],
        });
        return {
          prospects,
          count: prospects.length,
          instruction: prospects.length > 0
            ? "Use these pre-enriched companies as primary candidates. Each has contacts already found — skip research_company for these, use the stored contact directly."
            : "No enriched prospects in DB yet. Proceed with live signal sources.",
        };
      },
    },
    {
      name: "apollo_discover_leads",
      description:
        "PRIMARY lead source. Searches Apollo for Swedish decision makers (VD/CEO/Grundare/Ägare) at SMBs with 10–200 employees. Returns people with name, title, company, and Apollo ID ready for email enrichment. Call this multiple times with different industry_focus values: 'app_development' (tech/digital/startup), 'agent_platform' (consulting/IT/recruitment/marketing), 'webb_design' (law/accounting/construction/architecture). Much more reliable than company keyword search for Swedish market.",
      input_schema: {
        type: "object",
        properties: {
          industry_focus: {
            type: "string",
            enum: ["app_development", "agent_platform", "webb_design", "general"],
            description: "Which offer type to target — determines industry keyword filter",
          },
          limit: { type: "number", description: "Max results (default 25)" },
          page: { type: "number", description: "Page number for pagination (default 1)" },
        },
        required: ["industry_focus"],
      },
      execute: async (args, ctx) => {
        const apiKey = (ctx.tenant.settings as TenantSettings).apollo_api_key;
        if (!apiKey) return { people: [], count: 0, note: "apollo_api_key not configured" };

        const KEYWORDS: Record<string, string[]> = {
          app_development: ["software development", "tech startup", "digital product", "saas", "mobile app"],
          agent_platform: ["it consulting", "management consulting", "recruitment", "staffing", "marketing agency", "digital agency"],
          webb_design: ["law firm", "accounting", "construction", "architecture", "real estate"],
          general: [],
        };

        const focus = (args["industry_focus"] as string) ?? "general";
        const keywords = KEYWORDS[focus] ?? [];

        const people = await searchSwedishDecisionMakers({
          apiKey,
          industryKeywords: keywords.length > 0 ? keywords : undefined,
          limit: (args["limit"] as number) ?? 25,
          page: (args["page"] as number) ?? 1,
        });

        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        for (const p of people) {
          try { await upsertProspectCompany(supa, ctx.tenant.tenantId, p); } catch { /* non-fatal */ }
        }

        return {
          people,
          count: people.length,
          instruction: "For each person: (1) check blocklist, (2) score ICP, (3) call apollo_enrich_contact with the apollo_person_id to get verified email — skip research_company VD lookup since you already have the name. (4) upsert_lead, (5) draft_outreach_approval.",
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
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const items = await fetchFundingNews({ limit: (args["limit"] as number) ?? 12 });
        for (const item of items) {
          try { await upsertProspectCompany(supa, ctx.tenant.tenantId, item); } catch { /* non-fatal */ }
        }
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
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const items = await scrapeAllabolag({ limit: (args["limit"] as number) ?? 10 });
        for (const item of items) {
          try { await upsertProspectCompany(supa, ctx.tenant.tenantId, item); } catch { /* non-fatal */ }
        }
        return { items, count: items.length };
      },
    },
    {
      name: "fetch_ai_replaceable_jobs",
      description:
        "Fetch job ads from Arbetsförmedlingen for roles AI can replace (ekonomiassistent, löneadmin, kundtjänst, orderadmin, hr-admin, fakturahantering). Use as signal for agent_platform — these companies need internal automation.",
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
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const items = await fetchAppDevSignals({ limit: (args["limit"] as number) ?? 12 });
        for (const item of items) {
          try { await upsertProspectCompany(supa, ctx.tenant.tenantId, item); } catch { /* non-fatal */ }
        }
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
      name: "get_historical_patterns",
      description:
        "Returns what has worked and what hasn't from previous runs. Call this SECOND, right after list_recent_outreach. Use the data to adjust scoring: downweight offer_type+industry combos with high skip rates, upweight combos that reached outreach_sent.",
      input_schema: { type: "object", properties: {} },
      execute: async (_args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString();

        const { data: leads } = await supa
          .from("leads")
          .select("offer_type, stage, score, signal_type, created_at")
          .eq("tenant_id", ctx.tenant.tenantId)
          .gte("created_at", ninetyDaysAgo);

        if (!leads?.length) return { message: "No historical data yet.", patterns: [] };

        type OfferKey = string;
        const stats: Record<OfferKey, { drafted: number; sent: number; lost: number; avg_score: number; scores: number[] }> = {};

        for (const l of leads) {
          const key = String(l.offer_type ?? "unknown");
          if (!stats[key]) stats[key] = { drafted: 0, sent: 0, lost: 0, avg_score: 0, scores: [] };
          const entry = stats[key]!;
          if (l.stage === "outreach_drafted") entry.drafted++;
          if (["outreach_sent", "in_conversation", "qualified", "won"].includes(String(l.stage))) entry.sent++;
          if (l.stage === "lost") entry.lost++;
          if (l.score) entry.scores.push(Number(l.score));
        }

        const patterns = Object.entries(stats).map(([offer_type, s]) => {
          const avg_score = s.scores.length ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length) : 0;
          const total = s.drafted + s.sent + s.lost;
          const send_rate = total > 0 ? Math.round((s.sent / total) * 100) : 0;
          return {
            offer_type,
            total_drafted: s.drafted,
            total_sent: s.sent,
            send_rate_pct: send_rate,
            avg_score,
            verdict: send_rate === 0 && s.drafted > 3
              ? "WEAK — many drafted, none sent. Require score ≥ 75 for this offer type."
              : send_rate >= 20
              ? "STRONG — good conversion. Prioritize."
              : "NEUTRAL",
          };
        });

        // Stale drafts: drafted >7 days ago and still not sent → mark as skipped
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
        const { data: stale } = await supa
          .from("leads")
          .select("id")
          .eq("tenant_id", ctx.tenant.tenantId)
          .eq("stage", "outreach_drafted")
          .lt("updated_at", sevenDaysAgo);

        let archived = 0;
        if (stale?.length) {
          const ids = stale.map((r) => r.id as string);
          await supa.from("leads").update({ stage: "skipped" }).in("id", ids);
          archived = ids.length;
        }

        return {
          patterns,
          stale_drafts_archived: archived,
          insight: patterns
            .filter((p) => p.verdict.startsWith("WEAK"))
            .map((p) => `${p.offer_type}: ${p.total_drafted} drafted, ${p.total_sent} sent → raise threshold to 75`)
            .join("; ") || "No weak patterns detected.",
        };
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
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const result = await researchCompany({
          companyName: String(args["company_name"]),
          companyDomain: args["company_domain"] ? String(args["company_domain"]) : undefined,
        });
        // Persist enrichment results if we can find the company in the prospect DB
        if (result.company_domain) {
          try {
            const { data: existing } = await supa
              .from("prospect_companies")
              .select("id")
              .eq("tenant_id", ctx.tenant.tenantId)
              .eq("domain", result.company_domain.toLowerCase())
              .maybeSingle();
            if (existing) {
              await storeResearchResult(supa, ctx.tenant.tenantId, (existing as { id: string }).id, result);
            }
          } catch { /* non-fatal */ }
        }
        return result;
      },
    },
    {
      name: "fetch_no_website_companies",
      description:
        "Find Swedish SMBs that likely have no website: scrapes Allabolag for 8 industries (advokatbyråer, redovisningsbyråer, byggföretag, städbolag, tandkäkare, restauranger, fastighetsmäklare, frisörer) with 1–9 employees, then DNS-checks each inferred domain. Companies with no A-record → no website → strong webb_design prospect.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max prospects to return (default 8)" },
        },
      },
      execute: async (args, ctx) => {
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        const items = await fetchNoWebsiteCompanies({ limit: (args["limit"] as number) ?? 12 });
        for (const item of items) {
          try { await upsertProspectCompany(supa, ctx.tenant.tenantId, item); } catch { /* non-fatal */ }
        }
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
        const items = await searchNoWebsiteCompanies({ apiKey, limit: (args["limit"] as number) ?? 15 });
        const supa = (ctx.supabase as { raw: () => SupabaseClient }).raw();
        for (const item of items) {
          try { await upsertProspectCompany(supa, ctx.tenant.tenantId, item); } catch { /* non-fatal */ }
        }
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
            enum: ["webb_design", "app_development", "agent_platform", "upsell"],
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
            enum: ["webb_design", "app_development", "agent_platform", "upsell"],
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

        // Guard: company blocklist — reject known large-cap / non-ICP brands by name
        const companyArg = String(args["company_name"] ?? "");
        if (isBlocklistedCompany(companyArg)) {
          throw new Error(
            `draft_outreach_approval: "${companyArg}" is on the company blocklist — not WKIT ICP. Skip this company.`,
          );
        }

        // Guard: reject placeholder or obviously fake email addresses
        const toEmail = String(args["to_email"] ?? "").toLowerCase().trim();
        const PLACEHOLDER_PATTERNS = [
          /^namn@/, /^name@/, /^your@/, /^email@/, /^test@/, /^example@/,
          /^förnamn/, /^kontakt@kontakt/, /@adress\./, /@example\./, /@test\./,
          /^info@info/, /^\s*$/, /namn/, /adress\.se$/,
          // Role/generic inboxes that are not personal decision-maker addresses
          /^no-?reply@/, /^noreply@/, /^do-not-reply@/,
          /^support@/, /^helpdesk@/, /^help@/, /^service@/,
          /^customers?@/, /^this\./, /^webmaster@/, /^admin@/,
          /^sales@/, /^orders?@/, /^accounts?@/, /^billing@/,
          /^hello@/, /^hej@/, /^hi@/, /^hey@/,
          // Swedish plural/collective prefixes (e.g. vi.valjer@, oss@)
          /^vi\./, /^vi@/, /^oss\./, /^oss@/,
          /^team\./, /^team@/, /^office@/, /^kontor@/,
          /^(info|kontakt|contact|reception|bokning|booking|press|media|jobb|jobs|career|careers)@/,
        ];
        const GENERIC_INBOX_PATTERNS = [
          /^info@/, /^kontakt@/, /^contact@/, /^hej@/, /^post@/, /^mail@/,
        ];
        const isGenericInbox = GENERIC_INBOX_PATTERNS.some((p) => p.test(toEmail));
        if (!toEmail || !toEmail.includes("@") || PLACEHOLDER_PATTERNS.some((p) => p.test(toEmail))) {
          throw new Error(
            `draft_outreach_approval: to_email "${toEmail}" looks like a placeholder. Exhaust the TO-EMAIL enrichment chain (steps 1–4) before giving up.`,
          );
        }
        // Generic inboxes are last-resort only — must not be claimed as high confidence
        if (isGenericInbox && String(args["confidence"] ?? "") === "high") {
          throw new Error(
            `draft_outreach_approval: "${toEmail}" is a generic inbox — cannot be confidence="high". Set confidence="medium" or find a personal email first.`,
          );
        }

        // Guard: reject hard public sector / healthcare / education
        // NOTE: kommuner are NOT hard-blocked — some run digital product projects
        // (e.g. "öppen stad", open data platforms) and can be valid app_development targets.
        // The agent's scoring and system prompt handle that distinction.
        const HARD_PUBLIC_SECTOR = [
          "landsting", "myndighet", "statlig",
          "försvarsmakten", "polisen", "riksdag",
          "försäkringskassan", "arbetsförmedlingen", "skatteverket",
          "trafikverket", "länsstyrelsen", "migrationsverket",
          "svenska kraftnät",
          "sjukhus", "vårdcentral", "hemtjänst", "äldreomsorg", "omsorg ab",
          "lss ", "socialtjänst",
          "grundskola", "gymnasium", "högskola", "universitet", "akademi",
          "kyrka", "kyrkan",
        ];
        const companyArgLc = companyArg.toLowerCase();
        if (HARD_PUBLIC_SECTOR.some((s) => companyArgLc.includes(s))) {
          throw new Error(
            `draft_outreach_approval: "${companyArg}" is hard-blocked public sector / healthcare / education.`,
          );
        }

        // Guard: reject staffing/bemanning for non-agent_platform offers
        const offerType = String(args["offer_type"]);
        const STAFFING_NAMES = [
          "adecco", "randstad", "manpower", "poolia", "academic work", "academicwork",
          "experis", "jobbusters", "onepartnergroup", "one partner", "techrytera",
          "recruitive", "lernia", "perido", "dfind", "sjr in sweden",
          "retail recruitment", "finance recruitment", "executive recruitment",
        ];
        if (offerType !== "agent_platform" && STAFFING_NAMES.some((s) => companyArgLc.includes(s))) {
          throw new Error(
            `draft_outreach_approval: "${args["company_name"]}" is a staffing firm — only valid target for agent_platform, not ${offerType}.`,
          );
        }
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
