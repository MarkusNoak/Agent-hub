from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import database as db
import growth
from auth import AuthContext, get_current_auth

router = APIRouter(prefix="/api/growth", tags=["growth"])


class IcpRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    what_we_sell: str | None = None
    target_roles: list[str] = []
    regions: list[str] = []
    include_new_companies: bool = False
    include_funding: bool = False
    include_tenders: bool = False
    include_expansion: bool = False
    include_leadership: bool = False
    auto_run: bool = False


class IcpUpdateRequest(BaseModel):
    name: str | None = None
    what_we_sell: str | None = None
    target_roles: list[str] | None = None
    regions: list[str] | None = None
    include_new_companies: bool | None = None
    include_funding: bool | None = None
    include_tenders: bool | None = None
    include_expansion: bool | None = None
    include_leadership: bool | None = None
    auto_run: bool | None = None


@router.get("/icps")
async def list_icps(auth: AuthContext = Depends(get_current_auth)):
    return await db.list_icps(auth.org_id)


@router.post("/icps")
async def create_icp(req: IcpRequest,
                     auth: AuthContext = Depends(get_current_auth)):
    icp_id = await db.create_icp(auth.org_id, req.model_dump())
    return await db.get_icp(auth.org_id, icp_id)


@router.patch("/icps/{icp_id}")
async def update_icp(icp_id: str, req: IcpUpdateRequest,
                     auth: AuthContext = Depends(get_current_auth)):
    fields = req.model_dump(exclude_none=True)
    ok = await db.update_icp(auth.org_id, icp_id, fields)
    if not ok:
        raise HTTPException(status_code=404, detail="ICP not found")
    return await db.get_icp(auth.org_id, icp_id)


@router.delete("/icps/{icp_id}")
async def delete_icp(icp_id: str,
                     auth: AuthContext = Depends(get_current_auth)):
    await db.delete_icp(auth.org_id, icp_id)
    return {"ok": True}


@router.post("/icps/{icp_id}/run")
async def run_now(icp_id: str,
                  auth: AuthContext = Depends(get_current_auth)):
    icp = await db.get_icp(auth.org_id, icp_id)
    if not icp:
        raise HTTPException(status_code=404, detail="ICP not found")
    return await growth.run_prospecting(auth.org_id, icp, trigger="manual")


@router.get("/runs")
async def list_runs(auth: AuthContext = Depends(get_current_auth)):
    return await db.list_prospecting_runs(auth.org_id)


@router.get("/insights")
async def get_insights(auth: AuthContext = Depends(get_current_auth)):
    import insights
    return await insights.pipeline_insights(auth.org_id)
