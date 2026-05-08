/**
 * Prospect DB — Apollo light V1
 *
 * Persists company signals and enriched contacts between agent runs so that
 * research_company scraping is never repeated for a company we've already seen.
 *
 * Three public functions:
 *   upsertProspectCompany   — write a company from any signal source
 *   storeResearchResult     — persist research_company output for a company
 *   queryEnrichedCompanies  — return enriched, uncontacted companies for agent use
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProspectSignal, CompanyResearch } from "./prospecting.js";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type ProspectCompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  city: string | null;
  employees: number | null;
  source: string;
  suggested_offer: string | null;
  signals: string[];
  raw_extra: Record<string, unknown>;
  enrichment_status: "pending" | "enriched" | "failed";
  enriched_at: string | null;
  created_at: string;
};

export type ProspectContactRow = {
  id: string;
  company_id: string;
  name: string | null;
  title: string | null;
  email: string;
  email_verified: boolean;
  source: string;
};

export type EnrichedProspect = ProspectCompanyRow & {
  contacts: ProspectContactRow[];
};

// ------------------------------------------------------------
// upsertProspectCompany
// Upserts on (tenant_id, domain). Returns the company id.
// For no-domain companies, always inserts a new row.
// ------------------------------------------------------------

export async function upsertProspectCompany(
  supa: SupabaseClient,
  tenantId: string,
  signal: ProspectSignal & { domain?: string },
): Promise<string | null> {
  const domain = signal.domain ?? signal.extra?.["primary_domain"] as string | undefined
    ?? signal.extra?.["website_url"] as string | undefined;

  // Normalise domain — strip protocol/path, lowercase
  const normDomain = domain
    ? domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase().trim() || null
    : null;

  const row = {
    tenant_id: tenantId,
    name: signal.company_name,
    domain: normDomain,
    industry: signal.extra?.["industry"] as string | null ?? null,
    city: signal.extra?.["city"] as string | null ?? null,
    employees: signal.extra?.["employees"] as number | null ?? null,
    source: signal.source,
    suggested_offer: signal.suggested_offer_hint ?? null,
    signals: signal.signals,
    raw_extra: signal.extra ?? {},
    updated_at: new Date().toISOString(),
  };

  if (normDomain) {
    // Upsert on unique (tenant_id, domain) index
    const { data, error } = await supa
      .from("prospect_companies")
      .upsert(row, { onConflict: "tenant_id,domain", ignoreDuplicates: false })
      .select("id")
      .single();
    if (error) return null;
    return (data as { id: string }).id;
  } else {
    // No domain — check by name to avoid duplicates within recent window
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data: existing } = await supa
      .from("prospect_companies")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", signal.company_name)
      .is("domain", null)
      .gte("created_at", since)
      .maybeSingle();
    if (existing) return (existing as { id: string }).id;

    const { data, error } = await supa
      .from("prospect_companies")
      .insert(row)
      .select("id")
      .single();
    if (error) return null;
    return (data as { id: string }).id;
  }
}

// ------------------------------------------------------------
// storeResearchResult
// Saves the output of research_company for a prospect_company row.
// Sets enrichment_status = 'enriched' (or 'failed' if no contacts found).
// Idempotent — re-running won't create duplicate contacts.
// ------------------------------------------------------------

export async function storeResearchResult(
  supa: SupabaseClient,
  tenantId: string,
  companyId: string,
  research: CompanyResearch,
): Promise<void> {
  // Collect all contacts to store: scraped personal emails first, then generated candidates
  type ContactInput = { email: string; name?: string; title?: string; source: string };
  const contacts: ContactInput[] = [];

  for (const email of research.contact_emails) {
    contacts.push({ email: email.toLowerCase(), name: research.vd_name ?? undefined, source: "website_scrape" });
  }
  for (const email of research.email_candidates) {
    // generated candidates — not verified
    contacts.push({ email: email.toLowerCase(), name: research.vd_name ?? undefined, source: "generated" });
  }

  // Upsert contacts — ignore conflicts on (tenant_id, lower(email))
  if (contacts.length > 0) {
    const rows = contacts.map((c) => ({
      tenant_id: tenantId,
      company_id: companyId,
      name: c.name ?? null,
      title: null,
      email: c.email,
      email_verified: false,
      source: c.source,
    }));
    await supa
      .from("prospect_contacts")
      .upsert(rows, { onConflict: "tenant_id,lower(email)", ignoreDuplicates: true });
  }

  // Fetch current raw_extra and merge in research fields
  const extra: Record<string, unknown> = {};
  if (research.vd_name) extra["vd_name"] = research.vd_name;
  if (research.org_number) extra["org_number"] = research.org_number;
  if (research.revenue) extra["revenue"] = research.revenue;
  if (research.address) extra["address"] = research.address;
  if (research.key_facts?.length) extra["key_facts"] = research.key_facts;

  const { data: current } = await supa
    .from("prospect_companies")
    .select("raw_extra")
    .eq("id", companyId)
    .eq("tenant_id", tenantId)
    .single();

  const merged = {
    ...((current as { raw_extra: Record<string, unknown> } | null)?.raw_extra ?? {}),
    ...extra,
  };

  await supa
    .from("prospect_companies")
    .update({
      enrichment_status: contacts.length > 0 ? "enriched" : "failed",
      enriched_at: new Date().toISOString(),
      raw_extra: merged,
    })
    .eq("id", companyId)
    .eq("tenant_id", tenantId);
}

// ------------------------------------------------------------
// queryEnrichedCompanies
// Returns enriched prospect_companies with their contacts,
// excluding companies already in the leads blocklist.
// ------------------------------------------------------------

export async function queryEnrichedCompanies(
  supa: SupabaseClient,
  tenantId: string,
  opts: {
    offer?: string;
    limit?: number;
    excludeDomains?: string[];
  } = {},
): Promise<EnrichedProspect[]> {
  const limit = opts.limit ?? 20;

  let query = supa
    .from("prospect_companies")
    .select(`
      id, name, domain, industry, city, employees,
      source, suggested_offer, signals, raw_extra,
      enrichment_status, enriched_at, created_at,
      prospect_contacts ( id, company_id, name, title, email, email_verified, source )
    `)
    .eq("tenant_id", tenantId)
    .eq("enrichment_status", "enriched")
    .order("enriched_at", { ascending: false })
    .limit(limit);

  if (opts.offer) {
    query = query.eq("suggested_offer", opts.offer);
  }

  if (opts.excludeDomains && opts.excludeDomains.length > 0) {
    query = query.not("domain", "in", `(${opts.excludeDomains.map((d) => `"${d}"`).join(",")})`);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as Array<ProspectCompanyRow & { prospect_contacts: ProspectContactRow[] }>).map((row) => ({
    ...row,
    signals: Array.isArray(row.signals) ? row.signals as string[] : [],
    contacts: row.prospect_contacts ?? [],
  }));
}
