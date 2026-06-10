"""SQLite persistence layer.

Multi-tenant schema: every row that belongs to a customer carries org_id.
SQLite keeps the stack dependency-free for development and small deployments;
the SQL is deliberately plain so it can be ported to Postgres for scale.
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

DB_PATH = Path(__file__).parent / "agent_hub.db"

LEAD_STATUSES = ["new", "qualified", "contacted", "meeting", "won", "lost"]


def new_id() -> str:
    return uuid.uuid4().hex


def month_key(dt: datetime | None = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.strftime("%Y-%m")


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS organizations (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                plan        TEXT NOT NULL DEFAULT 'free',
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,
                org_id        TEXT NOT NULL REFERENCES organizations(id),
                email         TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                name          TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'member',
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS api_keys (
                id           TEXT PRIMARY KEY,
                org_id       TEXT NOT NULL REFERENCES organizations(id),
                name         TEXT NOT NULL,
                prefix       TEXT NOT NULL,
                key_hash     TEXT NOT NULL,
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id      TEXT    NOT NULL,
                user_id     TEXT,
                agent_id    TEXT    NOT NULL,
                session_id  TEXT    NOT NULL,
                role        TEXT    NOT NULL,
                content     TEXT    NOT NULL,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_conv_lookup
                ON conversations (org_id, agent_id, session_id, created_at);

            CREATE TABLE IF NOT EXISTS usage_events (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id        TEXT NOT NULL,
                user_id       TEXT,
                agent_id      TEXT NOT NULL,
                month         TEXT NOT NULL,
                input_tokens  INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_usage_org_month
                ON usage_events (org_id, month);

            CREATE TABLE IF NOT EXISTS leads (
                id              TEXT PRIMARY KEY,
                org_id          TEXT NOT NULL,
                month           TEXT NOT NULL,
                company_name    TEXT NOT NULL,
                domain          TEXT,
                industry        TEXT,
                company_size    TEXT,
                location        TEXT,
                contact_name    TEXT,
                contact_title   TEXT,
                contact_email   TEXT,
                contact_linkedin TEXT,
                source          TEXT NOT NULL DEFAULT 'manual',
                score           INTEGER,
                score_reason    TEXT,
                status          TEXT NOT NULL DEFAULT 'new',
                notes           TEXT,
                outreach_draft  TEXT,
                created_by      TEXT,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_leads_org
                ON leads (org_id, status, created_at);

            CREATE TABLE IF NOT EXISTS lead_activities (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id      TEXT NOT NULL,
                lead_id     TEXT NOT NULL REFERENCES leads(id),
                kind        TEXT NOT NULL,
                content     TEXT NOT NULL,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_lead_activities
                ON lead_activities (org_id, lead_id, created_at);

            -- Cross-tenant cache for public enrichment data (registries,
            -- websites, news, DNS, provider searches). Keyed by source +
            -- normalized request; TTL is enforced by the reader.
            CREATE TABLE IF NOT EXISTS enrichment_cache (
                source      TEXT NOT NULL,
                cache_key   TEXT NOT NULL,
                payload     TEXT NOT NULL,
                fetched_at  TEXT NOT NULL,
                PRIMARY KEY (source, cache_key)
            );

            -- Ideal customer profiles drive signal-first prospecting runs
            CREATE TABLE IF NOT EXISTS icp_profiles (
                id              TEXT PRIMARY KEY,
                org_id          TEXT NOT NULL,
                name            TEXT NOT NULL,
                what_we_sell    TEXT,
                target_roles    TEXT,   -- JSON list of occupation keywords
                regions         TEXT,   -- JSON list of regions/municipalities
                include_new_companies INTEGER NOT NULL DEFAULT 0,
                auto_run        INTEGER NOT NULL DEFAULT 0,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Outreach sequences: scheduled email steps per lead
            CREATE TABLE IF NOT EXISTS sequence_steps (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id      TEXT NOT NULL,
                lead_id     TEXT NOT NULL,
                step        INTEGER NOT NULL,
                subject     TEXT NOT NULL,
                body        TEXT NOT NULL,
                send_at     TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'pending',
                sent_at     TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_seq_due
                ON sequence_steps (status, send_at);
            CREATE INDEX IF NOT EXISTS idx_seq_lead
                ON sequence_steps (org_id, lead_id);

            -- GDPR suppression list: opt-outs are permanent per org
            CREATE TABLE IF NOT EXISTS suppression_list (
                org_id      TEXT NOT NULL,
                email       TEXT NOT NULL,
                reason      TEXT,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (org_id, email)
            );

            CREATE TABLE IF NOT EXISTS prospecting_runs (
                id                  TEXT PRIMARY KEY,
                org_id              TEXT NOT NULL,
                icp_id              TEXT,
                trigger             TEXT NOT NULL,
                signals_found       INTEGER NOT NULL DEFAULT 0,
                leads_created       INTEGER NOT NULL DEFAULT 0,
                duplicates_skipped  INTEGER NOT NULL DEFAULT 0,
                digest              TEXT,
                created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_runs_org
                ON prospecting_runs (org_id, created_at);
        """)
        # Migration: org_number added after the initial leads schema
        async with db.execute("PRAGMA table_info(leads)") as cur:
            cols = [r[1] for r in await cur.fetchall()]
        if "org_number" not in cols:
            await db.execute("ALTER TABLE leads ADD COLUMN org_number TEXT")
        # Migration: per-org settings JSON (booking URL, send limits, ...)
        async with db.execute("PRAGMA table_info(organizations)") as cur:
            org_cols = [r[1] for r in await cur.fetchall()]
        if "settings" not in org_cols:
            await db.execute("ALTER TABLE organizations ADD COLUMN settings TEXT")
        await db.commit()


# ── Org settings, sequences & suppression ────────────────────────────────────


async def get_org_settings(org_id: str) -> dict:
    org = await get_organization(org_id)
    if not org:
        return {}
    try:
        return json.loads(org.get("settings") or "{}")
    except json.JSONDecodeError:
        return {}


async def update_org_settings(org_id: str, patch: dict) -> dict:
    settings = await get_org_settings(org_id)
    settings.update({k: v for k, v in patch.items() if v is not None})
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE organizations SET settings = ? WHERE id = ?",
            (json.dumps(settings, ensure_ascii=False), org_id),
        )
        await db.commit()
    return settings


async def create_sequence(org_id: str, lead_id: str, steps: list[dict]) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        for i, step in enumerate(steps, 1):
            await db.execute(
                "INSERT INTO sequence_steps "
                "(org_id, lead_id, step, subject, body, send_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (org_id, lead_id, i, step["subject"], step["body"],
                 step["send_at"]),
            )
        await db.commit()
    return len(steps)


async def get_sequence(org_id: str, lead_id: str) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, step, subject, body, send_at, status, sent_at "
            "FROM sequence_steps WHERE org_id = ? AND lead_id = ? "
            "ORDER BY step",
            (org_id, lead_id),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def has_active_sequence(org_id: str, lead_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM sequence_steps "
            "WHERE org_id = ? AND lead_id = ? AND status = 'pending'",
            (org_id, lead_id),
        ) as cur:
            return (await cur.fetchone())[0] > 0


async def cancel_sequence(org_id: str, lead_id: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "UPDATE sequence_steps SET status = 'cancelled' "
            "WHERE org_id = ? AND lead_id = ? AND status = 'pending'",
            (org_id, lead_id),
        )
        await db.commit()
        return cur.rowcount


async def due_sequence_steps(now_iso: str, limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM sequence_steps "
            "WHERE status = 'pending' AND send_at <= ? "
            "ORDER BY send_at LIMIT ?",
            (now_iso, limit),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def mark_step(step_id: int, status: str, sent_at: str | None = None) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE sequence_steps SET status = ?, sent_at = ? WHERE id = ?",
            (status, sent_at, step_id),
        )
        await db.commit()


async def count_sends_today(org_id: str, today_prefix: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM sequence_steps "
            "WHERE org_id = ? AND status = 'sent' AND sent_at LIKE ?",
            (org_id, today_prefix + "%"),
        ) as cur:
            return (await cur.fetchone())[0]


async def is_suppressed(org_id: str, email: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT 1 FROM suppression_list WHERE org_id = ? AND email = ?",
            (org_id, email.strip().lower()),
        ) as cur:
            return await cur.fetchone() is not None


async def suppress_email(org_id: str, email: str, reason: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO suppression_list (org_id, email, reason) "
            "VALUES (?, ?, ?)",
            (org_id, email.strip().lower(), reason),
        )
        await db.commit()


async def find_lead_by_contact_email(org_id_or_none: str | None,
                                     email: str) -> dict | None:
    """Match an inbound reply to a lead. org scoping optional because the
    inbox is global per deployment."""
    query = ("SELECT * FROM leads WHERE LOWER(COALESCE(contact_email,'')) = ?")
    params: list = [email.strip().lower()]
    if org_id_or_none:
        query += " AND org_id = ?"
        params.append(org_id_or_none)
    query += " ORDER BY created_at DESC LIMIT 1"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


# ── ICP profiles & prospecting runs ──────────────────────────────────────────


async def create_icp(org_id: str, data: dict) -> str:
    icp_id = new_id()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO icp_profiles (id, org_id, name, what_we_sell, "
            "target_roles, regions, include_new_companies, auto_run) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (icp_id, org_id, data["name"], data.get("what_we_sell"),
             json.dumps(data.get("target_roles") or [], ensure_ascii=False),
             json.dumps(data.get("regions") or [], ensure_ascii=False),
             int(bool(data.get("include_new_companies"))),
             int(bool(data.get("auto_run")))),
        )
        await db.commit()
    return icp_id


def _parse_icp(row: dict) -> dict:
    row = dict(row)
    for key in ("target_roles", "regions"):
        try:
            row[key] = json.loads(row.get(key) or "[]")
        except json.JSONDecodeError:
            row[key] = []
    row["include_new_companies"] = bool(row["include_new_companies"])
    row["auto_run"] = bool(row["auto_run"])
    return row


async def list_icps(org_id: str) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM icp_profiles WHERE org_id = ? ORDER BY created_at",
            (org_id,),
        ) as cur:
            return [_parse_icp(r) for r in await cur.fetchall()]


async def get_icp(org_id: str, icp_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM icp_profiles WHERE id = ? AND org_id = ?",
            (icp_id, org_id),
        ) as cur:
            row = await cur.fetchone()
            return _parse_icp(row) if row else None


async def update_icp(org_id: str, icp_id: str, data: dict) -> bool:
    sets, params = [], []
    for key in ("name", "what_we_sell"):
        if key in data:
            sets.append(f"{key} = ?")
            params.append(data[key])
    for key in ("target_roles", "regions"):
        if key in data:
            sets.append(f"{key} = ?")
            params.append(json.dumps(data[key] or [], ensure_ascii=False))
    for key in ("include_new_companies", "auto_run"):
        if key in data:
            sets.append(f"{key} = ?")
            params.append(int(bool(data[key])))
    if not sets:
        return False
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            f"UPDATE icp_profiles SET {', '.join(sets)} "
            "WHERE id = ? AND org_id = ?",
            [*params, icp_id, org_id],
        )
        await db.commit()
        return cur.rowcount > 0


async def delete_icp(org_id: str, icp_id: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM icp_profiles WHERE id = ? AND org_id = ?",
            (icp_id, org_id),
        )
        await db.commit()


async def list_auto_run_icps() -> list[dict]:
    """All auto-run ICPs across tenants — used by the scheduler."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM icp_profiles WHERE auto_run = 1"
        ) as cur:
            return [_parse_icp(r) for r in await cur.fetchall()]


async def save_prospecting_run(org_id: str, icp_id: str | None, trigger: str,
                               stats: dict, digest: str) -> str:
    run_id = new_id()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO prospecting_runs (id, org_id, icp_id, trigger, "
            "signals_found, leads_created, duplicates_skipped, digest) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (run_id, org_id, icp_id, trigger,
             stats.get("signals_found", 0), stats.get("leads_created", 0),
             stats.get("duplicates_skipped", 0), digest),
        )
        await db.commit()
    return run_id


async def list_prospecting_runs(org_id: str, limit: int = 20) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM prospecting_runs WHERE org_id = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (org_id, limit),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def last_scheduled_run_at(org_id: str) -> str | None:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT MAX(created_at) FROM prospecting_runs "
            "WHERE org_id = ? AND trigger = 'scheduled'",
            (org_id,),
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else None


# ── Organizations & users ─────────────────────────────────────────────────────


async def create_organization(name: str, plan: str = "free") -> str:
    org_id = new_id()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO organizations (id, name, plan) VALUES (?, ?, ?)",
            (org_id, name, plan),
        )
        await db.commit()
    return org_id


async def get_organization(org_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM organizations WHERE id = ?", (org_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def set_organization_plan(org_id: str, plan: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE organizations SET plan = ? WHERE id = ?", (plan, org_id)
        )
        await db.commit()


async def update_organization_name(org_id: str, name: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE organizations SET name = ? WHERE id = ?", (name, org_id)
        )
        await db.commit()


async def create_user(
    org_id: str, email: str, password_hash: str, name: str, role: str = "member"
) -> str:
    user_id = new_id()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO users (id, org_id, email, password_hash, name, role) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, org_id, email.lower(), password_hash, name, role),
        )
        await db.commit()
    return user_id


async def get_user_by_email(email: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower(),)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def get_user(user_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def list_users(org_id: str) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, email, name, role, created_at FROM users "
            "WHERE org_id = ? ORDER BY created_at",
            (org_id,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def count_users(org_id: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM users WHERE org_id = ?", (org_id,)
        ) as cur:
            return (await cur.fetchone())[0]


# ── API keys ──────────────────────────────────────────────────────────────────


async def create_api_key(
    org_id: str, name: str, prefix: str, key_hash: str
) -> str:
    key_id = new_id()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO api_keys (id, org_id, name, prefix, key_hash) "
            "VALUES (?, ?, ?, ?, ?)",
            (key_id, org_id, name, prefix, key_hash),
        )
        await db.commit()
    return key_id


async def list_api_keys(org_id: str) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, name, prefix, created_at, last_used_at FROM api_keys "
            "WHERE org_id = ? ORDER BY created_at",
            (org_id,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def get_api_key_by_hash(key_hash: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM api_keys WHERE key_hash = ?", (key_hash,)
        ) as cur:
            row = await cur.fetchone()
        if row:
            await db.execute(
                "UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
                (row["id"],),
            )
            await db.commit()
        return dict(row) if row else None


async def delete_api_key(org_id: str, key_id: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM api_keys WHERE id = ? AND org_id = ?", (key_id, org_id)
        )
        await db.commit()


# ── Conversations ─────────────────────────────────────────────────────────────


async def save_message(
    org_id: str,
    user_id: str | None,
    agent_id: str,
    session_id: str,
    role: str,
    content: str,
) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO conversations "
            "(org_id, user_id, agent_id, session_id, role, content) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (org_id, user_id, agent_id, session_id, role, content),
        )
        await db.commit()


async def get_history(
    org_id: str, agent_id: str, session_id: str, limit: int = 20
) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT role, content
            FROM (
                SELECT role, content, created_at, id
                FROM conversations
                WHERE org_id = ? AND agent_id = ? AND session_id = ?
                ORDER BY id DESC
                LIMIT ?
            ) sub
            ORDER BY id ASC
            """,
            (org_id, agent_id, session_id, limit),
        ) as cursor:
            rows = await cursor.fetchall()
            return [{"role": row[0], "content": row[1]} for row in rows]


async def clear_history(org_id: str, agent_id: str, session_id: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM conversations "
            "WHERE org_id = ? AND agent_id = ? AND session_id = ?",
            (org_id, agent_id, session_id),
        )
        await db.commit()


# ── Usage metering ────────────────────────────────────────────────────────────


async def record_usage(
    org_id: str,
    user_id: str | None,
    agent_id: str,
    input_tokens: int,
    output_tokens: int,
) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO usage_events "
            "(org_id, user_id, agent_id, month, input_tokens, output_tokens) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (org_id, user_id, agent_id, month_key(), input_tokens, output_tokens),
        )
        await db.commit()


async def get_monthly_usage(org_id: str, month: str | None = None) -> dict:
    month = month or month_key()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*), COALESCE(SUM(input_tokens),0), "
            "COALESCE(SUM(output_tokens),0) "
            "FROM usage_events WHERE org_id = ? AND month = ?",
            (org_id, month),
        ) as cur:
            messages, tin, tout = await cur.fetchone()
        async with db.execute(
            "SELECT COUNT(*) FROM leads WHERE org_id = ? AND month = ?",
            (org_id, month),
        ) as cur:
            leads = (await cur.fetchone())[0]
        async with db.execute(
            "SELECT agent_id, COUNT(*) FROM usage_events "
            "WHERE org_id = ? AND month = ? GROUP BY agent_id "
            "ORDER BY COUNT(*) DESC",
            (org_id, month),
        ) as cur:
            by_agent = [
                {"agent_id": r[0], "messages": r[1]} for r in await cur.fetchall()
            ]
    return {
        "month": month,
        "messages": messages,
        "input_tokens": tin,
        "output_tokens": tout,
        "leads": leads,
        "by_agent": by_agent,
    }


# ── Leads ─────────────────────────────────────────────────────────────────────


def _norm_domain(domain: str | None) -> str | None:
    if not domain:
        return None
    d = domain.strip().lower()
    d = d.removeprefix("https://").removeprefix("http://").removeprefix("www.")
    return d.split("/")[0] or None


def _norm_orgnr(org_number: str | None) -> str | None:
    if not org_number:
        return None
    digits = "".join(ch for ch in org_number if ch.isdigit())
    return digits or None


async def find_duplicate_lead(
    org_id: str,
    company_name: str | None = None,
    domain: str | None = None,
    org_number: str | None = None,
    contact_email: str | None = None,
) -> dict | None:
    """Match an incoming lead against the org's existing pipeline.

    A lead is a duplicate if it shares an org number, domain, contact email,
    or exact company name (case-insensitive) with an existing lead — in that
    order of confidence.
    """
    conditions: list[str] = []
    params: list[str] = []
    if _norm_orgnr(org_number):
        conditions.append(
            "REPLACE(REPLACE(COALESCE(org_number,''), '-', ''), ' ', '') = ?"
        )
        params.append(_norm_orgnr(org_number))
    if _norm_domain(domain):
        conditions.append(
            "REPLACE(REPLACE(REPLACE(LOWER(COALESCE(domain,'')), "
            "'https://', ''), 'http://', ''), 'www.', '') = ?"
        )
        params.append(_norm_domain(domain))
    if contact_email:
        conditions.append("LOWER(COALESCE(contact_email,'')) = ?")
        params.append(contact_email.strip().lower())
    if company_name:
        conditions.append("LOWER(company_name) = ?")
        params.append(company_name.strip().lower())
    if not conditions:
        return None

    query = (
        "SELECT id, company_name, domain, org_number, contact_email, status, "
        "score, created_at FROM leads WHERE org_id = ? AND ("
        + " OR ".join(conditions)
        + ") LIMIT 1"
    )
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, [org_id, *params]) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def create_lead(org_id: str, created_by: str | None, data: dict) -> str:
    lead_id = new_id()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO leads (
                id, org_id, month, company_name, domain, org_number, industry,
                company_size, location, contact_name, contact_title,
                contact_email, contact_linkedin, source, score, score_reason,
                status, notes, outreach_draft, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lead_id,
                org_id,
                month_key(),
                data.get("company_name", "Unknown"),
                data.get("domain"),
                data.get("org_number"),
                data.get("industry"),
                data.get("company_size"),
                data.get("location"),
                data.get("contact_name"),
                data.get("contact_title"),
                data.get("contact_email"),
                data.get("contact_linkedin"),
                data.get("source", "manual"),
                data.get("score"),
                data.get("score_reason"),
                data.get("status", "new"),
                data.get("notes"),
                data.get("outreach_draft"),
                created_by,
            ),
        )
        await db.commit()
    return lead_id


async def get_lead(org_id: str, lead_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM leads WHERE id = ? AND org_id = ?", (lead_id, org_id)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def list_leads(
    org_id: str, status: str | None = None, limit: int = 200
) -> list[dict]:
    query = "SELECT * FROM leads WHERE org_id = ?"
    params: list = [org_id]
    if status:
        query += " AND status = ?"
        params.append(status)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def update_lead(org_id: str, lead_id: str, fields: dict) -> bool:
    allowed = {
        "company_name", "domain", "org_number", "industry", "company_size",
        "location", "contact_name", "contact_title", "contact_email",
        "contact_linkedin", "score", "score_reason", "status", "notes",
        "outreach_draft",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return False
    sets = ", ".join(f"{k} = ?" for k in updates)
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            f"UPDATE leads SET {sets}, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = ? AND org_id = ?",
            [*updates.values(), lead_id, org_id],
        )
        await db.commit()
        return cur.rowcount > 0


async def delete_lead(org_id: str, lead_id: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM lead_activities WHERE lead_id = ? AND org_id = ?",
            (lead_id, org_id),
        )
        await db.execute(
            "DELETE FROM leads WHERE id = ? AND org_id = ?", (lead_id, org_id)
        )
        await db.commit()


async def count_leads_this_month(org_id: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM leads WHERE org_id = ? AND month = ?",
            (org_id, month_key()),
        ) as cur:
            return (await cur.fetchone())[0]


async def add_lead_activity(
    org_id: str, lead_id: str, kind: str, content: str
) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO lead_activities (org_id, lead_id, kind, content) "
            "VALUES (?, ?, ?, ?)",
            (org_id, lead_id, kind, content),
        )
        await db.commit()


async def list_lead_activities(org_id: str, lead_id: str) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT kind, content, created_at FROM lead_activities "
            "WHERE org_id = ? AND lead_id = ? ORDER BY created_at",
            (org_id, lead_id),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]
