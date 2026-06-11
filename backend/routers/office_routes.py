"""Office view — a live snapshot of what the agents are doing.

Derived entirely from data the platform already records (conversations,
lead activities, prospecting runs), so it costs nothing extra to render.
"""
from fastapi import APIRouter, Depends

import database as db
from auth import AuthContext, get_current_auth

router = APIRouter(prefix="/api", tags=["office"])


@router.get("/office")
async def office_snapshot(auth: AuthContext = Depends(get_current_auth)):
    return await db.office_snapshot(auth.org_id)
