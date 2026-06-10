from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

import database as db
from auth import AuthContext, get_current_auth

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class KnowledgeRequest(BaseModel):
    kind: str = "other"
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=20_000)


@router.get("")
async def list_entries(
    kind: str | None = None, q: str | None = None,
    auth: AuthContext = Depends(get_current_auth),
):
    return {
        "kinds": db.KNOWLEDGE_KINDS,
        "entries": await db.list_knowledge(auth.org_id, kind=kind, query=q,
                                           limit=100),
    }


@router.post("")
async def create_entry(
    req: KnowledgeRequest, auth: AuthContext = Depends(get_current_auth)
):
    entry_id = await db.create_knowledge(
        auth.org_id, req.kind, req.title, req.content
    )
    return {"ok": True, "id": entry_id}


@router.delete("/{entry_id}")
async def delete_entry(
    entry_id: str, auth: AuthContext = Depends(get_current_auth)
):
    await db.delete_knowledge(auth.org_id, entry_id)
    return {"ok": True}
