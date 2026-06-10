import csv
import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import database as db
from auth import AuthContext, get_current_auth
from plans import get_plan, within_quota

router = APIRouter(prefix="/api/leads", tags=["leads"])

EXPORT_COLUMNS = [
    "company_name", "domain", "org_number", "industry", "company_size", "location",
    "contact_name", "contact_title", "contact_email", "contact_linkedin",
    "source", "score", "score_reason", "status", "notes", "created_at",
]


class LeadCreate(BaseModel):
    company_name: str
    domain: str | None = None
    org_number: str | None = None
    industry: str | None = None
    company_size: str | None = None
    location: str | None = None
    contact_name: str | None = None
    contact_title: str | None = None
    contact_email: str | None = None
    contact_linkedin: str | None = None
    score: int | None = None
    score_reason: str | None = None
    notes: str | None = None


class LeadUpdate(BaseModel):
    company_name: str | None = None
    domain: str | None = None
    org_number: str | None = None
    industry: str | None = None
    location: str | None = None
    contact_name: str | None = None
    contact_title: str | None = None
    contact_email: str | None = None
    contact_linkedin: str | None = None
    score: int | None = None
    score_reason: str | None = None
    status: str | None = None
    notes: str | None = None
    outreach_draft: str | None = None


@router.get("")
async def get_leads(
    status: str | None = None, auth: AuthContext = Depends(get_current_auth)
):
    leads = await db.list_leads(auth.org_id, status=status)
    return {"leads": leads, "statuses": db.LEAD_STATUSES}


@router.post("")
async def create_lead(
    req: LeadCreate, auth: AuthContext = Depends(get_current_auth)
):
    org = await db.get_organization(auth.org_id)
    plan = get_plan(org["plan"])
    used = await db.count_leads_this_month(auth.org_id)
    if not within_quota(used, plan.leads_per_month):
        raise HTTPException(
            status_code=402,
            detail=f"Monthly lead quota reached ({plan.leads_per_month})",
        )
    dupe = await db.find_duplicate_lead(
        auth.org_id,
        company_name=req.company_name,
        domain=req.domain,
        org_number=req.org_number,
        contact_email=req.contact_email,
    )
    if dupe:
        raise HTTPException(
            status_code=409,
            detail=f"Duplicate of existing lead '{dupe['company_name']}' "
                   f"(status: {dupe['status']})",
        )
    data = req.model_dump(exclude_none=True)
    data["source"] = "manual"
    lead_id = await db.create_lead(auth.org_id, auth.user_id, data)
    await db.add_lead_activity(auth.org_id, lead_id, "created", "Lead created manually")
    return await db.get_lead(auth.org_id, lead_id)


@router.get("/export.csv")
async def export_csv(auth: AuthContext = Depends(get_current_auth)):
    leads = await db.list_leads(auth.org_id, limit=10_000)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=EXPORT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(leads)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leads.csv"},
    )


@router.get("/{lead_id}")
async def get_lead(lead_id: str, auth: AuthContext = Depends(get_current_auth)):
    lead = await db.get_lead(auth.org_id, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    lead["activities"] = await db.list_lead_activities(auth.org_id, lead_id)
    lead["sequence"] = await db.get_sequence(auth.org_id, lead_id)
    return lead


@router.post("/{lead_id}/sequence/cancel")
async def cancel_sequence(
    lead_id: str, auth: AuthContext = Depends(get_current_auth)
):
    import outreach
    cancelled = await outreach.cancel_lead_sequence(
        auth.org_id, lead_id, "cancelled from UI"
    )
    return {"ok": True, "steps_cancelled": cancelled}


@router.patch("/{lead_id}")
async def update_lead(
    lead_id: str, req: LeadUpdate, auth: AuthContext = Depends(get_current_auth)
):
    fields = req.model_dump(exclude_none=True)
    if "status" in fields and fields["status"] not in db.LEAD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    ok = await db.update_lead(auth.org_id, lead_id, fields)
    if not ok:
        raise HTTPException(status_code=404, detail="Lead not found")
    if fields:
        summary = ", ".join(
            f"{k}={v}" for k, v in fields.items() if k != "outreach_draft"
        )
        await db.add_lead_activity(
            auth.org_id, lead_id, "updated", summary or "outreach draft updated"
        )
    return await db.get_lead(auth.org_id, lead_id)


@router.delete("/{lead_id}")
async def delete_lead(
    lead_id: str, auth: AuthContext = Depends(get_current_auth)
):
    lead = await db.get_lead(auth.org_id, lead_id)
    if lead:
        # Deleted = disqualified: block re-harvest for 90 days so weekly
        # runs don't keep resurrecting companies the team rejected
        await db.block_company(
            auth.org_id, lead.get("company_name"), lead.get("org_number"),
            reason="lead deleted", days=90,
        )
    await db.delete_lead(auth.org_id, lead_id)
    return {"ok": True}
