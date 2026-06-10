"""Signal-first prospecting engine.

Instead of starting from an ICP and searching for companies, runs start from
live buying signals (companies hiring developers right now; newly registered
companies) and harvest them into the lead pipeline. Runs are deterministic —
no LLM tokens — so they can execute on a weekly schedule at near-zero cost.
VANTAGE then works the resulting pipeline interactively.

Each run produces a Swedish digest: what was found, what was skipped as
duplicates, and the top prospects to contact first.
"""

import asyncio
import traceback
from datetime import datetime, timezone

import database as db
from enrichment.cache import cached_fetch
from enrichment.signals import search_hiring_companies
from enrichment.sweden import allabolag_newly_registered
from plans import get_plan, within_quota

DEFAULT_ROLES = ["systemutvecklare", "frontendutvecklare", "apputvecklare"]
SCHEDULE_INTERVAL_DAYS = 7
SCHEDULER_TICK_SECONDS = 3600


def _score_hiring_company(company: dict, icp: dict) -> tuple[int, str]:
    """Deterministic heuristic score for a hiring-signal lead."""
    score = 45
    reasons = []

    postings = company.get("postings", 0)
    bump = min(postings * 5, 20)
    score += bump
    reasons.append(f"rekryterar aktivt ({postings} annons(er), +{bump})")

    roles = [r.lower() for r in icp.get("target_roles") or DEFAULT_ROLES]
    advertised = " ".join(company.get("roles_advertised") or []).lower()
    if any(role.split()[0][:8] in advertised for role in roles):
        score += 10
        reasons.append("söker exakt de roller vi levererar (+10)")

    if company.get("org_number"):
        score += 5
        reasons.append("verifierat orgnr från Arbetsförmedlingen (+5)")

    if icp.get("regions") and company.get("locations"):
        locs = " ".join(company["locations"]).lower()
        if any(r.lower() in locs for r in icp["regions"]):
            score += 10
            reasons.append("i vår målregion (+10)")

    return min(score, 90), "Signalscore: " + "; ".join(reasons)


def _build_digest(icp: dict, stats: dict, top_leads: list[dict],
                  notes: list[str]) -> str:
    lines = [
        f"PROSPEKTERINGSKÖRNING — {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC",
        f"ICP: {icp.get('name', 'standard')}",
        "",
        f"Signaler funna: {stats['signals_found']}  |  "
        f"Nya leads: {stats['leads_created']}  |  "
        f"Dubbletter skippade: {stats['duplicates_skipped']}",
    ]
    if top_leads:
        lines += ["", "KONTAKTA FÖRST:"]
        for i, lead in enumerate(top_leads[:3], 1):
            lines.append(
                f"{i}. {lead['company_name']} (score {lead['score']}) — "
                f"{lead['why']}"
            )
        if len(top_leads) > 3:
            rest = ", ".join(x["company_name"] for x in top_leads[3:8])
            lines.append(f"Övriga nya: {rest}")
        lines += ["", "Nästa steg: be VANTAGE djup-enricha topp 3 och ta fram "
                      "outreach (registerkoll + sajtanalys + nyheter ingår)."]
    else:
        lines += ["", "Inga nya leads denna körning."]
    for note in notes:
        lines += ["", f"OBS: {note}"]
    return "\n".join(lines)


async def run_prospecting(org_id: str, icp: dict, trigger: str) -> dict:
    org = await db.get_organization(org_id)
    plan = get_plan(org["plan"])
    stats = {"signals_found": 0, "leads_created": 0, "duplicates_skipped": 0}
    top_leads: list[dict] = []
    notes: list[str] = []

    roles = icp.get("target_roles") or DEFAULT_ROLES
    regions = icp.get("regions") or None

    # ── Signal 1: companies hiring the roles we deliver ──
    try:
        harvest = await cached_fetch(
            "jobs_harvest",
            {"roles": roles, "regions": regions},
            lambda: search_hiring_companies(roles, regions, max_companies=25),
        )
        companies = harvest.get("companies") or []
    except Exception as e:
        companies = []
        notes.append(f"Rekryteringssignalen misslyckades: {e}")

    stats["signals_found"] += len(companies)

    for company in companies:
        used = await db.count_leads_this_month(org_id)
        if not within_quota(used, plan.leads_per_month):
            notes.append(
                f"Lead-kvoten för månaden nådd ({plan.leads_per_month}) — "
                "körningen avbröts. Uppgradera planen för fler."
            )
            break

        dupe = await db.find_duplicate_lead(
            org_id,
            company_name=company["company_name"],
            org_number=company.get("org_number"),
        )
        if dupe:
            stats["duplicates_skipped"] += 1
            continue

        score, reason = _score_hiring_company(company, icp)
        ads = "; ".join(a["headline"] for a in company.get("sample_ads") or [])
        lead_id = await db.create_lead(org_id, None, {
            "company_name": company["company_name"],
            "org_number": company.get("org_number"),
            "location": ", ".join(company.get("locations") or []) or None,
            "source": "signal:hiring",
            "score": score,
            "score_reason": reason,
            "notes": f"Aktiva annonser: {ads}" if ads else None,
        })
        await db.add_lead_activity(
            org_id, lead_id, "created",
            f"Skördad från rekryteringssignal ({trigger} körning)",
        )
        stats["leads_created"] += 1
        top_leads.append({
            "company_name": company["company_name"],
            "score": score,
            "why": f"{company.get('postings', 0)} aktiva annonser"
                   + (f" i {company['locations'][0]}"
                      if company.get("locations") else ""),
        })

    # ── Signal 2: newly registered companies (optional per ICP) ──
    if icp.get("include_new_companies"):
        try:
            region = (icp.get("regions") or [None])[0]
            fresh = await cached_fetch(
                "newco", {"region": region},
                lambda: _newco_fetch(region),
            )
            new_companies = fresh.get("companies") or []
        except Exception as e:
            new_companies = []
            notes.append(f"Nyregistrerade-signalen misslyckades: {e}")

        stats["signals_found"] += len(new_companies)
        for company in new_companies:
            used = await db.count_leads_this_month(org_id)
            if not within_quota(used, plan.leads_per_month):
                break
            dupe = await db.find_duplicate_lead(
                org_id,
                company_name=company.get("company_name"),
                org_number=company.get("org_number"),
            )
            if dupe:
                stats["duplicates_skipped"] += 1
                continue
            lead_id = await db.create_lead(org_id, None, {
                "company_name": company.get("company_name", "Unknown"),
                "org_number": company.get("org_number"),
                "location": company.get("address"),
                "source": "signal:newco",
                "score": 40,
                "score_reason": "Signalscore: nyregistrerat bolag — behöver "
                                "sannolikt webb/IT-grund (+basnivå)",
            })
            await db.add_lead_activity(
                org_id, lead_id, "created",
                f"Skördad som nyregistrerat bolag ({trigger} körning)",
            )
            stats["leads_created"] += 1

    top_leads.sort(key=lambda x: -x["score"])
    digest = _build_digest(icp, stats, top_leads, notes)
    run_id = await db.save_prospecting_run(
        org_id, icp.get("id"), trigger, stats, digest
    )
    return {"run_id": run_id, **stats, "digest": digest}


async def _newco_fetch(region: str | None) -> dict:
    companies = await allabolag_newly_registered(region)
    return {"companies": companies}


# ── Scheduler ─────────────────────────────────────────────────────────────────


async def scheduler_loop() -> None:
    """Hourly tick: run every auto-run ICP whose org hasn't had a scheduled
    run in the last SCHEDULE_INTERVAL_DAYS."""
    while True:
        try:
            await _scheduler_tick()
        except Exception:
            traceback.print_exc()
        await asyncio.sleep(SCHEDULER_TICK_SECONDS)


async def _scheduler_tick() -> None:
    icps = await db.list_auto_run_icps()
    ran_orgs: set[str] = set()
    for icp in icps:
        org_id = icp["org_id"]
        if org_id in ran_orgs:
            continue
        last = await db.last_scheduled_run_at(org_id)
        if last:
            try:
                last_dt = datetime.fromisoformat(last)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                age_days = (datetime.now(timezone.utc) - last_dt).days
                if age_days < SCHEDULE_INTERVAL_DAYS:
                    continue
            except ValueError:
                pass
        ran_orgs.add(org_id)
        try:
            await run_prospecting(org_id, icp, trigger="scheduled")
        except Exception:
            traceback.print_exc()
