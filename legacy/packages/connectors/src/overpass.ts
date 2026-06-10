/**
 * OpenStreetMap / Overpass API connector — free, no API key, no billing.
 * Primary source for webb_design leads: local Swedish businesses without a website.
 *
 * Overpass API: https://overpass-api.de  (free, community-run, rate limit: ~10k req/day)
 */

import type { ProspectSignal } from "./prospecting.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// OSM tags that map well to WKIT's webb_design target audience.
// Each entry: [osm_key, osm_value, Swedish label]
const WEBB_TARGET_TYPES: Array<[string, string, string]> = [
  ["amenity",  "restaurant",    "Restaurang"],
  ["amenity",  "cafe",          "Café"],
  ["amenity",  "fast_food",     "Snabbmatsrestaurang"],
  ["shop",     "hairdresser",   "Frisör"],
  ["shop",     "beauty",        "Skönhetssalong"],
  ["craft",    "electrician",   "Elektriker"],
  ["craft",    "plumber",       "Rörmokare"],
  ["craft",    "painter",       "Målare"],
  ["craft",    "carpenter",     "Snickare"],
  ["craft",    "cleaning",      "Städfirma"],
  ["shop",     "bakery",        "Bageri"],
  ["shop",     "florist",       "Florist"],
  ["amenity",  "dentist",       "Tandläkare"],
  ["amenity",  "car_wash",      "Biltvätt"],
  ["shop",     "car_repair",    "Bilverkstad"],
  ["leisure",  "fitness_centre","Gym"],
  ["office",   "accountant",    "Redovisningsbyrå"],
  ["office",   "lawyer",        "Advokatbyrå"],
  ["amenity",  "childcare",     "Förskola/barnomsorg"],
  ["shop",     "garden_centre", "Trädgårdshandel"],
];

// Swedish cities with their bounding boxes [south, west, north, east].
const SWEDISH_CITIES: Array<{ name: string; bbox: [number, number, number, number] }> = [
  { name: "Stockholm",    bbox: [59.25, 17.85, 59.45, 18.15] },
  { name: "Göteborg",     bbox: [57.62, 11.85, 57.78, 12.05] },
  { name: "Malmö",        bbox: [55.54, 12.95, 55.64, 13.10] },
  { name: "Uppsala",      bbox: [59.82, 17.58, 59.92, 17.72] },
  { name: "Västerås",     bbox: [59.58, 16.47, 59.65, 16.61] },
  { name: "Örebro",       bbox: [59.24, 15.15, 59.32, 15.27] },
  { name: "Linköping",    bbox: [58.38, 15.55, 58.44, 15.66] },
  { name: "Helsingborg",  bbox: [56.01, 12.65, 56.08, 12.76] },
  { name: "Jönköping",    bbox: [57.74, 14.12, 57.81, 14.22] },
  { name: "Norrköping",   bbox: [58.57, 16.14, 58.63, 16.24] },
  { name: "Lund",         bbox: [55.68, 13.16, 55.73, 13.24] },
  { name: "Umeå",         bbox: [63.80, 20.20, 63.87, 20.35] },
  { name: "Gävle",        bbox: [60.65, 17.09, 60.72, 17.21] },
  { name: "Borås",        bbox: [57.70, 12.88, 57.76, 12.99] },
  { name: "Karlstad",     bbox: [59.36, 13.44, 59.42, 13.56] },
  { name: "Sundsvall",    bbox: [62.37, 17.28, 62.43, 17.40] },
  { name: "Växjö",        bbox: [56.86, 14.78, 56.92, 14.90] },
  { name: "Halmstad",     bbox: [56.65, 12.84, 56.71, 12.96] },
];

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

async function queryOverpass(ql: string): Promise<OsmElement[]> {
  const body = `data=${encodeURIComponent(ql)}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const res = await g.fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: g.AbortSignal.timeout(20_000),
  }) as { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> };
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}`);
  }
  const data = (await res.json()) as { elements?: OsmElement[] };
  return data.elements ?? [];
}

// ------------------------------------------------------------
// PRIMARY — local businesses without a website tag
// ------------------------------------------------------------
export async function searchOsmNoWebsite(opts: {
  limit?: number;
  cityOverride?: string;
}): Promise<ProspectSignal[]> {
  const limit = opts.limit ?? 15;
  const seen = new Set<number>();
  const results: ProspectSignal[] = [];

  // Deterministic rotation so each run covers different city+type combos.
  const day = new Date().getDay();
  const hour = new Date().getHours();
  const cityIdx = (day * 5 + Math.floor(hour / 4)) % SWEDISH_CITIES.length;
  const typeIdx = (day * 3 + hour) % WEBB_TARGET_TYPES.length;

  const cities = opts.cityOverride
    ? SWEDISH_CITIES.filter((c) => c.name === opts.cityOverride).slice(0, 1)
    : [
        SWEDISH_CITIES[cityIdx % SWEDISH_CITIES.length]!,
        SWEDISH_CITIES[(cityIdx + 6) % SWEDISH_CITIES.length]!,
        SWEDISH_CITIES[(cityIdx + 12) % SWEDISH_CITIES.length]!,
      ];

  const types = [
    WEBB_TARGET_TYPES[typeIdx % WEBB_TARGET_TYPES.length]!,
    WEBB_TARGET_TYPES[(typeIdx + 5) % WEBB_TARGET_TYPES.length]!,
    WEBB_TARGET_TYPES[(typeIdx + 10) % WEBB_TARGET_TYPES.length]!,
    WEBB_TARGET_TYPES[(typeIdx + 15) % WEBB_TARGET_TYPES.length]!,
  ];

  for (const city of cities) {
    for (const [osmKey, osmVal, label] of types) {
      if (results.length >= limit) break;

      const [s, w, n, e] = city.bbox;
      // Fetch nodes + ways of this type in the bounding box.
      const ql = `
[out:json][timeout:15];
(
  node["${osmKey}"="${osmVal}"](${s},${w},${n},${e});
  way["${osmKey}"="${osmVal}"](${s},${w},${n},${e});
);
out body center 30;`;

      let elements: OsmElement[];
      try {
        elements = await queryOverpass(ql);
      } catch {
        continue;
      }

      for (const el of elements) {
        if (results.length >= limit) break;
        const tags = el.tags ?? {};

        // Skip if they already have a website.
        if (tags["website"] || tags["contact:website"] || tags["url"]) continue;

        const name = tags["name"] ?? tags["operator"] ?? "";
        if (!name || name.length < 2) continue;
        if (seen.has(el.id)) continue;
        seen.add(el.id);

        const phone = tags["phone"] ?? tags["contact:phone"] ?? tags["contact:mobile"] ?? "";
        const addr = [
          tags["addr:street"] && tags["addr:housenumber"]
            ? `${tags["addr:street"]} ${tags["addr:housenumber"]}`
            : tags["addr:street"],
          tags["addr:postcode"],
          tags["addr:city"] ?? city.name,
        ]
          .filter(Boolean)
          .join(", ");

        const email = tags["email"] ?? tags["contact:email"] ?? "";

        results.push({
          source: "digital_presence",
          company_name: name,
          signals: [
            `Ingen hemsida registrerad i OpenStreetMap`,
            `Kategori: ${label}`,
            `Ort: ${city.name}`,
            addr ? `Adress: ${addr}` : "",
            phone ? `Tel: ${phone}` : "",
            email ? `E-post: ${email}` : "",
          ].filter(Boolean),
          suggested_offer_hint: "webb_design",
          extra: {
            osm_id: el.id,
            osm_type: el.type,
            address: addr,
            phone: phone || null,
            email: email || null,
            city: city.name,
            category: label,
          },
        });
      }
    }
    if (results.length >= limit) break;
  }

  return results;
}

// ------------------------------------------------------------
// SECONDARY — businesses by type for other offer hints
// ------------------------------------------------------------
export async function searchOsmByType(opts: {
  osmFilters: Array<[string, string]>; // e.g. [["office","accountant"],["office","company"]]
  city: string;
  offerHint: ProspectSignal["suggested_offer_hint"];
  label: string;
  limit?: number;
}): Promise<ProspectSignal[]> {
  const cityData = SWEDISH_CITIES.find((c) => c.name === opts.city) ?? SWEDISH_CITIES[0]!;
  const [s, w, n, e] = cityData.bbox;
  const limit = opts.limit ?? 10;

  const filterLines = opts.osmFilters
    .map(([k, v]) => `  node["${k}"="${v}"](${s},${w},${n},${e});`)
    .join("\n");

  const ql = `
[out:json][timeout:15];
(
${filterLines}
);
out body 30;`;

  let elements: OsmElement[];
  try {
    elements = await queryOverpass(ql);
  } catch {
    return [];
  }

  const results: ProspectSignal[] = [];
  const seen = new Set<number>();

  for (const el of elements) {
    if (results.length >= limit) break;
    const tags = el.tags ?? {};
    const name = tags["name"] ?? tags["operator"] ?? "";
    if (!name || seen.has(el.id)) continue;
    seen.add(el.id);

    const phone = tags["phone"] ?? tags["contact:phone"] ?? "";
    const website = tags["website"] ?? tags["contact:website"] ?? "";
    const email = tags["email"] ?? tags["contact:email"] ?? "";

    results.push({
      source: "digital_presence",
      company_name: name,
      signals: [
        opts.label,
        `Ort: ${opts.city}`,
        website ? `Webb: ${website}` : "Ingen hemsida",
        phone ? `Tel: ${phone}` : "",
        email ? `E-post: ${email}` : "",
      ].filter(Boolean),
      suggested_offer_hint: opts.offerHint,
      extra: {
        osm_id: el.id,
        phone: phone || null,
        email: email || null,
        website: website || null,
        city: opts.city,
      },
    });
  }

  return results;
}
