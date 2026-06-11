"""CRM layer — existing customers/partners on top of the lead pipeline.

Accounts are the org's REAL relationships. They are permanently excluded
from harvest and outreach (see database.is_company_blocked), which is the
guarantee that prospecting never cold-emails an existing customer.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import database as db
from auth import AuthContext, get_current_auth

router = APIRouter(prefix="/api/crm", tags=["crm"])


class AccountRequest(BaseModel):
    company_name: str = Field(min_length=1, max_length=200)
    org_number: str | None = None
    domain: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    status: str = "customer"
    monthly_value: int | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=2000)


class AccountUpdateRequest(BaseModel):
    company_name: str | None = None
    org_number: str | None = None
    domain: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    status: str | None = None
    monthly_value: int | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=2000)


def _check_status(status: str | None) -> None:
    if status and status not in db.ACCOUNT_STATUSES:
        raise HTTPException(status_code=400,
                            detail=f"Status must be one of "
                                   f"{db.ACCOUNT_STATUSES}")


@router.get("/accounts")
async def get_accounts(status: str | None = None,
                       auth: AuthContext = Depends(get_current_auth)):
    accounts = await db.list_accounts(auth.org_id, status=status)
    return {"accounts": accounts, "statuses": db.ACCOUNT_STATUSES}


@router.post("/accounts")
async def add_account(req: AccountRequest,
                      auth: AuthContext = Depends(get_current_auth)):
    _check_status(req.status)
    existing = await db.find_account_for_company(
        auth.org_id, req.company_name, req.org_number)
    if existing:
        raise HTTPException(status_code=409,
                            detail=f"'{existing['company_name']}' is already "
                                   "in the customer register")
    account_id = await db.create_account(auth.org_id, req.model_dump())
    return {"id": account_id, "ok": True}


@router.patch("/accounts/{account_id}")
async def patch_account(account_id: str, req: AccountUpdateRequest,
                        auth: AuthContext = Depends(get_current_auth)):
    _check_status(req.status)
    ok = await db.update_account(auth.org_id, account_id,
                                 req.model_dump(exclude_none=True))
    if not ok:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"ok": True}


@router.delete("/accounts/{account_id}")
async def remove_account(account_id: str,
                         auth: AuthContext = Depends(get_current_auth)):
    await db.delete_account(auth.org_id, account_id)
    return {"ok": True}


@router.post("/convert/{lead_id}")
async def convert_lead(lead_id: str,
                       auth: AuthContext = Depends(get_current_auth)):
    """Won deal → customer account: copies the lead, marks it won, stops any
    running sequence, and from that moment the company is outreach-immune."""
    lead = await db.get_lead(auth.org_id, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    existing = await db.find_account_for_company(
        auth.org_id, lead["company_name"], lead.get("org_number"))
    if existing:
        raise HTTPException(status_code=409,
                            detail="Already in the customer register")
    account_id = await db.create_account(auth.org_id, {
        "company_name": lead["company_name"],
        "org_number": lead.get("org_number"),
        "domain": lead.get("domain"),
        "contact_name": lead.get("contact_name"),
        "contact_email": lead.get("contact_email"),
        "status": "customer",
        "notes": f"Konverterad från lead (källa: {lead.get('source')})",
    })
    await db.cancel_sequence(auth.org_id, lead_id)
    await db.update_lead(auth.org_id, lead_id, {"status": "won"})
    await db.add_lead_activity(
        auth.org_id, lead_id, "converted",
        "Konverterad till kund — utesluts permanent ur skörd och outreach.",
    )
    return {"ok": True, "account_id": account_id}


@router.get("/followups")
async def get_followups(auth: AuthContext = Depends(get_current_auth)):
    return await db.list_followups(auth.org_id)
