"""Approval queue: human review of outreach emails before they send.

Sequences started while the org setting require_approval is on (the default)
hold every step in status 'awaiting_approval'. Nothing leaves the building
until a team member approves it here — optionally after editing the copy.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import database as db
from auth import AuthContext, get_current_auth

router = APIRouter(prefix="/api/outreach", tags=["outreach"])


class ApproveRequest(BaseModel):
    subject: str | None = Field(default=None, max_length=200)
    body: str | None = None


class RejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


@router.get("/approvals")
async def list_approvals(auth: AuthContext = Depends(get_current_auth)):
    return await db.list_awaiting_approval(auth.org_id)


@router.get("/approvals/count")
async def approvals_count(auth: AuthContext = Depends(get_current_auth)):
    return {"count": await db.count_awaiting_approval(auth.org_id)}


@router.post("/approvals/{step_id}/approve")
async def approve(step_id: int, req: ApproveRequest,
                  auth: AuthContext = Depends(get_current_auth)):
    step = await db.approve_step(
        auth.org_id, step_id, auth.user_id, req.subject, req.body
    )
    if not step:
        raise HTTPException(status_code=404,
                            detail="Step not found or not awaiting approval")
    await db.add_lead_activity(
        auth.org_id, step["lead_id"], "step_approved",
        f"Steg {step['step']} godkänt"
        + (" (redigerat)" if req.subject or req.body else "") + ".",
    )
    return {"ok": True, "step_id": step_id, "status": "pending"}


@router.post("/approvals/{step_id}/reject")
async def reject(step_id: int, req: RejectRequest,
                 auth: AuthContext = Depends(get_current_auth)):
    step = await db.reject_step(auth.org_id, step_id, auth.user_id, req.reason)
    if not step:
        raise HTTPException(status_code=404,
                            detail="Step not found or not awaiting approval")
    await db.add_lead_activity(
        auth.org_id, step["lead_id"], "step_rejected",
        f"Steg {step['step']} avvisat. Orsak: {req.reason}",
    )
    return {"ok": True, "step_id": step_id, "status": "rejected"}
