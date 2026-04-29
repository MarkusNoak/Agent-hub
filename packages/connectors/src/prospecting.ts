/**
 * Free prospecting sources — zero paid APIs.
 *
 * 1. RSS (Breakit / ComputerSweden) — funding + growth news → app_development
 * 2. Allabolag.se scrape           — SNI + size ICP filter → ai_automation
 * 3. Arbetsförmedlingen Jobs API   — AI-replaceable roles → ai_automation
 * 4. Arbetsförmedlingen Jobs API   — Growth/scaling roles → app_development
 * 5. Google Custom Search          — Per-service-line queries (webb/app/agent/ai)
 * 6. Visma upsell interim table    — existing customers 14-60 days post-delivery
 *
 * Based on the WKIT Sales Agent v2 by Markus Noaksson.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// ------------------------------------------------------------
// Shared types
// ------------------------------------------------------------
export type ProspectSignal = {
  source: "funding_news" | "allabolag_icp" | "job_signal" | "digital_presence" | "visma_upsell";
  company_name: string;
  signals: string[];
  suggested_offer_hint?:
    | "ai_automation"
    | "app_development"
    | "webb_design"
    | "agent_platform"
    | "upsell";
  extra?: Record<string, unknown>;
};

export const AI_REPLACEABLE_ROLES = [
  "ekonomiassistent",
  "redovisningsassistent",
  "löneadministratör",
  "orderadministratör",
  "kundtjänstmedarbetare",
  "kundservice",
  "receptionist",
  "administratör",
  "säljassistent",
  "backoffice",
  "inköpsassistent",
  "fakturahantering",
  "data entry",
  "hr-administratör",
  "personaladministratör",
  "controller",
  "ekonomicontroller",
] as const;

export const APP_DEV_ROLES = [
  "produktägare",
  "product owner",
  "projektledare digital",
  "systemutvecklare",
  "webbutvecklare",
  "mjukvaruutvecklare",
  "digital projektledare",
  "it-projektledare",
  "teknisk projektledare",
] as const;

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  retries = 1,           // max 1 retry (2 attempts total) — avoids long stalls
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          "User-Agent": "AgentHub-SalesAgent/1.0 (+https://weknowit.se)",
          ...(opts.headers ?? {}),
        },
        signal: AbortSignal.timeout(8000),   // 8 s hard cap per attempt
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await sleep(1200 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

// ------------------------------------------------------------
// SOURCE 1 — Breakit / ComputerSweden RSS → app_development
// ------------------------------------------------------------
const FUNDING_KEYWORDS = [
  "finansiering",
  "miljoner",
  "kapitalrunda",
  "expansion",
  "tillväxt",
  "serie a",
  "serie b",
  "seed",
  "förvärv",
  "nytt kontor",
  "rekryterar",
  "anställer",
];

const LARGE_CAP_SIGNALS = [
  "börsen",
  "stockholmsbörsen",
  "nasdaq",
  "first north",
  "rapportsäsongen",
  "ebitda",
  "ebita",
  "kvartal",
  "q1",
  "q2",
  "q3",
  "q4",
  "aktie",
  "aktier",
  "analytiker",
  "resultatvarning",
  "vinstvarning",
];

export async function fetchFundingNews(opts: { limit?: number } = {}): Promise<
  ProspectSignal[]
> {
  const feeds = [
    "https://breakit.se/feed/rss",
    "https://computersweden.idg.se/2.2683/rss.xml",
    "https://www.di.se/rss",
    "https://www.nyteknik.se/nyheter/rss.xml",
    "https://www.va.se/rss/",
    "https://www.idg.se/rss.xml",
  ];
  const items: { title: string; desc: string; link: string; source: string }[] = [];
  for (const feed of feeds) {
    try {
      const res = await fetchWithRetry(feed);
      const xml = await res.text();
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const raw = m[1] ?? "";
        const title = raw.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? "";
        const desc = raw
          .match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1]
          ?.replace(/<[^>]+>/g, "")
          .trim()
          .substring(0, 400) ?? "";
        const link = raw.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
        if (title) {
          items.push({ title, desc, link, source: new URL(feed).hostname });
        }
      }
    } catch (e) {
      console.warn(`RSS feed failed (${feed}):`, (e as Error).message);
    }
  }

  const relevant = items.filter((i) => {
    const text = (i.title + " " + i.desc).toLowerCase();
    const hasFundingKeyword = FUNDING_KEYWORDS.some((k) => text.includes(k));
    const isLargeCap = LARGE_CAP_SIGNALS.some((k) => text.includes(k));
    return hasFundingKeyword && !isLargeCap;
  });

  const limit = opts.limit ?? 8;
  return relevant.slice(0, limit).map((item) => ({
    source: "funding_news",
    company_name: "extract_from_headline",
    signals: [
      `Rubrik: "${item.title}"`,
      `Källa: ${item.source}`,
      `Text: ${item.desc}`,
    ],
    suggested_offer_hint: "app_development",
    extra: { link: item.link },
  }));
}

// ------------------------------------------------------------
// Shared HTML helper — extract company names from Allabolag listing pages
// ------------------------------------------------------------
function extractCompanyNamesFromHtml(html: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  const add = (raw: string) => {
    const name = raw.trim()
      .replace(/&amp;/g, "&")
      .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
      .replace(/\s+/g, " ");
    if (name.length > 3 && name.length < 90 && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };

  // Strategy 1 — org-number-based href links (Allabolag URL: /XXXXXXXXXX/slug or /XXXXXXXXXX)
  for (const m of html.matchAll(/href="\/\d{6,10}[^"]*"[^>]*>\s*([^<\n]{3,80}?)\s*(?:<\/a>|<\/span>|<\/h[1-6]>)/gi)) {
    add(m[1] ?? "");
  }

  // Strategy 2 — hrefs containing "/foretag/" or "/branschsida/"
  for (const m of html.matchAll(/href="\/(?:foretag|branschsida)\/[^"]*"[^>]*>\s*([^<\n]{3,80}?)\s*</gi)) {
    add(m[1] ?? "");
  }

  // Strategy 3 — Swedish company entity suffixes in inline elements (AB, HB, KB, etc.)
  if (names.length < 3) {
    for (const m of html.matchAll(/>\s*([A-ZÅÄÖ][^<\n]{1,55}\s+(?:AB|HB|KB|ek\.?för\.?|Ideell\s+förening|Stiftelse)\b[^<\n]{0,15})\s*</g)) {
      add(m[1] ?? "");
    }
  }

  return names;
}

// ------------------------------------------------------------
// SOURCE 2 — Allabolag.se SNI + size filter → ai_automation
// ------------------------------------------------------------
export async function scrapeAllabolag(opts: { limit?: number } = {}): Promise<
  ProspectSignal[]
> {
  // SNI codes chosen for WKIT ICP: companies that need websites, automation, or agent_platform.
  // 62020 (IT consulting) intentionally excluded — those are competitors.
  const sniSearches = [
    "https://www.allabolag.se/bransch/69109?anstallda=10-99",  // Juridiska tjänster (advokatbyråer)
    "https://www.allabolag.se/bransch/69200?anstallda=10-99",  // Redovisning/revision/bokföring
    "https://www.allabolag.se/bransch/71110?anstallda=10-99",  // Arkitektkontor
    "https://www.allabolag.se/bransch/73110?anstallda=10-99",  // Reklam/kommunikationsbyråer
    "https://www.allabolag.se/bransch/70220?anstallda=10-99",  // Managementkonsulter
    "https://www.allabolag.se/bransch/68100?anstallda=10-99",  // Fastighetsbolag
  ];
  const companies: { name: string; sourceUrl: string }[] = [];
  for (const url of sniSearches) {
    try {
      const res = await fetchWithRetry(url);
      const html = await res.text();
      const names = extractCompanyNamesFromHtml(html);
      names.slice(0, 6).forEach((name) => {
        companies.push({ name, sourceUrl: url });
      });
      await sleep(1500);
    } catch (e) {
      console.warn("Allabolag scrape failed:", (e as Error).message);
    }
  }
  const unique = [...new Map(companies.map((c) => [c.name, c])).values()];
  const limit = opts.limit ?? 6;
  return unique.slice(0, limit).map((c) => ({
    source: "allabolag_icp",
    company_name: c.name,
    signals: [
      "Listad på Allabolag.se med ICP-relevant SNI-kod",
      "Storlek: 10–99 anställda (från filter)",
    ],
    suggested_offer_hint: "ai_automation",
    extra: { sourceUrl: c.sourceUrl },
  }));
}

// ------------------------------------------------------------
// SOURCE 3 — Arbetsförmedlingen Jobs API — AI-replaceable roles
// ------------------------------------------------------------
type JobtechHit = {
  id?: string;
  headline?: string;
  employer?: { name?: string };
  workplace_address?: { municipality?: string };
  description?: { text?: string };
};

type JobtechResponse = {
  total?: { value?: number };
  hits?: JobtechHit[];
};

export async function fetchAiReplaceableJobs(
  opts: { limit?: number } = {},
): Promise<ProspectSignal[]> {
  const roles = [
    "ekonomiassistent",
    "redovisningsassistent",
    "löneadministratör",
    "orderadministratör",
    "kundtjänstmedarbetare",
    "fakturahantering",
    "hr-administratör",
    "personaladministratör",
    "inköpsassistent",
    "backoffice administratör",
  ];

  type JobAd = {
    company: string;
    title: string;
    desc: string;
    location: string;
    role: string;
  };

  // Offentlig sektor / vård / utbildning — not WKIT ICP.
  const NON_ICP_EMPLOYERS = [
    "region", "landsting", "kommun", "stad", "sjukhus", "sjukvård",
    "vård", "omsorg", "hemtjänst", "äldreomsorgen", "socialtjänst",
    "skola", "gymnasium", "högskola", "universitet", "akademi",
    "apotek", "kyrka", "kyrkan", "fk ", "försäkringskassan",
    "arbetsförmedlingen", "migrationsverket", "polisen", "länsstyrelsen",
    "riksdag", "myndighet",
  ];

  function isNonIcpEmployer(name: string): boolean {
    const n = name.toLowerCase();
    return NON_ICP_EMPLOYERS.some((kw) => n.includes(kw));
  }

  const ads: JobAd[] = [];
  for (const role of roles) {
    try {
      const url = `https://jobsearch.api.jobtechdev.se/search?q=${encodeURIComponent(role)}&limit=8`;
      const res = await fetchWithRetry(url, { headers: { accept: "application/json" } });
      const data = (await res.json()) as JobtechResponse;
      (data?.hits ?? []).forEach((hit) => {
        if (!hit.employer?.name) return;
        if (isNonIcpEmployer(hit.employer.name)) return;
        ads.push({
          company: hit.employer.name,
          title: hit.headline ?? role,
          desc: hit.description?.text?.substring(0, 300) ?? "",
          location: hit.workplace_address?.municipality ?? "Sverige",
          role,
        });
      });
      await sleep(600);
    } catch (e) {
      console.warn(`Jobs API failed (${role}):`, (e as Error).message);
    }
  }

  const limit = opts.limit ?? 10;
  return ads.slice(0, limit).map((ad) => ({
    source: "job_signal",
    company_name: ad.company,
    signals: [
      `Söker rollen: "${ad.title}"`,
      `Ort: ${ad.location}`,
      `Rollbeskrivning: ${ad.desc}`,
    ],
    suggested_offer_hint: "ai_automation",
    extra: { role: ad.role, signal_type: "ai_replaceable" },
  }));
}

// ------------------------------------------------------------
// SOURCE 4 — Arbetsförmedlingen Jobs API — Growth/scaling roles → app_development
// ------------------------------------------------------------
export async function fetchAppDevSignals(
  opts: { limit?: number } = {},
): Promise<ProspectSignal[]> {
  const roles = [
    "produktägare",
    "product owner",
    "digital projektledare",
    "it-projektledare",
    "systemutvecklare",
    "webbutvecklare",
  ];

  type JobAd = {
    company: string;
    title: string;
    desc: string;
    location: string;
  };

  const STAFFING_KEYWORDS = ["adecco", "randstad", "manpower", "poolia", "academicwork", "academic work", "experis", "jeffersonwells"];
  const NON_ICP_APP = ["region ", "landsting", "kommun", "stad ", "sjukhus", "skola", "gymnasium", "högskola", "universitet", "myndighet"];

  const ads: JobAd[] = [];
  for (const role of roles) {
    try {
      const url = `https://jobsearch.api.jobtechdev.se/search?q=${encodeURIComponent(role)}&limit=8`;
      const res = await fetchWithRetry(url, { headers: { accept: "application/json" } });
      const data = (await res.json()) as JobtechResponse;
      (data?.hits ?? []).forEach((hit) => {
        if (!hit.employer?.name) return;
        const name = (hit.employer.name ?? "").toLowerCase();
        if (STAFFING_KEYWORDS.some(s => name.includes(s))) return;
        if (NON_ICP_APP.some(s => name.includes(s))) return;
        ads.push({
          company: hit.employer.name,
          title: hit.headline ?? role,
          desc: hit.description?.text?.substring(0, 300) ?? "",
          location: hit.workplace_address?.municipality ?? "Sverige",
        });
      });
      await sleep(600);
    } catch (e) {
      console.warn(`App dev jobs API failed (${role}):`, (e as Error).message);
    }
  }

  const limit = opts.limit ?? 8;
  return ads.slice(0, limit).map((ad) => ({
    source: "job_signal",
    company_name: ad.company,
    signals: [
      `Rekryterar: "${ad.title}"`,
      `Ort: ${ad.location}`,
      `Signal: Bolaget skalar sin digitala kapacitet`,
      `Beskrivning: ${ad.desc}`,
    ],
    suggested_offer_hint: "app_development",
    extra: { signal_type: "growth_hiring" },
  }));
}

// ------------------------------------------------------------
// SOURCE 5 — Google Custom Search — per service line
// ------------------------------------------------------------
export async function searchWeakDigitalPresence(opts: {
  googleApiKey?: string;
  googleCseId?: string;
  limit?: number;
  /** Max CSE queries to fire per call. Default 4 (saves free quota: 100/day ÷ 4 = 25 runs). */
  queriesPerRun?: number;
}): Promise<ProspectSignal[]> {
  if (!opts.googleApiKey || !opts.googleCseId) return [];

  const queries: Array<{
    q: string;
    hint: ProspectSignal["suggested_offer_hint"];
    label: string;
  }> = [
    // ── WEBB DESIGN — Outdated/no website ────────────────────────────────────
    {
      q: 'advokatbyrå Sverige hemsida kontakt "om oss"',
      hint: "webb_design",
      label: "Advokatbyrå med enkel hemsida",
    },
    {
      q: 'redovisningsbyrå Sverige hemsida bokföring "kontakta oss"',
      hint: "webb_design",
      label: "Redovisningsbyrå utan modern hemsida",
    },
    {
      q: 'byggföretag mark anläggning Sverige hemsida "om företaget"',
      hint: "webb_design",
      label: "Bygg/anläggningsföretag med enkel hemsida",
    },
    {
      q: 'tandläkare klinik Sverige hemsida "boka tid" kontakt',
      hint: "webb_design",
      label: "Tandläkarmottagning med enkel hemsida",
    },
    {
      q: 'städbolag företagsstädning Sverige hemsida offert',
      hint: "webb_design",
      label: "Städbolag B2B utan modern hemsida",
    },
    {
      q: 'fastighetsmäklare mäklarbyrå Sverige hemsida "se våra objekt"',
      hint: "webb_design",
      label: "Mäklarbyrå med föråldrad hemsida",
    },
    {
      q: 'hantverksföretag VVS elektriker snickare Sverige hemsida kontakt',
      hint: "webb_design",
      label: "Hantverksföretag utan bra hemsida",
    },
    // Hitta.se directory listings = high signal for no/weak website
    {
      q: "site:hitta.se advokatbyrå stockholm OR göteborg OR malmö",
      hint: "webb_design",
      label: "Advokatbyrå listad på hitta.se — troligen utan hemsida",
    },
    {
      q: "site:hitta.se redovisningsbyrå",
      hint: "webb_design",
      label: "Redovisningsbyrå listad på hitta.se",
    },
    {
      q: "site:hitta.se byggföretag stockholm OR göteborg OR malmö",
      hint: "webb_design",
      label: "Byggföretag listad på hitta.se",
    },
    {
      q: "site:hitta.se städbolag OR städfirma",
      hint: "webb_design",
      label: "Städbolag utan hemsida",
    },
    {
      q: "site:hitta.se hantverkare elektriker VVS snickare",
      hint: "webb_design",
      label: "Hantverkare listad på hitta.se",
    },
    // ── APP DEVELOPMENT — Scaling companies, MVPs, digital transformation ─────
    {
      q: 'startup Sverige "vi söker" "product owner" OR "produktägare" 2025',
      hint: "app_development",
      label: "Startup som skalar produktteam",
    },
    {
      q: 'scaleup Stockholm Göteborg "digital plattform" OR "ny app" OR "MVP"',
      hint: "app_development",
      label: "Scaleup med behov av digital lösning",
    },
    {
      q: 'bolag Sweden "vi bygger" OR "vi utvecklar" "digital" OR "app" startup',
      hint: "app_development",
      label: "Bolag med pågående digital produktutveckling",
    },
    {
      q: '"kapitalrunda" OR "investering" Sverige startup tech 2024 OR 2025',
      hint: "app_development",
      label: "Nyligen finansierat startup",
    },
    {
      q: 'företag Sverige "integrationer" OR "API" OR "automatisering" system nytt',
      hint: "app_development",
      label: "Bolag som behöver systemintegrationer",
    },
    // ── AI AUTOMATION — Companies with heavy manual admin ─────────────────────
    {
      q: 'fastighetsbolag Sverige administration "ekonomiavdelning" OR "backoffice"',
      hint: "ai_automation",
      label: "Fastighetsbolag med tung administration",
    },
    {
      q: 'logistikbolag Sverige "manuell" OR "excel" administration processer',
      hint: "ai_automation",
      label: "Logistikbolag med manuella processer",
    },
    {
      q: 'vårdbolag OR hemtjänst Sverige administration "tidrapportering" OR "schema"',
      hint: "ai_automation",
      label: "Vårdbolag med manuell schemaläggning",
    },
    {
      q: 'tillverkningsbolag Sverige "order" OR "lager" administration manuellt',
      hint: "ai_automation",
      label: "Tillverkningsbolag med manuell orderhantering",
    },
    // ── AGENT PLATFORM — Agencies/consultancies with manual internal work ──────
    {
      q: 'rekryteringsbolag Sverige 10-50 anställda processer administration manuellt',
      hint: "agent_platform",
      label: "Rekryteringsbolag med manuella processer",
    },
    {
      q: 'managementkonsult konsultbolag Sverige "rapportering" OR "offerter" OR "timrapport"',
      hint: "agent_platform",
      label: "Konsultbolag med manuell administration",
    },
    {
      q: 'PR-byrå kommunikationsbyrå marknadsbyrå Sverige "administration" OR "processer"',
      hint: "agent_platform",
      label: "Kommunikationsbyrå med manuella processer",
    },
    {
      q: 'revisionsbyrå redovisningsbolag Sverige "digitalisering" OR "automatisering"',
      hint: "agent_platform",
      label: "Revisionsbyrå med digitaliseringsbehov",
    },
    {
      q: 'site:hitta.se konsultbolag bemanning IT management 10-100 anställda',
      hint: "agent_platform",
      label: "Konsultbolag listad på hitta.se",
    },
    // ── PROFF.SE — Swedish business directory with financials ──────────────────
    {
      q: 'site:proff.se advokatbyrå 10-49 anställda',
      hint: "webb_design",
      label: "Advokatbyrå funnen på proff.se",
    },
    {
      q: 'site:proff.se redovisningsbyrå revisorer 10-49 anställda',
      hint: "ai_automation",
      label: "Redovisningsbyrå på proff.se",
    },
    {
      q: 'site:proff.se arkitektkontor ingenjörer 10-49 anställda',
      hint: "webb_design",
      label: "Arkitektkontor på proff.se",
    },
    {
      q: 'site:proff.se rekryteringsbolag konsultbolag 10-50 anställda',
      hint: "agent_platform",
      label: "Rekryteringsbolag på proff.se",
    },
    {
      q: 'site:proff.se reklambyrå kommunikationsbyrå marknadsbyrå',
      hint: "agent_platform",
      label: "Kommunikationsbyrå på proff.se",
    },
    {
      q: 'site:proff.se byggbolag fastighetsbolag anläggning 10-99 anställda',
      hint: "webb_design",
      label: "Bygg/fastighetsbolag på proff.se",
    },
  ];

  type Candidate = {
    title: string;
    snippet: string;
    link: string;
    hint: ProspectSignal["suggested_offer_hint"];
    label: string;
  };

  // Run a random subset of 4 queries in parallel (free tier = 100/day; 4 queries/run
  // = 25 runs before quota). Shuffled so all service lines get coverage over time.
  const perRun = opts.queriesPerRun ?? 4;
  const shuffled = [...queries].sort(() => Math.random() - 0.5).slice(0, perRun);

  const results = await Promise.allSettled(
    shuffled.map(async ({ q, hint, label }) => {
      const url = `https://www.googleapis.com/customsearch/v1?key=${opts.googleApiKey}&cx=${opts.googleCseId}&q=${encodeURIComponent(q)}&num=3&lr=lang_sv&gl=se`;
      const res = await fetchWithRetry(url);
      const data = (await res.json()) as {
        items?: Array<{ title: string; snippet: string; link: string }>;
      };
      return (data.items ?? []).map((item) => ({
        title: item.title, snippet: item.snippet, link: item.link, hint, label,
      }));
    }),
  );

  const candidates: Candidate[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") candidates.push(...r.value);
    else console.warn("Google CSE query failed:", r.reason);
  }

  const limit = opts.limit ?? 8;
  return candidates
    .slice(0, limit)
    .map((c): ProspectSignal | null => {
      const nameMatch = c.title.match(/^([\wåäöÅÄÖ\s&]+(?:AB|HB|KB)?)/i);
      const company = nameMatch?.[1]?.trim() ?? c.title.split("|")[0]?.trim() ?? "";
      if (!company || company.length < 4) return null;
      return {
        source: "digital_presence",
        company_name: company,
        signals: [
          c.label,
          `Snippet: ${c.snippet}`,
          `URL: ${c.link}`,
        ],
        suggested_offer_hint: c.hint,
        extra: { link: c.link },
      };
    })
    .filter((x): x is ProspectSignal => x !== null);
}

// ------------------------------------------------------------
// SOURCE 6 — Visma upsell (interim table)
// ------------------------------------------------------------
export async function fetchVismaUpsellCandidates(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<ProspectSignal[]> {
  const from = new Date();
  from.setDate(from.getDate() - 60);
  const to = new Date();
  to.setDate(to.getDate() - 14);
  const { data: projects } = await supabase
    .from("visma_completed_projects")
    .select("*")
    .eq("tenant_id", tenantId)
    .gte("completed_date", from.toISOString().split("T")[0])
    .lte("completed_date", to.toISOString().split("T")[0])
    .eq("upsell_contacted", false)
    .limit(opts.limit ?? 10);
  if (!projects?.length) return [];
  return (projects as Array<Record<string, unknown>>).map((p) => {
    const completedDate = new Date(p["completed_date"] as string);
    const days = Math.round((Date.now() - completedDate.getTime()) / 86_400_000);
    const value = (p["total_value"] as number | null) ?? 0;
    return {
      source: "visma_upsell" as const,
      company_name: p["client_name"] as string,
      signals: [
        "Befintlig WKIT-kund — relationen är varm",
        `Projekt "${p["project_type"]}" avslutades för ${days} dagar sedan`,
        `Projektvärde: ${value.toLocaleString("sv-SE")} SEK`,
      ],
      suggested_offer_hint: "upsell" as const,
      extra: {
        project_id: p["id"],
        contact_name: p["contact_name"] ?? null,
        project_type: p["project_type"],
        total_value: value,
        days_since_completion: days,
      },
    };
  });
}

/** Mark a Visma project as "upsell contacted" so it isn't resurfaced. */
export async function markVismaUpsellContacted(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<void> {
  await supabase
    .from("visma_completed_projects")
    .update({ upsell_contacted: true })
    .eq("tenant_id", tenantId)
    .eq("id", projectId);
}

// ------------------------------------------------------------
// EMAIL DOMAIN VALIDATION — DNS MX lookup (no external API)
// ------------------------------------------------------------

export type EmailDomainResult = {
  domain: string;
  has_mx: boolean;
  domain_resolves: boolean;
  confidence: "high" | "low" | "unknown";
  suggested_emails: string[];
};

export async function validateEmailDomain(domain: string): Promise<EmailDomainResult> {
  const d = domain.toLowerCase().trim().replace(/^@/, "");
  try {
    // Dynamic import keeps Edge-runtime compat (scheduler + Server Actions both run Node.js)
    const { promises: dns } = await import("node:dns");
    let hasMx = false;
    let domainResolves = false;
    try {
      const mx = await dns.resolveMx(d);
      hasMx = mx.length > 0;
      domainResolves = true;
    } catch {
      // No MX — try A record as fallback
      try {
        await dns.resolve4(d);
        domainResolves = true;
      } catch {
        domainResolves = false;
      }
    }
    return {
      domain: d,
      has_mx: hasMx,
      domain_resolves: domainResolves,
      confidence: hasMx ? "high" : domainResolves ? "low" : "unknown",
      suggested_emails: domainResolves
        ? [`info@${d}`, `hej@${d}`, `kontakt@${d}`, `hello@${d}`]
        : [],
    };
  } catch {
    return {
      domain: d,
      has_mx: false,
      domain_resolves: false,
      confidence: "unknown",
      suggested_emails: [],
    };
  }
}

// ------------------------------------------------------------
// COMPANY RESEARCH — website scrape + Allabolag lookup
// ------------------------------------------------------------

export type CompanyResearch = {
  company_name: string;
  company_domain: string;
  org_number?: string;
  employees?: string;
  revenue?: string;
  address?: string;
  website_description?: string;
  vd_name?: string;
  contact_emails: string[];
  email_candidates: string[];  // Generated from VD name — not verified, but personalized
  contact_names: string[];
  key_facts: string[];
};

const EMAIL_RE = /\b([a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,253}\.[a-zA-Z]{2,10})\b/g;

/** Fetch a URL silently — never throws, returns null on any failure. */
async function fetchPageSilent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AgentHub-SalesAgent/1.0 (+https://weknowit.se)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(4000),   // 4 s — tight budget; we call this many times
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function inferDomain(companyName: string): string {
  return (
    companyName
      .toLowerCase()
      .replace(/\s+(ab|hb|kb|ek\.?för\.?|ideell|stiftelse)\.?\s*$/i, "")
      .replace(/[åä]/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "") + ".se"
  );
}

function extractEmails(html: string, preferredDomain: string): string[] {
  const NOISE = ["example.", "sentry.", "w3.org", "schema.org", "apple.com", "microsoft.com"];
  const all = [...html.matchAll(EMAIL_RE)]
    .map((m) => (m[1] ?? "").toLowerCase())
    .filter((e) => e.length > 0)
    .filter((e) => {
      const parts = e.split("@");
      const d = parts[1] ?? "";
      if (NOISE.some((n) => d.includes(n))) return false;
      // Skip image/asset false positives
      if (/\.(png|jpg|gif|svg|webp|ico|css|js)$/.test(e)) return false;
      return true;
    });
  // Prefer emails on the company's own domain
  const onDomain = all.filter((e) => e.includes(preferredDomain));
  const others = all.filter((e) => !e.includes(preferredDomain));
  return [...new Set([...onDomain, ...others])].slice(0, 5);
}

function extractContactNames(html: string): string[] {
  const names: string[] = [];
  const SWEDISH_NAME = "[A-ZÅÄÖ][a-zåäö]+(?:\\s+[A-ZÅÄÖ][a-zåäö]+)+";
  const seen = new Set<string>();
  const add = (n: string, priority = false) => {
    const clean = n.trim();
    if (clean.length > 3 && !seen.has(clean)) {
      seen.add(clean);
      priority ? names.unshift(clean) : names.push(clean);
    }
  };

  // JSON-LD Person schema — most reliable when present
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1] ?? "{}") as Record<string, unknown>;
      const items: Record<string, unknown>[] = Array.isArray(data) ? data as Record<string, unknown>[] : [data];
      for (const item of items) {
        if (item["@type"] === "Person" && item["name"]) {
          const role = String(item["jobTitle"] ?? "").toLowerCase();
          const isDecisionMaker = /vd|ceo|grundare|direktör|chef|ägare|partner/.test(role);
          add(String(item["name"]), isDecisionMaker);
        }
      }
    } catch { /* malformed JSON-LD */ }
  }

  // HTML heading followed by role — team/om-oss pages: <h3>Erik Andersson</h3>...<p>VD</p>
  const ROLE_RE = /vd|ceo|grundare|direktör|chef|ägare|partner|ansvarig/i;
  for (const m of html.matchAll(
    /<(?:h[2-4]|strong|b)[^>]*>\s*([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)+)\s*<\/(?:h[2-4]|strong|b)>\s*(?:<[^>]+>)*\s*([^<]{1,80})/gi,
  )) {
    const name = (m[1] ?? "").trim();
    const context = (m[2] ?? "").toLowerCase();
    if (ROLE_RE.test(context)) add(name, true);
    else add(name);
  }

  // Plain text: "roll: Namn" or "Namn, roll"
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const roleBeforeName = new RegExp(
    `(?:vd|ceo|grundare|partner|ansvarig|ägare|direktör|chef)\\s*[:\\-–]\\s*(${SWEDISH_NAME})`,
    "gi",
  );
  for (const m of text.matchAll(roleBeforeName)) {
    add(m[1] ?? "", true);
  }
  const nameBeforeRole = new RegExp(
    `(${SWEDISH_NAME})\\s*[,–\\-]\\s*(?:VD|CEO|Grundare|Direktör|Ägare|Partner|Ansvarig)`,
    "g",
  );
  for (const m of text.matchAll(nameBeforeRole)) {
    add(m[1] ?? "", true);
  }

  // Name directly before an @ email address
  const beforeEmail = new RegExp(`(${SWEDISH_NAME})\\s*[<(]?\\s*[a-zA-Z0-9._%+\\-]+@`, "g");
  for (const m of text.matchAll(beforeEmail)) {
    add(m[1] ?? "");
  }

  return names.slice(0, 5);
}

/** Generate probable work email patterns from a full name + domain. */
function generateEmailCandidates(fullName: string, domain: string): string[] {
  const normalized = fullName
    .trim()
    .replace(/[åä]/gi, "a")
    .replace(/ö/gi, "o")
    .toLowerCase();
  const parts = normalized.split(/\s+/).filter((p) => /^[a-z]/.test(p));
  if (parts.length < 2) return [];
  const first = (parts[0] ?? "").replace(/[^a-z0-9]/g, "");
  const last = (parts[parts.length - 1] ?? "").replace(/[^a-z0-9]/g, "");
  const fi = first[0] ?? "";
  if (!first || !last || !fi) return [];
  return [
    `${first}.${last}@${domain}`,
    `${first}@${domain}`,
    `${fi}.${last}@${domain}`,
    `${first}${last}@${domain}`,
  ];
}

/** Extract VD/CEO name from a Swedish company HTML page. */
function extractVdName(html: string): string | undefined {
  // JSON-LD structured data — fastest path if the page includes it
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1] ?? "{}") as Record<string, unknown>;
      const items: Record<string, unknown>[] = Array.isArray(data) ? data as Record<string, unknown>[] : [data];
      for (const item of items) {
        const title = String(item["jobTitle"] ?? "").toLowerCase();
        if ((title.includes("vd") || title.includes("verkst") || title.includes("ceo")) && item["name"]) {
          return String(item["name"]).trim();
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  }

  // Table cell pattern: <td>Verkst. dir.</td><td>Name Name</td>
  const SWEDISH_NAME_PAT = "[A-ZÅÄÖ][a-zåäö]+(?:\\s+[A-ZÅÄÖ][a-zåäö]+)+";
  const tableMatch = html.match(
    new RegExp(
      `<td[^>]*>\\s*(?:Verkst(?:ällande)?(?:\\.)?(?:\\s+)?dir(?:ektör)?(?:\\.)?|VD|CEO)\\s*</td>\\s*<td[^>]*>\\s*(${SWEDISH_NAME_PAT})\\s*</td>`,
      "i",
    ),
  );
  if (tableMatch?.[1]) {
    const name = tableMatch[1].trim();
    if (name.split(" ").length >= 2) return name;
  }

  // Plain-text fallback after stripping all tags
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const patterns = [
    new RegExp(`(?:Verkst(?:ällande)?(?:\\.)?\\s*dir(?:ektör)?(?:\\.)?|\\bVD\\b|\\bCEO\\b)\\s*[:\\-–]?\\s*(${SWEDISH_NAME_PAT})`, "i"),
    new RegExp(`(${SWEDISH_NAME_PAT})\\s*[,–\\-]\\s*(?:VD|Vd|CEO|verkst(?:ällande)?\\s*dir(?:ektör)?)`, "i"),
    // Allabolag person table: role followed by name on same line
    new RegExp(`Verkst\\.\\s+dir\\.\\s+(${SWEDISH_NAME_PAT})`, "i"),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const name = m?.[1]?.trim();
    if (name && name.split(" ").length >= 2) return name;
  }
  return undefined;
}

export async function researchCompany(opts: {
  companyName: string;
  companyDomain?: string;
}): Promise<CompanyResearch> {
  const domain = opts.companyDomain ?? inferDomain(opts.companyName);
  const result: CompanyResearch = {
    company_name: opts.companyName,
    company_domain: domain,
    contact_emails: [],
    email_candidates: [],
    contact_names: [],
    key_facts: [],
  };

  // --- Step 1: Fetch company website ---
  // Try homepage first (meta description + emails + names).
  // Then work through contact/about pages until we have both an email and a name.
  // Max 4 pages to stay within time budget.
  const primaryPages = [`https://${domain}`, `https://www.${domain}`];
  const extraPages = [
    `/kontakt`, `/om-oss`, `/team`, `/ledning`, `/personal`,
    `/medarbetare`, `/om-foretaget`, `/about`, `/contact`,
  ].map((p) => `https://${domain}${p}`);

  let scrapedHomepage = false;
  for (const url of [...primaryPages, ...extraPages]) {
    if (result.contact_emails.length > 0 && result.contact_names.length > 0) break;
    const html = await fetchPageSilent(url);
    if (!html) continue;

    const emails = extractEmails(html, domain);
    result.contact_emails.push(...emails);

    if (!result.website_description && !scrapedHomepage) {
      const desc =
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,250})["']/i)?.[1] ??
        html.match(/<meta[^>]+content=["']([^"']{10,250})["'][^>]+name=["']description["']/i)?.[1];
      if (desc) {
        result.website_description = desc.trim();
        result.key_facts.push(`Hemsidebeskrivning: ${desc.trim().substring(0, 150)}`);
      }
      scrapedHomepage = true;
    }

    result.contact_names.push(...extractContactNames(html));
    await sleep(300);
  }

  // --- Step 2: Allabolag search for company facts + VD name ---
  try {
    const searchUrl = `https://www.allabolag.se/what/${encodeURIComponent(opts.companyName)}`;
    const searchHtml = await fetchPageSilent(searchUrl);
    if (searchHtml) {
      // Extract org number: from text like "556716-8218" OR from href links like "/5567168218/"
      const orgFromText = searchHtml.match(/(\d{6}-\d{4})/)?.[1];
      const orgFromHref = searchHtml.match(/href="\/(\d{10})\//)?.[1];
      const rawOrg = orgFromText ?? (orgFromHref ? `${orgFromHref.slice(0, 6)}-${orgFromHref.slice(6)}` : undefined);
      if (rawOrg) {
        result.org_number = rawOrg;
        result.key_facts.push(`Org.nr: ${rawOrg}`);
      }

      const empText =
        (searchHtml.match(/(\d+[\s–\-]+\d+)\s+anst/i) ??
          searchHtml.match(/anst[^<>]{0,20}(\d+)/i))?.[1];
      if (empText) {
        result.employees = empText;
        result.key_facts.push(`Anställda: ${empText}`);
      }
      const revText = searchHtml.match(
        /omsättning[^<>]{0,60}([\d\s.,]+(?:tkr|mnkr|mkr|msek|ksek|kr))/i,
      )?.[1];
      if (revText) {
        result.revenue = revText.trim();
        result.key_facts.push(`Omsättning: ${revText.trim()}`);
      }

      // Fetch full company page for VD name; try both with and without trailing slug
      if (result.org_number) {
        const orgDigits = result.org_number.replace("-", "");
        // Allabolag company URL: /XXXXXXXXXX/slug — redirect follows automatically
        const companyPageUrl = `https://www.allabolag.se/${orgDigits}`;
        const companyHtml = await fetchPageSilent(companyPageUrl);
        if (companyHtml) {
          const vd = extractVdName(companyHtml);
          if (vd) {
            result.vd_name = vd;
            result.contact_names.unshift(vd);
            result.key_facts.push(`VD: ${vd}`);
          }
          // Also pick up employee/revenue data from the company page itself
          if (!result.employees) {
            const emp = companyHtml.replace(/<[^>]+>/g, " ").match(/(\d+[\s–\-]+\d+)\s+anst/i)?.[1];
            if (emp) { result.employees = emp; result.key_facts.push(`Anställda: ${emp}`); }
          }
        }
      } else if (orgFromHref) {
        // We have a 10-digit org number from href but couldn't format with dash — try it directly
        const companyHtml = await fetchPageSilent(`https://www.allabolag.se/${orgFromHref}`);
        if (companyHtml) {
          const vd = extractVdName(companyHtml);
          if (vd) {
            result.vd_name = vd;
            result.contact_names.unshift(vd);
            result.key_facts.push(`VD: ${vd}`);
          }
        }
      }
    }
    await sleep(500);
  } catch {
    // Allabolag is optional enrichment
  }

  // --- Step 3: Ratsit.se — structured Swedish company directory, reliable VD names ---
  if (!result.vd_name) {
    try {
      // Search by company name; if org number is known, go directly to company page
      let ratsitHtml: string | null = null;
      if (result.org_number) {
        ratsitHtml = await fetchPageSilent(
          `https://www.ratsit.se/foretag/${result.org_number}`,
        );
      }
      if (!ratsitHtml) {
        const searchHtml = await fetchPageSilent(
          `https://www.ratsit.se/foretag/search?q=${encodeURIComponent(opts.companyName)}`,
        );
        if (searchHtml) {
          // First company link: /foretag/XXXXXX-XXXX
          const companyPath = searchHtml.match(/href="(\/foretag\/\d{6}-\d{4}[^"]{0,80})"/i)?.[1];
          if (companyPath) {
            await sleep(300);
            ratsitHtml = await fetchPageSilent(`https://www.ratsit.se${companyPath}`);
          }
        }
      }
      if (ratsitHtml) {
        const vd = extractVdName(ratsitHtml);
        if (vd) {
          result.vd_name = vd;
          result.contact_names.unshift(vd);
          result.key_facts.push(`VD (Ratsit): ${vd}`);
        }
        // Ratsit also shows address — grab if missing
        if (!result.address) {
          const addr = ratsitHtml.replace(/<[^>]+>/g, " ").match(
            /\b(\d{3}\s?\d{2}\s+[A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ]?[a-zåäö]+)*)\b/,
          )?.[1];
          if (addr) result.address = addr.trim();
        }
      }
      await sleep(400);
    } catch {
      // Ratsit is optional enrichment
    }
  }

  // --- Step 4: PRoff.se fallback — only if no VD found ---
  if (!result.vd_name) {
    try {
      // PRoff company page (more structured than search results)
      const proffSearchUrl = `https://www.proff.se/s%C3%B6k?q=${encodeURIComponent(opts.companyName)}`;
      const proffHtml = await fetchPageSilent(proffSearchUrl);
      if (proffHtml) {
        const vd = extractVdName(proffHtml);
        if (vd) {
          result.vd_name = vd;
          result.contact_names.unshift(vd);
          result.key_facts.push(`VD (PRoff): ${vd}`);
        }
        // PRoff search might show a direct company link — follow it for richer data
        const proffCompanyPath = proffHtml.match(/href="(\/(?:bolag|f%C3%B6retag|foretag)\/[^"]{3,80})"/i)?.[1];
        if (proffCompanyPath && !result.vd_name) {
          await sleep(300);
          const proffCompanyHtml = await fetchPageSilent(`https://www.proff.se${proffCompanyPath}`);
          if (proffCompanyHtml) {
            const vd2 = extractVdName(proffCompanyHtml);
            if (vd2) {
              result.vd_name = vd2;
              result.contact_names.unshift(vd2);
              result.key_facts.push(`VD (PRoff): ${vd2}`);
            }
          }
        }
      }
    } catch {
      // PRoff is optional
    }
  }

  // --- Generate personalised email candidates from VD name ---
  const nameForCandidates = result.vd_name ?? result.contact_names[0];
  if (nameForCandidates) {
    result.email_candidates = generateEmailCandidates(nameForCandidates, domain);
    if (result.email_candidates.length > 0) {
      result.key_facts.push(
        `E-postkandidater (ej verifierade): ${result.email_candidates.slice(0, 2).join(", ")}`,
      );
    }
  }

  // Deduplicate
  result.contact_emails = [...new Set(result.contact_emails)];
  result.contact_names = [...new Set(result.contact_names)];

  return result;
}

// ------------------------------------------------------------
// SOURCE 7 — Companies without websites (DNS A-record check)
// ------------------------------------------------------------

const NO_WEBSITE_SNI = [
  { sni: "69100", industry: "Advokatbyrå" },
  { sni: "69200", industry: "Redovisningsbyrå" },
  { sni: "41200", industry: "Byggföretag" },
  { sni: "81210", industry: "Städbolag" },
  { sni: "86230", industry: "Tandläkare" },
  { sni: "56101", industry: "Restaurang" },
  { sni: "68310", industry: "Fastighetsmäklare" },
  { sni: "96020", industry: "Frisör/Skönhetssalong" },
];

async function domainHasWebsite(domain: string): Promise<boolean> {
  try {
    const { promises: dns } = await import("node:dns");
    await dns.resolve4(domain);
    return true;
  } catch {
    try {
      const { promises: dns } = await import("node:dns");
      await dns.resolve4(`www.${domain}`);
      return true;
    } catch {
      return false;
    }
  }
}

export async function fetchNoWebsiteCompanies(
  opts: { limit?: number } = {},
): Promise<ProspectSignal[]> {
  const results: ProspectSignal[] = [];
  const limit = opts.limit ?? 8;

  // Process at most 4 SNI codes per call — keeps total tool time under ~30 s
  for (const { sni, industry } of NO_WEBSITE_SNI.slice(0, 4)) {
    if (results.length >= limit) break;
    try {
      const url = `https://www.allabolag.se/bransch/${sni}?anstallda=1-9`;
      const res = await fetchWithRetry(url);
      const html = await res.text();
      const names = extractCompanyNamesFromHtml(html).slice(0, 6);

      // DNS checks in parallel — batch of 3 to avoid flooding DNS
      const checks = await Promise.allSettled(
        names.slice(0, 3).map(async (name) => {
          const domain = inferDomain(name);
          const hasWebsite = await domainHasWebsite(domain);
          return { name, domain, hasWebsite };
        }),
      );

      for (const check of checks) {
        if (results.length >= limit) break;
        if (check.status !== "fulfilled") continue;
        const { name, domain, hasWebsite } = check.value;
        if (!hasWebsite) {
          results.push({
            source: "digital_presence",
            company_name: name,
            signals: [
              `${industry} utan registrerad webbplats`,
              `Domänen ${domain} har inget A-record — troligen ingen hemsida`,
              `SNI-kod ${sni}: ${industry}`,
            ],
            suggested_offer_hint: "webb_design",
            extra: { sni, industry, inferred_domain: domain, dns_check: "no_a_record" },
          });
        }
      }
      await sleep(1000);
    } catch (e) {
      console.warn(`fetchNoWebsiteCompanies SNI ${sni} failed:`, (e as Error).message);
    }
  }

  return results;
}
