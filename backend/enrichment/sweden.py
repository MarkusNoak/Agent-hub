"""Swedish company data — free sources.

Bolagsverket has no free public API, so Swedish coverage combines:

- EU VIES (official, keyless): verify an org number's VAT registration and
  get the registered legal name and address straight from Skatteverket's
  data via the EU commission API.
- allabolag.se (public web pages): name search scraped politely — rate
  limited, identified User-Agent, results cached server-side. Parsing reads
  the embedded JSON state first and falls back to HTML patterns, so minor
  site redesigns degrade gracefully instead of breaking.

Both return the registry-normalized shape used by lookup_company_registry.
"""

import asyncio
import json
import re
import time

import httpx

USER_AGENT = "Mozilla/5.0 (compatible; AgentHub/2.0; lead enrichment; contact: ops@agenthub.example)"
TIMEOUT = 20

ORGNR_RE = re.compile(r"^\d{6}-?\d{4}$")

# Polite scraping: at most one allabolag request per 1.5s process-wide
_scrape_lock = asyncio.Lock()
_last_scrape = 0.0
SCRAPE_INTERVAL = 1.5


async def _polite_get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    global _last_scrape
    async with _scrape_lock:
        wait = SCRAPE_INTERVAL - (time.monotonic() - _last_scrape)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_scrape = time.monotonic()
    return await client.get(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.5",
    })


# ── VIES — official VAT verification (org number → legal name/address) ───────


async def vies_lookup(org_number: str) -> dict | None:
    digits = "".join(ch for ch in org_number if ch.isdigit())
    if len(digits) != 10:
        return None
    vat_number = digits + "01"  # Swedish VAT = orgnr + '01'

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(
            f"https://ec.europa.eu/taxation_customs/vies/rest-api/ms/SE/vat/{vat_number}",
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()

    if not data.get("isValid"):
        return {
            "company_name": None,
            "org_number": f"{digits[:6]}-{digits[6:]}",
            "status": "not VAT-registered (may be inactive or not found)",
            "country": "SE",
            "registry": "vies.europa.eu",
        }

    address = (data.get("address") or "").replace("\n", ", ").strip(", ")
    return {
        "company_name": (data.get("name") or "").strip() or None,
        "org_number": f"{digits[:6]}-{digits[6:]}",
        "status": "active (VAT-registered)",
        "legal_form": None,
        "industry": None,
        "employees": None,
        "address": address or None,
        "registered": None,
        "website": None,
        "country": "SE",
        "registry": "vies.europa.eu",
    }


# ── allabolag.se — name search (scraped public pages) ────────────────────────

NAME_KEYS = {"name", "companyname", "jurnamn", "namn", "companyName"}
ORG_KEYS = {"orgnr", "organisationnumber", "organisationsnummer", "orgnumber",
            "organisationNumber", "orgNumber"}
LOC_KEYS = {"location", "city", "postort", "municipality", "kommun", "ort"}
EMPLOYEE_KEYS = {"employees", "antalanstallda", "numberofemployees"}


def _dig_companies(node, found: list[dict], depth: int = 0) -> None:
    """Walk arbitrarily nested JSON and collect dicts that look like
    company records (a name field + an org number field)."""
    if depth > 14 or len(found) >= 30:
        return
    if isinstance(node, dict):
        lower = {k.lower(): v for k, v in node.items()}
        org = next(
            (str(lower[k]) for k in (k.lower() for k in ORG_KEYS)
             if k in lower and lower[k] and ORGNR_RE.match(str(lower[k]).strip())),
            None,
        )
        name = next(
            (str(lower[k]).strip() for k in (k.lower() for k in NAME_KEYS)
             if k in lower and isinstance(lower[k], str) and lower[k].strip()),
            None,
        )
        if org and name:
            loc = next(
                (str(lower[k]).strip() for k in (k.lower() for k in LOC_KEYS)
                 if k in lower and isinstance(lower[k], (str, int)) and str(lower[k]).strip()),
                None,
            )
            emp = next(
                (str(lower[k]) for k in (k.lower() for k in EMPLOYEE_KEYS)
                 if k in lower and lower[k] not in (None, "")),
                None,
            )
            found.append({"name": name, "orgnr": org, "location": loc,
                          "employees": emp})
        for v in node.values():
            _dig_companies(v, found, depth + 1)
    elif isinstance(node, list):
        for v in node:
            _dig_companies(v, found, depth + 1)


def parse_allabolag_search(html: str) -> list[dict]:
    results: list[dict] = []

    # Preferred: embedded JSON state (Next.js / Nuxt style)
    for pattern in (
        r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>',
        r'window\.__NUXT__\s*=\s*(\{.*?\});?\s*</script>',
        r'window\.__INITIAL_STATE__\s*=\s*(\{.*?\});?\s*</script>',
    ):
        m = re.search(pattern, html, re.S)
        if not m:
            continue
        try:
            _dig_companies(json.loads(m.group(1)), results)
        except json.JSONDecodeError:
            continue
        if results:
            break

    # Fallback: company links in plain HTML (/<slug>/<orgnr> or ?orgnr=)
    if not results:
        for m in re.finditer(
            r'<a[^>]+href="[^"]*?(\d{6}-?\d{4})[^"]*"[^>]*>\s*([^<>{}]{2,90}?)\s*<',
            html,
        ):
            name = re.sub(r"\s+", " ", m.group(2)).strip()
            if name and not name.isdigit():
                results.append({"name": name, "orgnr": m.group(1),
                                "location": None, "employees": None})

    # Dedupe by org number, keep order
    seen, unique = set(), []
    for r in results:
        orgnr = r["orgnr"].replace("-", "")
        if orgnr in seen:
            continue
        seen.add(orgnr)
        unique.append(r)
    return unique[:5]


def _norm_allabolag(r: dict) -> dict:
    digits = r["orgnr"].replace("-", "")
    return {
        "company_name": r["name"],
        "org_number": f"{digits[:6]}-{digits[6:]}",
        "status": "listed (verify with org-number lookup)",
        "legal_form": None,
        "industry": None,
        "employees": r.get("employees"),
        "address": r.get("location"),
        "registered": None,
        "website": None,
        "country": "SE",
        "registry": "allabolag.se",
    }


async def allabolag_search(name: str) -> list[dict]:
    from urllib.parse import quote

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        resp = await _polite_get(
            client, f"https://www.allabolag.se/what/{quote(name)}"
        )
        if resp.status_code >= 400:
            raise LookupError(
                f"allabolag.se returned HTTP {resp.status_code} — the site "
                "may be rate-limiting; retry later or verify by org number "
                "via VIES instead."
            )
        return [_norm_allabolag(r) for r in parse_allabolag_search(resp.text)]


async def allabolag_newly_registered(region: str | None = None) -> list[dict]:
    """Newly registered Swedish companies from allabolag.se's public listing.

    New companies need websites, apps, and IT foundations — a prime segment
    for an IT consultancy. Parsed with the same JSON-first/HTML-fallback
    strategy as the name search."""
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        resp = await _polite_get(client, "https://www.allabolag.se/nyregistrerade")
        if resp.status_code >= 400:
            raise LookupError(
                f"allabolag.se returned HTTP {resp.status_code} for the "
                "newly-registered listing; retry later."
            )
        results = parse_allabolag_search(resp.text)

    normalized = [_norm_allabolag(r) for r in results]
    for n in normalized:
        n["status"] = "newly registered"
    if region:
        filtered = [
            n for n in normalized
            if n.get("address") and region.lower() in n["address"].lower()
        ]
        normalized = filtered or normalized
    return normalized


# ── Dispatcher used by lookup_company_registry for SE ─────────────────────────


async def lookup_sweden(query: str) -> list[dict]:
    query = query.strip()
    if ORGNR_RE.match(query.replace(" ", "")):
        result = await vies_lookup(query.replace(" ", ""))
        return [result] if result else []
    results = await allabolag_search(query)
    if not results:
        return []
    # Verify the top hit via VIES so at least one record is authoritative
    try:
        verified = await vies_lookup(results[0]["org_number"])
        if verified and verified.get("company_name"):
            results[0] = {**results[0], **{
                k: v for k, v in verified.items() if v is not None
            }}
    except httpx.HTTPError:
        pass
    return results
