from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

import database as db
from auth import (
    AuthContext,
    create_token,
    get_current_auth,
    hash_password,
    require_admin,
    verify_password,
)
from plans import get_plan

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    organization_name: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class InviteRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: str = "member"


@router.post("/register")
async def register(req: RegisterRequest):
    if await db.get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    org_id = await db.create_organization(req.organization_name)
    user_id = await db.create_user(
        org_id, req.email, hash_password(req.password), req.name, role="owner"
    )
    token = create_token(user_id, org_id, "owner")
    return {"token": token, "user_id": user_id, "org_id": org_id, "role": "owner"}


@router.post("/login")
async def login(req: LoginRequest):
    user = await db.get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["org_id"], user["role"])
    return {
        "token": token,
        "user_id": user["id"],
        "org_id": user["org_id"],
        "role": user["role"],
    }


@router.post("/invite")
async def invite(req: InviteRequest, auth: AuthContext = Depends(require_admin)):
    org = await db.get_organization(auth.org_id)
    plan = get_plan(org["plan"])
    seats_used = await db.count_users(auth.org_id)
    if plan.seats >= 0 and seats_used >= plan.seats:
        raise HTTPException(
            status_code=402,
            detail=f"Seat limit reached ({plan.seats} on the {plan.name} plan)",
        )
    if await db.get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    role = req.role if req.role in ("member", "admin") else "member"
    user_id = await db.create_user(
        auth.org_id, req.email, hash_password(req.password), req.name, role=role
    )
    return {"user_id": user_id, "email": req.email, "role": role}


@router.get("/me")
async def me(auth: AuthContext = Depends(get_current_auth)):
    org = await db.get_organization(auth.org_id)
    user = await db.get_user(auth.user_id) if auth.user_id else None
    return {
        "user": {
            "id": user["id"], "email": user["email"],
            "name": user["name"], "role": user["role"],
        } if user else None,
        "organization": {
            "id": org["id"], "name": org["name"], "plan": org["plan"],
        },
    }
