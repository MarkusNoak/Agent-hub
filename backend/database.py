"""SQLite persistence layer.

Multi-tenant schema: every row that belongs to a customer carries org_id.
SQLite keeps the stack dependency-free for development and small deployments;
the SQL is deliberately plain so it can be ported to Postgres for scale.
"""

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
        """)
        await db.commit()


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


async def create_lead(org_id: str, created_by: str | None, data: dict) -> str:
    lead_id = new_id()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO leads (
                id, org_id, month, company_name, domain, industry,
                company_size, location, contact_name, contact_title,
                contact_email, contact_linkedin, source, score, score_reason,
                status, notes, outreach_draft, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lead_id,
                org_id,
                month_key(),
                data.get("company_name", "Unknown"),
                data.get("domain"),
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
        "company_name", "domain", "industry", "company_size", "location",
        "contact_name", "contact_title", "contact_email", "contact_linkedin",
        "score", "score_reason", "status", "notes", "outreach_draft",
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
