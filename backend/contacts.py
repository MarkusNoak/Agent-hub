"""Contact discovery for leads.

Fills contact_name / contact_title / contact_email on a lead using the
configured provider (Apollo when APOLLO_API_KEY is set, demo otherwise),
with the lead's website as a free fallback for at least an inbox address.
Used by the "Find contact" action in the UI and by the harvest auto-enrich
step (top leads of each prospecting run).
"""

import os

import database as db
from enrichment.cache import cached_fetch
from enrichment.website import analyze_website
from leadgen import get_provider

DECISION_MAKER_TITLES = [
    "VD", "CEO", "CTO", "Founder", "Grundare",
    "Head of IT", "Head of Digital", "IT-chef", "Marknadschef",
]


def contact_provider_live() -> bool:
    return bool(os.environ.get("APOLLO_API_KEY"))


async def _resolve_domain(provider, company_name: str) -> str | None:
    async def fetch() -> dict:
        try:
            results = await provider.search_companies(
                keywords=company_name, per_page=10
            )
        except Exception as e:
            return {"error": str(e)}
        return {"companies": results}

    data = await cached_fetch(
        "provider_companies",
        {"provider": provider.name, "keywords": company_name, "resolve": 1},
        fetch,
    )
    tokens = [t for t in company_name.lower().split() if len(t) > 2]
    for company in data.get("companies") or []:
        name = (company.get("company_name") or "").lower()
        if company.get("domain") and any(t in name for t in tokens):
            return company["domain"]
    return None


async def find_contact_for_lead(org_id: str, lead: dict) -> dict:
    """Returns {found: bool, source, contact?, note?} and updates the lead."""
    provider = get_provider()
    domain = lead.get("domain")

    if not domain:
        domain = await _resolve_domain(provider, lead["company_name"])
        if domain:
            await db.update_lead(org_id, lead["id"], {"domain": domain})

    # 1. Person-level data via the provider
    person = None
    if domain or lead.get("company_name"):
        async def fetch_people() -> dict:
            try:
                results = await provider.search_people(
                    titles=DECISION_MAKER_TITLES,
                    company_domains=[domain] if domain else None,
                    keywords=None if domain else lead["company_name"],
                    per_page=5,
                )
            except Exception as e:
                return {"error": str(e)}
            return {"people": results}

        data = await cached_fetch(
            "provider_people",
            {"provider": provider.name, "domain": domain,
             "company": lead["company_name"], "contact": 1},
            fetch_people,
        )
        people = data.get("people") or []

        # Guard: never attach a contact from a DIFFERENT company. Match on
        # exact domain when we have one, else on company-name tokens.
        tokens = [t for t in lead["company_name"].lower().split()
                  if len(t) > 2]

        def _same_company(p: dict) -> bool:
            if domain and (p.get("domain") or "").lower() == domain.lower():
                return True
            pname = (p.get("company_name") or "").lower()
            return bool(pname) and any(t in pname for t in tokens)

        people = [p for p in people if _same_company(p)]
        person = next((p for p in people if p.get("contact_email")),
                      people[0] if people else None)

    if person and (person.get("contact_email") or person.get("contact_name")):
        updates = {k: v for k, v in {
            "contact_name": person.get("contact_name"),
            "contact_title": person.get("contact_title"),
            "contact_email": person.get("contact_email"),
            "contact_linkedin": person.get("contact_linkedin"),
        }.items() if v}
        await db.update_lead(org_id, lead["id"], updates)
        await db.add_lead_activity(
            org_id, lead["id"], "contact_found",
            f"Kontakt via {provider.name}: "
            f"{person.get('contact_name') or '?'} "
            f"({person.get('contact_title') or '?'}) "
            f"{person.get('contact_email') or 'ingen e-post'}",
        )
        return {"found": True, "source": provider.name, "contact": updates,
                "note": None if contact_provider_live() else
                "DEMO DATA — connect APOLLO_API_KEY for live contacts."}

    # 2. Free fallback: public emails on the company website
    if domain:
        async def fetch_site() -> dict:
            try:
                return await analyze_website(domain)
            except Exception as e:
                return {"error": str(e)}

        site = await cached_fetch("website", {"domain": domain}, fetch_site)
        emails = site.get("contact_emails") or []
        if emails:
            await db.update_lead(org_id, lead["id"],
                                 {"contact_email": emails[0]})
            await db.add_lead_activity(
                org_id, lead["id"], "contact_found",
                f"Publik e-post från webbplatsen: {emails[0]}",
            )
            return {"found": True, "source": "website",
                    "contact": {"contact_email": emails[0]},
                    "note": "Inbox address mined from the website — no named "
                            "decision-maker found."}

    return {"found": False, "source": provider.name,
            "note": ("No contact found. "
                     + ("Try VANTAGE's search_people with different titles."
                        if contact_provider_live() else
                        "Connect APOLLO_API_KEY in the environment to unlock "
                        "live decision-maker data."))}


async def auto_enrich_new_leads(org_id: str, lead_ids: list[str],
                                max_leads: int = 5) -> int:
    """Post-harvest contact enrichment for the top leads of a run.
    Only runs when a live provider is configured — demo data should never
    silently land on real harvested leads."""
    if not contact_provider_live():
        return 0
    enriched = 0
    for lead_id in lead_ids[:max_leads]:
        lead = await db.get_lead(org_id, lead_id)
        if not lead or lead.get("contact_email"):
            continue
        try:
            result = await find_contact_for_lead(org_id, lead)
            if result.get("found"):
                enriched += 1
        except Exception:
            continue
    return enriched
