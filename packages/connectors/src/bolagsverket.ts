/**
 * Bolagsverket "Värdefulla Datamängder" API connector.
 * Free tier — requires Client ID + Client Secret from bolagsverket.se/apierochoppnadata
 *
 * Gives: company name, org number, address, SNI industry codes.
 * Does NOT give employee count on free tier (use Proff.se enrichment for that).
 */

import type { ProspectSignal } from "./prospecting.js";

const TOKEN_URL = "https://auth.bolagsverket.se/realms/bolagsverket/protocol/openid-connect/token";
const API_BASE  = "https://api.bolagsverket.se/vardefulladatamangder/v1";

// SNI codes mapped to offer types.
// Source: https://www.scb.se/en/documentation/classifications-and-standards/swedish-standard-industrial-classification-sni/
const SNI_TARGETS: Array<{
  sni: string;         // 2–5 digit prefix
  label: string;
  offer: ProspectSignal["suggested_offer_hint"];
}> = [
  // ai_automation targets — heavy manual admin
  { sni: "6920", label: "Redovisnings- och bokföringsbyrå",        offer: "ai_automation" },
  { sni: "6910", label: "Juridisk verksamhet / advokatbyrå",       offer: "ai_automation" },
  { sni: "4941", label: "Godstransport på väg / åkeri",            offer: "ai_automation" },
  { sni: "5210", label: "Lagring och magasinering",                offer: "ai_automation" },
  { sni: "4110", label: "Fastighetsbolag",                         offer: "ai_automation" },
  { sni: "8121", label: "Städbolag",                               offer: "ai_automation" },
  { sni: "2561", label: "Ytbehandling av metaller / tillverkning", offer: "ai_automation" },

  // app_development targets — scaling / tech adjacent
  { sni: "6201", label: "Dataprogrammering / mjukvaruutveckling",  offer: "app_development" },
  { sni: "6202", label: "IT-konsultverksamhet",                    offer: "app_development" },
  { sni: "7311", label: "Reklam- och kommunikationsbyrå",          offer: "app_development" },
  { sni: "4791", label: "Postorderhandel / e-handel",              offer: "app_development" },

  // agent_platform targets — consulting firms that need internal automation
  { sni: "7022", label: "Managementkonsult",                       offer: "agent_platform" },
  { sni: "7810", label: "Rekrytering och bemanning",               offer: "agent_platform" },
  { sni: "7320", label: "Marknads- och opinionsundersökning",      offer: "agent_platform" },
  { sni: "6203", label: "Datordrifttjänster / IT-outsourcing",     offer: "agent_platform" },
];

// Swedish county codes (län) for geographic filtering.
const LAN_CODES: Record<string, string> = {
  "Stockholm":     "01",
  "Uppsala":       "03",
  "Södermanland":  "04",
  "Östergötland":  "05",
  "Jönköping":     "06",
  "Kronoberg":     "07",
  "Kalmar":        "08",
  "Gotland":       "09",
  "Blekinge":      "10",
  "Skåne":         "12",
  "Halland":       "13",
  "Västra Götaland": "14",
  "Värmland":      "17",
  "Örebro":        "18",
  "Västmanland":   "19",
  "Dalarna":       "20",
  "Gävleborg":     "21",
  "Västernorrland":"22",
  "Jämtland":      "23",
  "Västerbotten":  "24",
  "Norrbotten":    "25",
};

type BVToken = { access_token: string; expires_in: number };
type BVCompany = {
  organisationsnummer?: string;
  foretagsnamn?: string;
  adress?: { gatuadress?: string; postnummer?: string; postort?: string };
  sniKoder?: Array<{ sniKod?: string; sniBenamning?: string }>;
  juridiskForm?: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.value;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const res = await g.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new (g.URLSearchParams as new (init?: Record<string, string>) => { toString: () => string })({
      grant_type:    "client_credentials",
      client_id:     clientId,
      client_secret: clientSecret,
    }).toString(),
    signal: g.AbortSignal.timeout(10_000),
  }) as { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> };

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Bolagsverket token: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = await res.json() as BVToken;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function bvGet(token: string, path: string): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const res = await g.fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: g.AbortSignal.timeout(10_000),
  }) as { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> };
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Bolagsverket ${path}: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// ------------------------------------------------------------
// Main export — search by SNI code
// ------------------------------------------------------------
export async function searchBolagsverketBySni(opts: {
  clientId: string;
  clientSecret: string;
  offer: ProspectSignal["suggested_offer_hint"];
  lan?: string;   // County name, e.g. "Stockholm"
  limit?: number;
}): Promise<ProspectSignal[]> {
  const limit = Math.min(opts.limit ?? 10, 10);
  const targets = SNI_TARGETS.filter((t) => t.offer === opts.offer);
  if (!targets.length) return [];

  let token: string;
  try {
    token = await getToken(opts.clientId, opts.clientSecret);
  } catch (e) {
    throw new Error(`Bolagsverket auth failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const lanKod = opts.lan ? LAN_CODES[opts.lan] : undefined;
  const seen = new Set<string>();
  const results: ProspectSignal[] = [];

  // Rotate through SNI targets so different codes get coverage each run.
  const dayOffset = new Date().getDay() * 3;
  const orderedTargets = [
    ...targets.slice(dayOffset % targets.length),
    ...targets.slice(0, dayOffset % targets.length),
  ];

  for (const target of orderedTargets) {
    if (results.length >= limit) break;

    let companies: BVCompany[] = [];
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qs = new (globalThis as any).URLSearchParams({ sniKod: target.sni, antal: "20" }) as { set: (k: string, v: string) => void; toString: () => string };
      if (lanKod) qs.set("lan", lanKod);
      const data = await bvGet(token, `/foretag?${qs.toString()}`) as { foretag?: BVCompany[] };
      companies = data.foretag ?? [];
    } catch {
      continue;
    }

    for (const c of companies) {
      if (results.length >= limit) break;
      const name = c.foretagsnamn ?? "";
      const orgNr = c.organisationsnummer ?? "";
      if (!name || seen.has(orgNr || name)) continue;
      seen.add(orgNr || name);

      const city = c.adress?.postort ?? "";
      const address = [c.adress?.gatuadress, c.adress?.postnummer, city].filter(Boolean).join(", ");

      results.push({
        source: "digital_presence",
        company_name: name,
        signals: [
          target.label,
          city ? `Ort: ${city}` : "",
          orgNr ? `Org.nr: ${orgNr}` : "",
        ].filter(Boolean),
        suggested_offer_hint: opts.offer,
        extra: {
          org_number: orgNr,
          address,
          city,
          sni: target.sni,
          sni_label: target.label,
        },
      });
    }
  }

  return results;
}
