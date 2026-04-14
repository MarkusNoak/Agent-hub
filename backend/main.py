import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env BEFORE importing agents (they initialise AsyncAnthropic on first use)
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from agents import AGENTS  # noqa: E402
from database import clear_history, get_history, init_db, save_message  # noqa: E402

FRONTEND = Path(__file__).parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Agent Hub", lifespan=lifespan)

app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")


# ── REST ──────────────────────────────────────────────────────────────────────


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(str(FRONTEND / "index.html"))


@app.get("/api/agents")
async def list_agents():
    return [agent.to_dict() for agent in AGENTS.values()]


# ── WebSocket ─────────────────────────────────────────────────────────────────


@app.websocket("/ws/{agent_id}")
async def ws_chat(
    websocket: WebSocket,
    agent_id: str,
    session_id: str = Query(default=None),
):
    await websocket.accept()

    if agent_id not in AGENTS:
        await websocket.send_json(
            {"type": "error", "content": f"Unknown agent: {agent_id}"}
        )
        await websocket.close()
        return

    agent = AGENTS[agent_id]

    # Reuse session or create a fresh one
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

                # Load history BEFORE saving the new user message
                history = await get_history(agent_id, sid)
                await save_message(agent_id, sid, "user", user_msg)

                # Stream response
                full_response = ""
                await websocket.send_json({"type": "start"})

                try:
                    async for chunk in agent.stream_response(user_msg, history):
                        full_response += chunk
                        await websocket.send_json(
                            {"type": "chunk", "content": chunk}
                        )
                except Exception as stream_err:
                    await websocket.send_json(
                        {"type": "error", "content": str(stream_err)}
                    )
                    continue
                finally:
                    await websocket.send_json({"type": "end"})

                await save_message(agent_id, sid, "assistant", full_response)

            elif data.get("type") == "clear":
                sid = data.get("session_id", sid)
                await clear_history(agent_id, sid)
                await websocket.send_json({"type": "cleared"})

    except WebSocketDisconnect:
        pass
