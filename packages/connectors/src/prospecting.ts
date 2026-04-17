/**
 * Free prospecting sources — zero paid APIs.
 *
 * 1. RSS (Breakit / DI / ComputerSweden) — funding + growth news
 * 2. Allabolag.se scrape           — SNI + size ICP filter
 * 3. Arbetsförmedlingen Jobs API   — open gov data, AI-replaceable roles
 * 4. Google Custom Search          — 100 free queries/day (optional)
 * 5. Visma upsell interim table    — existing customers 14-60 days post-delivery
 *
 * Based on the WKIT Sales Agent v2 by Markus Noaksson. Converted to
 * a reusable connector so Agent Hub's Sales Agent can call each source
 * as a tool without leaking paid-API assumptions.
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
// SOURCE 1 — Breakit / DI / ComputerSweden RSS
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

export async function fetchFundingNews(opts: { limit?: number } = {}): Promise<
  ProspectSignal[]
> {
  const feeds = [
    "https://breakit.se/feed/rss",
    "https://www.di.se/rss",
    "https://computersweden.idg.se/2.2683/rss.xml",
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
          items.push({
            title,
            desc,
            link,
            source: new URL(feed).hostname,
          });
        }
      }
    } catch (e) {
      console.warn(`RSS feed failed (${feed}):`, (e as Error).message);
    }
  }

  const relevant = items.filter((i) =>
    FUNDING_KEYWORDS.some((k) => (i.title + i.desc).toLowerCase().includes(k)),
  );

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
// SOURCE 2 — Allabolag.se SNI + size filter
// ------------------------------------------------------------

export async function scrapeAllabolag(opts: { limit?: number } = {}): Promise<
  ProspectSignal[]
> {
  // SNI codes: IT consulting, e-commerce, real estate, R&D consulting
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
// SOURCE 3 — Arbetsförmedlingen Jobs API (100% free, government data)
// ------------------------------------------------------------

export async function fetchAiReplaceableJobs(
  opts: { limit?: number } = {},
): Promise<ProspectSignal[]> {
  const roles = [
    "ekonomiassistent",
    "löneadministratör",
    "orderadministratör",
    "kundtjänst administratör",
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
      const data = (await res.json()) as {
        hits?: { hits?: Array<{ _source?: Record<string, unknown> }> };
      };
      (data?.hits?.hits ?? []).forEach((hit) => {
        const src = (hit._source ?? {}) as Record<string, unknown>;
        const employer = src["employer"] as { name?: string } | undefined;
        const workplace = src["workplace_address"] as { municipality?: string } | undefined;
        const description = src["description"] as { text?: string } | undefined;
        if (!employer?.name) return;
        ads.push({
          company: employer.name,
          title: (src["headline"] as string) ?? role,
          desc: description?.text?.substring(0, 300) ?? "",
          location: workplace?.municipality ?? "Sverige",
          role,
        });
      });
      await sleep(600);
    } catch (e) {
      console.warn(`Jobs API failed (${role}):`, (e as Error).message);
    }
  }

  const relevant = ads.filter((ad) =>
    AI_REPLACEABLE_ROLES.some((r) =>
      (ad.title + ad.desc).toLowerCase().includes(r),
    ),
  );
  const limit = opts.limit ?? 8;
  return relevant.slice(0, limit).map((ad) => ({
    source: "job_signal",
    company_name: ad.company,
    signals: [
      `Söker rollen: "${ad.title}"`,
      `Ort: ${ad.location}`,
      `Rollbeskrivning: ${ad.desc}`,
    ],
    suggested_offer_hint: "ai_automation",
    extra: { role: ad.role },
  }));
}

// ------------------------------------------------------------
// SOURCE 4 — Google Custom Search (100 free queries/day)
// ------------------------------------------------------------

export async function searchWeakDigitalPresence(opts: {
  googleApiKey?: string;
  googleCseId?: string;
  limit?: number;
}): Promise<ProspectSignal[]> {
  if (!opts.googleApiKey || !opts.googleCseId) return [];

  const queries = [
    'konsultbolag Sverige "kontakta oss" -hemsida 10-50 anställda',
    "fastighetsbolag Sverige site:hitta.se",
    "byggföretag Sverige 20-80 anställda hemsida",
  ];

  type Candidate = { title: string; snippet: string; link: string };
  const candidates: Candidate[] = [];
  for (const q of queries) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${opts.googleApiKey}&cx=${opts.googleCseId}&q=${encodeURIComponent(q)}&num=5&lr=lang_sv`;
      const res = await fetchWithRetry(url);
      const data = (await res.json()) as {
        items?: Array<{ title: string; snippet: string; link: string }>;
      };
      (data.items ?? []).forEach((item) =>
        candidates.push({
          title: item.title,
          snippet: item.snippet,
          link: item.link,
        }),
      );
      await sleep(500);
    } catch (e) {
      console.warn("Google CSE failed:", (e as Error).message);
    }
  }

  const limit = opts.limit ?? 6;
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
             "Funnen via Google med låg digital närvaro",
             `Snippet: ${c.snippet}`,
             `URL: ${c.link}`,
           ],
           suggested_offer_hint: "webb_design",
           extra: { link: c.link },
         };
       })
    .filter((x): x is ProspectSignal => x !== null);
}

// ------------------------------------------------------------
// SOURCE 5 — Visma upsell (interim table)
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
      suggested_offer_hint: "ai_automation" as const,
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
