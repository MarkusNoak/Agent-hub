"""Approvals inbox: human-in-the-loop review of outreach before it sends.

New sequence steps land as 'awaiting_approval' (unless the org disables
require_approval). Approving moves a step to 'pending' so the engine sends
it at its scheduled window; rejecting is terminal.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import database as db
from auth import AuthContext, get_current_auth

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


class ApproveRequest(BaseModel):
    subject: str | None = None
    body: str | None = None


@router.get("")
async def list_approvals(auth: AuthContext = Depends(get_current_auth)):
    items = await db.list_awaiting_steps(auth.org_id)
    return {"count": len(items), "items": items}


@router.post("/{step_id}/approve")
async def approve(
    step_id: int,
    req: ApproveRequest,
    auth: AuthContext = Depends(get_current_auth),
):
    subject = (req.subject or "").strip() or None
    body = (req.body or "").strip() or None
    step = await db.approve_step(auth.org_id, step_id, subject, body)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found or already handled")
    await db.add_lead_activity(
        auth.org_id, step["lead_id"], "approved",
        f"Steg {step['step']} godkänt{' (redigerat)' if subject or body else ''} "
        f"— skickas {step['send_at'][:16]}",
    )
    return {"ok": True, "remaining": len(await db.list_awaiting_steps(auth.org_id))}


@router.post("/{step_id}/reject")
async def reject(step_id: int, auth: AuthContext = Depends(get_current_auth)):
    step = await db.reject_step(auth.org_id, step_id)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found or already handled")
    await db.add_lead_activity(
        auth.org_id, step["lead_id"], "rejected",
        f"Steg {step['step']} avvisat: \"{step['subject'][:80]}\"",
    )
    return {"ok": True, "remaining": len(await db.list_awaiting_steps(auth.org_id))}
