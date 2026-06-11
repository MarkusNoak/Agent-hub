"""Company dossier — one-click meeting prep for a lead.

Runs the free enrichment battery (registry, website + digital maturity,
news, job ads) plus the lead's own history, and compiles a readable
one-pager. With an Anthropic key, a small model adds "tre saker att ta
upp" on top; without it the dossier is still complete, just unsummarized.
"""

import os

import database as db
from enrichment.cache import cached_fetch


async def _safe(coro):
    try:
        return await coro
    except Exception as e:
        return {"error": str(e)}


async def build_dossier(org_id: str, lead: dict) -> dict:
    from enrichment.signals import find_company_news, find_job_postings
    from enrichment.sweden import lookup_sweden
    from enrichment.website import analyze_website

    name = lead["company_name"]
    domain = lead.get("domain")

    registry = await _safe(cached_fetch(
        "registry_se", {"query": lead.get("org_number") or name},
        lambda: lookup_sweden(lead.get("org_number") or name),
    ))
    site = (await _safe(cached_fetch(
        "website", {"domain": domain},
        lambda: analyze_website(domain),
    ))) if domain else {}
    news = await _safe(cached_fetch(
        "news", {"company": name, "language": "sv"},
        lambda: _news_wrap(find_company_news(name, "sv", 5)),
    ))
    jobs = await _safe(cached_fetch(
        "jobs", {"company": name},
        lambda: find_job_postings(name, limit=5),
    ))
    activities = await db.list_lead_activities(org_id, lead["id"])

    lines = [f"# Dossier: {name}", ""]
    lines += ["## Läget",
              f"- **Status:** {lead.get('status')}  ·  **Score:** "
              f"{lead.get('score') or '–'}  ·  **Källa:** {lead.get('source')}",
              f"- **Kontakt:** {lead.get('contact_name') or 'saknas'}"
              + (f" ({lead.get('contact_title')})" if lead.get('contact_title') else "")
              + (f" · {lead.get('contact_email')}" if lead.get('contact_email') else ""),
              f"- **Signalfakta:** {lead.get('score_reason') or '–'}", ""]

    reg_list = registry if isinstance(registry, list) else []
    if reg_list:
        r = reg_list[0]
        lines += ["## Registerdata",
                  f"- {r.get('company_name') or name} · "
                  f"orgnr {r.get('org_number') or '–'} · "
                  f"{r.get('legal_form') or ''} {r.get('status') or ''}".strip(),
                  f"- Adress: {r.get('address') or '–'}", ""]

    if site and not site.get("error"):
        maturity = site.get("digital_maturity") or {}
        lines += ["## Digital närvaro",
                  f"- **Sajt:** {site.get('domain')} — {site.get('title') or ''}",
                  f"- **Tech:** {', '.join(site.get('tech_stack') or []) or 'inget identifierat'}",
                  f"- **Digital mognad:** {maturity.get('score', '–')}/100"]
        for issue in (maturity.get("issues") or [])[:4]:
            lines.append(f"  - Brist: {issue}")
        for opp in (maturity.get("opportunities") or [])[:3]:
            lines.append(f"  - Möjlighet: {opp}")
        lines.append("")

    news_items = (news or {}).get("items") or []
    if news_items:
        lines.append("## Senaste nytt")
        for item in news_items[:4]:
            lines.append(f"- {item.get('title')} "
                         f"({item.get('source') or '?'})")
        lines.append("")

    postings = (jobs or {}).get("postings") or []
    if postings:
        lines.append("## Rekryterar just nu")
        for p in postings[:4]:
            lines.append(f"- {p.get('headline')} "
                         f"({p.get('municipality') or '?'})")
        lines.append("")

    if activities:
        lines.append("## Vår historik")
        for a in activities[:6]:
            lines.append(f"- {str(a.get('created_at'))[:10]}: "
                         f"{a.get('content')[:120]}")
        lines.append("")

    markdown = "\n".join(lines)

    summary = await _talking_points(markdown)
    if summary:
        markdown = markdown.replace(
            "# Dossier", f"# Dossier", 1
        ) + f"\n## Tre saker att ta upp\n{summary}\n"

    await db.add_lead_activity(org_id, lead["id"], "dossier",
                               "Dossier genererad inför kontakt/möte.")
    return {"markdown": markdown}


async def _news_wrap(coro) -> dict:
    return {"items": await coro}


async def _talking_points(dossier_md: str) -> str | None:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    from anthropic import AsyncAnthropic
    model = (os.environ.get("WRITER_MODEL")
             or os.environ.get("CLASSIFIER_MODEL", "claude-haiku-4-5"))
    try:
        client = AsyncAnthropic()
        msg = await client.messages.create(
            model=model, max_tokens=300,
            system=("Du förbereder en säljare inför ett kundmöte. Utifrån "
                    "dossiern: lista exakt TRE konkreta saker att ta upp, "
                    "som punkter på svenska. Varje punkt: en observation ur "
                    "dossiern + varför den öppnar för affär. Inga "
                    "artighetsfraser, ingen inledning."),
            messages=[{"role": "user", "content": dossier_md[:6000]}],
        )
        text = (msg.content[0].text or "").strip()
        return text or None
    except Exception:
        return None
