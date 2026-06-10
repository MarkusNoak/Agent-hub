"""Public procurement (B2G) — IT tenders from TED.

TED (Tenders Electronic Daily) publishes all EU above-threshold procurement,
including every larger Swedish IT tender, with a free search API. A weekly
scan of fresh notices in the right CPV categories opens a revenue channel
with zero cold outreach: the buyer has already published their need and
budget.

Below-threshold Swedish tenders live in commercial databases (Mercell,
e-Avrop) — out of scope for the free tier; TED covers the larger deals.
"""

import httpx

USER_AGENT = "AgentHub/2.0 (tender monitoring; contact: ops@agenthub.example)"
TIMEOUT = 30

TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search"

# CPV families relevant to an IT consultancy
CPV_PRESETS = {
    "it": "72000000",          # IT services: consulting, development, internet
    "software": "48000000",    # Software package and information systems
    "web": "72400000",         # Internet services
}

FIELDS = [
    "publication-number",
    "notice-title",
    "buyer-name",
    "buyer-country",
    "publication-date",
    "deadline-receipt-tenders-date-time",
    "classification-cpv",
    "estimated-value-glo",
    "estimated-value-cur-glo",
]


def _first(value) -> str | None:
    """TED fields are sometimes lists or language maps — normalize to str."""
    if value is None:
        return None
    if isinstance(value, list):
        return _first(value[0]) if value else None
    if isinstance(value, dict):
        for lang in ("swe", "eng"):
            if value.get(lang):
                return _first(value[lang])
        return _first(next(iter(value.values()), None))
    return str(value)


def _norm_notice(n: dict) -> dict:
    pub_number = _first(n.get("publication-number"))
    return {
        "title": _first(n.get("notice-title")),
        "buyer": _first(n.get("buyer-name")),
        "country": _first(n.get("buyer-country")),
        "published": _first(n.get("publication-date")),
        "deadline": _first(n.get("deadline-receipt-tenders-date-time")),
        "cpv": _first(n.get("classification-cpv")),
        "estimated_value": _first(n.get("estimated-value-glo")),
        "currency": _first(n.get("estimated-value-cur-glo")),
        "url": (f"https://ted.europa.eu/en/notice/-/detail/{pub_number}"
                if pub_number else None),
    }


async def find_tenders(
    category: str = "it",
    country: str = "SWE",
    keywords: str | None = None,
    limit: int = 10,
) -> dict:
    cpv = CPV_PRESETS.get(category.lower(), CPV_PRESETS["it"])
    query = (f"(classification-cpv IN ({cpv}*)) "
             f"AND (buyer-country IN ({country}))")
    if keywords:
        safe = keywords.replace('"', "")
        query += f' AND (notice-title ~ ("{safe}"))'

    import os
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    api_key = os.environ.get("TED_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            TED_SEARCH_URL,
            json={
                "query": query,
                "fields": FIELDS,
                "limit": min(limit, 25),
                "page": 1,
                "scope": "ACTIVE",
                "paginationMode": "PAGE_NUMBER",
            },
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()

    notices = [_norm_notice(n) for n in data.get("notices") or []]
    return {
        "category": category,
        "cpv": cpv,
        "country": country,
        "total_available": data.get("totalNoticeCount"),
        "tenders": notices,
        "source": "ted.europa.eu (EU official)",
        "note": ("TED covers above-threshold tenders (roughly > 1.5 MSEK for "
                 "services). Smaller Swedish tenders require a commercial "
                 "database subscription." if notices else
                 "No active tenders matched — try category 'software' or "
                 "'web', or drop the keywords."),
    }
