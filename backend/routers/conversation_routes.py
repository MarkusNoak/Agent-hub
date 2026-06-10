from fastapi import APIRouter, Depends

import database as db
from auth import AuthContext, get_current_auth

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("/{agent_id}")
async def list_sessions(
    agent_id: str, auth: AuthContext = Depends(get_current_auth)
):
    return await db.list_sessions(auth.org_id, agent_id)


@router.get("/{agent_id}/{session_id}")
async def get_session(
    agent_id: str, session_id: str,
    auth: AuthContext = Depends(get_current_auth),
):
    return {
        "session_id": session_id,
        "messages": await db.get_history(auth.org_id, agent_id, session_id,
                                         limit=200),
    }
