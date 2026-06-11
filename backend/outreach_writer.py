"""LLM-refined outreach drafts for harvested leads.

The deterministic templates in growth.py are the zero-cost floor; this
module lifts the TOP leads of each run to hand-written quality using a
small model. Strictly budgeted: only the leads that also get contact
enrichment (top 8 per run), a few hundred tokens each, and every result
must pass the same spam lint as human-written outreach — on any failure
the template stays.
"""

import os

WRITER_MODEL = (os.environ.get("WRITER_MODEL")
                or os.environ.get("CLASSIFIER_MODEL", "claude-haiku-4-5"))
MAX_REFINED_PER_RUN = 8


def writer_live() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


SYSTEM = """Du skriver första-kontakt-mejl på svenska för ett konsultbolag.
Skriv om UTKASTET nedan till toppklass med hjälp av LEAD-fakta. Regler:
1. ÖPPNING: första meningen är en specifik, verifierbar observation om
   mottagarens bolag, hämtad ur LEAD-fakta. Aldrig "vi är..." först.
2. BRYGGA: en mening som kopplar observationen till ett problem vi löser.
3. BEVIS: om REFERENSCASE finns, väv in EN konkret rad därifrån (med
   siffra om det finns). Finns inget case — hoppa över, hitta ALDRIG på.
4. CTA: exakt EN lågtröskelfråga. Behåll platshållaren {{booking_url}}.
5. FORM: under 110 ord. Korta meningar. Mottagarens förnamn i hälsningen
   om det finns, annars "Hej,". Inga klyschor ("hoppas allt är bra",
   "följer er resa", "imponeras av"), inga buzzwords (digitalisering,
   synergier, helhetslösning), max ett utropstecken, inga superlativ om
   oss själva. Avsluta med "Vänliga hälsningar".
Returnera ENBART mejltexten — ingen ämnesrad, inga förklaringar."""


def _facts_block(lead: dict, icp: dict, business_profile: str | None,
                 case: dict | None) -> str:
    first_name = (lead.get("contact_name") or "").split(" ")[0]
    lines = [
        f"BOLAG: {lead.get('company_name')}",
        f"SIGNAL: {lead.get('source')}",
        f"SIGNALFAKTA: {lead.get('score_reason') or '-'}",
        f"ANTECKNINGAR: {(lead.get('notes') or '-')[:400]}",
        f"MOTTAGARE: {lead.get('contact_name') or 'okänd'}"
        + (f" ({lead.get('contact_title')})" if lead.get('contact_title') else "")
        + (f", förnamn: {first_name}" if first_name else ""),
        f"VI SÄLJER: {icp.get('what_we_sell') or 'utveckling av webb och appar'}",
    ]
    if business_profile:
        lines.append(f"OM OSS: {business_profile[:300]}")
    if case:
        lines.append(f"REFERENSCASE: {case.get('title')} — "
                     f"{(case.get('content') or '')[:300]}")
    lines.append(f"\nUTKAST:\n{lead.get('outreach_draft') or '(saknas)'}")
    return "\n".join(lines)


async def refine_draft(lead: dict, icp: dict, business_profile: str | None,
                       case: dict | None) -> str | None:
    """Returns an improved draft, or None to keep the template."""
    if not writer_live():
        return None
    from anthropic import AsyncAnthropic
    try:
        client = AsyncAnthropic()
        msg = await client.messages.create(
            model=WRITER_MODEL,
            max_tokens=400,
            system=SYSTEM,
            messages=[{"role": "user",
                       "content": _facts_block(lead, icp,
                                               business_profile, case)}],
        )
        text = (msg.content[0].text or "").strip()
    except Exception:
        return None

    if not text or len(text.split()) > 130 or "{{booking_url}}" not in text:
        return None
    from outreach import spam_lint
    if spam_lint("Angående er utveckling", text):
        return None
    return text
