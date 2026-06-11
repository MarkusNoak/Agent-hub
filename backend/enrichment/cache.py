"""Server-side cache for enrichment and provider lookups.

Public data (registries, websites, news, DNS) and paid provider results are
cached across tenants, so the same company researched twice — by any team —
costs one API call. TTLs reflect how fast each source goes stale.
"""

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

import dbdriver


# Hours before a cached entry is considered stale, per source
TTL_HOURS = {
    "registry": 30 * 24,        # official registry data changes rarely
    "registry_se": 30 * 24,
    "website": 7 * 24,
    "news": 24,                 # timing signals must be fresh
    "jobs": 24,
    "mx": 30 * 24,
    "tenders": 24,
    "jobs_harvest": 12,
    "newco": 24,
    "dns_site": 30 * 24,        # whether a company has a website at all
    "website_people": 7 * 24,
    "provider_companies": 7 * 24,   # paid provider searches — cache hardest
    "provider_people": 7 * 24,
    "provider_enrich": 14 * 24,
}
DEFAULT_TTL_HOURS = 24


def make_key(params: dict) -> str:
    """Stable cache key from tool input: sorted, normalized JSON."""
    norm = {
        k: (v.strip().lower() if isinstance(v, str) else v)
        for k, v in sorted(params.items())
        if v not in (None, "", [])
    }
    return json.dumps(norm, sort_keys=True, ensure_ascii=False)


async def cache_get(source: str, key: str) -> dict | None:
    ttl = timedelta(hours=TTL_HOURS.get(source, DEFAULT_TTL_HOURS))
    async with dbdriver.connect() as db:
        async with db.execute(
            "SELECT payload, fetched_at FROM enrichment_cache "
            "WHERE source = ? AND cache_key = ?",
            (source, key),
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None
    payload, fetched_at = row
    try:
        if datetime.fromisoformat(fetched_at) + ttl < datetime.now(timezone.utc):
            return None
        return json.loads(payload)
    except (ValueError, json.JSONDecodeError):
        return None


async def cache_set(source: str, key: str, payload: dict) -> None:
    async with dbdriver.connect() as db:
        await db.execute(
            "INSERT INTO enrichment_cache (source, cache_key, payload, fetched_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT (source, cache_key) DO UPDATE "
            "SET payload = excluded.payload, fetched_at = excluded.fetched_at",
            (source, key, json.dumps(payload, ensure_ascii=False, default=str),
             datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def cached_fetch(
    source: str,
    params: dict,
    fetch: Callable[[], Awaitable[dict]],
) -> dict:
    """Return cached result or run fetch(). Errors are never cached.

    Cache hits are marked with "_cache": "hit" so the agent (and logs) can
    see when a call was free.
    """
    key = make_key(params)
    hit = await cache_get(source, key)
    if hit is not None:
        return {**hit, "_cache": "hit"}
    result = await fetch()
    if isinstance(result, dict) and "error" not in result:
        await cache_set(source, key, result)
    return result
