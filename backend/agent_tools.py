"""Tool framework for agents.

A Tool couples an Anthropic tool definition with an async handler. Handlers
receive the validated input dict plus a ToolContext carrying the tenant, so
every side effect is scoped to the calling organization.
"""

import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import database as db
from enrichment import (
    analyze_website,
    cached_fetch,
    check_email_domain,
    find_company_news,
    find_job_postings,
    lookup_registry,
)
from enrichment.registries import SUPPORTED_COUNTRIES
from enrichment.signals import scan_funding_news, search_hiring_companies
from enrichment.sweden import allabolag_newly_registered
from leadgen import get_provider
from plans import get_plan, within_quota


@dataclass
class ToolContext:
    org_id: str
    user_id: str | None
    plan_id: str


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    handler: Callable[[dict, ToolContext], Awaitable[str]]

    def to_anthropic(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }


def _json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, default=str)


# ── Lead generation tools (VANTAGE) ──────────────────────────────────────────


async def _search_companies(inp: dict, ctx: ToolContext) -> str:
    provider = get_provider()

    async def fetch() -> dict:
        try:
            results = await provider.search_companies(
                keywords=inp.get("keywords"),
                industry=inp.get("industry"),
                locations=inp.get("locations"),
                employee_ranges=inp.get("employee_ranges"),
                per_page=inp.get("limit", 10),
            )
        except Exception as e:
            return {"error": f"Provider error: {e}", "provider": provider.name}
        return {"provider": provider.name, "count": len(results),
                "companies": results}

    return _json(await cached_fetch(
        "provider_companies", {"provider": provider.name, **inp}, fetch
    ))


async def _search_people(inp: dict, ctx: ToolContext) -> str:
    provider = get_provider()

    async def fetch() -> dict:
        try:
            results = await provider.search_people(
                titles=inp.get("titles"),
                locations=inp.get("locations"),
                company_domains=inp.get("company_domains"),
                keywords=inp.get("keywords"),
                per_page=inp.get("limit", 10),
            )
        except Exception as e:
            return {"error": f"Provider error: {e}", "provider": provider.name}
        return {"provider": provider.name, "count": len(results),
                "people": results}

    return _json(await cached_fetch(
        "provider_people", {"provider": provider.name, **inp}, fetch
    ))


async def _enrich_company(inp: dict, ctx: ToolContext) -> str:
    provider = get_provider()

    async def fetch() -> dict:
        try:
            result = await provider.enrich_company(inp["domain"])
        except Exception as e:
            return {"error": f"Provider error: {e}", "provider": provider.name}
        if not result:
            return {"error": f"No data found for domain {inp['domain']}"}
        return {"provider": provider.name, "company": result}

    return _json(await cached_fetch(
        "provider_enrich", {"provider": provider.name, **inp}, fetch
    ))


async def _save_lead(inp: dict, ctx: ToolContext) -> str:
    plan = get_plan(ctx.plan_id)
    used = await db.count_leads_this_month(ctx.org_id)
    if not within_quota(used, plan.leads_per_month):
        return _json({
            "error": "Monthly lead quota reached "
                     f"({used}/{plan.leads_per_month} on the {plan.name} plan). "
                     "Ask the user to upgrade to save more leads.",
        })

    blocked = await db.is_company_blocked(
        ctx.org_id, inp.get("company_name"), inp.get("org_number")
    )
    if blocked:
        return _json({
            "error": "DISQUALIFIED — this company was rejected recently "
                     f"(reason: {blocked['reason']}, cooldown until "
                     f"{blocked['until'][:10]}). Move on to the next "
                     "prospect.",
        })

    # Duplicate disqualification: never store the same company twice
    dupe = await db.find_duplicate_lead(
        ctx.org_id,
        company_name=inp.get("company_name"),
        domain=inp.get("domain"),
        org_number=inp.get("org_number"),
        contact_email=inp.get("contact_email"),
    )
    if dupe:
        return _json({
            "error": "DUPLICATE — this company is already in the pipeline. "
                     "Do not save it again or re-enrich it; use update_lead "
                     "if there is genuinely new information, otherwise move "
                     "on to the next prospect.",
            "existing_lead": {
                "lead_id": dupe["id"],
                "company_name": dupe["company_name"],
                "status": dupe["status"],
                "score": dupe["score"],
                "created_at": dupe["created_at"],
            },
        })

    score = inp.get("score")
    if score is not None:
        score = max(0, min(100, int(score)))
    lead_id = await db.create_lead(ctx.org_id, ctx.user_id, {
        "company_name": inp.get("company_name", "Unknown"),
        "domain": inp.get("domain"),
        "org_number": inp.get("org_number"),
        "industry": inp.get("industry"),
        "company_size": inp.get("company_size"),
        "location": inp.get("location"),
        "contact_name": inp.get("contact_name"),
        "contact_title": inp.get("contact_title"),
        "contact_email": inp.get("contact_email"),
        "contact_linkedin": inp.get("contact_linkedin"),
        "source": inp.get("source", "agent"),
        "score": score,
        "score_reason": inp.get("score_reason"),
        "notes": inp.get("notes"),
        "outreach_draft": inp.get("outreach_draft"),
    })
    await db.add_lead_activity(
        ctx.org_id, lead_id, "created", "Lead created by VANTAGE"
    )
    return _json({"ok": True, "lead_id": lead_id,
                  "quota": {"used": used + 1, "limit": plan.leads_per_month}})


async def _list_leads(inp: dict, ctx: ToolContext) -> str:
    leads = await db.list_leads(
        ctx.org_id, status=inp.get("status"), limit=inp.get("limit", 50)
    )
    slim = [
        {k: lead[k] for k in (
            "id", "company_name", "domain", "industry", "contact_name",
            "contact_title", "contact_email", "score", "status", "created_at",
        )}
        for lead in leads
    ]
    return _json({"count": len(slim), "leads": slim})


async def _update_lead(inp: dict, ctx: ToolContext) -> str:
    lead_id = inp.pop("lead_id", None)
    if not lead_id:
        return _json({"error": "lead_id is required"})
    status = inp.get("status")
    if status and status not in db.LEAD_STATUSES:
        return _json({"error": f"Invalid status. Use one of: {db.LEAD_STATUSES}"})
    ok = await db.update_lead(ctx.org_id, lead_id, inp)
    if not ok:
        return _json({"error": "Lead not found or no valid fields to update"})
    summary = ", ".join(f"{k}={v}" for k, v in inp.items() if k != "outreach_draft")
    await db.add_lead_activity(
        ctx.org_id, lead_id, "updated", summary or "outreach draft updated"
    )
    return _json({"ok": True, "lead_id": lead_id})


# ── Knowledge base tools (shared across agents) ──────────────────────────────


async def _search_knowledge(inp: dict, ctx: ToolContext) -> str:
    entries = await db.list_knowledge(
        ctx.org_id, kind=inp.get("kind"), query=inp.get("query"), limit=8
    )
    slim = [
        {"id": e["id"], "kind": e["kind"], "title": e["title"],
         "content": e["content"][:1500]}
        for e in entries
    ]
    return _json({"count": len(slim), "entries": slim,
                  "note": None if slim else
                  "Knowledge base empty for this filter — ask the user to "
                  "add reference cases and standards, or save them with "
                  "save_knowledge when they appear in conversation."})


async def _save_knowledge(inp: dict, ctx: ToolContext) -> str:
    title = (inp.get("title") or "").strip()
    content = (inp.get("content") or "").strip()
    if not title or len(content) < 20:
        return _json({"error": "Provide a title and meaningful content."})
    entry_id = await db.create_knowledge(
        ctx.org_id, inp.get("kind", "other"), title, content
    )
    return _json({"ok": True, "id": entry_id})


SEARCH_KNOWLEDGE = Tool(
    name="search_knowledge",
    description=(
        "Search the organization's knowledge base: reference cases ('case'), "
        "tech standards & stack choices ('standard'), service offerings & "
        "pricing ('offering'), internal processes ('process'). Use it to "
        "ground proposals, outreach, briefs, and onboarding in how THIS "
        "company actually works — never invent reference cases."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Keyword filter"},
            "kind": {"type": "string",
                     "enum": db.KNOWLEDGE_KINDS},
        },
    },
    handler=_search_knowledge,
)

SAVE_KNOWLEDGE = Tool(
    name="save_knowledge",
    description=(
        "Save an entry to the organization's knowledge base (reference case, "
        "tech standard, offering, process). Use when the user shares "
        "something worth reusing — e.g. a finished project that should "
        "become a reference case, or a stack decision that should become "
        "the standard. Confirm with the user before saving."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": db.KNOWLEDGE_KINDS},
            "title": {"type": "string"},
            "content": {"type": "string"},
        },
        "required": ["kind", "title", "content"],
    },
    handler=_save_knowledge,
)


# ── Outreach sequence tools ───────────────────────────────────────────────────


async def _start_email_sequence(inp: dict, ctx: ToolContext) -> str:
    import outreach
    result = await outreach.start_sequence(
        ctx.org_id,
        inp.get("lead_id", ""),
        inp.get("steps") or [],
        inp.get("relevance_basis", ""),
        hook_type=inp.get("hook_type", "other"),
    )
    return _json(result)


async def _check_sending_domain(inp: dict, ctx: ToolContext) -> str:
    """SPF/DMARC posture of the org's own sending domain via DNS-over-HTTPS.
    Misconfigured authentication silently kills deliverability."""
    import httpx as _httpx

    domain = (inp.get("domain") or "").strip().lower()
    if "@" in domain:
        domain = domain.split("@", 1)[1]
    if not domain:
        return _json({"error": "Provide the sending domain, e.g. 'weknowit.se'"})

    async def fetch() -> dict:
        results = {}
        try:
            async with _httpx.AsyncClient(timeout=15) as client:
                for label, name in (("spf", domain),
                                    ("dmarc", f"_dmarc.{domain}")):
                    resp = await client.get(
                        "https://dns.google/resolve",
                        params={"name": name, "type": "TXT"},
                        headers={"Accept": "application/json"},
                    )
                    resp.raise_for_status()
                    answers = resp.json().get("Answer") or []
                    txts = [a.get("data", "").strip('"')
                            for a in answers if a.get("type") == 16]
                    if label == "spf":
                        results["spf"] = next(
                            (t for t in txts if t.startswith("v=spf1")), None)
                    else:
                        results["dmarc"] = next(
                            (t for t in txts if t.lower().startswith("v=dmarc1")),
                            None)
        except Exception as e:
            return {"error": f"DNS check failed: {e}"}

        issues = []
        if not results.get("spf"):
            issues.append("No SPF record — receiving servers cannot verify "
                          "the sender; many will junk the mail.")
        if not results.get("dmarc"):
            issues.append("No DMARC record — set at least "
                          "'v=DMARC1; p=none; rua=mailto:...' to build "
                          "domain reputation.")
        return {
            "domain": domain,
            "spf_record": results.get("spf"),
            "dmarc_record": results.get("dmarc"),
            "issues": issues,
            "verdict": "OK — authentication in place" if not issues
                       else "FIX BEFORE SCALING OUTREACH",
        }

    return _json(await cached_fetch("mx", {"auth_check": domain}, fetch))


async def _cancel_email_sequence(inp: dict, ctx: ToolContext) -> str:
    import outreach
    cancelled = await outreach.cancel_lead_sequence(
        ctx.org_id, inp.get("lead_id", ""),
        inp.get("reason", "cancelled by agent"),
    )
    return _json({"ok": True, "steps_cancelled": cancelled})


async def _list_upsell_candidates(inp: dict, ctx: ToolContext) -> str:
    candidates = await db.list_upsell_candidates(ctx.org_id)
    if not candidates:
        return _json({"candidates": [],
                      "note": "No completed projects in the 14-60 day "
                              "post-delivery window that haven't been "
                              "contacted yet."})
    return _json({"count": len(candidates), "candidates": candidates})


async def _add_completed_project(inp: dict, ctx: ToolContext) -> str:
    if not (inp.get("project_name") and inp.get("company_name")
            and inp.get("completed_at")):
        return _json({"error": "project_name, company_name and completed_at "
                               "(YYYY-MM-DD) are required."})
    project_id = await db.add_completed_project(ctx.org_id, inp)
    return _json({"ok": True, "project_id": project_id})


async def _mark_upsell_contacted(inp: dict, ctx: ToolContext) -> str:
    ok = await db.mark_upsell_contacted(ctx.org_id, inp.get("project_id", ""))
    return _json({"ok": ok} if ok else
                 {"error": "Project not found or already marked contacted."})


async def _get_sequence_status(inp: dict, ctx: ToolContext) -> str:
    steps = await db.get_sequence(ctx.org_id, inp.get("lead_id", ""))
    if not steps:
        return _json({"lead_id": inp.get("lead_id"), "sequence": None,
                      "note": "No sequence exists for this lead."})
    slim = [{k: s[k] for k in ("step", "subject", "send_at", "status",
                               "sent_at")} for s in steps]
    return _json({"lead_id": inp.get("lead_id"), "steps": slim})


# ── Free public enrichment tools ──────────────────────────────────────────────


async def _lookup_registry(inp: dict, ctx: ToolContext) -> str:
    async def fetch() -> dict:
        try:
            results = await lookup_registry(inp["query"], inp["country"])
        except LookupError as e:
            return {"error": str(e)}
        except Exception as e:
            return {"error": f"Registry lookup failed: {e}"}
        if not results:
            return {"error": f"No registry match for '{inp['query']}' "
                             f"in {inp['country']}"}
        return {"count": len(results), "companies": results}

    return _json(await cached_fetch("registry", inp, fetch))


async def _analyze_website(inp: dict, ctx: ToolContext) -> str:
    async def fetch() -> dict:
        try:
            return await analyze_website(inp["domain"])
        except Exception as e:
            return {"error": f"Website analysis failed: {e}"}

    return _json(await cached_fetch("website", inp, fetch))


async def _find_company_news(inp: dict, ctx: ToolContext) -> str:
    async def fetch() -> dict:
        try:
            items = await find_company_news(
                inp["company_name"], language=inp.get("language", "en")
            )
        except Exception as e:
            return {"error": f"News search failed: {e}"}
        return {"company": inp["company_name"], "news": items,
                "note": None if items else "No recent news found."}

    return _json(await cached_fetch("news", inp, fetch))


async def _find_job_postings(inp: dict, ctx: ToolContext) -> str:
    async def fetch() -> dict:
        try:
            return await find_job_postings(inp["company_name"])
        except Exception as e:
            return {"error": f"Job posting search failed: {e}"}

    return _json(await cached_fetch("jobs", inp, fetch))


async def _find_hiring_companies(inp: dict, ctx: ToolContext) -> str:
    roles = inp.get("roles") or []
    if not roles:
        return _json({"error": "Provide at least one role keyword, "
                               "e.g. ['frontendutvecklare']"})

    async def fetch() -> dict:
        try:
            return await search_hiring_companies(
                roles, inp.get("regions"), inp.get("limit", 15)
            )
        except Exception as e:
            return {"error": f"Hiring-signal search failed: {e}"}

    return _json(await cached_fetch("jobs_harvest", inp, fetch))


async def _find_new_companies(inp: dict, ctx: ToolContext) -> str:
    async def fetch() -> dict:
        try:
            companies = await allabolag_newly_registered(inp.get("region"))
        except Exception as e:
            return {"error": f"Newly-registered lookup failed: {e}"}
        return {"count": len(companies), "companies": companies}

    return _json(await cached_fetch("newco", inp, fetch))


async def _scan_funding_news(inp: dict, ctx: ToolContext) -> str:
    async def fetch() -> dict:
        try:
            return await scan_funding_news(inp.get("topic"))
        except Exception as e:
            return {"error": f"Funding-news scan failed: {e}"}

    return _json(await cached_fetch("news", {"funding": True, **inp}, fetch))


async def _find_public_tenders(inp: dict, ctx: ToolContext) -> str:
    from enrichment.procurement import find_tenders

    async def fetch() -> dict:
        try:
            return await find_tenders(
                category=inp.get("category", "it"),
                country=inp.get("country", "SWE"),
                keywords=inp.get("keywords"),
                limit=inp.get("limit", 10),
            )
        except Exception as e:
            return {"error": f"Tender search failed: {e}"}

    return _json(await cached_fetch("tenders", inp, fetch))


async def _check_email_domain(inp: dict, ctx: ToolContext) -> str:
    async def fetch() -> dict:
        try:
            return await check_email_domain(inp["domain"])
        except Exception as e:
            return {"error": f"Email domain check failed: {e}"}

    return _json(await cached_fetch("mx", inp, fetch))


SEARCH_COMPANIES = Tool(
    name="search_companies",
    description=(
        "Search for companies matching an ideal customer profile (ICP). "
        "Returns normalized company records from the configured data provider "
        "(Apollo.io when an API key is configured, otherwise clearly-marked "
        "demo data). Use this as the first step of prospecting."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "keywords": {"type": "string", "description": "Free-text keywords describing the company, e.g. 'logistics SaaS'"},
            "industry": {"type": "string", "description": "Industry filter, e.g. 'manufacturing'"},
            "locations": {"type": "array", "items": {"type": "string"}, "description": "Locations, e.g. ['Sweden', 'Stockholm']"},
            "employee_ranges": {"type": "array", "items": {"type": "string"}, "description": "Employee count ranges like '11,50' or '51,200'"},
            "limit": {"type": "integer", "description": "Max results (default 10, max 25)"},
        },
    },
    handler=_search_companies,
)

SEARCH_PEOPLE = Tool(
    name="search_people",
    description=(
        "Search for decision-makers and contacts, optionally scoped to "
        "specific company domains. Use after identifying target companies to "
        "find the right person to contact."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "titles": {"type": "array", "items": {"type": "string"}, "description": "Job titles, e.g. ['CTO', 'VP Engineering']"},
            "locations": {"type": "array", "items": {"type": "string"}},
            "company_domains": {"type": "array", "items": {"type": "string"}, "description": "Restrict to these company domains"},
            "keywords": {"type": "string"},
            "limit": {"type": "integer", "description": "Max results (default 10, max 25)"},
        },
    },
    handler=_search_people,
)

ENRICH_COMPANY = Tool(
    name="enrich_company",
    description="Fetch detailed firmographic data for a company by domain.",
    input_schema={
        "type": "object",
        "properties": {
            "domain": {"type": "string", "description": "Company domain, e.g. 'acme.com'"},
        },
        "required": ["domain"],
    },
    handler=_enrich_company,
)

SAVE_LEAD = Tool(
    name="save_lead",
    description=(
        "Save a qualified lead to the organization's pipeline so the team can "
        "act on it. Always include a 0-100 score with a short score_reason, "
        "and an outreach_draft (a short personalized first-touch email) when "
        "you have enough context. Counts against the monthly lead quota."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "company_name": {"type": "string"},
            "domain": {"type": "string"},
            "org_number": {"type": "string", "description": "Official organization number from a registry lookup — enables exact duplicate detection"},
            "industry": {"type": "string"},
            "company_size": {"type": "string"},
            "location": {"type": "string"},
            "contact_name": {"type": "string"},
            "contact_title": {"type": "string"},
            "contact_email": {"type": "string"},
            "contact_linkedin": {"type": "string"},
            "source": {"type": "string", "description": "Data source, e.g. 'apollo' or 'demo'"},
            "score": {"type": "integer", "description": "Lead score 0-100 based on ICP fit, authority, and timing"},
            "score_reason": {"type": "string", "description": "One-sentence justification of the score"},
            "notes": {"type": "string", "description": "Qualification notes and next-step recommendation"},
            "outreach_draft": {"type": "string", "description": "Personalized first-touch email draft"},
        },
        "required": ["company_name", "score", "score_reason"],
    },
    handler=_save_lead,
)

LIST_LEADS = Tool(
    name="list_leads",
    description="List leads already in the organization's pipeline, optionally filtered by status (new, qualified, contacted, meeting, won, lost). Use to avoid duplicates and to review the pipeline.",
    input_schema={
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": db.LEAD_STATUSES},
            "limit": {"type": "integer"},
        },
    },
    handler=_list_leads,
)

UPDATE_LEAD = Tool(
    name="update_lead",
    description="Update an existing lead: change status, adjust score, append notes, or replace the outreach draft.",
    input_schema={
        "type": "object",
        "properties": {
            "lead_id": {"type": "string"},
            "status": {"type": "string", "enum": db.LEAD_STATUSES},
            "score": {"type": "integer"},
            "score_reason": {"type": "string"},
            "notes": {"type": "string"},
            "outreach_draft": {"type": "string"},
            "contact_email": {"type": "string"},
            "contact_name": {"type": "string"},
            "contact_title": {"type": "string"},
        },
        "required": ["lead_id"],
    },
    handler=_update_lead,
)

LOOKUP_REGISTRY = Tool(
    name="lookup_company_registry",
    description=(
        "Look up a company in an OFFICIAL government company registry — free, "
        f"public, authoritative data. Supported: {SUPPORTED_COUNTRIES}. "
        "Returns legal name, org/VAT number, status (active/dissolved/"
        "bankrupt), legal form, official industry classification, employees "
        "(NO), registered address, and registration date. Use it to verify "
        "that a prospect is a real, active company and to fill firmographic "
        "gaps. Accepts a company name or an org number as the query."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Company name or organization number"},
            "country": {"type": "string", "description": "ISO country code: NO, DK, FI, or GB"},
        },
        "required": ["query", "country"],
    },
    handler=_lookup_registry,
)

ANALYZE_WEBSITE = Tool(
    name="analyze_website",
    description=(
        "Fetch and analyze a company's website (free, no key). Returns title, "
        "meta description, site language, detected technology stack "
        "(CMS, CRM, analytics, e-commerce, chat widgets), social profiles "
        "(LinkedIn etc.), publicly listed contact emails, AND a "
        "digital_maturity grade (0-100) with concrete issues and pitch_angles "
        "— no HTTPS, not mobile-adapted, no analytics, unmaintained, slow. "
        "For an IT-services seller a LOW maturity score is a sales "
        "opportunity: open the outreach with the specific issue found."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "domain": {"type": "string", "description": "Company domain or URL, e.g. 'acme.se'"},
        },
        "required": ["domain"],
    },
    handler=_analyze_website,
)

FIND_COMPANY_NEWS = Tool(
    name="find_company_news",
    description=(
        "Search recent news about a company via Google News (free, no key). "
        "Surfaces timing signals: funding rounds, expansion, new offices, "
        "leadership changes, product launches, layoffs. Use these to score "
        "timing and to personalize the outreach draft with a relevant hook."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "company_name": {"type": "string"},
            "language": {"type": "string", "description": "News language: en, sv, no, da, or fi (default en)"},
        },
        "required": ["company_name"],
    },
    handler=_find_company_news,
)

FIND_HIRING_COMPANIES = Tool(
    name="find_hiring_companies",
    description=(
        "SIGNAL-FIRST PROSPECTING (Sweden): find every company currently "
        "advertising for given roles via Arbetsförmedlingen's open API — "
        "free, official, includes org numbers. This inverts the funnel: "
        "instead of guessing an ICP and searching, you harvest companies "
        "with PROVEN need and budget right now. Returns companies ranked by "
        "hiring intensity with sample ads and locations. The single best "
        "lead source for selling development/IT services in Sweden."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "roles": {"type": "array", "items": {"type": "string"},
                      "description": "Swedish occupation keywords, e.g. ['frontendutvecklare', 'systemutvecklare'] (max 5)"},
            "regions": {"type": "array", "items": {"type": "string"},
                        "description": "Optional region/municipality filter, e.g. ['Stockholm', 'Göteborg']"},
            "limit": {"type": "integer", "description": "Max companies (default 15)"},
        },
        "required": ["roles"],
    },
    handler=_find_hiring_companies,
)

FIND_NEW_COMPANIES = Tool(
    name="find_new_companies",
    description=(
        "List newly registered Swedish companies (via allabolag.se public "
        "data). New companies need websites, apps, and IT foundations — "
        "prime prospects for digital services. Optionally filter by region."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "region": {"type": "string", "description": "Optional region filter, e.g. 'Stockholm'"},
        },
    },
    handler=_find_new_companies,
)

SCAN_FUNDING_NEWS = Tool(
    name="scan_funding_news",
    description=(
        "Scan Swedish business press for fresh funding rounds (Google News, "
        "free). Companies that just raised capital invest in digital "
        "projects. Returns headlines — extract the company names and enrich "
        "the relevant ones. Optionally focus on a topic/industry."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "topic": {"type": "string", "description": "Optional industry/topic, e.g. 'logistik' or 'fintech'"},
        },
    },
    handler=_scan_funding_news,
)

FIND_JOB_POSTINGS = Tool(
    name="find_job_postings",
    description=(
        "Search active SWEDISH job postings via Arbetsförmedlingen's open "
        "JobTech API (free, no key). Active hiring is one of the strongest "
        "timing signals — a company recruiting is growing and has budget — "
        "and postings reveal which departments and technologies are scaling. "
        "Sweden only; for other markets use find_company_news instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "company_name": {"type": "string"},
        },
        "required": ["company_name"],
    },
    handler=_find_job_postings,
)

FIND_PUBLIC_TENDERS = Tool(
    name="find_public_tenders",
    description=(
        "Search ACTIVE public IT procurement (B2G) via TED, the EU's "
        "official tender database — free. Categories: 'it' (IT services/"
        "consulting/development), 'software', 'web'. Returns buyer, "
        "deadline, estimated value, and a link per tender. Public buyers "
        "have published need AND budget — zero cold outreach required. "
        "Covers above-threshold tenders (roughly > 1.5 MSEK); say so when "
        "the user asks about smaller deals."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "category": {"type": "string", "enum": ["it", "software", "web"]},
            "country": {"type": "string", "description": "ISO3 country, default SWE"},
            "keywords": {"type": "string", "description": "Optional title keywords, e.g. 'webbplats'"},
            "limit": {"type": "integer"},
        },
    },
    handler=_find_public_tenders,
)

CHECK_EMAIL_DOMAIN = Tool(
    name="check_email_domain",
    description=(
        "Check a domain's MX records via DNS (free, no key). Tells you whether "
        "the domain can receive email at all and which email provider it uses "
        "(Google Workspace, Microsoft 365, ...). Run this before saving a lead "
        "with a contact_email to avoid storing addresses that will bounce."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "domain": {"type": "string", "description": "Domain or full email address"},
        },
        "required": ["domain"],
    },
    handler=_check_email_domain,
)

async def _analyze_pipeline_performance(inp: dict, ctx: ToolContext) -> str:
    import insights
    return _json(await insights.pipeline_insights(ctx.org_id))


ANALYZE_PIPELINE_PERFORMANCE = Tool(
    name="analyze_pipeline_performance",
    description=(
        "The learning loop: win rates by lead source, industry, and score "
        "band; score calibration (do won deals actually score higher than "
        "lost ones?); outreach reply rates; and concrete recommendations. "
        "Use this to answer 'what is working?', to recalibrate the ICP, and "
        "at the start of any strategy discussion — ground advice in the "
        "org's actual outcomes, not generic best practice."
    ),
    input_schema={"type": "object", "properties": {}},
    handler=_analyze_pipeline_performance,
)

START_EMAIL_SEQUENCE = Tool(
    name="start_email_sequence",
    description=(
        "Schedule an outreach sequence of 1-3 emails for a lead. YOU write "
        "the emails — short (max 120 words each), personalized with specifics "
        "from enrichment (a news item, their tech gaps, their hiring). Step 1 "
        "sends immediately; later steps wait days_after days and are "
        "auto-cancelled if the prospect replies. Use {{booking_url}} in a "
        "body to insert the org's meeting-booking link. A Swedish GDPR "
        "footer with an unsubscribe link is appended automatically. "
        "relevance_basis is REQUIRED: 1-2 sentences documenting why this is "
        "relevant to the recipient's role (legitimate-interest record). "
        "Guardrails reject suppressed addresses, missing emails, and "
        "duplicate sequences. By default every step is held in the approval "
        "queue until a team member approves it (Approvals view). Without "
        "SMTP configured, sends are simulated and fully logged."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "lead_id": {"type": "string"},
            "relevance_basis": {"type": "string", "description": "Why this outreach is relevant to the recipient's role (GDPR documentation)"},
            "hook_type": {"type": "string",
                          "enum": ["hiring", "news", "tech_gap", "maturity",
                                   "funding", "referral", "other"],
                          "description": "The opening angle of step 1 — tracked so the learning loop can measure which angles get replies"},
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "subject": {"type": "string"},
                        "body": {"type": "string"},
                        "days_after": {"type": "integer", "description": "Days after the previous step (ignored for step 1, default 3)"},
                    },
                    "required": ["subject", "body"],
                },
            },
        },
        "required": ["lead_id", "relevance_basis", "steps"],
    },
    handler=_start_email_sequence,
)

CANCEL_EMAIL_SEQUENCE = Tool(
    name="cancel_email_sequence",
    description="Cancel all pending sequence steps for a lead (e.g. the user spoke to them through another channel, or circumstances changed).",
    input_schema={
        "type": "object",
        "properties": {
            "lead_id": {"type": "string"},
            "reason": {"type": "string"},
        },
        "required": ["lead_id"],
    },
    handler=_cancel_email_sequence,
)

CHECK_SENDING_DOMAIN = Tool(
    name="check_sending_domain",
    description=(
        "Check OUR OWN sending domain's email authentication (SPF + DMARC) "
        "via DNS — free. Misconfigured authentication is the silent killer "
        "of cold-email reply rates: mails land in spam and nobody knows. "
        "Run this before scaling outreach volume and whenever reply rates "
        "look suspiciously low."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "domain": {"type": "string", "description": "The sending domain, e.g. 'weknowit.se'"},
        },
        "required": ["domain"],
    },
    handler=_check_sending_domain,
)

LIST_UPSELL_CANDIDATES = Tool(
    name="list_upsell_candidates",
    description=(
        "List existing customers whose project was delivered 14-60 days ago "
        "and who haven't been contacted about follow-up work yet. These are "
        "the warmest leads available — trust is proven, the work is fresh. "
        "Use them before any cold prospecting. After starting an upsell "
        "sequence, call mark_upsell_contacted so they aren't pitched twice."
    ),
    input_schema={"type": "object", "properties": {}},
    handler=_list_upsell_candidates,
)

ADD_COMPLETED_PROJECT = Tool(
    name="add_completed_project",
    description=(
        "Register a delivered project so the customer enters the upsell "
        "pipeline (they surface in list_upsell_candidates 14-60 days after "
        "completed_at). source can be 'visma', 'fortnox' or 'manual'."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "project_name": {"type": "string"},
            "company_name": {"type": "string"},
            "completed_at": {"type": "string", "description": "YYYY-MM-DD"},
            "contact_name": {"type": "string"},
            "contact_email": {"type": "string"},
            "value_sek": {"type": "number"},
            "project_type": {"type": "string"},
            "source": {"type": "string",
                       "enum": ["visma", "fortnox", "manual"]},
        },
        "required": ["project_name", "company_name", "completed_at"],
    },
    handler=_add_completed_project,
)

MARK_UPSELL_CONTACTED = Tool(
    name="mark_upsell_contacted",
    description="Mark an upsell candidate as contacted so they leave the candidate list. Call this right after starting their outreach sequence.",
    input_schema={
        "type": "object",
        "properties": {"project_id": {"type": "string"}},
        "required": ["project_id"],
    },
    handler=_mark_upsell_contacted,
)

GET_SEQUENCE_STATUS = Tool(
    name="get_sequence_status",
    description="Show the outreach sequence for a lead: each step's subject, schedule, and status (awaiting_approval/pending/sent/simulated/cancelled/rejected).",
    input_schema={
        "type": "object",
        "properties": {"lead_id": {"type": "string"}},
        "required": ["lead_id"],
    },
    handler=_get_sequence_status,
)

LEAD_TOOLS = [
    FIND_HIRING_COMPANIES, FIND_NEW_COMPANIES, SCAN_FUNDING_NEWS,
    SEARCH_COMPANIES, SEARCH_PEOPLE, ENRICH_COMPANY,
    LOOKUP_REGISTRY, ANALYZE_WEBSITE, FIND_COMPANY_NEWS, FIND_JOB_POSTINGS,
    FIND_PUBLIC_TENDERS, CHECK_EMAIL_DOMAIN,
    SAVE_LEAD, LIST_LEADS, UPDATE_LEAD,
    START_EMAIL_SEQUENCE, CANCEL_EMAIL_SEQUENCE, GET_SEQUENCE_STATUS,
    LIST_UPSELL_CANDIDATES, ADD_COMPLETED_PROJECT, MARK_UPSELL_CONTACTED,
    CHECK_SENDING_DOMAIN, ANALYZE_PIPELINE_PERFORMANCE,
    SEARCH_KNOWLEDGE,
]
