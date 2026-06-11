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
import re
import traceback
from datetime import datetime, timezone

import database as db
from enrichment.cache import cached_fetch
from enrichment.signals import (
    check_website_exists,
    extract_expansion_companies,
    extract_funding_companies,
    extract_leadership_changes,
    scan_expansion_news,
    scan_funding_news,
    scan_leadership_news,
    search_hiring_companies,
)
from enrichment.sweden import allabolag_newly_registered
from plans import get_plan, within_quota

DEFAULT_ROLES = ["systemutvecklare", "frontendutvecklare", "apputvecklare"]

# Ready-made ICP profiles for a Swedish web/app consultancy — one click in
# the GROWTH view instead of building from scratch. The payloads are plain
# create_icp input, so users can add one and then tweak it freely.
ICP_PRESETS = [
    {
        "id": "systemutveckling",
        "label": "Systemutveckling — bolag i utvecklingsfas",
        "description": ("Bolag i hela Sverige som rekryterar utvecklare, "
                        "tar in kapital eller expanderar — köper "
                        "systemutveckling och digitala lösningar."),
        "payload": {
            "name": "Systemutveckling — bolag i utvecklingsfas",
            "what_we_sell": ("systemutveckling och digitala lösningar "
                             "(webb, appar, integrationer)"),
            "target_roles": ["frontendutvecklare", "systemutvecklare",
                             "apputvecklare", "fullstackutvecklare"],
            "regions": [],
            "include_funding": True,
            "include_expansion": True,
        },
    },
    {
        "id": "startups-scaleups",
        "label": "Startups & scaleups",
        "description": ("Nystartade bolag (de utan webbplats flaggas), "
                        "färska kapitalrundor och ledningsbyten — hela "
                        "resan från MVP till skalning."),
        "payload": {
            "name": "Startups & scaleups",
            "what_we_sell": ("digitala lösningar för startups och scaleups "
                             "— MVP, webb och app"),
            "target_roles": [],
            "regions": [],
            "include_new_companies": True,
            "include_funding": True,
            "include_leadership": True,
            "include_expansion": True,
        },
    },
    {
        "id": "digital-marknadsforing",
        "label": "Digital marknadsföring — alla branscher",
        "description": ("Bolag som anställer marknadsroller, byter "
                        "marknadschef eller expanderar — de investerar i "
                        "synlighet just nu."),
        "payload": {
            "name": "Digital marknadsföring — alla branscher",
            "what_we_sell": ("digital marknadsföring (SEO, SEM, content "
                             "och sociala medier)"),
            "target_roles": ["marknadschef", "digital marknadsförare",
                             "marknadskoordinator", "growth marketer"],
            "regions": [],
            "include_expansion": True,
            "include_leadership": True,
        },
    },
    {
        "id": "ai-implementation",
        "label": "AI-implementation",
        "description": ("Bolag som rekryterar data/AI-roller eller just "
                        "fått kapital — mogna för AI i sina processer."),
        "payload": {
            "name": "AI-implementation",
            "what_we_sell": ("AI-implementation och automation av "
                             "affärsprocesser"),
            "target_roles": ["data scientist", "ai-utvecklare",
                             "machine learning engineer", "data engineer"],
            "regions": [],
            "include_funding": True,
            "include_leadership": True,
            "include_expansion": True,
        },
    },
    {
        "id": "offentlig",
        "label": "Offentlig sektor — IT-upphandlingar",
        "description": ("Aktiva IT-upphandlingar från TED. Publicerat behov "
                        "och budget; BEACON gör bid/no-bid."),
        "payload": {
            "name": "Offentlig sektor — IT-upphandlingar",
            "what_we_sell": "utvecklingstjänster mot offentlig sektor",
            "target_roles": [],
            "regions": [],
            "include_tenders": True,
        },
    },
    {
        "id": "ehandel",
        "label": "E-handel som växer",
        "description": ("Bolag som rekryterar e-handelsroller eller "
                        "expanderar — behov av butik, integrationer, fart."),
        "payload": {
            "name": "E-handel som växer",
            "what_we_sell": "e-handelsutveckling (Shopify och headless)",
            "target_roles": ["e-handelsansvarig", "e-handelsutvecklare",
                             "frontendutvecklare"],
            "regions": [],
            "include_expansion": True,
            "include_funding": True,
        },
    },
]
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


def _norm_company_key(name: str | None) -> str | None:
    """Normalized company-name key for cross-signal matching."""
    if not name:
        return None
    base = name.lower().strip()
    base = re.sub(r"\b(aktiebolag|ab|handelsbolag|hb|kb|as|aps|oy|ltd)\b", "", base)
    base = re.sub(r"[^a-zåäö0-9]+", "", base)
    return base or None


SIGNAL_LABELS = {
    "hiring": "rekryterar", "newco": "nyregistrerat", "funding": "ny finansiering",
    "expansion": "expanderar", "leadership": "ledningsbyte",
}


def _mark_presence(presence: dict, signal: str,
                   name: str | None, org_number: str | None) -> None:
    orgnr = (org_number or "").replace("-", "")
    if orgnr:
        presence.setdefault(f"org:{orgnr}", set()).add(signal)
    key = _norm_company_key(name)
    if key:
        presence.setdefault(f"name:{key}", set()).add(signal)


def _cross_signals(presence: dict, signal: str,
                   name: str | None, org_number: str | None) -> list[str]:
    """Other signals this company also appeared in during this run."""
    sigs: set[str] = set()
    orgnr = (org_number or "").replace("-", "")
    if orgnr:
        sigs |= presence.get(f"org:{orgnr}", set())
    key = _norm_company_key(name)
    if key:
        sigs |= presence.get(f"name:{key}", set())
    return sorted(sigs - {signal})


def _apply_cross_boost(presence: dict, signal: str, name: str | None,
                       org_number: str | None,
                       score: int, reason: str) -> tuple[int, str]:
    """Stacked signals are the strongest buying indicator we have: a company
    that is hiring AND just raised AND has a new CTO is in motion. +12 per
    extra signal, capped at 98."""
    others = _cross_signals(presence, signal, name, org_number)
    if not others:
        return score, reason
    boost = min(12 * len(others), 98 - score)
    labels = ", ".join(SIGNAL_LABELS.get(s, s) for s in others)
    return (score + max(boost, 0),
            reason + f"; KORSSIGNAL: även {labels} (+{max(boost, 0)})")


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



def _draft_for_lead(lead: dict, icp: dict) -> str | None:
    """Deterministic, signal-specific outreach template generated at
    sourcing time — specific opening, one CTA, lint-safe, ready for human
    review in Approvals (or for VANTAGE to refine)."""
    sell = icp.get("what_we_sell") or "utveckling av webb och appar"
    first_name = (lead.get("contact_name") or "").split(" ")[0]
    greeting = f"Hej {first_name}," if first_name else "Hej,"
    notes = lead.get("notes") or ""
    source = lead.get("source") or ""

    if source == "signal:hiring":
        first_ad = None
        if "Aktiva annonser: " in notes:
            first_ad = notes.split("Aktiva annonser: ", 1)[1]
            first_ad = first_ad.split(";")[0].split("|")[0].strip()
        opening = (f"ni annonserar just nu efter {first_ad}"
                   if first_ad else "ni rekryterar utvecklare just nu")
        return (f"{greeting}\n\n{opening} — och att tillsätta den typen av "
                f"roller tar ofta månader i dagens marknad.\n\nVi arbetar med "
                f"{sell} och kan avlasta ert team med start inom ett par "
                f"veckor, medan rekryteringen pågår.\n\nHar du 20 minuter "
                f"någon dag nästa vecka? {{{{booking_url}}}}\n\nVänliga hälsningar")

    if source == "signal:funding":
        amount = None
        reason = lead.get("score_reason") or ""
        if "(" in reason and ")" in reason:
            amount = reason.split("(", 1)[1].split(")", 1)[0]
        opening = (f"såg att ni tar in {amount}"
                   if amount and amount != "okänt belopp"
                   else "såg nyheten om er finansieringsrunda")
        return (f"{greeting}\n\n{opening} — den fasen brukar betyda att "
                f"mycket ska byggas på kort tid.\n\nVi arbetar med {sell} "
                f"och hjälper bolag i exakt det läget att leverera snabbare "
                f"utan att vänta in nyrekryteringar.\n\nHar du 20 minuter "
                f"nästa vecka? {{{{booking_url}}}}\n\nVänliga hälsningar")

    if source == "signal:newco":
        no_site = "Ingen webbplats hittad" in notes
        opening = ("ert bolag registrerades nyligen och vi hittade ingen "
                   "webbplats ännu" if no_site
                   else "ert bolag registrerades nyligen")
        return (f"{greeting}\n\n{opening} — i det skedet avgör den digitala "
                f"grunden hur snabbt ni kan börja sälja.\n\nVi arbetar med "
                f"{sell} och sätter upp webbplats och digitala flöden för "
                f"nystartade bolag på ett par veckor.\n\nVill du se ett par "
                f"exempel? {{{{booking_url}}}}\n\nVänliga hälsningar")

    if source == "signal:expansion":
        detail = None
        if "Expansion: " in notes:
            detail = notes.split("Expansion: ", 1)[1].split("|")[0].strip()
        opening = (f"såg att ni {detail}" if detail
                   else "såg nyheten om er expansion")
        return (f"{greeting}\n\n{opening} — tillväxt i den takten brukar "
                f"sätta press på både webb och interna system.\n\nVi arbetar "
                f"med {sell} och förstärker bolag i exakt det läget, utan "
                f"att ni behöver vänta in nyrekryteringar.\n\nHar du 20 "
                f"minuter nästa vecka? {{{{booking_url}}}}\n\nVänliga hälsningar")

    if source == "signal:leadership":
        role = None
        if "Ledningsbyte: ny " in notes:
            role = notes.split("Ledningsbyte: ny ", 1)[1]
            role = role.split("—")[0].split("|")[0].strip()
        opening = (f"såg att ni nyligen fått ny {role}"
                   if role else "såg nyheten om er nya ledning")
        return (f"{greeting}\n\n{opening} — de första månaderna i en sådan "
                f"roll handlar ofta om att se över verktyg och "
                f"leverantörer.\n\nVi arbetar med {sell} och brukar i det "
                f"läget göra en kort teknisk genomlysning som underlag för "
                f"prioriteringarna.\n\nVill du ha en sådan? "
                f"{{{{booking_url}}}}\n\nVänliga hälsningar")

    return None  # tenders go through BEACON's bid process, not cold email


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

    # ── Prefetch every enabled signal once, then build the cross-signal
    # presence map: a company appearing in several independent signal sets
    # is the strongest prospect of the run, whatever the combination.
    region = (icp.get("regions") or [None])[0]

    async def _safe(label: str, coro):
        try:
            return await coro
        except Exception as e:
            notes.append(f"{label} misslyckades: {e}")
            return {}

    # Hiring runs when the ICP names roles. An ICP with no roles but other
    # signals enabled (e.g. a tenders-only profile) skips it — defaulting to
    # developer ads there would pollute the pipeline with off-profile leads.
    other_signals = any(icp.get(k) for k in (
        "include_new_companies", "include_funding", "include_tenders",
        "include_expansion", "include_leadership"))
    include_hiring = bool(icp.get("target_roles")) or not other_signals

    companies: list[dict] = []
    if include_hiring:
        harvest = await _safe("Rekryteringssignalen", cached_fetch(
            "jobs_harvest", {"roles": roles, "regions": regions},
            lambda: search_hiring_companies(roles, regions, max_companies=25),
        ))
        companies = harvest.get("companies") or []

    new_companies: list[dict] = []
    if icp.get("include_new_companies"):
        fresh = await _safe("Nyregistrerade-signalen", cached_fetch(
            "newco", {"region": region}, lambda: _newco_fetch(region),
        ))
        new_companies = fresh.get("companies") or []

    funded: list[dict] = []
    if icp.get("include_funding"):
        news = await _safe("Finansieringssignalen", cached_fetch(
            "news", {"funding_harvest": 1}, lambda: _funding_fetch(),
        ))
        funded = extract_funding_companies(news.get("headlines") or [])

    expanding: list[dict] = []
    if icp.get("include_expansion"):
        news = await _safe("Expansionssignalen", cached_fetch(
            "news", {"expansion_harvest": 1}, lambda: scan_expansion_news(20),
        ))
        expanding = extract_expansion_companies(news.get("headlines") or [])

    new_leaders: list[dict] = []
    if icp.get("include_leadership"):
        news = await _safe("Ledningsbytessignalen", cached_fetch(
            "news", {"leadership_harvest": 1},
            lambda: scan_leadership_news(20),
        ))
        new_leaders = extract_leadership_changes(news.get("headlines") or [])

    presence: dict[str, set] = {}
    for c in companies:
        _mark_presence(presence, "hiring", c.get("company_name"), c.get("org_number"))
    for c in new_companies:
        _mark_presence(presence, "newco", c.get("company_name"), c.get("org_number"))
    for c in funded:
        _mark_presence(presence, "funding", c.get("company_name"), None)
    for c in expanding:
        _mark_presence(presence, "expansion", c.get("company_name"), None)
    for c in new_leaders:
        _mark_presence(presence, "leadership", c.get("company_name"), None)

    # Run-local dedupe on normalized name: a company in motion should be ONE
    # lead with stacked evidence (KORSSIGNAL), never one lead per signal.
    created_keys: set[str] = set()

    def _created_this_run(name: str | None) -> bool:
        key = _norm_company_key(name)
        return bool(key) and key in created_keys

    def _remember_created(name: str | None) -> None:
        key = _norm_company_key(name)
        if key:
            created_keys.add(key)

    # ── Signal 1: companies hiring the roles we deliver ──
    stats["signals_found"] += len(companies)
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
        score, reason = _apply_cross_boost(
            presence, "hiring", company["company_name"],
            company.get("org_number"), score, reason,
        )

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
        _remember_created(company["company_name"])
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
        stats["signals_found"] += len(new_companies)
        gap_checked = 0
        for company in new_companies:
            name = company.get("company_name", "Unknown")
            used = await db.count_leads_this_month(org_id)
            if not within_quota(used, plan.leads_per_month):
                break
            if await db.is_company_blocked(
                org_id, name, company.get("org_number")
            ):
                stats["duplicates_skipped"] += 1
                continue
            dupe = await db.find_duplicate_lead(
                org_id,
                company_name=name,
                org_number=company.get("org_number"),
            )
            if dupe or _created_this_run(name):
                stats["duplicates_skipped"] += 1
                continue

            score = 40
            reason = ("Signalscore: nyregistrerat bolag — behöver "
                      "sannolikt webb/IT-grund (+basnivå)")
            note = None

            # Digital-gap layer: a brand-new company with no website is the
            # highest-intent web prospect there is. DNS probes are free;
            # cap per run to keep harvests fast.
            if gap_checked < 8:
                gap_checked += 1
                try:
                    gap = await cached_fetch(
                        "dns_site", {"name": name},
                        lambda n=name: check_website_exists(n),
                    )
                except Exception:
                    gap = {}
                if gap.get("has_website") is False:
                    score += 15
                    reason += ("; ingen webbplats hittad på förväntade "
                               "domäner — digital lucka (+15)")
                    note = (f"Ingen webbplats hittad (kollade "
                            f"{', '.join(gap.get('checked') or [])}) — "
                            "heuristik, verifiera vid kontakt.")
                elif gap.get("has_website") and gap.get("domain"):
                    note = f"Trolig webbplats: {gap['domain']} (DNS-träff)."

            score, reason = _apply_cross_boost(
                presence, "newco", name, company.get("org_number"),
                score, reason,
            )

            lead_id = await db.create_lead(org_id, None, {
                "company_name": name,
                "org_number": company.get("org_number"),
                "location": company.get("address"),
                "source": "signal:newco",
                "score": score,
                "score_reason": reason,
                "notes": note,
            })
            await db.add_lead_activity(
                org_id, lead_id, "created",
                f"Skördad som nyregistrerat bolag ({trigger} körning)",
            )
            stats["leads_created"] += 1
            created_ids.append(lead_id)
            _remember_created(name)
            if score >= 55:
                top_leads.append({
                    "company_name": name, "score": score,
                    "why": "nyregistrerat utan webbplats — hög potential"
                           if "digital lucka" in reason else "nyregistrerat bolag",
                })

    # ── Signal 3: fresh funding rounds (optional per ICP) ──
    if icp.get("include_funding"):
        stats["signals_found"] += len(funded)
        added = 0
        for company in funded:
            if added >= 5:
                break
            used = await db.count_leads_this_month(org_id)
            if not within_quota(used, plan.leads_per_month):
                break
            if await db.is_company_blocked(org_id, company["company_name"], None):
                stats["duplicates_skipped"] += 1
                continue
            dupe = await db.find_duplicate_lead(
                org_id, company_name=company["company_name"]
            )
            if dupe or _created_this_run(company["company_name"]):
                stats["duplicates_skipped"] += 1
                continue
            score = 65 if " ab" in company["company_name"].lower() + " " else 60
            reason = ("Signalscore: ny finansiering "
                      f"({company.get('amount') or 'okänt belopp'}) — "
                      "färskt kapital finansierar digitala projekt (+15)")
            score, reason = _apply_cross_boost(
                presence, "funding", company["company_name"], None,
                score, reason,
            )
            lead_id = await db.create_lead(org_id, None, {
                "company_name": company["company_name"],
                "source": "signal:funding",
                "score": score,
                "score_reason": reason,
                "notes": f"Rubrik: {company['headline']} | {company.get('link') or ''} "
                         "| VERIFIERA bolaget via registerkoll innan outreach.",
            })
            await db.add_lead_activity(
                org_id, lead_id, "created",
                f"Skördad från finansieringssignal ({trigger} körning)",
            )
            stats["leads_created"] += 1
            created_ids.append(lead_id)
            _remember_created(company["company_name"])
            added += 1
            top_leads.append({
                "company_name": company["company_name"], "score": score,
                "why": f"tar in {company.get('amount') or 'kapital'} enligt media",
            })

    # ── Signal 4: expansion & establishment news (optional per ICP) ──
    if icp.get("include_expansion"):
        stats["signals_found"] += len(expanding)
        added = 0
        for company in expanding:
            if added >= 5:
                break
            used = await db.count_leads_this_month(org_id)
            if not within_quota(used, plan.leads_per_month):
                break
            if await db.is_company_blocked(org_id, company["company_name"], None):
                stats["duplicates_skipped"] += 1
                continue
            dupe = await db.find_duplicate_lead(
                org_id, company_name=company["company_name"]
            )
            if dupe or _created_this_run(company["company_name"]):
                stats["duplicates_skipped"] += 1
                continue
            score = 65 if company.get("kind") == "hiring_plan" else 60
            reason = (f"Signalscore: expansion ({company['detail']}) — "
                      "tillväxt i den skalan drar med sig digitala projekt")
            score, reason = _apply_cross_boost(
                presence, "expansion", company["company_name"], None,
                score, reason,
            )
            lead_id = await db.create_lead(org_id, None, {
                "company_name": company["company_name"],
                "source": "signal:expansion",
                "score": score,
                "score_reason": reason,
                "notes": f"Expansion: {company['detail']} | "
                         f"Rubrik: {company['headline']} | "
                         f"{company.get('link') or ''} "
                         "| VERIFIERA bolaget via registerkoll innan outreach.",
            })
            await db.add_lead_activity(
                org_id, lead_id, "created",
                f"Skördad från expansionssignal ({trigger} körning)",
            )
            stats["leads_created"] += 1
            created_ids.append(lead_id)
            _remember_created(company["company_name"])
            added += 1
            top_leads.append({
                "company_name": company["company_name"], "score": score,
                "why": company["detail"] + " enligt media",
            })

    # ── Signal 5: leadership changes (optional per ICP) ──
    if icp.get("include_leadership"):
        stats["signals_found"] += len(new_leaders)
        added = 0
        for company in new_leaders:
            if added >= 5:
                break
            used = await db.count_leads_this_month(org_id)
            if not within_quota(used, plan.leads_per_month):
                break
            if await db.is_company_blocked(org_id, company["company_name"], None):
                stats["duplicates_skipped"] += 1
                continue
            dupe = await db.find_duplicate_lead(
                org_id, company_name=company["company_name"]
            )
            if dupe or _created_this_run(company["company_name"]):
                stats["duplicates_skipped"] += 1
                continue
            role = company.get("role") or "vd"
            person = company.get("person")
            score = 60 if role in ("vd", "cto", "cio", "it-chef",
                                   "digitaliseringschef") else 55
            reason = (f"Signalscore: ny {role}"
                      + (f" ({person})" if person else "")
                      + " — nya ledare ser över leverantörer och digitala "
                        "verktyg under sina första månader")
            score, reason = _apply_cross_boost(
                presence, "leadership", company["company_name"], None,
                score, reason,
            )
            lead_id = await db.create_lead(org_id, None, {
                "company_name": company["company_name"],
                "contact_name": person,
                "source": "signal:leadership",
                "score": score,
                "score_reason": reason,
                "notes": f"Ledningsbyte: ny {role}"
                         + (f" — {person}" if person else "")
                         + f" | Rubrik: {company['headline']} | "
                         f"{company.get('link') or ''} "
                         "| VERIFIERA bolaget via registerkoll innan outreach.",
            })
            await db.add_lead_activity(
                org_id, lead_id, "created",
                f"Skördad från ledningsbytessignal ({trigger} körning)",
            )
            stats["leads_created"] += 1
            created_ids.append(lead_id)
            _remember_created(company["company_name"])
            added += 1
            top_leads.append({
                "company_name": company["company_name"], "score": score,
                "why": f"ny {role}" + (f" ({person})" if person else "")
                       + " — färskt beslutsfönster",
            })

    # ── Signal 6: public tenders (optional per ICP) ──
    if icp.get("include_tenders"):
        try:
            tenders = await cached_fetch(
                "tenders", {"harvest": 1, "category": "it", "country": "SWE"},
                lambda: _tender_fetch(),
            )
            tender_list = tenders.get("tenders") or []
        except Exception as e:
            tender_list = []
            notes.append(f"Upphandlingssignalen misslyckades: {e}")

        stats["signals_found"] += len(tender_list)
        added = 0
        for tender in tender_list:
            if added >= 5 or not tender.get("buyer") or not tender.get("title"):
                continue
            used = await db.count_leads_this_month(org_id)
            if not within_quota(used, plan.leads_per_month):
                break
            # One lead per tender: buyer + title makes the dedupe key unique
            lead_name = f"{tender['buyer']}: {tender['title'][:60]}"
            dupe = await db.find_duplicate_lead(org_id, company_name=lead_name)
            if dupe:
                stats["duplicates_skipped"] += 1
                continue
            score = 70 if tender.get("estimated_value") else 60
            value = (f"{tender['estimated_value']} {tender.get('currency') or ''}".strip()
                     if tender.get("estimated_value") else "ej angivet")
            lead_id = await db.create_lead(org_id, None, {
                "company_name": lead_name,
                "source": "signal:tender",
                "score": score,
                "score_reason": "Signalscore: aktiv offentlig upphandling — "
                                f"publicerat behov och budget ({value})",
                "notes": f"Deadline: {tender.get('deadline') or 'se annons'} | "
                         f"{tender.get('url') or ''} | Be BEACON göra "
                         "bid/no-bid-bedömning.",
            })
            await db.add_lead_activity(
                org_id, lead_id, "created",
                f"Skördad från upphandlingssignal ({trigger} körning)",
            )
            stats["leads_created"] += 1
            added += 1
            top_leads.append({
                "company_name": tender["buyer"], "score": score,
                "why": f"upphandlar IT (deadline {tender.get('deadline') or '?'})",
            })

    top_leads.sort(key=lambda x: -x["score"])

    # Contact auto-enrich for the top of the run (live provider only)
    import contacts as contacts_mod
    if contacts_mod.contact_provider_live() and created_ids:
        try:
            enriched = await contacts_mod.auto_enrich_new_leads(
                org_id, created_ids, max_leads=8
            )
            if enriched:
                notes.append(
                    f"Kontaktuppgifter hittade för {enriched} av topp-leadsen "
                    "(namn/titel/e-post ifyllt automatiskt)."
                )
        except Exception as e:
            notes.append(f"Kontakt-berikning misslyckades: {e}")

    # Sourcing-time outreach: deterministic template for every lead (free),
    # then the top leads get an LLM-refined version grounded in the lead's
    # signal facts and the org's reference cases — lint-gated, template kept
    # on any failure.
    import outreach_writer
    settings = await db.get_org_settings(org_id)
    cases = await db.list_knowledge(org_id, kind="case", limit=1)
    case = cases[0] if cases else None

    drafted = 0
    refined = 0
    for i, lead_id in enumerate(created_ids):
        lead = await db.get_lead(org_id, lead_id)
        if not lead or lead.get("outreach_draft"):
            continue
        draft = _draft_for_lead(lead, icp)
        if not draft:
            continue
        if i < outreach_writer.MAX_REFINED_PER_RUN:
            better = await outreach_writer.refine_draft(
                {**lead, "outreach_draft": draft}, icp,
                settings.get("business_profile"), case,
            )
            if better:
                draft = better
                refined += 1
        await db.update_lead(org_id, lead_id, {"outreach_draft": draft})
        drafted += 1
    if drafted:
        msg = f"Outreach-utkast genererade för {drafted} nya leads"
        if refined:
            msg += (f", varav {refined} AI-förfinade mot era referenscase"
                    if case else f", varav {refined} AI-förfinade")
        notes.append(msg + " — granska i leadet eller låt VANTAGE vässa.")

    digest = _build_digest(icp, stats, top_leads, notes)
    run_id = await db.save_prospecting_run(
        org_id, icp.get("id"), trigger, stats, digest
    )
    return {"run_id": run_id, **stats, "digest": digest}


async def _newco_fetch(region: str | None) -> dict:
    companies = await allabolag_newly_registered(region)
    return {"companies": companies}


async def _funding_fetch() -> dict:
    return await scan_funding_news(None, limit=20)


async def _tender_fetch() -> dict:
    from enrichment.procurement import find_tenders
    return await find_tenders(category="it", country="SWE", limit=10)


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
