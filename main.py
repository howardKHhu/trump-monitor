import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import init_db, query_posts
from poller import (
    fetch_posts, poll_loop, get_status,
    load_token_from_storage, set_token, get_token,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

_poll_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _poll_task
    init_db()
    load_token_from_storage()
    _poll_task = asyncio.create_task(poll_loop())
    yield
    if _poll_task:
        _poll_task.cancel()
        try:
            await _poll_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Truth Social Monitor", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")


# ── Pages ────────────────────────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse("static/index.html")


# ── API ──────────────────────────────────────────────────────────────────────

@app.get("/api/posts")
async def get_posts(
    lang: str = Query("zh-TW"),
    q: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    return query_posts(
        lang=lang,
        q=q or "",
        date_from=date_from or "",
        date_to=date_to or "",
        limit=limit,
        offset=offset,
    )


@app.get("/api/status")
async def status():
    return get_status()


@app.post("/api/poll")
async def manual_poll():
    fetched, new = await fetch_posts()
    return {"fetched": fetched, "new": new}


class TokenBody(BaseModel):
    token: str


@app.post("/api/token")
async def save_token(body: TokenBody):
    t = body.token.strip()
    if not t:
        raise HTTPException(400, "Token cannot be empty")
    set_token(t)
    # Trigger an immediate poll with the new token
    asyncio.create_task(fetch_posts())
    return {"ok": True}


@app.get("/api/token/status")
async def token_status():
    return {"has_token": bool(get_token())}
