"""Outreach engine: email sequences, GDPR guardrails, reply handling.

Flow: VANTAGE (or the UI) starts a sequence of up to 3 personalized emails
for a lead. The engine sends due steps, appends a Swedish GDPR footer with a
working unsubscribe link, respects the per-org daily send limit and the
suppression list, and stops the sequence the moment a reply arrives. Replies
are matched to leads via IMAP polling and (when an Anthropic key is present)
classified so the pipeline updates itself: meeting booked, interested,
not-now, or opt-out.

Safety default: without EMAIL_ENABLED=true, sends are SIMULATED — fully
logged, nothing leaves the machine. That makes the whole flow demoable and
testable before SMTP credentials exist.

Env: EMAIL_ENABLED, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
     IMAP_HOST, IMAP_USER, IMAP_PASS, APP_BASE_URL
"""

import asyncio
import email as email_lib
import email.utils
import hashlib
import hmac
import imaplib
import os
import smtplib
import traceback
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import re
from zoneinfo import ZoneInfo

import database as db
from auth import jwt_secret

SE_TZ = ZoneInfo("Europe/Stockholm")

MAX_STEPS = 3
DEFAULT_DAILY_LIMIT = 20
SEQUENCE_TICK_SECONDS = 300
INBOX_TICK_SECONDS = 600

VALID_SEND_STATUSES = {"new", "qualified", "contacted"}

REPLY_CLASSES = {"meeting", "interested", "not_now", "negative", "unsubscribe"}


HOOK_TYPES = {"hiring", "news", "tech_gap", "maturity", "funding",
              "referral", "other"}

# Deterministic deliverability lint — emails that trip spam filters never
# get a reply, so they are rejected before scheduling (free precision)
SPAM_WORDS = (
    "gratis", "erbjudande", "klicka här", "garanterat", "100%", "vinn",
    "free", "buy now", "limited offer", "act now", "no obligation",
)

# Generic cold-email clichés kill reply rates — reject and make the agent
# rewrite with a specific observation instead
CLICHE_PATTERNS = (
    r"vi på .{0,40}?(följer|har följt)",
    r"hoppas (att )?(allt är|du har|ni har|det är)",
    r"i hope this (e-?mail )?finds you",
    r"imponeras av",
    r"imponerande (tillväxt|resa|utveckling)",
    r"jag heter .{0,40}?(och|på)",
    r"(we|vi) (are|är) (a |en |ett )?(leading|ledande)",
    r"hör (gärna )?av (er|dig) vid intresse",
    r"din digitala partner",
    r"helhetslösning",
)


def spam_lint(subject: str, body: str) -> list[str]:
    issues = []
    if len(subject) > 70:
        issues.append("subject over 70 chars — gets truncated and looks bulk")
    letters = [c for c in subject if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.5:
        issues.append("subject is mostly CAPS — classic spam trigger")
    if subject.count("!") + body.count("!") > 2:
        issues.append("too many exclamation marks")
    lower = f"{subject} {body}".lower()
    hits = [w for w in SPAM_WORDS if w in lower]
    if hits:
        issues.append(f"spam-trigger words: {', '.join(hits)}")
    for pattern in CLICHE_PATTERNS:
        m = re.search(pattern, lower)
        if m:
            issues.append(
                f"generic cold-email cliché ('{m.group(0)[:40]}') — open "
                "with a specific, verifiable observation about the "
                "recipient instead")
    links = len(re.findall(r"https?://", body))
    if links > 2:
        issues.append(f"{links} links — keep at most 2 (booking link counts)")
    if len(body.split()) > 170:
        issues.append("body over ~170 words — cold emails must be short")
    return issues


def next_send_window(after: datetime) -> datetime:
    """Align sends to Tue-Thu 08:00-10:00 Swedish time — when B2B replies
    actually happen. If 'after' already falls in a window, keep it."""
    local = after.astimezone(SE_TZ)
    if local.weekday() in (1, 2, 3):
        if 8 <= local.hour < 10:
            return after
        if local.hour < 8:  # same-day window still ahead
            return local.replace(
                hour=8, minute=30, second=0, microsecond=0
            ).astimezone(timezone.utc)
    candidate = local
    for _ in range(8):
        candidate = candidate + timedelta(days=1)
        if candidate.weekday() in (1, 2, 3):
            return candidate.replace(
                hour=8, minute=30, second=0, microsecond=0
            ).astimezone(timezone.utc)
    return after  # unreachable, defensive


def email_enabled() -> bool:
    return os.environ.get("EMAIL_ENABLED", "").lower() in ("1", "true", "yes")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Unsubscribe tokens (HMAC — no DB lookup needed to verify) ────────────────


def unsubscribe_token(org_id: str, recipient: str) -> str:
    payload = f"{org_id}|{recipient.strip().lower()}".encode()
    return hmac.new(jwt_secret().encode(), payload, hashlib.sha256).hexdigest()[:32]


def verify_unsubscribe_token(org_id: str, recipient: str, token: str) -> bool:
    return hmac.compare_digest(unsubscribe_token(org_id, recipient), token)


def gdpr_footer(org_name: str, org_id: str, recipient: str) -> str:
    base = os.environ.get("APP_BASE_URL", "http://localhost:8000").rstrip("/")
    token = unsubscribe_token(org_id, recipient)
    link = (f"{base}/unsubscribe?org={org_id}"
            f"&email={recipient.strip().lower()}&token={token}")
    return (
        f"\n\n--\n{org_name}\n"
        "Du får detta mejl för att vi bedömt att innehållet är relevant för "
        "din yrkesroll (berättigat intresse enligt GDPR art. 6.1 f).\n"
        f"Vill du inte bli kontaktad igen? Avregistrera dig här: {link}"
    )


# ── Sending ───────────────────────────────────────────────────────────────────


def _smtp_send(to_addr: str, subject: str, body: str) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASS")
    from_addr = os.environ.get("SMTP_FROM") or user

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.starttls()
        if user and password:
            smtp.login(user, password)
        smtp.send_message(msg)


async def send_email(to_addr: str, subject: str, body: str) -> str:
    """Returns 'sent' or 'simulated'."""
    if not email_enabled() or not os.environ.get("SMTP_HOST"):
        return "simulated"
    await asyncio.to_thread(_smtp_send, to_addr, subject, body)
    return "sent"


# ── Starting sequences (with guardrails) ─────────────────────────────────────


async def start_sequence(
    org_id: str,
    lead_id: str,
    steps: list[dict],
    relevance_basis: str,
    hook_type: str = "other",
) -> dict:
    """Validates guardrails and schedules the steps. steps:
    [{subject, body, days_after}] — sends align to the Tue-Thu morning
    window (Swedish time). hook_type tags the opening angle so the learning
    loop can measure which angles get replies."""
    lead = await db.get_lead(org_id, lead_id)
    if not lead:
        return {"error": "Lead not found"}
    recipient = (lead.get("contact_email") or "").strip().lower()
    if not recipient:
        return {"error": "Lead has no contact_email — find and verify one "
                         "before starting outreach (check_email_domain helps)."}
    if not relevance_basis or len(relevance_basis) < 20:
        return {"error": "GDPR guardrail: provide relevance_basis — one or two "
                         "sentences on WHY this is relevant to the recipient's "
                         "role. It is stored as legitimate-interest "
                         "documentation."}
    if await db.is_suppressed(org_id, recipient):
        return {"error": f"{recipient} has opted out (suppression list). "
                         "Do not contact; mark the lead lost."}
    account = await db.find_account_for_company(
        org_id, lead.get("company_name"), lead.get("org_number"))
    if account and account["status"] != "former":
        return {"error": f"{lead.get('company_name')} är en befintlig "
                         f"{account['status']} i kundregistret — kalla "
                         "utskick till egna kunder är blockerade. Prata "
                         "med dem direkt i stället."}
    if await db.has_active_sequence(org_id, lead_id):
        return {"error": "An active sequence already exists for this lead. "
                         "Cancel it first if you want to replace it."}
    if lead.get("status") not in VALID_SEND_STATUSES:
        return {"error": f"Lead status is '{lead['status']}' — sequences only "
                         "run for new/qualified/contacted leads."}
    if not steps or len(steps) > MAX_STEPS:
        return {"error": f"Provide 1-{MAX_STEPS} steps."}

    settings = await db.get_org_settings(org_id)
    booking_url = settings.get("booking_url") or ""
    require_approval = bool(settings.get("require_approval", True))
    initial_status = "awaiting_approval" if require_approval else "pending"
    hook = hook_type if hook_type in HOOK_TYPES else "other"

    now = _now()
    prepared = []
    offset_days = 0
    for i, step in enumerate(steps, 1):
        if not step.get("subject") or not step.get("body"):
            return {"error": f"Step {i} is missing subject or body."}
        lint = spam_lint(step["subject"], step["body"])
        if lint:
            return {"error": f"Deliverability lint failed on step {i} — "
                             "rewrite and retry: " + "; ".join(lint)}
        if i > 1:
            offset_days += max(int(step.get("days_after", 3)), 1)
        body = step["body"].replace("{{booking_url}}", booking_url)
        send_at = next_send_window(now + timedelta(days=offset_days))
        prepared.append({
            "subject": step["subject"],
            "body": body,
            "send_at": send_at.isoformat(),
            "hook_type": hook,
            "status": initial_status,
        })

    await db.create_sequence(org_id, lead_id, prepared)
    await db.add_lead_activity(
        org_id, lead_id, "sequence_started",
        f"{len(prepared)} steg schemalagda till {recipient}. "
        f"Relevansgrund (GDPR): {relevance_basis}",
    )
    mode = "LIVE" if email_enabled() else "DRY-RUN (EMAIL_ENABLED is off — steps will be simulated)"
    result = {"ok": True, "steps_scheduled": len(prepared),
              "recipient": recipient, "mode": mode, "hook_type": hook,
              "first_send": prepared[0]["send_at"]
              + " (aligned to Tue-Thu 08-10 Swedish time)"}
    if require_approval:
        result["approval"] = ("Steps are AWAITING APPROVAL in the Approvals "
                              "inbox — nothing sends until a human approves. "
                              "Tell the user to review them there.")
    return result


async def cancel_lead_sequence(org_id: str, lead_id: str, reason: str) -> int:
    cancelled = await db.cancel_sequence(org_id, lead_id)
    if cancelled:
        await db.add_lead_activity(
            org_id, lead_id, "sequence_cancelled",
            f"{cancelled} steg avbrutna. Orsak: {reason}",
        )
    return cancelled


# ── Engine loop: send due steps ───────────────────────────────────────────────


async def sequence_tick() -> None:
    now = _now()
    steps = await db.due_sequence_steps(now.isoformat())
    for step in steps:
        org_id, lead_id = step["org_id"], step["lead_id"]
        try:
            lead = await db.get_lead(org_id, lead_id)
            if not lead or lead.get("status") not in VALID_SEND_STATUSES:
                await db.mark_step(step["id"], "cancelled")
                continue
            recipient = (lead.get("contact_email") or "").strip().lower()
            if not recipient or await db.is_suppressed(org_id, recipient):
                await db.mark_step(step["id"], "cancelled")
                continue

            settings = await db.get_org_settings(org_id)
            limit = int(settings.get("daily_send_limit", DEFAULT_DAILY_LIMIT))
            sent_today = await db.count_sends_today(
                org_id, now.strftime("%Y-%m-%d")
            )
            if sent_today >= limit:
                continue  # stays pending; retried next tick / tomorrow

            org = await db.get_organization(org_id)
            body = step["body"] + gdpr_footer(org["name"], org_id, recipient)
            result = await send_email(recipient, step["subject"], body)
            await db.mark_step(step["id"], result, now.isoformat())
            await db.add_lead_activity(
                org_id, lead_id, "email_" + result,
                f"Steg {step['step']}: \"{step['subject']}\" till {recipient}",
            )
            if lead["status"] in ("new", "qualified"):
                await db.update_lead(org_id, lead_id, {"status": "contacted"})
        except Exception:
            traceback.print_exc()


async def sequence_loop() -> None:
    while True:
        try:
            await sequence_tick()
        except Exception:
            traceback.print_exc()
        await asyncio.sleep(SEQUENCE_TICK_SECONDS)


# ── Replies: IMAP polling + classification ───────────────────────────────────


def _imap_fetch_unseen() -> list[dict]:
    host = os.environ.get("IMAP_HOST")
    user = os.environ.get("IMAP_USER")
    password = os.environ.get("IMAP_PASS")
    if not (host and user and password):
        return []

    messages = []
    with imaplib.IMAP4_SSL(host) as imap:
        imap.login(user, password)
        imap.select("INBOX")
        _, data = imap.search(None, "UNSEEN")
        for num in (data[0].split() if data and data[0] else [])[:50]:
            _, msg_data = imap.fetch(num, "(RFC822)")
            if not msg_data or not msg_data[0]:
                continue
            msg = email_lib.message_from_bytes(msg_data[0][1])
            from_addr = email.utils.parseaddr(msg.get("From", ""))[1].lower()
            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        payload = part.get_payload(decode=True)
                        if payload:
                            body = payload.decode(errors="replace")
                            break
            else:
                payload = msg.get_payload(decode=True)
                if payload:
                    body = payload.decode(errors="replace")
            messages.append({
                "from": from_addr,
                "subject": msg.get("Subject", ""),
                "body": body[:3000],
            })
    return messages


async def classify_reply(subject: str, body: str) -> str:
    """Classify a reply with a cheap model call; falls back to 'interested'
    heuristics when no API key is configured."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        lower = f"{subject} {body}".lower()
        if any(w in lower for w in ("avregistrera", "unsubscribe", "sluta",
                                    "ta bort mig")):
            return "unsubscribe"
        if any(w in lower for w in ("inte intresserad", "nej tack",
                                    "not interested")):
            return "negative"
        if any(w in lower for w in ("boka", "möte", "meeting", "calendar",
                                    "tid ", "ring")):
            return "meeting"
        return "interested"

    from anthropic import AsyncAnthropic
    client = AsyncAnthropic()
    model = os.environ.get("CLASSIFIER_MODEL", "claude-haiku-4-5")
    try:
        resp = await client.messages.create(
            model=model,
            max_tokens=10,
            system=(
                "Classify a reply to a B2B sales email. Answer with exactly "
                "one word from: meeting, interested, not_now, negative, "
                "unsubscribe."
            ),
            messages=[{"role": "user",
                       "content": f"Subject: {subject}\n\n{body[:2000]}"}],
        )
        word = resp.content[0].text.strip().lower()
        return word if word in REPLY_CLASSES else "interested"
    except Exception:
        return "interested"


async def handle_reply(from_addr: str, subject: str, body: str) -> None:
    lead = await db.find_lead_by_contact_email(None, from_addr)
    if not lead:
        return
    org_id, lead_id = lead["org_id"], lead["id"]

    cancelled = await db.cancel_sequence(org_id, lead_id)
    classification = await classify_reply(subject, body)

    status_map = {
        "meeting": "meeting",
        "interested": "contacted",
        "not_now": "contacted",
        "negative": "lost",
        "unsubscribe": "lost",
    }
    await db.update_lead(org_id, lead_id,
                         {"status": status_map[classification]})
    await db.add_lead_activity(
        org_id, lead_id, "reply_received",
        f"Svar från {from_addr} klassat som '{classification}'. "
        f"{cancelled} kvarvarande steg stoppade. Ämne: {subject[:120]}",
    )
    if classification == "unsubscribe":
        await db.suppress_email(org_id, from_addr, "reply opt-out")
    if classification == "not_now":
        await db.add_lead_activity(
            org_id, lead_id, "followup_hint",
            "Klassat som 'inte nu' — lägg en påminnelse om ca 3 månader.",
        )


async def inbox_tick() -> None:
    messages = await asyncio.to_thread(_imap_fetch_unseen)
    for msg in messages:
        try:
            await handle_reply(msg["from"], msg["subject"], msg["body"])
        except Exception:
            traceback.print_exc()


async def inbox_loop() -> None:
    while True:
        try:
            await inbox_tick()
        except Exception:
            traceback.print_exc()
        await asyncio.sleep(INBOX_TICK_SECONDS)
