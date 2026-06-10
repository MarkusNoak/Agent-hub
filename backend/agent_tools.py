"""Tool framework for agents.

A Tool couples an Anthropic tool definition with an async handler. Handlers
receive the validated input dict plus a ToolContext carrying the tenant, so
every side effect is scoped to the calling organization.
"""

import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import database as db
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
    try:
        results = await provider.search_companies(
            keywords=inp.get("keywords"),
            industry=inp.get("industry"),
            locations=inp.get("locations"),
            employee_ranges=inp.get("employee_ranges"),
            per_page=inp.get("limit", 10),
        )
    except Exception as e:
        return _json({"error": f"Provider error: {e}", "provider": provider.name})
    return _json({"provider": provider.name, "count": len(results),
                  "companies": results})


async def _search_people(inp: dict, ctx: ToolContext) -> str:
    provider = get_provider()
    try:
        results = await provider.search_people(
            titles=inp.get("titles"),
            locations=inp.get("locations"),
            company_domains=inp.get("company_domains"),
            keywords=inp.get("keywords"),
            per_page=inp.get("limit", 10),
        )
    except Exception as e:
        return _json({"error": f"Provider error: {e}", "provider": provider.name})
    return _json({"provider": provider.name, "count": len(results),
                  "people": results})


async def _enrich_company(inp: dict, ctx: ToolContext) -> str:
    provider = get_provider()
    try:
        result = await provider.enrich_company(inp["domain"])
    except Exception as e:
        return _json({"error": f"Provider error: {e}", "provider": provider.name})
    if not result:
        return _json({"error": f"No data found for domain {inp['domain']}"})
    return _json({"provider": provider.name, "company": result})


async def _save_lead(inp: dict, ctx: ToolContext) -> str:
    plan = get_plan(ctx.plan_id)
    used = await db.count_leads_this_month(ctx.org_id)
    if not within_quota(used, plan.leads_per_month):
        return _json({
            "error": "Monthly lead quota reached "
                     f"({used}/{plan.leads_per_month} on the {plan.name} plan). "
                     "Ask the user to upgrade to save more leads.",
        })
    score = inp.get("score")
    if score is not None:
        score = max(0, min(100, int(score)))
    lead_id = await db.create_lead(ctx.org_id, ctx.user_id, {
        "company_name": inp.get("company_name", "Unknown"),
        "domain": inp.get("domain"),
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

LEAD_TOOLS = [
    SEARCH_COMPANIES, SEARCH_PEOPLE, ENRICH_COMPANY,
    SAVE_LEAD, LIST_LEADS, UPDATE_LEAD,
]
