import aiosqlite
from pathlib import Path

DB_PATH = Path(__file__).parent / "agent_hub.db"


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id    TEXT    NOT NULL,
                session_id  TEXT    NOT NULL,
                role        TEXT    NOT NULL,
                content     TEXT    NOT NULL,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_conv_agent_session "
            "ON conversations (agent_id, session_id, created_at)"
        )
        await db.commit()


async def save_message(
    agent_id: str, session_id: str, role: str, content: str
) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO conversations (agent_id, session_id, role, content) "
            "VALUES (?, ?, ?, ?)",
            (agent_id, session_id, role, content),
        )
        await db.commit()


async def get_history(
    agent_id: str, session_id: str, limit: int = 20
) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT role, content
            FROM (
                SELECT role, content, created_at
                FROM conversations
                WHERE agent_id = ? AND session_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            ) sub
            ORDER BY created_at ASC
            """,
            (agent_id, session_id, limit),
        ) as cursor:
            rows = await cursor.fetchall()
            return [{"role": row[0], "content": row[1]} for row in rows]


async def clear_history(agent_id: str, session_id: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM conversations WHERE agent_id = ? AND session_id = ?",
            (agent_id, session_id),
        )
        await db.commit()
