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
    "CEO", "VD", "CTO", "CIO", "COO", "Founder", "Co-founder", "Owner",
    "Managing Director", "Grundare", "IT-chef",
    "Head of IT", "Head of Digital", "Head of Engineering",
    "Head of Marketing", "Marknadschef", "E-commerce Manager",
]


def _is_decision_title(title: str | None) -> bool:
    t = (title or "").lower()
    return any(w.lower() in t for w in DECISION_MAKER_TITLES)


def contact_provider_live() -> bool:
    return bool(os.environ.get("APOLLO_API_KEY"))


async def _resolve_domain(provider, company_name: str) -> str | None:
    async def fetch() -> dict:
        try:
            results = await provider.search_companies(
                keywords=company_name, per_page=10
            )
        except Exception as e:
            # "error" also prevents caching — a transient provider failure
            # must not block this company for the cache TTL
            return {"error": str(e)}
        if not results:
            return {"companies": [], "error": "empty (not cached)"}
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

    # Free fallback: guess the obvious Swedish domain and verify via DNS.
    # Harvested leads rarely carry a domain, and Apollo's company search is
    # weak on small Swedish ABs — this rescues most of them.
    from enrichment.signals import check_website_exists
    try:
        probe = await cached_fetch(
            "dns_site", {"name": company_name},
            lambda: check_website_exists(company_name),
        )
    except Exception:
        probe = {}
    if probe.get("has_website") and probe.get("domain"):
        return probe["domain"]
    return None


async def find_contact_for_lead(org_id: str, lead: dict) -> dict:
    """Returns {found: bool, source, contact?, note?} and updates the lead."""
    provider = get_provider()
    domain = lead.get("domain")

    if not domain:
        domain = await _resolve_domain(provider, lead["company_name"])
        if domain:
            await db.update_lead(org_id, lead["id"], {"domain": domain})

    # 1. Person-level data via the provider — two passes: decision-maker
    # titles first, then anyone at the company (better than nothing, and
    # small Swedish companies often have no title-tagged people in Apollo)
    person = None
    provider_error = None
    if domain or lead.get("company_name"):
        async def fetch_people() -> dict:
            try:
                results = await provider.search_people(
                    titles=DECISION_MAKER_TITLES,
                    company_domains=[domain] if domain else None,
                    keywords=None if domain else lead["company_name"],
                    per_page=5,
                )
                if not results:
                    results = await provider.search_people(
                        titles=None,
                        company_domains=[domain] if domain else None,
                        keywords=None if domain else lead["company_name"],
                        per_page=5,
                    )
            except Exception as e:
                return {"error": str(e)}
            if not results:
                # "error" prevents caching: an empty answer must not be
                # served from cache for a week when the user retries
                return {"people": [], "error": "empty (not cached)"}
            return {"people": results}

        data = await cached_fetch(
            "provider_people",
            {"provider": provider.name, "domain": domain,
             "company": lead["company_name"], "contact": 1},
            fetch_people,
        )
        people = data.get("people") or []
        err = data.get("error")
        if err and err != "empty (not cached)":
            provider_error = err

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

        # Apollo's api_search returns no emails by design — reveal the
        # selected person via People Enrichment (one credit, cached 14d)
        if (person and not person.get("contact_email")
                and hasattr(provider, "enrich_person")):
            async def fetch_enrich() -> dict:
                try:
                    enriched = await provider.enrich_person(
                        person_id=person.get("provider_id"),
                        name=person.get("contact_name"),
                        domain=domain,
                    )
                except Exception as e:
                    return {"error": str(e)}
                if not enriched:
                    return {"person": None, "error": "empty (not cached)"}
                return {"person": enriched}

            data = await cached_fetch(
                "provider_enrich",
                {"provider": provider.name,
                 "pid": person.get("provider_id"),
                 "who": person.get("contact_name"), "domain": domain},
                fetch_enrich,
            )
            if data.get("person"):
                merged = {**person, **{k: v for k, v in data["person"].items() if v}}
                person = merged
            err = data.get("error")
            if err and err != "empty (not cached)" and not provider_error:
                provider_error = err

    # 1b. Free waterfall: the company's own team/contact pages. Swedish SMB
    # sites usually list people — names, titles, often personal addresses.
    # Also yields the org's email pattern for careful, MX-checked guessing.
    guessed = False
    if domain and (not person or not person.get("contact_email")):
        from enrichment.signals import check_email_domain
        from enrichment.website import apply_email_pattern, mine_site_people

        async def fetch_site_people() -> dict:
            try:
                result = await mine_site_people(domain)
            except Exception as e:
                return {"error": str(e)}
            if not (result.get("people") or result.get("personal_emails")
                    or result.get("generic_emails")):
                return {**result, "error": "empty (not cached)"}
            return result

        site = await cached_fetch("website_people", {"domain": domain},
                                  fetch_site_people)
        site_people = site.get("people") or []
        pattern = site.get("email_pattern")

        def _same_person(a: str | None, b: str | None) -> bool:
            ta = {t.lower() for t in (a or "").split() if len(t) > 2}
            tb = {t.lower() for t in (b or "").split() if len(t) > 2}
            return bool(ta and tb and ta & tb)

        async def _mx_ok() -> bool:
            try:
                mx = await cached_fetch("mx", {"domain": domain},
                                        lambda: check_email_domain(domain))
                return bool(mx.get("accepts_email"))
            except Exception:
                return False

        if person and not person.get("contact_linkedin"):
            li = next((p.get("linkedin") for p in site_people
                       if p.get("linkedin")
                       and _same_person(p["name"],
                                        person.get("contact_name"))), None)
            if li:
                person = {**person, "contact_linkedin": li}

        if person and not person.get("contact_email"):
            match = next((p for p in site_people
                          if p.get("email")
                          and _same_person(p["name"],
                                           person.get("contact_name"))), None)
            if match:
                person = {**person, "contact_email": match["email"]}
            elif pattern and person.get("contact_name") and await _mx_ok():
                guess = apply_email_pattern(pattern,
                                            person["contact_name"], domain)
                if guess:
                    person = {**person, "contact_email": guess}
                    guessed = True

        if not person and site_people:
            ranked = sorted(
                site_people,
                key=lambda p: (not _is_decision_title(p.get("title")),
                               not p.get("email")),
            )
            cand = dict(ranked[0])
            email = cand.get("email")
            if not email and pattern and await _mx_ok():
                email = apply_email_pattern(pattern, cand["name"], domain)
                guessed = bool(email)
            if email or cand.get("name"):
                person = {"contact_name": cand.get("name"),
                          "contact_title": cand.get("title"),
                          "contact_email": email,
                          "contact_linkedin": cand.get("linkedin")}

    if person and (person.get("contact_email") or person.get("contact_name")):
        updates = {k: v for k, v in {
            "contact_name": person.get("contact_name"),
            "contact_title": person.get("contact_title"),
            "contact_email": person.get("contact_email"),
            "contact_linkedin": person.get("contact_linkedin"),
        }.items() if v}
        await db.update_lead(org_id, lead["id"], updates)
        suffix = (" [MÖNSTERGISSAD ADRESS — verifiera innan utskick]"
                  if guessed else "")
        await db.add_lead_activity(
            org_id, lead["id"], "contact_found",
            f"Kontakt: {person.get('contact_name') or '?'} "
            f"({person.get('contact_title') or '?'}) "
            f"{person.get('contact_email') or 'ingen e-post'}{suffix}",
        )
        note = None
        if guessed:
            note = ("Adressen är härledd ur företagets e-postmönster och "
                    "MX-verifierad på domännivå — verifiera mottagaren "
                    "innan utskick.")
        elif not contact_provider_live():
            note = "DEMO DATA — connect APOLLO_API_KEY for live contacts."
        return {"found": True, "source": provider.name, "contact": updates,
                "note": note}

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

    if provider_error:
        # An invalid key or quota problem must not masquerade as "no contact"
        return {"found": False, "source": provider.name,
                "note": f"Provider error from {provider.name}: "
                        f"{provider_error[:200]} — check the API key and "
                        "plan limits."}
    if not domain:
        return {"found": False, "source": provider.name,
                "note": ("Could not resolve a website for this company, so "
                         "neither the data provider nor the site scan had "
                         "anything to search. Add the domain on the lead "
                         "and try again.")}
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
