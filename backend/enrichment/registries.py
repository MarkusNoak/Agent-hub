"""Official company registries — free, public APIs.

All sources return the same normalized shape so VANTAGE can treat them
uniformly:

    {company_name, org_number, status, legal_form, industry, employees,
     address, registered, website, country, registry}

Sources:
- Norway   — Brønnøysundregistrene (data.brreg.no), no key required
- Denmark  — CVR via cvrapi.dk, no key required (identifying User-Agent only)
- Finland  — PRH/YTJ open data (avoindata.prh.fi), no key required
- UK       — Companies House, free API key via COMPANIES_HOUSE_API_KEY

Sweden has no free public registry API (Bolagsverket requires a paid
agreement); Swedish companies are covered by the lead provider and the
website/news enrichers instead.
"""

import os

import httpx

USER_AGENT = "AgentHub/2.0 (lead enrichment; contact: ops@agenthub.example)"
TIMEOUT = 15


async def _get_json(url: str, params: dict | None = None,
                    auth: tuple | None = None) -> dict | list:
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(
            url, params=params, auth=auth, headers={"User-Agent": USER_AGENT}
        )
        resp.raise_for_status()
        return resp.json()


# ── Norway — Brønnøysundregistrene ───────────────────────────────────────────


def _norm_brreg(e: dict) -> dict:
    addr = e.get("forretningsadresse") or {}
    return {
        "company_name": e.get("navn"),
        "org_number": e.get("organisasjonsnummer"),
        "status": "dissolved" if e.get("slettedato")
                  else ("bankrupt" if e.get("konkurs") else "active"),
        "legal_form": (e.get("organisasjonsform") or {}).get("beskrivelse"),
        "industry": (e.get("naeringskode1") or {}).get("beskrivelse"),
        "employees": e.get("antallAnsatte"),
        "address": ", ".join(filter(None, [
            ", ".join(addr.get("adresse") or []),
            addr.get("postnummer"), addr.get("poststed"),
        ])) or None,
        "registered": e.get("registreringsdatoEnhetsregisteret"),
        "website": e.get("hjemmeside"),
        "country": "NO",
        "registry": "brreg.no",
    }


async def _lookup_norway(query: str) -> list[dict]:
    if query.replace(" ", "").isdigit():
        data = await _get_json(
            "https://data.brreg.no/enhetsregisteret/api/enheter/"
            + query.replace(" ", "")
        )
        return [_norm_brreg(data)]
    data = await _get_json(
        "https://data.brreg.no/enhetsregisteret/api/enheter",
        params={"navn": query, "size": 5},
    )
    enheter = (data.get("_embedded") or {}).get("enheter") or []
    return [_norm_brreg(e) for e in enheter]


# ── Denmark — CVR (cvrapi.dk) ────────────────────────────────────────────────


def _norm_cvr(d: dict) -> dict:
    return {
        "company_name": d.get("name"),
        "org_number": str(d.get("vat") or ""),
        "status": "dissolved" if d.get("enddate") else "active",
        "legal_form": d.get("companydesc"),
        "industry": d.get("industrydesc"),
        "employees": d.get("employees"),
        "address": ", ".join(filter(None, [
            d.get("address"), d.get("zipcode"), d.get("city"),
        ])) or None,
        "registered": d.get("startdate"),
        "website": None,
        "contact_email": d.get("email"),
        "phone": d.get("phone"),
        "country": "DK",
        "registry": "cvrapi.dk",
    }


async def _lookup_denmark(query: str) -> list[dict]:
    data = await _get_json(
        "https://cvrapi.dk/api", params={"search": query, "country": "dk"}
    )
    if isinstance(data, dict) and data.get("error"):
        return []
    return [_norm_cvr(data)] if isinstance(data, dict) else []


# ── Finland — PRH / YTJ open data ────────────────────────────────────────────


def _norm_prh(c: dict) -> dict:
    names = c.get("names") or []
    official = next((n.get("name") for n in names if n.get("type") == "1"), None)
    name = official or (names[0].get("name") if names else None)

    line = c.get("mainBusinessLine") or {}
    descs = line.get("descriptions") or []
    industry = next(
        (d.get("description") for d in descs if d.get("languageCode") == "3"),
        descs[0].get("description") if descs else None,
    )

    addr = None
    for a in c.get("addresses") or []:
        parts = [a.get("street"), a.get("postCode")]
        offices = a.get("postOffices") or []
        if offices:
            parts.append(offices[0].get("city"))
        addr = ", ".join(str(p) for p in parts if p) or None
        if addr:
            break

    return {
        "company_name": name,
        "org_number": (c.get("businessId") or {}).get("value"),
        "status": "active" if not c.get("endDate") else "dissolved",
        "legal_form": next(
            (d.get("description")
             for d in (c.get("companyForms") or [{}])[0].get("descriptions", [])
             if d.get("languageCode") == "3"),
            None,
        ),
        "industry": industry,
        "employees": None,
        "address": addr,
        "registered": c.get("registrationDate"),
        "website": (c.get("website") or {}).get("url")
                   if isinstance(c.get("website"), dict) else c.get("website"),
        "country": "FI",
        "registry": "avoindata.prh.fi",
    }


async def _lookup_finland(query: str) -> list[dict]:
    params = {"businessId": query} if any(ch.isdigit() for ch in query) and "-" in query \
        else {"name": query}
    data = await _get_json(
        "https://avoindata.prh.fi/opendata-ytj-api/v3/companies", params=params
    )
    companies = data.get("companies") or []
    return [_norm_prh(c) for c in companies[:5]]


# ── United Kingdom — Companies House ─────────────────────────────────────────


def _norm_companies_house(item: dict) -> dict:
    return {
        "company_name": item.get("title"),
        "org_number": item.get("company_number"),
        "status": item.get("company_status"),
        "legal_form": item.get("company_type"),
        "industry": None,
        "employees": None,
        "address": item.get("address_snippet"),
        "registered": item.get("date_of_creation"),
        "website": None,
        "country": "GB",
        "registry": "companieshouse.gov.uk",
    }


async def _lookup_uk(query: str) -> list[dict]:
    api_key = os.environ.get("COMPANIES_HOUSE_API_KEY")
    if not api_key:
        raise LookupError(
            "UK lookups need a free Companies House API key — set "
            "COMPANIES_HOUSE_API_KEY (register at "
            "https://developer.company-information.service.gov.uk)"
        )
    data = await _get_json(
        "https://api.company-information.service.gov.uk/search/companies",
        params={"q": query, "items_per_page": 5},
        auth=(api_key, ""),
    )
    return [_norm_companies_house(i) for i in data.get("items") or []]


# ── Dispatcher ────────────────────────────────────────────────────────────────

_REGISTRIES = {
    "no": _lookup_norway,
    "dk": _lookup_denmark,
    "fi": _lookup_finland,
    "gb": _lookup_uk,
    "uk": _lookup_uk,
}

SUPPORTED_COUNTRIES = "NO (Norway), DK (Denmark), FI (Finland), GB/UK (United Kingdom)"


async def lookup_registry(query: str, country: str) -> list[dict]:
    """Look up a company by name or org number in an official registry."""
    fn = _REGISTRIES.get(country.strip().lower())
    if not fn:
        raise LookupError(
            f"No free registry available for '{country}'. "
            f"Supported: {SUPPORTED_COUNTRIES}. Sweden has no free public "
            "registry API — use the lead provider plus website/news enrichment."
        )
    return await fn(query.strip())
