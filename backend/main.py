import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env BEFORE importing agents (they initialise AsyncAnthropic on first use)
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import database as db  # noqa: E402
from agent_tools import ToolContext  # noqa: E402
from agents import AGENTS  # noqa: E402
from auth import auth_from_ws_token  # noqa: E402
from plans import get_plan, plan_allows_agent, within_quota  # noqa: E402
from routers import account_routes, auth_routes, lead_routes, public_api  # noqa: E402

FRONTEND = Path(__file__).parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    yield


app = FastAPI(title="Agent Hub", version="2.0.0", lifespan=lifespan)

app.include_router(auth_routes.router)
app.include_router(account_routes.router)
app.include_router(lead_routes.router)
app.include_router(public_api.router)

app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(str(FRONTEND / "index.html"))


@app.get("/api/agents")
async def list_agents():
    """Public agent catalogue (availability is enforced at chat time)."""
    return [agent.to_dict() for agent in AGENTS.values()]


# ── WebSocket chat ────────────────────────────────────────────────────────────


@app.websocket("/ws/{agent_id}")
async def ws_chat(
    websocket: WebSocket,
    agent_id: str,
    session_id: str = Query(default=None),
    token: str = Query(default=None),
):
    await websocket.accept()

    auth = await auth_from_ws_token(token)
    if not auth:
        await websocket.send_json(
            {"type": "error", "content": "Authentication required", "code": "auth"}
        )
        await websocket.close()
        return

    if agent_id not in AGENTS:
        await websocket.send_json(
            {"type": "error", "content": f"Unknown agent: {agent_id}"}
        )
        await websocket.close()
        return

    agent = AGENTS[agent_id]
    org = await db.get_organization(auth.org_id)
    if not org:
        await websocket.send_json(
            {"type": "error", "content": "Organization not found", "code": "auth"}
        )
        await websocket.close()
        return

    if not plan_allows_agent(org["plan"], agent.tier):
        await websocket.send_json({
            "type": "error",
            "content": f"{agent.name} is not included in your plan. "
                       "Upgrade to unlock this agent.",
            "code": "plan",
        })
        await websocket.close()
        return

    sid = session_id or str(uuid.uuid4())
    await websocket.send_json(
        {"type": "session", "session_id": sid, "agent": agent.to_dict()}
    )

    try:
        while True:
            data = await websocket.receive_json()

            if data.get("type") == "message":
                user_msg = data.get("content", "").strip()
                if not user_msg:
                    continue

                sid = data.get("session_id", sid)

                # Quota check is per message, so plan changes apply immediately
                plan = get_plan((await db.get_organization(auth.org_id))["plan"])
                usage = await db.get_monthly_usage(auth.org_id)
                if not within_quota(usage["messages"], plan.messages_per_month):
                    await websocket.send_json({
                        "type": "error",
                        "content": "Monthly message quota reached "
                                   f"({plan.messages_per_month}). Upgrade your "
                                   "plan to continue.",
                        "code": "quota",
                    })
                    continue

                history = await db.get_history(auth.org_id, agent_id, sid)
                await db.save_message(
                    auth.org_id, auth.user_id, agent_id, sid, "user", user_msg
                )

                ctx = ToolContext(
                    org_id=auth.org_id, user_id=auth.user_id, plan_id=plan.id
                )
                full_response = ""
                total_in = total_out = 0
                await websocket.send_json({"type": "start"})

                try:
                    async for event in agent.run(user_msg, history, ctx):
                        if event["type"] == "text":
                            full_response += event["content"]
                            await websocket.send_json(
                                {"type": "chunk", "content": event["content"]}
                            )
                        elif event["type"] == "tool_start":
                            await websocket.send_json({
                                "type": "tool_start",
                                "name": event["name"],
                                "input": event["input"],
                            })
                        elif event["type"] == "tool_end":
                            await websocket.send_json({
                                "type": "tool_end",
                                "name": event["name"],
                                "ok": event["ok"],
                            })
                        elif event["type"] == "usage":
                            total_in += event["input_tokens"]
                            total_out += event["output_tokens"]
                except Exception as stream_err:
                    await websocket.send_json(
                        {"type": "error", "content": str(stream_err)}
                    )
                    continue
                finally:
                    await websocket.send_json({"type": "end"})
                    if total_in or total_out:
                        await db.record_usage(
                            auth.org_id, auth.user_id, agent_id,
                            total_in, total_out,
                        )

                if full_response:
                    await db.save_message(
                        auth.org_id, auth.user_id, agent_id, sid,
                        "assistant", full_response,
                    )

            elif data.get("type") == "clear":
                sid = data.get("session_id", sid)
                await db.clear_history(auth.org_id, agent_id, sid)
                await websocket.send_json({"type": "cleared"})

    except WebSocketDisconnect:
        pass
