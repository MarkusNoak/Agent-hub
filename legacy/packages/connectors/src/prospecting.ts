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
    | "upsell"
    | "konsult_uthyrning";
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
  "apputvecklare",
  "mobilutvecklare",
  "frontend-utvecklare",
  "backend-utvecklare",
  "fullstack-utvecklare",
  "iOS-utvecklare",
  "Android-utvecklare",
  "mjukvaruutvecklare",
  "digital projektledare",
  "it-projektledare",
  "teknisk projektledare",
  "digital marknadsföring",
  "SEO-specialist",
  "performance marketing",
] as const;

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Companies that should NEVER appear as leads regardless of signal source.
// Mirrors the LARGE_CAP_BRANDS list in the sales agent — filtering here means
// they're removed before they reach the agent at all.
export const WKIT_COMPANY_BLOCKLIST = [
  // Fintech / lending
  "lendo", "klarna", "zettle", "izettle", "bambora", "nets", "swish", "bankid",
  "avanza", "nordnet", "collector", "resurs bank", "hoist", "svea",
  // Telecom
  "tele2", "telia", "tre.se", "comviq", "telenor",
  // Banking
  "handelsbanken", "nordea", "swedbank", "seb ", "länsförsäkringar", "folksam",
  // Tech/consumer
  "spotify", "king.com", "mojang", "mojäng",
  "ericsson", "volvo", "scania", "vattenfall", "skanska", "ncc ",
  // Retail / consumer
  "ikea", "h&m", "hennes", "willys", "ica ", "coop ", "axfood",
  "lyko", "nelly", "boozt", "webhallen", "komplett", "hemfrid",
  // Marketplaces
  "hemnet", "blocket", "tradera",
  // Staffing (already filtered separately but keep here for signal-level dedup)
  "adecco", "randstad", "manpower", "poolia", "academic work", "academicwork",
  "experis", "jeffersonwells", "jobbusters", "onepartnergroup", "techrytera",
  "recruitive", "lernia", "perido", "dfind", "wise group",
];

/** Returns true if the company name matches a known non-ICP brand. */
export function isBlocklistedCompany(name: string): boolean {
  const lc = name.toLowerCase();
  return WKIT_COMPANY_BLOCKLIST.some((b) => lc.includes(b));
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Upgrade-Insecure-Requests": "1",
};

async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  retries = 1,
): Promise<Response> {
  const isSwedishSite = url.includes("allabolag.se") || url.includes("proff.se");
  const baseHeaders = isSwedishSite ? BROWSER_HEADERS : {
    "User-Agent": "AgentHub-SalesAgent/1.0 (+https://weknowit.se)",
  };

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        signal: AbortSignal.timeout(isSwedishSite ? 12000 : 8000),
        headers: {
          ...baseHeaders,
          ...((opts.headers as Record<string, string>) ?? {}),
        },
      });
      if (res.ok) return res;
      if (res.status < 500) return res;
    } catch {
      if (i === retries) throw new Error(`fetch failed: ${url}`);
    }
    await sleep(1200 * (i + 1));
  }
  throw new Error(`fetch exhausted retries: ${url}`);
}

// ------------------------------------------------------------
// RSS helpers
// ------------------------------------------------------------
type RssItem = { title: string; desc: string; link: string; source: string };

async function fetchRss(url: string, sourceName: string): Promise<RssItem[]> {
  try {
    const res = await fetchWithRetry(url);
    const text = await res.text();
    const items: RssItem[] = [];
    const itemRe = /<item[\s\S]*?<\/item>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(text)) !== null) {
      const block = m[0]!;
      const title = (/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i.exec(block) ??
                    /<title[^>]*>([^<]*)<\/title>/i.exec(block))?.[1]?.trim() ?? "";
      const desc  = (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i.exec(block) ??
                    /<description[^>]*>([^<]*)<\/description>/i.exec(block))?.[1]?.trim() ?? "";
      const link  = /<link[^>]*>([^<]*)<\/link>/i.exec(block)?.[1]?.trim() ?? "";
      if (title) items.push({ title, desc: desc.slice(0, 300), link, source: sourceName });
    }
    return items;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------
// SOURCE 1 — RSS (Breakit / ComputerSweden) — funding news
// ------------------------------------------------------------
const FUNDING_KEYWORDS = [
  "finansiering",
  "investering",
  "kapital",
  "miljon",
  "miljoner",
  "seed",
  "series a",
  "serie a",
  "series b",
  "serie b",
  "venture",
  "riskkapital",
  "lanserar",
  "expansion",
  "förvärv",
  "uppköp",
  "börsnotering",
  "ipo",
  "tillväxt",
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
  ];

  const allItems: RssItem[] = [];
  for (const feed of feeds) {
    const items = await fetchRss(feed, feed.includes("breakit") ? "Breakit" : feed.includes("di.se") ? "DI" : "ComputerSweden");
    allItems.push(...items);
    await sleep(400);
  }

  // Keywords that indicate a startup signal AND exclusion of large-cap / investor noise
  const hasStartupSignal = (item: RssItem) => {
    const text = `${item.title} ${item.desc}`.toLowerCase();
    const hasFundingKeyword = FUNDING_KEYWORDS.some((k) => text.includes(k));
    const isLargeCap = LARGE_CAP_SIGNALS.some((k) => text.includes(k));
    return hasFundingKeyword && !isLargeCap;
  };

  const relevant = allItems.filter(hasStartupSignal);

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
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/<[^>]+>/g, "").trim();
    if (name.length < 3 || seen.has(name)) return;
    if (/^(Visa|Se mer|Fler|Alla|Sök|Nästa|Föregående|Logga|Menu|Start)/i.test(name)) return;
    seen.add(name);
    names.push(name);
  };

  // Pattern 1: Allabolag — company in anchor under /foretag/ or /bolag/
  const re1 = /href="\/(?:foretag|bolag)\/[^"]+"[^>]*>\s*([^<]{2,70})\s*<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(html)) !== null) add(m[1]!);

  // Pattern 2: Any link text ending with AB/HB/KB
  if (names.length < 5) {
    const re2 = /href="[^"]*"[^>]*>\s*([A-ZÅÄÖ][^<]{2,60}(?:AB|HB|KB|Aktiebolag|Handelsbolag)\.?)\s*<\/a>/g;
    while ((m = re2.exec(html)) !== null) add(m[1]!);
  }

  // Pattern 3: JSON-LD / structured data company names
  if (names.length < 5) {
    const re3 = /"name"\s*:\s*"([^"]{3,70}(?:AB|HB|KB|AB \(publ\)))"/g;
    while ((m = re3.exec(html)) !== null) add(m[1]!);
  }

  // Pattern 4: h2/h3 headings with company names (card-style layouts)
  if (names.length < 5) {
    const re4 = /<h[23][^>]*>\s*([A-ZÅÄÖ][^<]{2,60}(?:AB|HB|KB|AB \(publ\))\.?)\s*<\/h[23]>/gi;
    while ((m = re4.exec(html)) !== null) add(m[1]!);
  }

  return names.slice(0, 30);
}

// ------------------------------------------------------------
// SOURCE 2 — Allabolag.se scrape
// ------------------------------------------------------------
export async function scrapeAllabolag(opts: { limit?: number } = {}): Promise<ProspectSignal[]> {
  const targets = [
    { url: "https://www.allabolag.se/bransch/datakonsultverksamhet", offer: "agent_platform" as const, label: "IT-konsultbolag" },
    { url: "https://www.allabolag.se/bransch/konsultverksamhet-avseende-foretags-och-annan-verksamhetsledning", offer: "agent_platform" as const, label: "Managementkonsult" },
    { url: "https://www.allabolag.se/bransch/rekrytering-och-urval", offer: "agent_platform" as const, label: "Rekryteringsbolag" },
    { url: "https://www.allabolag.se/bransch/reklambyraverksamhet", offer: "agent_platform" as const, label: "Kommunikationsbyrå" },
    { url: "https://www.allabolag.se/bransch/pr-och-kommunikationsverksamhet", offer: "agent_platform" as const, label: "PR-byrå" },
    { url: "https://www.allabolag.se/bransch/redovisning-och-bokforing", offer: "webb_design" as const, label: "Redovisningsbyrå" },
    { url: "https://www.allabolag.se/bransch/advokatbyraer-och-juridisk-radgivning", offer: "webb_design" as const, label: "Advokatbyrå" },
    { url: "https://www.allabolag.se/bransch/arkitektverksamhet", offer: "webb_design" as const, label: "Arkitektkontor" },
    { url: "https://www.allabolag.se/bransch/byggande-av-bostadshus-och-andra-byggnader", offer: "webb_design" as const, label: "Byggföretag" },
    { url: "https://www.allabolag.se/bransch/fastighetsforvaltning", offer: "webb_design" as const, label: "Fastighetsbolag" },
  ];

  const results: ProspectSignal[] = [];

  for (const t of targets) {
    if (results.length >= (opts.limit ?? 6)) break;
    try {
      const res = await fetchWithRetry(t.url);
      const html = await res.text();
      if (res.status !== 200 || !html.includes("allabolag")) continue;
      const names = extractCompanyNamesFromHtml(html);
      for (const name of names.slice(0, 2)) {
        if (isBlocklistedCompany(name)) continue;
        results.push({
          source: "allabolag_icp",
          company_name: name,
          signals: [t.label, "Hittad via Allabolag SNI-kategori"],
          suggested_offer_hint: t.offer,
          extra: { allabolag_category: t.url },
        });
      }
      await sleep(800);
    } catch {
      continue;
    }
  }

  return results.slice(0, opts.limit ?? 6);
}

// ------------------------------------------------------------
// SOURCE 3 — Arbetsförmedlingen (AI-replaceable roles)
// ------------------------------------------------------------
type JobtechResponse = {
  hits: Array<{
    employer?: { name?: string };
    headline?: string;
    description?: { text?: string };
    workplace_address?: { municipality?: string };
  }>;
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
        if (isBlocklistedCompany(hit.employer.name)) return;
        ads.push({
          company: hit.employer.name,
          title: hit.headline ?? role,
          desc: hit.description?.text?.substring(0, 300) ?? "",
          location: hit.workplace_address?.municipality ?? "Sverige",
          role,
        });
      });
      await sleep(500);
    } catch {
      continue;
    }
  }

  const seen = new Set<string>();
  const deduped = ads.filter((a) => {
    const key = a.company.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, opts.limit ?? 10).map((ad) => ({
    source: "job_signal",
    company_name: ad.company,
    signals: [
      `Rekryterar: "${ad.title}"`,
      `Roll: ${ad.role}`,
      `Ort: ${ad.location}`,
      `Signal: Bolaget har manuella admin-processer som kan automatiseras`,
      `Beskrivning: ${ad.desc}`,
    ],
    suggested_offer_hint: "agent_platform",
    extra: { signal_type: "admin_role_hiring", role: ad.role },
  }));
}

// ------------------------------------------------------------
// SOURCE 4 — Arbetsförmedlingen (app_development signals)
// ------------------------------------------------------------
export async function fetchAppDevSignals(
  opts: { limit?: number } = {},
): Promise<ProspectSignal[]> {
  // Only strong "we need to build something" signals — not marketing/PM roles
  // which are weaker proxies. These roles = company actively needs a developer.
  const roles = [
    "systemutvecklare",
    "webbutvecklare",
    "apputvecklare",
    "mobilutvecklare",
    "frontend-utvecklare",
    "backend-utvecklare",
    "fullstack-utvecklare",
    "iOS-utvecklare",
    "Android-utvecklare",
    "mjukvaruutvecklare",
    "produktägare",
    "product owner",
  ];

  type JobAd = {
    company: string;
    title: string;
    desc: string;
    location: string;
  };

  const STAFFING_KEYWORDS = [
    "adecco", "randstad", "manpower", "poolia", "academicwork", "academic work",
    "experis", "jeffersonwells", "jobbusters", "onepartnergroup", "techrytera",
    "recruitive", "lernia", "perido", "dfind", "wise",
    // Also skip large tech companies — they have their own devs
    "spotify", "klarna", "ericsson", "volvo", "scania", "ikea", "h&m", "hm group",
    "tele2", "telia", "swedbank", "handelsbanken", "nordea", "seb bank",
  ];
  const NON_ICP_APP = [
    "region ", "landsting", "kommun", "stad ", "sjukhus", "skola",
    "gymnasium", "högskola", "universitet", "myndighet", "försäkrings",
  ];

  const ads: JobAd[] = [];
  for (const role of roles) {
    try {
      // Limit to 5 per role — we only want the top signals, not a firehose
      const url = `https://jobsearch.api.jobtechdev.se/search?q=${encodeURIComponent(role)}&limit=5`;
      const res = await fetchWithRetry(url, { headers: { accept: "application/json" } });
      const data = (await res.json()) as JobtechResponse;
      (data?.hits ?? []).forEach((hit) => {
        if (!hit.employer?.name) return;
        const name = (hit.employer.name ?? "").toLowerCase();
        if (STAFFING_KEYWORDS.some(s => name.includes(s))) return;
        if (NON_ICP_APP.some(s => name.includes(s))) return;
        if (isBlocklistedCompany(hit.employer.name)) return;
        ads.push({
          company: hit.employer.name,
          title: hit.headline ?? role,
          desc: hit.description?.text?.substring(0, 300) ?? "",
          location: hit.workplace_address?.municipality ?? "Sverige",
        });
      });
      await sleep(600);
    } catch {
      continue;
    }
  }

  const seen = new Set<string>();
  const deduped = ads.filter((a) => {
    const key = a.company.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const limit = opts.limit ?? 8;
  return deduped.slice(0, limit).map((ad) => ({
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
type GoogleSearchItem = {
  title?: string;
  snippet?: string;
  link?: string;
  displayLink?: string;
  pagemap?: {
    metatags?: Array<Record<string, string>>;
  };
};

const GOOGLE_QUERIES: Array<{
  q: string;
  offer: ProspectSignal["suggested_offer_hint"];
  label: string;
}> = [
  {
    q: 'site:proff.se advokatbyrå 10-49 anställda',
    offer: "webb_design",
    label: "Advokatbyrå funnen på proff.se",
  },
  {
    q: 'site:proff.se redovisningsbyrå revisorer 10-49 anställda',
    offer: "webb_design",
    label: "Redovisningsbyrå på proff.se",
  },
  {
    q: 'site:proff.se arkitektkontor ingenjörer 10-49 anställda',
    offer: "webb_design",
    label: "Arkitektkontor på proff.se",
  },
  {
    q: 'site:proff.se rekryteringsbolag konsultbolag 10-50 anställda',
    offer: "agent_platform",
    label: "Rekryteringsbolag på proff.se",
  },
  {
    q: 'site:proff.se reklambyrå kommunikationsbyrå marknadsbyrå',
    offer: "agent_platform",
    label: "Kommunikationsbyrå på proff.se",
  },
  {
    q: 'site:proff.se byggbolag fastighetsbolag anläggning 10-99 anställda',
    offer: "webb_design",
    label: "Bygg/fastighetsbolag på proff.se",
  },
  {
    q: 'startup scaleup Sverige söker systemutvecklare apputvecklare 2024 2025',
    offer: "app_development",
    label: "Svensk startup/scaleup söker utvecklare",
  },
  {
    q: 'fintech proptech healthtech Sverige produktägare 2024 2025',
    offer: "app_development",
    label: "Tech-startup Sverige söker produktägare",
  },
];

export async function searchWeakDigitalPresence(opts: {
  googleApiKey?: string;
  googleCseId?: string;
  limit?: number;
}): Promise<ProspectSignal[]> {
  if (!opts.googleApiKey || !opts.googleCseId) return [];

  const results: ProspectSignal[] = [];
  const seen = new Set<string>();

  for (const q of GOOGLE_QUERIES) {
    if (results.length >= (opts.limit ?? 8)) break;
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${opts.googleApiKey}&cx=${opts.googleCseId}&q=${encodeURIComponent(q.q)}&num=3`;
      const res = await fetchWithRetry(url);
      if (!res.ok) continue;
      const data = (await res.json()) as { items?: GoogleSearchItem[] };
      for (const item of (data.items ?? []).slice(0, 2)) {
        const domain = item.displayLink?.replace(/^www\./, "") ?? "";
        if (!domain || seen.has(domain)) continue;
        const title = item.title ?? "";
        if (isBlocklistedCompany(title)) continue;
        seen.add(domain);
        results.push({
          source: "digital_presence",
          company_name: title,
          signals: [q.label, item.snippet ?? ""].filter(Boolean),
          suggested_offer_hint: q.offer,
          extra: { domain, link: item.link },
        });
      }
      await sleep(500);
    } catch {
      continue;
    }
  }

  return results.slice(0, opts.limit ?? 8);
}

// ------------------------------------------------------------
// SOURCE 6 — Visma upsell
// ------------------------------------------------------------
export async function fetchVismaUpsellCandidates(
  supa: SupabaseClient,
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<ProspectSignal[]> {
  const now = new Date();
  const from = new Date(now.getTime() - 60 * 86400_000).toISOString();
  const to   = new Date(now.getTime() - 14 * 86400_000).toISOString();

  const { data } = await supa
    .from("visma_projects")
    .select("id, company_name, company_domain, contact_email, contact_name, project_type, delivered_at")
    .eq("tenant_id", tenantId)
    .gte("delivered_at", from)
    .lte("delivered_at", to)
    .is("upsell_contacted_at", null)
    .order("delivered_at", { ascending: false })
    .limit(opts.limit ?? 10);

  return (data ?? []).map((row) => ({
    source: "visma_upsell" as const,
    company_name: String(row.company_name ?? ""),
    signals: [
      `Projekt levererat: ${row.project_type ?? "okänd typ"}`,
      `Leveransdatum: ${row.delivered_at ? new Date(row.delivered_at as string).toLocaleDateString("sv-SE") : "okänt"}`,
      "Varm lead — befintlig kund",
    ],
    suggested_offer_hint: "upsell" as const,
    extra: {
      project_id: row.id,
      company_domain: row.company_domain,
      contact_email: row.contact_email,
      contact_name: row.contact_name,
    },
  }));
}

export async function markVismaUpsellContacted(
  supa: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<void> {
  await supa
    .from("visma_projects")
    .update({ upsell_contacted_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", projectId);
}

// ------------------------------------------------------------
// Email domain validation (DNS MX check)
// ------------------------------------------------------------
export type EmailDomainResult = {
  domain: string;
  has_mx: boolean;
  confidence: "high" | "low" | "unknown";
  note?: string;
};

export async function validateEmailDomain(domain: string): Promise<EmailDomainResult> {
  const clean = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  try {
    // Use a public DNS-over-HTTPS resolver to check MX records
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(clean)}&type=MX`,
      {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return { domain: clean, has_mx: false, confidence: "unknown", note: `DNS query failed: ${res.status}` };
    const data = (await res.json()) as { Status: number; Answer?: Array<{ type: number; data: string }> };
    const hasMx = (data.Answer ?? []).some((a) => a.type === 15);
    if (hasMx) return { domain: clean, has_mx: true, confidence: "high" };
    // Fall back to A record check
    const resA = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(clean)}&type=A`,
      {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!resA.ok) return { domain: clean, has_mx: false, confidence: "low" };
    const dataA = (await resA.json()) as { Status: number; Answer?: Array<{ type: number }> };
    const hasA = (dataA.Answer ?? []).some((a) => a.type === 1);
    return {
      domain: clean,
      has_mx: false,
      confidence: hasA ? "low" : "unknown",
      note: hasA ? "No MX but has A record — email may still work" : "No DNS records found",
    };
  } catch {
    return { domain: clean, has_mx: false, confidence: "unknown", note: "DNS lookup timed out" };
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
  const isSwedishSite = url.includes("allabolag.se") || url.includes("proff.se");
  try {
    const res = await fetch(url, {
      headers: isSwedishSite ? BROWSER_HEADERS : {
        "User-Agent": "AgentHub-SalesAgent/1.0 (+https://weknowit.se)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(isSwedishSite ? 10000 : 4000),
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

// Generic/catchall email prefixes — these should NEVER end up in contact_emails.
// If only these exist on a page, the agent falls through to email_candidates (generated
// from VD name) or the info@ fallback. This is intentional: info@ gets [VERIFIERA ADRESS].
const GENERIC_PREFIXES = [
  "info", "kontakt", "contact", "hej", "hello", "noreply", "no-reply",
  "support", "admin", "reception", "hallo", "service", "mail", "post",
  "kontor", "kundtjanst", "kundservice", "order", "bokning", "booking",
  "webb", "web", "press", "media", "hr", "jobb", "jobs", "career", "careers",
];

function isGenericEmail(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  return GENERIC_PREFIXES.some(
    (p) => local === p || local.startsWith(p + ".") || local.startsWith(p + "-") || local.startsWith(p + "_"),
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
      if (/\.(png|jpg|gif|svg|webp|ico|css|js)$/.test(e)) return false;
      return true;
    });
  // Only return personal emails (non-generic) on the company's own domain.
  // Generic addresses (info@, kontakt@, etc.) are excluded so the agent falls
  // through to personalized email_candidates generated from VD name.
  const personal = all.filter((e) => e.includes(preferredDomain) && !isGenericEmail(e));
  return [...new Set(personal)].slice(0, 5);
}

function extractContactNames(html: string): string[] {
  const names: string[] = [];
  const patterns = [
    /<(?:h[1-4]|strong|b)[^>]*>\s*([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+){1,3})\s*<\/(?:h[1-4]|strong|b)>/g,
    /(?:kontakt(?:a oss)?|contact|team|medarbetare|personal)[^<]{0,200}<(?:h[1-4]|strong|p|span)[^>]*>\s*([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)+)\s*</gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && names.length < 5) {
      const n = m[1]!.trim();
      if (n.split(" ").length >= 2 && n.split(" ").length <= 4) names.push(n);
    }
  }
  return [...new Set(names)];
}

function generateEmailCandidates(fullName: string, domain: string): string[] {
  const parts = fullName.trim().toLowerCase()
    .replace(/[åä]/g, "a").replace(/ö/g, "o")
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ").filter(Boolean);
  if (parts.length < 2) return [];
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  return [
    `${first}.${last}@${domain}`,
    `${first}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${last}.${first}@${domain}`,
  ];
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractVdName(html: string): string | undefined {
  // Strategy 1: JSON-LD person (most reliable — structured data)
  const jsonLdRe = /"@type"\s*:\s*"Person"[^}]{0,300}"name"\s*:\s*"([^"]+)"/i;
  const jm = jsonLdRe.exec(html);
  if (jm) {
    const name = jm[1]!.trim();
    if (name.split(" ").length >= 2) return name;
  }

  // Strategy 2: Plain-text search after stripping HTML tags
  // This catches cross-tag patterns like <dt>VD</dt><dd>Anna Johansson</dd>
  const text = stripHtml(html);
  const textPatterns = [
    /(?:vd|verkst[äa]llande\s+direkt[öo]r|ceo|grundare|[äa]gare|partner|chef)\s*[:\-–]?\s*([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+){1,3})/gi,
    /([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+){1,3})\s*[,\-–]\s*(?:vd|verkst[äa]llande\s+direkt[öo]r|ceo|grundare|[äa]gare)/gi,
  ];
  for (const re of textPatterns) {
    const m = re.exec(text);
    if (m) {
      const name = m[1]!.trim();
      const parts = name.split(" ");
      if (parts.length >= 2 && parts.length <= 4) return name;
    }
  }
  return undefined;
}

export async function researchCompany(opts: {
  companyName: string;
  companyDomain?: string;
}): Promise<CompanyResearch> {
  const result: CompanyResearch = {
    company_name: opts.companyName,
    company_domain: opts.companyDomain ?? inferDomain(opts.companyName),
    contact_emails: [],
    email_candidates: [],
    contact_names: [],
    key_facts: [],
  };

  const domain = result.company_domain;

  // 1. Fetch main website
  const mainHtml = await fetchPageSilent(`https://${domain}`);
  if (mainHtml) {
    result.website_description = mainHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);

    const emails = extractEmails(mainHtml, domain);
    result.contact_emails.push(...emails);

    const names = extractContactNames(mainHtml);
    result.contact_names.push(...names);

    const vd = extractVdName(mainHtml);
    if (vd) result.vd_name = vd;
  }

  // 2. Try /kontakt page
  if (result.contact_emails.length === 0) {
    const kontaktHtml = await fetchPageSilent(`https://${domain}/kontakt`);
    if (kontaktHtml) {
      const emails = extractEmails(kontaktHtml, domain);
      result.contact_emails.push(...emails);
      if (!result.vd_name) {
        const vd = extractVdName(kontaktHtml);
        if (vd) result.vd_name = vd;
      }
    }
  }

  // 3. Try /om-oss page
  if (!result.vd_name) {
    const omHtml = await fetchPageSilent(`https://${domain}/om-oss`) ??
                   await fetchPageSilent(`https://${domain}/about`) ??
                   await fetchPageSilent(`https://${domain}/om-foretaget`);
    if (omHtml) {
      const vd = extractVdName(omHtml);
      if (vd) result.vd_name = vd;
      if (result.contact_emails.length === 0) {
        const emails = extractEmails(omHtml, domain);
        result.contact_emails.push(...emails);
      }
    }
  }

  // 4. Allabolag company search — server-rendered, most reliable VD source
  if (!result.vd_name) {
    const allabolagSearchUrl = `https://www.allabolag.se/what/${encodeURIComponent(opts.companyName)}`;
    const allabolagHtml = await fetchPageSilent(allabolagSearchUrl);
    if (allabolagHtml) {
      // Try direct extraction from search results page
      if (!result.vd_name) {
        const vd = extractVdName(allabolagHtml);
        if (vd) result.vd_name = vd;
      }
      // Follow link to individual company page if we still lack a name
      if (!result.vd_name) {
        const companyPath = allabolagHtml.match(/href="(\/[0-9]{6,12}\/[^"?]{3,80})"/)?.[1];
        if (companyPath) {
          await sleep(300);
          const companyHtml = await fetchPageSilent(`https://www.allabolag.se${companyPath}`);
          if (companyHtml) {
            const vd = extractVdName(companyHtml);
            if (vd) result.vd_name = vd;
            if (!result.employees) {
              const em = /(?:Antal anst[äa]llda|Anst[äa]llda)[:\s]+(\d[\d\s\-]*)/i.exec(stripHtml(companyHtml));
              if (em) result.employees = em[1]!.trim();
            }
            if (!result.org_number) {
              const on = /(?:Org\.?\s*nr|Organisationsnummer)[:\s]+([\d\-]{10,13})/i.exec(stripHtml(companyHtml));
              if (on) result.org_number = on[1]!.trim();
            }
          }
        }
      }
    }
  }

  // 5. Proff.se lookup for VD name + company facts
  const proffSearchUrl = `https://www.proff.se/s%C3%B6k?q=${encodeURIComponent(opts.companyName)}`;
  const proffHtml = await fetchPageSilent(proffSearchUrl);
  if (proffHtml) {
    const vd = extractVdName(proffHtml);
    if (vd && !result.vd_name) result.vd_name = vd;

    // Extract org facts from Proff search result
    const orgNoMatch = /(?:Org\.?\s*nr|Organisationsnummer)[:\s]+([\d\-]+)/i.exec(proffHtml);
    if (orgNoMatch) result.org_number = orgNoMatch[1]!.trim();

    const empMatch = /(?:Antal anst[äa]llda|Anst[äa]llda)[:\s]+(\d+[\s\-]*\d*)/i.exec(proffHtml);
    if (empMatch) result.employees = empMatch[1]!.trim();

    const revMatch = /(?:Omsättning|Nettoomsättning)[:\s]+([\d\s]+(?:tkr|mkr|kkr|MSEK|SEK)?)/i.exec(proffHtml);
    if (revMatch) result.revenue = revMatch[1]!.trim();

    // Proff.se is JS-rendered so deep page likely won't return useful data via plain fetch,
    // but try anyway — some facts may be in initial HTML or meta tags
    const proffCompanyPath = proffHtml.match(/href="(\/(?:bolag|f%C3%B6retag|foretag)\/[^"]{3,80})"/i)?.[1];
    if (proffCompanyPath && !result.vd_name) {
      await sleep(300);
      const proffCompanyHtml = await fetchPageSilent(`https://www.proff.se${proffCompanyPath}`);
      if (proffCompanyHtml) {
        const vd2 = extractVdName(proffCompanyHtml);
        if (vd2) result.vd_name = vd2;
        if (!result.employees) {
          const em = /(?:Antal anst[äa]llda|Anst[äa]llda)[:\s]+(\d+[\s\-]*\d*)/i.exec(stripHtml(proffCompanyHtml));
          if (em) result.employees = em[1]!.trim();
        }
      }
    }
  }

  // 6. Generate email candidates from VD name
  if (result.vd_name) {
    const candidates = generateEmailCandidates(result.vd_name, domain);
    result.email_candidates.push(...candidates);
  }

  // 7. Build key_facts
  const facts: string[] = [];
  if (result.employees) facts.push(`Anställda: ${result.employees}`);
  if (result.revenue) facts.push(`Omsättning: ${result.revenue}`);
  if (result.address) facts.push(`Adress: ${result.address}`);
  if (result.org_number) facts.push(`Org.nr: ${result.org_number}`);
  if (result.website_description) facts.push(`Beskrivning: ${result.website_description.slice(0, 150)}`);
  result.key_facts = facts;

  return result;
}

// ------------------------------------------------------------
// SOURCE 7 — IT consultant assignments (konsultuppdrag)
// Targets companies actively looking for IT consultants so we can
// pitch WKIT's own consultants (konsult_uthyrning offer type).
// ------------------------------------------------------------
const KONSULT_QUERIES = [
  "systemutvecklare konsultuppdrag",
  "frontend-utvecklare konsultuppdrag",
  "fullstack konsultuppdrag",
  "iOS-utvecklare konsultuppdrag",
  "Android-utvecklare konsultuppdrag",
  "data analyst konsultuppdrag",
  "backend-utvecklare konsultuppdrag",
];

// Known broker names — if the employer is a broker the actual end client is
// hidden, but the signal (active demand) is still useful. We flag these so the
// agent can decide whether to pitch the broker as a partner instead.
const KONSULT_BROKER_NAMES = [
  "ework", "nexer", "kvadrat", "knightec", "dfind", "wise", "experis",
  "tng ", " tng", "brainville", "adecco", "randstad", "manpower", "poolia",
  "academicwork", "academic work", "lernia", "perido", "jobbusters",
];

const NON_ICP_KONSULT = [
  "region ", "landsting", "kommun", "stad ", "sjukhus", "skola",
  "gymnasium", "högskola", "universitet", "myndighet", "försäkrings",
];

export async function fetchKonsultUppdrag(
  opts: { limit?: number } = {},
): Promise<ProspectSignal[]> {
  type JobAd = {
    company: string;
    title: string;
    desc: string;
    location: string;
    role: string;
    isBroker: boolean;
  };

  const ads: JobAd[] = [];

  for (const query of KONSULT_QUERIES) {
    try {
      const url = `https://jobsearch.api.jobtechdev.se/search?q=${encodeURIComponent(query)}&limit=5`;
      const res = await fetchWithRetry(url, { headers: { accept: "application/json" } });
      const data = (await res.json()) as JobtechResponse;
      (data?.hits ?? []).forEach((hit) => {
        if (!hit.employer?.name) return;
        const name = (hit.employer.name ?? "").toLowerCase();
        if (NON_ICP_KONSULT.some((s) => name.includes(s))) return;
        if (isBlocklistedCompany(hit.employer.name)) return;
        const isBroker = KONSULT_BROKER_NAMES.some((b) => name.includes(b));
        ads.push({
          company: hit.employer.name,
          title: hit.headline ?? query,
          desc: hit.description?.text?.substring(0, 300) ?? "",
          location: hit.workplace_address?.municipality ?? "Sverige",
          role: query,
          isBroker,
        });
      });
      await sleep(500);
    } catch {
      continue;
    }
  }

  // Try uppdragshittaren.se as supplementary source (server-rendered)
  try {
    const html = await fetchPageSilent("https://www.uppdragshittaren.se/uppdrag/");
    if (html && html.includes("uppdrag")) {
      // Extract company/uppdrag names from listings
      const re = /href="[^"]*\/uppdrag\/[^"]*"[^>]*>\s*([^<]{5,80})\s*</gi;
      let m: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((m = re.exec(html)) !== null) {
        const title = m[1]!.trim();
        if (title.length < 5 || seen.has(title)) continue;
        seen.add(title);
        // uppdragshittaren lists assignment titles, not company names —
        // use as signal text, company_name is set to a placeholder for the agent to infer
        ads.push({
          company: "extract_from_assignment",
          title,
          desc: `Uppdrag listat på Uppdragshittaren.se: "${title}"`,
          location: "Sverige",
          role: "IT-konsultuppdrag",
          isBroker: true,
        });
        if (seen.size >= 5) break;
      }
    }
  } catch { /* silent — supplementary source */ }

  const seenCompanies = new Set<string>();
  const deduped = ads.filter((a) => {
    const key = a.company.toLowerCase();
    if (seenCompanies.has(key)) return false;
    seenCompanies.add(key);
    return true;
  });

  const limit = opts.limit ?? 10;
  return deduped.slice(0, limit).map((ad) => ({
    source: "job_signal" as const,
    company_name: ad.company,
    signals: [
      ad.isBroker
        ? `Konsultmäklare söker: "${ad.title}" — kontakta mäklaren för partnerskap`
        : `Företag söker direkt: "${ad.title}" — pitcha WKIT-konsult`,
      `Ort: ${ad.location}`,
      `Signal: Aktiv efterfrågan på IT-konsult → konsult_uthyrning`,
      ad.desc ? `Beskrivning: ${ad.desc}` : "",
    ].filter(Boolean),
    suggested_offer_hint: "konsult_uthyrning" as const,
    extra: {
      signal_type: "konsult_uppdrag",
      role: ad.role,
      is_broker_posting: ad.isBroker,
    },
  }));
}

// ------------------------------------------------------------
// No-website company discovery
// ------------------------------------------------------------
async function domainHasWebsite(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "AgentHub-SalesAgent/1.0" },
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export async function fetchNoWebsiteCompanies(
  opts: { limit?: number } = {},
): Promise<ProspectSignal[]> {
  const SNI_TARGETS = [
    { url: "https://www.allabolag.se/bransch/redovisning-och-bokforing", label: "Redovisningsbyrå" },
    { url: "https://www.allabolag.se/bransch/advokatbyraer-och-juridisk-radgivning", label: "Advokatbyrå" },
    { url: "https://www.allabolag.se/bransch/byggande-av-bostadshus-och-andra-byggnader", label: "Byggföretag" },
    { url: "https://www.allabolag.se/bransch/elektriska-installationer", label: "Elinstallation" },
    { url: "https://www.allabolag.se/bransch/VVS-installationer", label: "VVS" },
    { url: "https://www.allabolag.se/bransch/städverksamhet", label: "Städbolag" },
    { url: "https://www.allabolag.se/bransch/hår-och-skönhetsvård", label: "Frisör/Skönhet" },
    { url: "https://www.allabolag.se/bransch/restauranger-och-mobil-matverk samhet", label: "Restaurang" },
  ];

  const candidates: Array<{ name: string; label: string }> = [];

  for (const target of SNI_TARGETS) {
    if (candidates.length >= (opts.limit ?? 8) * 4) break;
    try {
      const res = await fetchWithRetry(target.url);
      const html = await res.text();
      if (res.status !== 200) continue;
      const names = extractCompanyNamesFromHtml(html);
      for (const name of names.slice(0, 5)) {
        if (!isBlocklistedCompany(name)) {
          candidates.push({ name, label: target.label });
        }
      }
      await sleep(700);
    } catch {
      continue;
    }
  }

  // DNS-check each candidate — only return those without a website
  const results: ProspectSignal[] = [];
  for (const c of candidates) {
    if (results.length >= (opts.limit ?? 8)) break;
    const domain = inferDomain(c.name);
    const hasWebsite = await domainHasWebsite(domain);
    if (!hasWebsite) {
      results.push({
        source: "digital_presence",
        company_name: c.name,
        signals: [
          `${c.label} utan webbplats (DNS-kontroll misslyckades för ${domain})`,
          "Stark webb_design-signal: bolaget saknar digital närvaro",
        ],
        suggested_offer_hint: "webb_design",
        extra: { inferred_domain: domain, label: c.label },
      });
    }
    await sleep(200);
  }

  return results;
}
