"""Database driver: Postgres (Supabase) in production, SQLite in development.

Set DATABASE_URL (postgresql://...) to run on Postgres — tables live in the
dedicated schema "v2" so they coexist with any legacy tables in public.
Without DATABASE_URL, everything runs on local SQLite exactly as before.

The adapter mimics the aiosqlite API surface that database.py uses
(connect() context manager, execute() that is both awaitable and an async
context manager, commit(), executescript(), row_factory), translating
'?' placeholders to asyncpg's $n style.
"""

import os
import re
from pathlib import Path

DATABASE_URL = os.environ.get("DATABASE_URL", "")
IS_POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))

SQLITE_PATH = Path(__file__).parent / "agent_hub.db"

if not IS_POSTGRES:
    import aiosqlite

    def connect():
        return aiosqlite.connect(SQLITE_PATH)

else:
    import asyncpg

    _pool = None

    async def _get_pool():
        global _pool
        if _pool is None:
            _pool = await asyncpg.create_pool(
                DATABASE_URL,
                min_size=1,
                max_size=10,
                server_settings={"search_path": "v2,public"},
            )
        return _pool

    def _convert_placeholders(sql: str) -> str:
        out, n = [], 0
        for ch in sql:
            if ch == "?":
                n += 1
                out.append(f"${n}")
            else:
                out.append(ch)
        return "".join(out)

    class _Cursor:
        def __init__(self, rows=None, status: str = ""):
            self._rows = rows if rows is not None else []
            self._status = status

        async def fetchall(self):
            return self._rows

        async def fetchone(self):
            return self._rows[0] if self._rows else None

        @property
        def rowcount(self) -> int:
            m = re.search(r"(\d+)$", self._status or "")
            return int(m.group(1)) if m else 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

    class _Execution:
        """Awaitable AND async-context-manager, like aiosqlite's execute."""

        def __init__(self, conn, sql: str, params: tuple):
            self._conn = conn
            self._sql = _convert_placeholders(sql)
            self._params = params

        async def _run(self) -> _Cursor:
            head = self._sql.lstrip()[:6].lower()
            if head.startswith("select") or " returning " in self._sql.lower():
                rows = await self._conn.fetch(self._sql, *self._params)
                return _Cursor(rows=rows)
            status = await self._conn.execute(self._sql, *self._params)
            return _Cursor(status=status)

        def __await__(self):
            return self._run().__await__()

        async def __aenter__(self) -> _Cursor:
            self._cursor = await self._run()
            return self._cursor

        async def __aexit__(self, *args):
            pass

    class _Connection:
        def __init__(self):
            self.row_factory = None  # asyncpg Records are already mappings

        async def __aenter__(self):
            self._pool = await _get_pool()
            self._conn = await self._pool.acquire()
            return self

        async def __aexit__(self, *args):
            await self._pool.release(self._conn)

        def execute(self, sql: str, params=()) -> _Execution:
            return _Execution(self._conn, sql, tuple(params))

        async def executescript(self, script: str) -> None:
            await self._conn.execute(script)

        async def commit(self) -> None:
            pass  # asyncpg autocommits outside explicit transactions

    def connect():
        return _Connection()
