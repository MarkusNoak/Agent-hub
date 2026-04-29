/**
 * Google Places API (New) connector — primary source for webb_design leads.
 *
 * Searches Swedish businesses by category + city and returns those without
 * a registered website. No scraping, not blocked, low cost (~$5/1000 calls).
 *
 * Cost: Text Search = $0.032/request (free tier: $200/month credit)
 */

import type { ProspectSignal } from "./prospecting.js";

const BASE = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.primaryTypeDisplayName",
  "places.rating",
  "places.userRatingCount",
  "places.types",
].join(",");

// Business categories likely to lack a website — prime webb_design targets.
const WEBB_CATEGORIES = [
  "restaurang",
  "frisör",
  "elektriker",
  "rörmokare",
  "målare",
  "städfirma",
  "bilverkstad",
  "konditori",
  "café",
  "trädgårdsservice",
  "byggfirma",
  "snickare",
  "florist",
  "skomakeriet",
  "bageri",
  "fastighetsmäklare",
  "advokatbyrå",
  "redovisningsbyrå",
  "tandläkare",
  "optiker",
];

const SWEDISH_CITIES = [
  "Stockholm", "Göteborg", "Malmö", "Uppsala", "Västerås",
  "Örebro", "Linköping", "Helsingborg", "Jönköping", "Norrköping",
  "Lund", "Umeå", "Gävle", "Borås", "Karlstad",
  "Växjö", "Halmstad", "Sundsvall", "Östersund", "Trollhättan",
  "Falun", "Skövde", "Kalmar", "Kristianstad", "Södertälje",
];

type PlaceResult = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
};

async function searchPlaces(
  apiKey: string,
  query: string,
): Promise<PlaceResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (globalThis as any).fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "sv",
      regionCode: "SE",
      maxResultCount: 20,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signal: (globalThis as any).AbortSignal.timeout(10_000),
  }) as { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> };

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google Places "${query}": HTTP ${res.status} ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as { places?: PlaceResult[] };
  return data.places ?? [];
}

// ------------------------------------------------------------
// PRIMARY — companies without a website (webb_design leads)
// ------------------------------------------------------------
export async function searchPlacesNoWebsite(opts: {
  apiKey: string;
  limit?: number;
  cityOverride?: string;
}): Promise<ProspectSignal[]> {
  const limit = opts.limit ?? 15;
  const seen = new Set<string>();
  const results: ProspectSignal[] = [];

  // Rotate through a deterministic but varied set of category+city pairs.
  const hour = new Date().getHours();
  const day = new Date().getDay();
  const cityOffset = (day * 7 + hour) % SWEDISH_CITIES.length;
  const catOffset = (day * 3 + hour) % WEBB_CATEGORIES.length;

  const cities = opts.cityOverride
    ? [opts.cityOverride]
    : [
        SWEDISH_CITIES[cityOffset % SWEDISH_CITIES.length]!,
        SWEDISH_CITIES[(cityOffset + 5) % SWEDISH_CITIES.length]!,
        SWEDISH_CITIES[(cityOffset + 11) % SWEDISH_CITIES.length]!,
      ];

  const categories = [
    WEBB_CATEGORIES[catOffset % WEBB_CATEGORIES.length]!,
    WEBB_CATEGORIES[(catOffset + 4) % WEBB_CATEGORIES.length]!,
    WEBB_CATEGORIES[(catOffset + 9) % WEBB_CATEGORIES.length]!,
    WEBB_CATEGORIES[(catOffset + 14) % WEBB_CATEGORIES.length]!,
  ];

  for (const city of cities) {
    for (const category of categories) {
      if (results.length >= limit) break;

      let places: PlaceResult[];
      try {
        places = await searchPlaces(opts.apiKey, `${category} ${city}`);
      } catch {
        continue;
      }

      for (const p of places) {
        if (results.length >= limit) break;

        // Skip if they already have a website.
        if (p.websiteUri) continue;

        const name = p.displayName?.text ?? "";
        if (!name) continue;

        // Deduplicate by place ID or name.
        const key = p.id ?? name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const categoryLabel = p.primaryTypeDisplayName?.text ?? category;
        const rating = p.rating;
        const reviews = p.userRatingCount ?? 0;

        results.push({
          source: "digital_presence",
          company_name: name,
          signals: [
            "Ingen webbplats registrerad i Google",
            `Kategori: ${categoryLabel}`,
            `Ort: ${city}`,
            p.formattedAddress ? `Adress: ${p.formattedAddress}` : "",
            rating ? `Google-betyg: ${rating} ⭐ (${reviews} recensioner)` : "",
            reviews < 10 ? "Få recensioner — svag digital närvaro" : "",
            p.nationalPhoneNumber ? `Tel: ${p.nationalPhoneNumber}` : "",
          ].filter(Boolean),
          suggested_offer_hint: "webb_design",
          extra: {
            place_id: p.id,
            address: p.formattedAddress,
            phone: p.nationalPhoneNumber,
            rating,
            review_count: reviews,
            category: categoryLabel,
            city,
          },
        });
      }
    }
    if (results.length >= limit) break;
  }

  return results;
}

// ------------------------------------------------------------
// SECONDARY — local businesses by category for other offer types
// (e.g. small tech firms, accounting firms for ai_automation)
// ------------------------------------------------------------
export async function searchPlacesByCategory(opts: {
  apiKey: string;
  queries: string[];   // e.g. ["redovisningsbyrå Stockholm", "logistikbolag Göteborg"]
  offerHint: ProspectSignal["suggested_offer_hint"];
  label: string;
  limit?: number;
}): Promise<ProspectSignal[]> {
  const limit = opts.limit ?? 10;
  const seen = new Set<string>();
  const results: ProspectSignal[] = [];

  for (const query of opts.queries) {
    if (results.length >= limit) break;

    let places: PlaceResult[];
    try {
      places = await searchPlaces(opts.apiKey, query);
    } catch {
      continue;
    }

    for (const p of places) {
      if (results.length >= limit) break;

      const name = p.displayName?.text ?? "";
      if (!name) continue;

      const key = p.id ?? name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        source: "digital_presence",
        company_name: name,
        signals: [
          opts.label,
          `Kategori: ${p.primaryTypeDisplayName?.text ?? ""}`,
          p.formattedAddress ? `Adress: ${p.formattedAddress}` : "",
          p.websiteUri ? `Webb: ${p.websiteUri}` : "Ingen webbplats",
          p.rating ? `Betyg: ${p.rating} ⭐ (${p.userRatingCount ?? 0} rec.)` : "",
          p.nationalPhoneNumber ? `Tel: ${p.nationalPhoneNumber}` : "",
        ].filter(Boolean),
        suggested_offer_hint: opts.offerHint,
        extra: {
          place_id: p.id,
          address: p.formattedAddress,
          phone: p.nationalPhoneNumber,
          website: p.websiteUri,
          rating: p.rating,
          review_count: p.userRatingCount,
        },
      });
    }
  }

  return results;
}
