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
  retries = 2,
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          "User-Agent": "AgentHub-SalesAgent/1.0 (+https://weknowit.se)",
          ...(opts.headers ?? {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i === retries) throw err;
      await sleep(1500 * (i + 1));
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
// SOURCE 2 — Allabolag.se SNI + size filter → ai_automation
// ------------------------------------------------------------
export async function scrapeAllabolag(opts: { limit?: number } = {}): Promise<
  ProspectSignal[]
> {
  const sniSearches = [
    "https://www.allabolag.se/bransch/62020?anstallda=10-99",
    "https://www.allabolag.se/bransch/47910?anstallda=10-99",
    "https://www.allabolag.se/bransch/68100?anstallda=10-99",
    "https://www.allabolag.se/bransch/70220?anstallda=10-99",
  ];
  const companies: { name: string; sourceUrl: string }[] = [];
  for (const url of sniSearches) {
    try {
      const res = await fetchWithRetry(url);
      const html = await res.text();
      const matches = [
        ...html.matchAll(
          /class="[^"]*(?:company|foretag)[^"]*name[^"]*"[^>]*>\s*([^<]{3,80})\s*</gi,
        ),
      ];
      matches.slice(0, 6).forEach((m) => {
        const name = (m[1] ?? "").trim().replace(/&amp;/g, "&");
        if (name.length > 3) companies.push({ name, sourceUrl: url });
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

  const ads: JobAd[] = [];
  for (const role of roles) {
    try {
      const url = `https://jobsearch.api.jobtechdev.se/search?q=${encodeURIComponent(role)}&limit=5`;
      const res = await fetchWithRetry(url, { headers: { accept: "application/json" } });
      const data = (await res.json()) as JobtechResponse;
      (data?.hits ?? []).forEach((hit) => {
        if (!hit.employer?.name) return;
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

  const relevant = ads.filter((ad) =>
    [...AI_REPLACEABLE_ROLES].some((r) =>
      (ad.title + ad.desc).toLowerCase().includes(r),
    ),
  );
  const limit = opts.limit ?? 10;
  return relevant.slice(0, limit).map((ad) => ({
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

  const ads: JobAd[] = [];
  for (const role of roles) {
    try {
      const url = `https://jobsearch.api.jobtechdev.se/search?q=${encodeURIComponent(role)}&limit=5`;
      const res = await fetchWithRetry(url, { headers: { accept: "application/json" } });
      const data = (await res.json()) as JobtechResponse;
      (data?.hits ?? []).forEach((hit) => {
        if (!hit.employer?.name) return;
        // Skip staffing companies (they recruit for others, not themselves)
        const name = (hit.employer.name ?? "").toLowerCase();
        if (["adecco", "randstad", "manpower", "poolia", "academicwork", "academic work"].some(s => name.includes(s))) return;
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
}): Promise<ProspectSignal[]> {
  if (!opts.googleApiKey || !opts.googleCseId) return [];

  const queries: Array<{
    q: string;
    hint: ProspectSignal["suggested_offer_hint"];
    label: string;
  }> = [
    // Webb design — companies with poor digital presence
    {
      q: 'advokatbyrå Sverige hemsida kontakt "om oss"',
      hint: "webb_design",
      label: "Advokatbyrå med enkel hemsida",
    },
    {
      q: 'redovisningsbyrå Sverige hemsida 10-30 anställda',
      hint: "webb_design",
      label: "Redovisningsbyrå utan modern hemsida",
    },
    {
      q: 'byggföretag Sverige "kontakta oss" hemsida',
      hint: "webb_design",
      label: "Byggföretag med enkel hemsida",
    },
    // App development — scaling companies that need custom solutions
    {
      q: 'startup Sverige "vi söker" "product owner" OR "produktägare" 2024 OR 2025',
      hint: "app_development",
      label: "Startup som skalar produktteam",
    },
    {
      q: 'scaleup Stockholm digital transformation "system" OR "plattform"',
      hint: "app_development",
      label: "Scaleup med digital transformationsplan",
    },
    // Agent platform — agencies and consulting firms
    {
      q: 'rekryteringsbolag Sverige 10-50 anställda processer administration',
      hint: "agent_platform",
      label: "Rekryteringsbolag med manuella processer",
    },
    {
      q: 'konsultbolag Stockholm "projektledning" OR "bemanning" 20-100 anställda',
      hint: "agent_platform",
      label: "Konsultbolag med manuell administration",
    },
    // AI automation — companies with manual admin processes
    {
      q: 'fastighetsbolag Sverige administration "ekonomiavdelning" OR "backoffice"',
      hint: "ai_automation",
      label: "Fastighetsbolag med tung administration",
    },
    // Hitta.se — companies listed in directory, likely without own website
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
      q: "site:hitta.se byggföretag stockholm OR göteborg",
      hint: "webb_design",
      label: "Byggföretag listad på hitta.se",
    },
    {
      q: "site:hitta.se konsultbolag 10-50 anställda",
      hint: "agent_platform",
      label: "Konsultbolag listad på hitta.se",
    },
    {
      q: "site:hitta.se städbolag OR städfirma",
      hint: "webb_design",
      label: "Städbolag utan hemsida",
    },
  ];

  type Candidate = {
    title: string;
    snippet: string;
    link: string;
    hint: ProspectSignal["suggested_offer_hint"];
    label: string;
  };

  const candidates: Candidate[] = [];
  for (const { q, hint, label } of queries) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${opts.googleApiKey}&cx=${opts.googleCseId}&q=${encodeURIComponent(q)}&num=3&lr=lang_sv`;
      const res = await fetchWithRetry(url);
      const data = (await res.json()) as {
        items?: Array<{ title: string; snippet: string; link: string }>;
      };
      (data.items ?? []).forEach((item) =>
        candidates.push({ title: item.title, snippet: item.snippet, link: item.link, hint, label }),
      );
      await sleep(500);
    } catch (e) {
      console.warn("Google CSE failed:", (e as Error).message);
    }
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
  contact_emails: string[];
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
      signal: AbortSignal.timeout(6000),
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

function extractContactNames(text: string): string[] {
  const names: string[] = [];
  const SWEDISH_NAME = "[A-ZÅÄÖ][a-zåäö]+(?:\\s+[A-ZÅÄÖ][a-zåäö]+)+";
  const rolePattern = new RegExp(
    `(?:vd|ceo|grundare|partner|ansvarig|ägare|direktör|chef)\\s*[:\\-–]\\s*(${SWEDISH_NAME})`,
    "gi",
  );
  for (const m of text.matchAll(rolePattern)) {
    if (m[1]) names.push(m[1].trim());
  }
  // Name immediately before an @ email
  const beforeEmail = new RegExp(`(${SWEDISH_NAME})\\s*[<(]?\\s*[a-zA-Z0-9._%+\\-]+@`, "g");
  for (const m of text.matchAll(beforeEmail)) {
    if (m[1]) names.push(m[1].trim());
  }
  return [...new Set(names)].slice(0, 3);
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
    contact_names: [],
    key_facts: [],
  };

  // --- Step 1: Fetch company website ---
  const urlsToTry = [
    `https://${domain}`,
    `https://www.${domain}`,
    `https://${domain}/kontakt`,
    `https://${domain}/om-oss`,
    `https://${domain}/contact`,
    `https://${domain}/about`,
  ];

  let foundEmails = false;
  for (const url of urlsToTry) {
    const html = await fetchPageSilent(url);
    if (!html) continue;

    const emails = extractEmails(html, domain);
    if (emails.length) {
      result.contact_emails.push(...emails);
      foundEmails = true;
    }

    // Meta description (first page only)
    if (!result.website_description) {
      const desc =
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,250})["']/i)?.[1] ??
        html.match(/<meta[^>]+content=["']([^"']{10,250})["'][^>]+name=["']description["']/i)?.[1];
      if (desc) {
        result.website_description = desc.trim();
        result.key_facts.push(`Hemsidebeskrivning: ${desc.trim().substring(0, 150)}`);
      }
    }

    // Extract contact names from stripped text
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const names = extractContactNames(text);
    result.contact_names.push(...names);

    if (foundEmails && result.contact_names.length > 0) break;
    await sleep(800);
  }

  // --- Step 2: Allabolag search for company facts ---
  try {
    const searchUrl = `https://www.allabolag.se/what/${encodeURIComponent(opts.companyName)}`;
    const html = await fetchPageSilent(searchUrl);
    if (html) {
      const orgText = html.match(/(\d{6}-\d{4})/)?.[1];
      if (orgText) {
        result.org_number = orgText;
        result.key_facts.push(`Org.nr: ${orgText}`);
      }
      const empText =
        (html.match(/(\d+[\s–\-]+\d+)\s+anst/i) ?? html.match(/anst[^<>]{0,20}(\d+)/i))?.[1];
      if (empText) {
        result.employees = empText;
        result.key_facts.push(`Anställda: ${empText}`);
      }
      const revMatch = html.match(
        /omsättning[^<>]{0,60}([\d\s.,]+(?:tkr|mnkr|mkr|msek|ksek|kr))/i,
      );
      const revText = revMatch?.[1];
      if (revText) {
        result.revenue = revText.trim();
        result.key_facts.push(`Omsättning: ${revText.trim()}`);
      }
    }
    await sleep(1500);
  } catch {
    // Allabolag is optional enrichment
  }

  // Deduplicate
  result.contact_emails = [...new Set(result.contact_emails)];
  result.contact_names = [...new Set(result.contact_names)];

  return result;
}
