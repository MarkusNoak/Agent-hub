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


def _ad_span_days(company: dict) -> int:
    first, latest = company.get("first_published"), company.get("latest_published")
    if not (first and latest):
        return 0
    try:
        return (datetime.fromisoformat(latest[:10])
                - datetime.fromisoformat(first[:10])).days
    except ValueError:
        return 0


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

    # Tech in ad text overlapping with what we sell / our roles
    our_stack = " ".join(
        [icp.get("what_we_sell") or ""] + (icp.get("target_roles") or [])
    ).lower()
    tech = company.get("tech_in_ads") or []
    overlap = [t for t in tech if t.lower().split("/")[0] in our_stack]
    if overlap:
        score += 8
        reasons.append(f"annonserna nämner vår tech ({', '.join(overlap[:3])}, +8)")

    # Already buying consultants — proven procurement behaviour
    if company.get("mentions_consultants"):
        score += 7
        reasons.append("anlitar redan konsulter enligt annonstext (+7)")

    # Sustained hiring over weeks = unfilled need (recruitment is failing)
    span = _ad_span_days(company)
    if span >= 21 and postings >= 2:
        score += 5
        reasons.append(f"långvarigt behov ({span} dagars annonsspann, +5)")

    if company.get("org_number"):
        score += 5
        reasons.append("verifierat orgnr från Arbetsförmedlingen (+5)")

    if icp.get("regions") and company.get("locations"):
        locs = " ".join(company["locations"]).lower()
        if any(r.lower() in locs for r in icp["regions"]):
            score += 10
            reasons.append("i vår målregion (+10)")

    return min(score, 95), "Signalscore: " + "; ".join(reasons)


async def _learned_score_floor(org_id: str) -> tuple[int, str | None]:
    """Outcome-calibrated harvest threshold: when the org has enough closed
    deals and the scoring is predictive, skip harvesting below the level
    where deals historically die. Saves lead quota and attention — the
    learning loop feeding back into acquisition."""
    import insights as insights_mod
    data = await insights_mod.pipeline_insights(org_id)
    calib = data["score_calibration"]
    if (calib["outcomes"] or 0) < 5:
        return 0, None
    avg_won, avg_lost = calib["avg_score_won"], calib["avg_score_lost"]
    if not (avg_won and avg_lost) or avg_won <= avg_lost:
        return 0, None
    floor = min(int(avg_lost) + 1, 70)
    return floor, (f"Lärd tröskel aktiv: skördar inte under score {floor} "
                   f"(förlorade affärer snittar {avg_lost:.0f}).")


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
    created_ids: list[str] = []
    notes: list[str] = []

    roles = icp.get("target_roles") or DEFAULT_ROLES
    regions = icp.get("regions") or None

    # Outcome-calibrated threshold (learning loop → acquisition)
    floor, floor_note = await _learned_score_floor(org_id)
    effective_min = max(int(icp.get("min_score") or 0), floor)
    if floor_note:
        notes.append(floor_note)

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

    # Cross-signal stacking: same company in several signal sets → boost
    newco_keys: set[str] = set()
    if icp.get("include_new_companies"):
        try:
            region = (icp.get("regions") or [None])[0]
            fresh = await cached_fetch(
                "newco", {"region": region}, lambda: _newco_fetch(region),
            )
            for c in fresh.get("companies") or []:
                if c.get("org_number"):
                    newco_keys.add(c["org_number"].replace("-", ""))
        except Exception:
            pass

    skipped_low = 0
    for company in companies:
        used = await db.count_leads_this_month(org_id)
        if not within_quota(used, plan.leads_per_month):
            notes.append(
                f"Lead-kvoten för månaden nådd ({plan.leads_per_month}) — "
                "körningen avbröts. Uppgradera planen för fler."
            )
            break

        if await db.is_company_blocked(
            org_id, company["company_name"], company.get("org_number")
        ):
            stats["duplicates_skipped"] += 1
            continue

        dupe = await db.find_duplicate_lead(
            org_id,
            company_name=company["company_name"],
            org_number=company.get("org_number"),
        )
        if dupe:
            stats["duplicates_skipped"] += 1
            continue

        score, reason = _score_hiring_company(company, icp)
        orgnr_key = (company.get("org_number") or "").replace("-", "")
        if orgnr_key and orgnr_key in newco_keys:
            score = min(score + 15, 98)
            reason += "; DUBBEL SIGNAL: även nyregistrerat bolag (+15)"

        if score < effective_min:
            skipped_low += 1
            continue

        ads = "; ".join(a["headline"] for a in company.get("sample_ads") or [])
        tech = ", ".join(company.get("tech_in_ads") or [])
        note_parts = []
        if ads:
            note_parts.append(f"Aktiva annonser: {ads}")
        if tech:
            note_parts.append(f"Tech i annonserna: {tech}")
        lead_id = await db.create_lead(org_id, None, {
            "company_name": company["company_name"],
            "org_number": company.get("org_number"),
            "location": ", ".join(company.get("locations") or []) or None,
            "source": "signal:hiring",
            "score": score,
            "score_reason": reason,
            "notes": " | ".join(note_parts) or None,
        })
        await db.add_lead_activity(
            org_id, lead_id, "created",
            f"Skördad från rekryteringssignal ({trigger} körning)",
        )
        stats["leads_created"] += 1
        created_ids.append(lead_id)
        top_leads.append({
            "company_name": company["company_name"],
            "score": score,
            "why": f"{company.get('postings', 0)} aktiva annonser"
                   + (f" i {company['locations'][0]}"
                      if company.get("locations") else ""),
        })

    if skipped_low:
        notes.append(
            f"{skipped_low} bolag under score-tröskeln ({effective_min}) "
            "skördades inte — sparar kvot åt starkare signaler."
        )

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
            if await db.is_company_blocked(
                org_id, company.get("company_name"), company.get("org_number")
            ):
                stats["duplicates_skipped"] += 1
                continue
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

    # Contact auto-enrich for the top of the run (live provider only)
    import contacts as contacts_mod
    if contacts_mod.contact_provider_live() and created_ids:
        try:
            enriched = await contacts_mod.auto_enrich_new_leads(
                org_id, created_ids, max_leads=5
            )
            if enriched:
                notes.append(
                    f"Kontaktuppgifter hittade för {enriched} av topp-leadsen "
                    "(namn/titel/e-post ifyllt automatiskt)."
                )
        except Exception as e:
            notes.append(f"Kontakt-berikning misslyckades: {e}")

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
