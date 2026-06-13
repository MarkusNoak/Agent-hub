"""Connector status — reports which integrations are configured.

Status is derived from environment presence only; no secrets are ever
returned. Connectors are configured via env vars on the host (Render),
which keeps credentials out of the database entirely.
"""
import os

from fastapi import APIRouter, Depends

from auth import AuthContext, get_current_auth

router = APIRouter(prefix="/api", tags=["integrations"])


def _has(*names: str) -> bool:
    return all(os.environ.get(n) for n in names)


@router.get("/integrations")
async def list_integrations(auth: AuthContext = Depends(get_current_auth)):
    email_configured = _has("SMTP_HOST", "SMTP_USER", "SMTP_PASS")
    email_live = os.environ.get("EMAIL_ENABLED", "").lower() in ("1", "true", "yes")
    imap_configured = _has("IMAP_HOST", "IMAP_USER", "IMAP_PASS")

    connectors = [
        {
            "id": "anthropic",
            "name": "Claude (Anthropic)",
            "category": "Core",
            "connected": _has("ANTHROPIC_API_KEY"),
            "detail": "Powers every agent. Set ANTHROPIC_API_KEY.",
        },
        {
            "id": "smtp",
            "name": "Email sending (SMTP)",
            "category": "Outreach",
            "connected": email_configured and email_live,
            "detail": (
                "Live — sequences send for real."
                if email_configured and email_live
                else "Configured but in dry-run. Set EMAIL_ENABLED=true to go live."
                if email_configured
                else "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM. "
                     "Until then all sends are simulated (dry-run)."
            ),
        },
        {
            "id": "imap",
            "name": "Reply inbox (IMAP)",
            "category": "Outreach",
            "connected": imap_configured,
            "detail": (
                "Replies are read and classified automatically."
                if imap_configured
                else "Set IMAP_HOST, IMAP_USER, IMAP_PASS to auto-classify replies "
                     "and stop sequences on answer."
            ),
        },
        {
            "id": "apollo",
            "name": "Apollo.io",
            "category": "Data",
            "connected": _has("APOLLO_API_KEY"),
            "detail": (
                "Live contact & company enrichment."
                if _has("APOLLO_API_KEY")
                else "Set APOLLO_API_KEY for live decision-maker contacts. "
                     "Without it, contact search returns demo data."
            ),
        },
        {
            "id": "jobtech",
            "name": "Platsbanken (JobTech)",
            "category": "Data",
            "connected": True,
            "detail": "Swedish job ads — hiring signal. Free public API, no key needed.",
        },
        {
            "id": "registry",
            "name": "Company registries (SE/NO/DK/FI + VIES)",
            "category": "Data",
            "connected": True,
            "detail": "Official company data, newco signal. Free public sources, no key needed.",
        },
        {
            "id": "ted",
            "name": "TED public tenders",
            "category": "Data",
            "connected": True,
            "detail": (
                "EU procurement — tender signal. Works without a key"
                + ("; TED_API_KEY set for higher limits." if _has("TED_API_KEY") else "; TED_API_KEY optional.")
            ),
        },
        {
            "id": "linkedin",
            "name": "LinkedIn (manuellt lager)",
            "category": "Outreach",
            "connected": True,
            "detail": "Profillänkar grävs fram ur sajter och Apollo; varje "
                      "lead får ett connection-utkast (<300 tecken) att "
                      "skicka själv. Automatiserade utskick stöds inte — "
                      "det bryter mot LinkedIns villkor.",
        },
        {
            "id": "companies_house",
            "name": "Companies House (UK)",
            "category": "Data",
            "connected": _has("COMPANIES_HOUSE_API_KEY"),
            "detail": (
                "UK registry lookups enabled."
                if _has("COMPANIES_HOUSE_API_KEY")
                else "Set COMPANIES_HOUSE_API_KEY (free) for UK company lookups."
            ),
        },
    ]

    coming_soon = [
        {"id": "fortnox", "name": "Fortnox", "category": "Finance"},
        {"id": "visma", "name": "Visma eEkonomi", "category": "Finance"},
        {"id": "slack", "name": "Slack", "category": "Notifications"},
        {"id": "trello", "name": "Trello", "category": "Project"},
    ]
    for c in coming_soon:
        c.update({"connected": False, "available": False, "detail": "Coming soon."})
    for c in connectors:
        c["available"] = True

    return {"connectors": connectors + coming_soon}
