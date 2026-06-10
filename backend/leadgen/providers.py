"""Lead data providers.

ApolloProvider calls the Apollo.io REST API when APOLLO_API_KEY is set.
DemoProvider returns clearly-marked fictional sample data so the product can
be demonstrated to prospects without third-party credentials. Both return the
same normalized shape, so VANTAGE's tools are provider-agnostic and new
sources (Cognism, ZoomInfo, native scraping) can be added behind the same
interface.
"""

import os
from abc import ABC, abstractmethod

import httpx

APOLLO_BASE = "https://api.apollo.io/api/v1"


class LeadProvider(ABC):
    name: str

    @abstractmethod
    async def search_companies(
        self,
        keywords: str | None = None,
        industry: str | None = None,
        locations: list[str] | None = None,
        employee_ranges: list[str] | None = None,
        page: int = 1,
        per_page: int = 10,
    ) -> list[dict]: ...

    @abstractmethod
    async def search_people(
        self,
        titles: list[str] | None = None,
        locations: list[str] | None = None,
        company_domains: list[str] | None = None,
        keywords: str | None = None,
        page: int = 1,
        per_page: int = 10,
    ) -> list[dict]: ...

    @abstractmethod
    async def enrich_company(self, domain: str) -> dict | None: ...


# ── Apollo.io ─────────────────────────────────────────────────────────────────


def _norm_company(org: dict, source: str) -> dict:
    return {
        "company_name": org.get("name"),
        "domain": org.get("primary_domain") or org.get("website_url"),
        "industry": org.get("industry"),
        "company_size": str(org.get("estimated_num_employees") or ""),
        "location": ", ".join(
            p for p in [org.get("city"), org.get("country")] if p
        ),
        "linkedin": org.get("linkedin_url"),
        "description": (org.get("short_description") or "")[:300],
        "source": source,
    }


def _norm_person(p: dict, source: str) -> dict:
    org = p.get("organization") or {}
    return {
        "contact_name": p.get("name"),
        "contact_title": p.get("title"),
        "contact_email": p.get("email")
        if p.get("email") not in (None, "email_not_unlocked@domain.com")
        else None,
        "contact_linkedin": p.get("linkedin_url"),
        "company_name": org.get("name"),
        "domain": org.get("primary_domain"),
        "industry": org.get("industry"),
        "location": ", ".join(
            x for x in [p.get("city"), p.get("country")] if x
        ),
        "source": source,
    }


class ApolloProvider(LeadProvider):
    name = "apollo"

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def _post(self, path: str, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{APOLLO_BASE}{path}",
                json=payload,
                headers={
                    "X-Api-Key": self.api_key,
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def search_companies(
        self, keywords=None, industry=None, locations=None,
        employee_ranges=None, page=1, per_page=10,
    ) -> list[dict]:
        payload: dict = {"page": page, "per_page": min(per_page, 25)}
        tags = [t for t in [keywords, industry] if t]
        if tags:
            payload["q_organization_keyword_tags"] = tags
        if locations:
            payload["organization_locations"] = locations
        if employee_ranges:
            payload["organization_num_employees_ranges"] = employee_ranges
        data = await self._post("/mixed_companies/search", payload)
        orgs = data.get("organizations", []) + data.get("accounts", [])
        return [_norm_company(o, "apollo") for o in orgs]

    async def search_people(
        self, titles=None, locations=None, company_domains=None,
        keywords=None, page=1, per_page=10,
    ) -> list[dict]:
        payload: dict = {"page": page, "per_page": min(per_page, 25)}
        if titles:
            payload["person_titles"] = titles
        if locations:
            payload["person_locations"] = locations
        if company_domains:
            payload["q_organization_domains_list"] = company_domains
        if keywords:
            payload["q_keywords"] = keywords
        data = await self._post("/mixed_people/search", payload)
        people = data.get("people", []) + data.get("contacts", [])
        return [_norm_person(p, "apollo") for p in people]

    async def enrich_company(self, domain: str) -> dict | None:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{APOLLO_BASE}/organizations/enrich",
                params={"domain": domain},
                headers={"X-Api-Key": self.api_key},
            )
            resp.raise_for_status()
            org = resp.json().get("organization")
            return _norm_company(org, "apollo") if org else None


# ── Demo data (no credentials required) ──────────────────────────────────────

_DEMO_COMPANIES = [
    {"company_name": "Nordkraft Energi AB", "domain": "nordkraftenergi-demo.se",
     "industry": "renewable energy", "company_size": "120",
     "location": "Stockholm, Sweden", "linkedin": None,
     "description": "Solar and wind asset management for commercial real estate."},
    {"company_name": "Fjord Analytics AS", "domain": "fjordanalytics-demo.no",
     "industry": "software", "company_size": "45",
     "location": "Oslo, Norway", "linkedin": None,
     "description": "Maritime logistics data platform for shipping operators."},
    {"company_name": "Baltik Components Oy", "domain": "baltikcomponents-demo.fi",
     "industry": "manufacturing", "company_size": "310",
     "location": "Tampere, Finland", "linkedin": None,
     "description": "Precision-machined components for industrial automation."},
    {"company_name": "Køge Logistik ApS", "domain": "koegelogistik-demo.dk",
     "industry": "logistics", "company_size": "85",
     "location": "Copenhagen, Denmark", "linkedin": None,
     "description": "Last-mile delivery network across the Øresund region."},
    {"company_name": "Visby Health Systems AB", "domain": "visbyhealth-demo.se",
     "industry": "healthcare technology", "company_size": "60",
     "location": "Gothenburg, Sweden", "linkedin": None,
     "description": "Patient-flow optimisation software for regional hospitals."},
]

_DEMO_PEOPLE = [
    {"contact_name": "Elin Bergström", "contact_title": "VP of Operations",
     "company_name": "Nordkraft Energi AB", "domain": "nordkraftenergi-demo.se",
     "industry": "renewable energy", "contact_email": "elin.bergstrom@nordkraftenergi-demo.se",
     "contact_linkedin": None, "location": "Stockholm, Sweden"},
    {"contact_name": "Henrik Dahl", "contact_title": "Chief Technology Officer",
     "company_name": "Fjord Analytics AS", "domain": "fjordanalytics-demo.no",
     "industry": "software", "contact_email": "henrik.dahl@fjordanalytics-demo.no",
     "contact_linkedin": None, "location": "Oslo, Norway"},
    {"contact_name": "Aino Korhonen", "contact_title": "Head of Procurement",
     "company_name": "Baltik Components Oy", "domain": "baltikcomponents-demo.fi",
     "industry": "manufacturing", "contact_email": "aino.korhonen@baltikcomponents-demo.fi",
     "contact_linkedin": None, "location": "Tampere, Finland"},
    {"contact_name": "Mads Eriksen", "contact_title": "Managing Director",
     "company_name": "Køge Logistik ApS", "domain": "koegelogistik-demo.dk",
     "industry": "logistics", "contact_email": "mads.eriksen@koegelogistik-demo.dk",
     "contact_linkedin": None, "location": "Copenhagen, Denmark"},
    {"contact_name": "Sara Lindqvist", "contact_title": "Chief Executive Officer",
     "company_name": "Visby Health Systems AB", "domain": "visbyhealth-demo.se",
     "industry": "healthcare technology", "contact_email": "sara.lindqvist@visbyhealth-demo.se",
     "contact_linkedin": None, "location": "Gothenburg, Sweden"},
]


class DemoProvider(LeadProvider):
    name = "demo"

    async def search_companies(
        self, keywords=None, industry=None, locations=None,
        employee_ranges=None, page=1, per_page=10,
    ) -> list[dict]:
        results = list(_DEMO_COMPANIES)
        if industry:
            filtered = [
                c for c in results if industry.lower() in c["industry"].lower()
            ]
            results = filtered or results
        return [{**c, "source": "demo"} for c in results[:per_page]]

    async def search_people(
        self, titles=None, locations=None, company_domains=None,
        keywords=None, page=1, per_page=10,
    ) -> list[dict]:
        results = list(_DEMO_PEOPLE)
        if company_domains:
            domains = {d.lower() for d in company_domains}
            filtered = [p for p in results if (p.get("domain") or "").lower() in domains]
            results = filtered or results
        if titles:
            wanted = [t.lower() for t in titles]
            filtered = [
                p for p in results
                if any(w in p["contact_title"].lower() for w in wanted)
            ]
            results = filtered or results
        return [{**p, "source": "demo"} for p in results[:per_page]]

    async def enrich_company(self, domain: str) -> dict | None:
        for c in _DEMO_COMPANIES:
            if c["domain"] == domain:
                return {**c, "source": "demo"}
        return None


def get_provider() -> LeadProvider:
    api_key = os.environ.get("APOLLO_API_KEY")
    if api_key:
        return ApolloProvider(api_key)
    return DemoProvider()
