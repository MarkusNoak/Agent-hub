"""Learning loop: pipeline outcomes → calibrated strategy.

Computes deterministic performance statistics from the org's own pipeline
history (won/lost outcomes, sources, score bands, outreach replies) and
turns them into concrete recommendations. Every closed deal makes next
month's prospecting sharper — that is the compounding advantage.
"""

import aiosqlite

from database import DB_PATH

MIN_SAMPLE = 3  # don't draw conclusions from fewer outcomes than this


async def _rows(query: str, params: list) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cur:
            return [dict(r) for r in await cur.fetchall()]


def _win_rate_table(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        total = r["won"] + r["lost"]
        out.append({
            "segment": r["segment"] or "(okänt)",
            "won": r["won"],
            "lost": r["lost"],
            "open": r["open"],
            "win_rate": round(r["won"] / total, 2) if total else None,
            "sample": total,
        })
    out.sort(key=lambda x: (-(x["win_rate"] or 0), -x["sample"]))
    return out


async def _breakdown(org_id: str, dimension_sql: str) -> list[dict]:
    rows = await _rows(
        f"""
        SELECT {dimension_sql} AS segment,
               SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END)  AS won,
               SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost,
               SUM(CASE WHEN status NOT IN ('won','lost') THEN 1 ELSE 0 END) AS open
        FROM leads WHERE org_id = ?
        GROUP BY segment
        """,
        [org_id],
    )
    return _win_rate_table(rows)


async def pipeline_insights(org_id: str) -> dict:
    funnel_rows = await _rows(
        "SELECT status, COUNT(*) AS n FROM leads WHERE org_id = ? "
        "GROUP BY status",
        [org_id],
    )
    funnel = {r["status"]: r["n"] for r in funnel_rows}
    total = sum(funnel.values())

    by_source = await _breakdown(org_id, "source")
    by_industry = await _breakdown(org_id, "industry")
    by_score = await _breakdown(
        org_id,
        "CASE WHEN score >= 80 THEN '80-100' "
        "WHEN score >= 60 THEN '60-79' "
        "WHEN score >= 40 THEN '40-59' "
        "WHEN score IS NOT NULL THEN '0-39' ELSE NULL END",
    )

    # Score calibration: does our scoring actually predict outcomes?
    calib = await _rows(
        "SELECT AVG(CASE WHEN status='won' THEN score END)  AS avg_won, "
        "       AVG(CASE WHEN status='lost' THEN score END) AS avg_lost, "
        "       SUM(CASE WHEN status='won' THEN 1 ELSE 0 END)  AS n_won, "
        "       SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) AS n_lost "
        "FROM leads WHERE org_id = ? AND score IS NOT NULL",
        [org_id],
    )
    c = calib[0] if calib else {}

    # Outreach effectiveness from the activity log
    activity = await _rows(
        "SELECT "
        " SUM(CASE WHEN kind IN ('email_sent','email_simulated') THEN 1 ELSE 0 END) AS sends, "
        " SUM(CASE WHEN kind = 'reply_received' THEN 1 ELSE 0 END) AS replies, "
        " SUM(CASE WHEN kind = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubs "
        "FROM lead_activities WHERE org_id = ?",
        [org_id],
    )
    a = activity[0] if activity else {"sends": 0, "replies": 0, "unsubs": 0}
    reply_rate = (round(a["replies"] / a["sends"], 2)
                  if a.get("sends") else None)

    recommendations = _recommend(funnel, by_source, by_industry, c, a)

    return {
        "total_leads": total,
        "funnel": funnel,
        "meetings_booked": funnel.get("meeting", 0) + funnel.get("won", 0),
        "by_source": by_source,
        "by_industry": by_industry[:8],
        "by_score_band": by_score,
        "score_calibration": {
            "avg_score_won": round(c["avg_won"], 1) if c.get("avg_won") else None,
            "avg_score_lost": round(c["avg_lost"], 1) if c.get("avg_lost") else None,
            "outcomes": (c.get("n_won") or 0) + (c.get("n_lost") or 0),
        },
        "outreach": {
            "emails_sent": a.get("sends") or 0,
            "replies": a.get("replies") or 0,
            "reply_rate": reply_rate,
            "unsubscribes": a.get("unsubs") or 0,
        },
        "recommendations": recommendations,
    }


def _recommend(funnel: dict, by_source: list, by_industry: list,
               calib: dict, activity: dict) -> list[str]:
    recs: list[str] = []

    closed = funnel.get("won", 0) + funnel.get("lost", 0)
    if closed < MIN_SAMPLE:
        recs.append(
            "För få avslutade affärer för statistiska slutsatser ännu — "
            "stäng fler leads (won/lost) så kalibreras strategin automatiskt."
        )
        return recs

    best_src = next((s for s in by_source
                     if s["sample"] >= MIN_SAMPLE and s["win_rate"]), None)
    if best_src:
        recs.append(
            f"Bästa leadkälla: '{best_src['segment']}' med "
            f"{int(best_src['win_rate'] * 100)}% win-rate "
            f"({best_src['sample']} utfall) — prioritera den signalen."
        )

    best_ind = next((s for s in by_industry
                     if s["sample"] >= MIN_SAMPLE and s["win_rate"]), None)
    if best_ind and best_ind["segment"] != "(okänt)":
        recs.append(
            f"Starkaste bransch: {best_ind['segment']} "
            f"({int(best_ind['win_rate'] * 100)}% win-rate) — vikta ICP:n "
            "mot den och återanvänd referenscase i outreach."
        )

    avg_won, avg_lost = calib.get("avg_won"), calib.get("avg_lost")
    if avg_won and avg_lost:
        if avg_won <= avg_lost:
            recs.append(
                "VARNING: vunna affärer hade INTE högre score än förlorade — "
                f"(vunna {avg_won:.0f} vs förlorade {avg_lost:.0f}). "
                "Scoringmodellen behöver omviktas; be VANTAGE analysera vad "
                "de vunna affärerna hade gemensamt."
            )
        else:
            recs.append(
                f"Scoringen fungerar: vunna affärer snittar {avg_won:.0f} "
                f"poäng mot {avg_lost:.0f} för förlorade. Lita på "
                "prioriteringsordningen."
            )

    sends, replies = activity.get("sends") or 0, activity.get("replies") or 0
    if sends >= 10:
        rate = replies / sends
        if rate < 0.05:
            recs.append(
                f"Svarsfrekvensen är låg ({rate:.0%} på {sends} mejl) — "
                "öka personaliseringen: öppna med konkret enrichment-fynd, "
                "kortare mejl, tydligare CTA."
            )
        else:
            recs.append(
                f"Svarsfrekvens {rate:.0%} på {sends} mejl — över "
                "B2B-snittet. Skala upp volymen inom dagsgränsen."
            )

    return recs
