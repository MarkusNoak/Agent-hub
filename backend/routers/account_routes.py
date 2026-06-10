from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import database as db
from auth import AuthContext, generate_api_key, get_current_auth, require_admin
from plans import PLANS, get_plan

router = APIRouter(prefix="/api", tags=["account"])


class OrgUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ApiKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class PlanChangeRequest(BaseModel):
    plan: str


class OrgSettingsRequest(BaseModel):
    booking_url: str | None = None
    daily_send_limit: int | None = Field(default=None, ge=1, le=200)
    business_profile: str | None = Field(default=None, max_length=2000)


@router.get("/org")
async def get_org(auth: AuthContext = Depends(get_current_auth)):
    org = await db.get_organization(auth.org_id)
    plan = get_plan(org["plan"])
    usage = await db.get_monthly_usage(auth.org_id)
    return {
        "id": org["id"],
        "name": org["name"],
        "plan": {
            "id": plan.id,
            "name": plan.name,
            "price_monthly_eur": plan.price_monthly_eur,
            "messages_per_month": plan.messages_per_month,
            "leads_per_month": plan.leads_per_month,
            "seats": plan.seats,
            "features": plan.features,
        },
        "usage": usage,
        "members": await db.list_users(auth.org_id),
    }


@router.patch("/org")
async def update_org(
    req: OrgUpdateRequest, auth: AuthContext = Depends(require_admin)
):
    await db.update_organization_name(auth.org_id, req.name)
    return {"ok": True}


@router.get("/org/settings")
async def get_settings(auth: AuthContext = Depends(get_current_auth)):
    return await db.get_org_settings(auth.org_id)


@router.patch("/org/settings")
async def patch_settings(
    req: OrgSettingsRequest, auth: AuthContext = Depends(require_admin)
):
    return await db.update_org_settings(
        auth.org_id, req.model_dump(exclude_none=True)
    )


@router.get("/usage")
async def usage(auth: AuthContext = Depends(get_current_auth)):
    org = await db.get_organization(auth.org_id)
    plan = get_plan(org["plan"])
    data = await db.get_monthly_usage(auth.org_id)
    data["limits"] = {
        "messages": plan.messages_per_month,
        "leads": plan.leads_per_month,
    }
    return data


@router.get("/billing/plans")
async def list_plans():
    return [
        {
            "id": p.id,
            "name": p.name,
            "price_monthly_eur": p.price_monthly_eur,
            "messages_per_month": p.messages_per_month,
            "leads_per_month": p.leads_per_month,
            "seats": p.seats,
            "features": p.features,
        }
        for p in PLANS.values()
    ]


@router.post("/billing/plan")
async def change_plan(
    req: PlanChangeRequest, auth: AuthContext = Depends(require_admin)
):
    # Self-serve plan switch. In production this is the integration point for
    # a payment provider (Stripe Checkout + webhook before activation).
    if req.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Unknown plan")
    await db.set_organization_plan(auth.org_id, req.plan)
    return {"ok": True, "plan": req.plan}


@router.get("/keys")
async def list_keys(auth: AuthContext = Depends(require_admin)):
    return await db.list_api_keys(auth.org_id)


@router.post("/keys")
async def create_key(
    req: ApiKeyRequest, auth: AuthContext = Depends(require_admin)
):
    full_key, prefix, key_hash = generate_api_key()
    key_id = await db.create_api_key(auth.org_id, req.name, prefix, key_hash)
    # The full key is returned exactly once and never stored in plaintext
    return {"id": key_id, "name": req.name, "prefix": prefix, "key": full_key}


@router.delete("/keys/{key_id}")
async def delete_key(key_id: str, auth: AuthContext = Depends(require_admin)):
    await db.delete_api_key(auth.org_id, key_id)
    return {"ok": True}
