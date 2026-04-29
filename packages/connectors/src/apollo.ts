/**
 * Apollo.io connector for WKIT sales agent.
 *
 * Credit usage:
 *   - searchCompanies / searchDecisionMaker  → FREE (no credits consumed)
 *   - enrichPersonEmail                      → 1 credit per matched person
 *
 * Keep enrichPersonEmail calls to a minimum — only when scraping found
 * no contact_emails and no email_candidates.
 */

import type { ProspectSignal } from "./prospecting.js";

const BASE = "https://api.apollo.io/api/v1";

// ------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------

async function apolloPost(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Apollo v1 API accepts the key both as header and in the body.
  // Include it in both places for maximum compatibility.
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({ api_key: apiKey, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Apollo ${path}: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

type ApolloOrg = {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  short_description?: string;
  city?: string;
  country?: string;
  founded_year?: number;
  linkedin_url?: string;
  latest_funding_round_date?: string;
  latest_funding_stage?: string;
  keywords?: string[];
};

type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  organization_name?: string;
  linkedin_url?: string;
  city?: string;
};

// ------------------------------------------------------------
// SOURCE A — Companies without websites in Sweden (FREE)
// ------------------------------------------------------------
export async function searchNoWebsiteCompanies(opts: {
  apiKey: string;
  limit?: number;
}): Promise<ProspectSignal[]> {
  // Industries that commonly lack websites — good webb_design targets.
  // q_organization_keyword_tags works on free tier; q_organization_job_titles does NOT.
  const data = await apolloPost(opts.apiKey, "/mixed_companies/search", {
    organization_locations: ["Sweden"],
    organization_num_employees_ranges: ["1,9", "10,49"],
    q_organization_keyword_tags: [
      "construction", "accounting", "legal services",
      "restaurants", "beauty", "cleaning services",
      "real estate", "architecture",
    ],
    per_page: 100,
    page: 1,
  });

  const orgs = (data["organizations"] ?? []) as ApolloOrg[];

  return orgs
    .filter((o) => !o.website_url || o.website_url.trim() === "")
    .slice(0, opts.limit ?? 10)
    .map((o): ProspectSignal => ({
      source: "digital_presence",
      company_name: o.name ?? "",
      signals: [
        "Ingen webbplats registrerad i Apollo",
        `Bransch: ${o.industry ?? "okänd"}`,
        o.city ? `Ort: ${o.city}` : "",
        o.estimated_num_employees ? `Anställda: ~${o.estimated_num_employees}` : "",
      ].filter(Boolean),
      suggested_offer_hint: "webb_design",
      extra: {
        apollo_id: o.id,
        primary_domain: o.primary_domain,
        industry: o.industry,
        employees: o.estimated_num_employees,
        linkedin_url: o.linkedin_url,
      },
    }));
}

// ------------------------------------------------------------
// SOURCE B — ICP companies by industry keyword (FREE)
// q_organization_job_titles and latest_funding_date_range require
// paid Apollo plan. Only q_organization_keyword_tags works on free tier.
// ------------------------------------------------------------
export type ApolloSignalType =
  | "ai_automation"
  | "app_development"
  | "agent_platform"
  | "webb_design";

// Each entry is one keyword group → one Apollo call → at most SLOTS_PER_GROUP results.
// Splitting by group prevents any single high-density category (e.g. staffing/recruitment)
// from flooding the full result set.
const SIGNAL_CONFIGS: Array<{
  // Each inner array becomes a separate Apollo call.
  keywordGroups: string[][];
  offer: ApolloSignalType;
  label: string;
}> = [
  {
    keywordGroups: [
      ["accounting", "bookkeeping"],
      ["logistics", "supply chain", "transportation"],
      ["manufacturing", "industrial"],
      ["real estate", "property management", "facilities services"],
    ],
    offer: "ai_automation",
    label: "Bransch med tung manuell administration → behov av AI-automation",
  },
  {
    keywordGroups: [
      ["software", "saas", "mobile apps"],
      ["ecommerce", "retail technology"],
      ["fintech", "payments"],
      ["startup", "scaleup"],
    ],
    offer: "app_development",
    label: "Tech/startup-bolag som skalar → behov av apputveckling",
  },
  {
    keywordGroups: [
      ["information technology", "it services"],
      ["consulting", "management consulting"],
      ["staffing", "recruitment"],
      ["marketing and advertising", "public relations", "digital marketing"],
    ],
    offer: "agent_platform",
    label: "IT-konsultbolag / digital byrå → prime target för agent_platform",
  },
];

// How many results to take from each keyword group call.
const SLOTS_PER_GROUP = 3;

export async function searchCompaniesWithSignal(opts: {
  apiKey: string;
  signalType: ApolloSignalType;
  limit?: number;
}): Promise<ProspectSignal[]> {
  const config = SIGNAL_CONFIGS.find((c) => c.offer === opts.signalType);
  if (!config) return [];

  const seen = new Set<string>();
  const results: ProspectSignal[] = [];

  for (const keywords of config.keywordGroups) {
    if (results.length >= (opts.limit ?? 12)) break;

    let data: Record<string, unknown>;
    try {
      data = await apolloPost(opts.apiKey, "/mixed_companies/search", {
        organization_locations: ["Sweden"],
        organization_num_employees_ranges: ["10,49", "50,199"],
        q_organization_keyword_tags: keywords,
        per_page: SLOTS_PER_GROUP * 3, // fetch a few extra in case of dupes
        page: 1,
      });
    } catch {
      continue; // skip this group on error, try next
    }

    const orgs = (data["organizations"] ?? []) as ApolloOrg[];
    let taken = 0;

    for (const o of orgs) {
      if (taken >= SLOTS_PER_GROUP) break;
      const key = o.id ?? o.name ?? "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      taken++;

      results.push({
        source: "digital_presence",
        company_name: o.name ?? "",
        signals: [
          config.label,
          `Bransch: ${o.industry ?? "okänd"}`,
          o.city ? `Ort: ${o.city}` : "",
          o.estimated_num_employees ? `Anställda: ~${o.estimated_num_employees}` : "",
          o.short_description ? `Beskrivning: ${o.short_description.slice(0, 120)}` : "",
        ].filter(Boolean),
        suggested_offer_hint: config.offer,
        extra: {
          apollo_id: o.id,
          primary_domain: o.primary_domain,
          website_url: o.website_url,
          industry: o.industry,
          employees: o.estimated_num_employees,
          linkedin_url: o.linkedin_url,
        },
      });
    }
  }

  return results.slice(0, opts.limit ?? 12);
}

// Recently funded — latest_funding_date_range requires paid plan.
// Replaced with tech/startup keyword search as proxy for growth-stage companies.
export async function searchRecentlyFundedCompanies(opts: {
  apiKey: string;
  limit?: number;
}): Promise<ProspectSignal[]> {
  const data = await apolloPost(opts.apiKey, "/mixed_companies/search", {
    organization_locations: ["Sweden"],
    organization_num_employees_ranges: ["10,49", "50,199"],
    q_organization_keyword_tags: ["venture capital", "seed funding", "series a", "startup", "growth", "scaleup"],
    per_page: Math.min(opts.limit ?? 15, 100),
    page: 1,
  });

  const orgs = (data["organizations"] ?? []) as ApolloOrg[];

  return orgs.slice(0, opts.limit ?? 8).map((o): ProspectSignal => ({
    source: "funding_news",
    company_name: o.name ?? "",
    signals: [
      "Startup/scaleup med tillväxtsignal — sannolikt behov av digital produkt",
      `Bransch: ${o.industry ?? "okänd"}`,
      o.city ? `Ort: ${o.city}` : "",
      o.estimated_num_employees ? `Anställda: ~${o.estimated_num_employees}` : "",
    ].filter(Boolean),
    suggested_offer_hint: "app_development",
    extra: {
      apollo_id: o.id,
      primary_domain: o.primary_domain,
      website_url: o.website_url,
    },
  }));
}


// ------------------------------------------------------------
// ENRICHMENT A — Find decision maker name (FREE)
// Returns VD/founder name + title without spending any credits.
// ------------------------------------------------------------
export type DecisionMaker = {
  name: string;
  first_name: string;
  last_name: string;
  title: string;
  apollo_id: string;
  linkedin_url?: string;
};

export async function findDecisionMaker(opts: {
  apiKey: string;
  domain: string;
  companyName: string;
}): Promise<DecisionMaker | null> {
  // /mixed_people/search is deprecated — use /mixed_people/api_search instead.
  const data = await apolloPost(opts.apiKey, "/mixed_people/api_search", {
    q_organization_domains_list: [opts.domain],
    person_seniorities: ["owner", "founder", "c_suite", "partner"],
    person_titles: ["vd", "ceo", "grundare", "ägare", "verkställande direktör", "chief executive"],
    per_page: 5,
    page: 1,
  });

  const people = (data["people"] ?? []) as ApolloPerson[];
  if (people.length === 0) return null;

  const p = people[0]!;
  if (!p.first_name || !p.last_name) return null;

  return {
    name: p.name ?? `${p.first_name} ${p.last_name}`,
    first_name: p.first_name,
    last_name: p.last_name,
    title: p.title ?? "",
    apollo_id: p.id ?? "",
    linkedin_url: p.linkedin_url,
  };
}

// ------------------------------------------------------------
// ENRICHMENT B — Email enrichment (COSTS 1 CREDIT)
// Only call this when scraping found no contact_emails and no
// email_candidates. The caller is responsible for confirming
// credit usage before calling.
// ------------------------------------------------------------
export type EnrichedContact = {
  email: string | null;
  email_status: string | null;
  credits_used: number;
};

export async function enrichPersonEmail(opts: {
  apiKey: string;
  firstName: string;
  lastName: string;
  domain: string;
  apolloId?: string;
}): Promise<EnrichedContact> {
  const body: Record<string, unknown> = {
    first_name: opts.firstName,
    last_name: opts.lastName,
    domain: opts.domain,
    reveal_personal_emails: false,
  };
  if (opts.apolloId) body["id"] = opts.apolloId;

  const data = await apolloPost(opts.apiKey, "/people/match", body);
  const person = (data["person"] ?? {}) as ApolloPerson;

  return {
    email: person.email ?? null,
    email_status: person.email_status ?? null,
    credits_used: person.email ? 1 : 0,
  };
}
