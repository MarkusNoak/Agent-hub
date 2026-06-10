from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any
import json, datetime

from auth import AuthContext, get_current_auth
import database as db
from integrations.registry import CONNECTOR_CLASSES, list_connector_meta
from integrations.crypto import encrypt, decrypt

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

class ConnectRequest(BaseModel):
    kind: str
    credentials: dict[str, Any]
    config: dict[str, Any] = {}

@router.get("/meta")
async def get_meta():
    return list_connector_meta()

@router.get("")
async def list_integrations(auth: AuthContext = Depends(get_current_auth)):
    return await db.list_integrations(auth.org_id)

@router.post("")
async def connect_integration(req: ConnectRequest, auth: AuthContext = Depends(get_current_auth)):
    if req.kind not in CONNECTOR_CLASSES:
        raise HTTPException(400, f"Unknown integration kind: {req.kind}")
    connector = CONNECTOR_CLASSES[req.kind](req.credentials, req.config)
    result = await connector.verify()
    if not result.ok:
        raise HTTPException(400, f"Verification failed: {result.error}")
    enc = encrypt(req.credentials)
    await db.save_integration(auth.org_id, req.kind, result.label, enc, json.dumps(req.config))
    await db.update_integration_status(auth.org_id, req.kind, "active",
                                       datetime.datetime.utcnow().isoformat() + "Z")
    return {"ok": True, "label": result.label}

@router.post("/{kind}/verify")
async def verify_integration(kind: str, auth: AuthContext = Depends(get_current_auth)):
    row = await db.get_integration(auth.org_id, kind)
    if not row:
        raise HTTPException(404, "Integration not connected")
    creds = decrypt(row["credentials"])
    cls = CONNECTOR_CLASSES.get(kind)
    if not cls:
        raise HTTPException(400, "Unknown kind")
    result = await cls(creds).verify()
    status = "active" if result.ok else "error"
    await db.update_integration_status(auth.org_id, kind, status,
                                       datetime.datetime.utcnow().isoformat() + "Z")
    return {"ok": result.ok, "label": result.label, "error": result.error}

@router.delete("/{kind}")
async def disconnect_integration(kind: str, auth: AuthContext = Depends(get_current_auth)):
    await db.delete_integration(auth.org_id, kind)
    return {"ok": True}
