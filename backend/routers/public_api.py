"""Public REST API (v1) for programmatic access with API keys.

Lets customers integrate agents into their own products:

    POST /api/v1/chat
    Authorization: Bearer ahub_...
    {"agent_id": "vantage", "message": "...", "session_id": "optional"}
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import database as db
from agent_tools import ToolContext
from agents import AGENTS
from auth import AuthContext, get_current_auth
from plans import get_plan, plan_allows_agent, within_quota

router = APIRouter(prefix="/api/v1", tags=["public-api"])


class ChatRequest(BaseModel):
    agent_id: str
    message: str = Field(min_length=1, max_length=20_000)
    session_id: str | None = None


@router.get("/agents")
async def list_agents_v1(auth: AuthContext = Depends(get_current_auth)):
    org = await db.get_organization(auth.org_id)
    return [
        {**a.to_dict(), "available": plan_allows_agent(org["plan"], a.tier)}
        for a in AGENTS.values()
    ]


@router.post("/chat")
async def chat(req: ChatRequest, auth: AuthContext = Depends(get_current_auth)):
    agent = AGENTS.get(req.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Unknown agent")

    org = await db.get_organization(auth.org_id)
    plan = get_plan(org["plan"])
    if not plan_allows_agent(org["plan"], agent.tier):
        raise HTTPException(
            status_code=402,
            detail=f"Agent {agent.name} requires a higher plan",
        )
    usage = await db.get_monthly_usage(auth.org_id)
    if not within_quota(usage["messages"], plan.messages_per_month):
        raise HTTPException(status_code=429, detail="Monthly message quota reached")

    sid = req.session_id or uuid.uuid4().hex
    history = await db.get_history(auth.org_id, req.agent_id, sid)
    await db.save_message(
        auth.org_id, auth.user_id, req.agent_id, sid, "user", req.message
    )

    ctx = ToolContext(org_id=auth.org_id, user_id=auth.user_id, plan_id=plan.id)
    text_parts: list[str] = []
    tool_calls: list[dict] = []
    total_in = total_out = 0

    async for event in agent.run(req.message, history, ctx):
        if event["type"] == "text":
            text_parts.append(event["content"])
        elif event["type"] == "tool_start":
            tool_calls.append({"name": event["name"], "input": event["input"]})
        elif event["type"] == "usage":
            total_in += event["input_tokens"]
            total_out += event["output_tokens"]

    full_text = "".join(text_parts)
    await db.save_message(
        auth.org_id, auth.user_id, req.agent_id, sid, "assistant", full_text
    )
    await db.record_usage(auth.org_id, auth.user_id, req.agent_id, total_in, total_out)

    return {
        "session_id": sid,
        "agent_id": req.agent_id,
        "response": full_text,
        "tool_calls": tool_calls,
        "usage": {"input_tokens": total_in, "output_tokens": total_out},
    }
