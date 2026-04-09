"""
poller.py — 資料來源：Factbase / Roll Call API
  https://rollcall.com/wp-json/factbase/v1/twitter
  - 免費、不需登入
  - 提供川普所有社群媒體貼文原文（含 Truth Social）
  - 每 2 分鐘輪詢一次，只抓比上次更新的貼文
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx

from database import get_meta, set_meta, insert_post
from translator import translate_async

logger = logging.getLogger(__name__)

POLL_INTERVAL = 120  # seconds
API_URL = "https://rollcall.com/wp-json/factbase/v1/twitter"

# ── Token（選用，有的話走官方 TS API，沒有走 Factbase） ─────────────────────
_data_dir    = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
SESSION_FILE = _data_dir / ".ts_session.json"
ENV_FILE     = Path(__file__).parent / ".env"
_access_token: str | None = None


def _load_env():
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def get_token() -> str | None:
    return _access_token


def set_token(token: str):
    global _access_token
    _access_token = token
    SESSION_FILE.write_text(json.dumps({"access_token": token}))
    logger.info("Access token saved")


def clear_token():
    global _access_token
    _access_token = None
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()


def load_token_from_storage() -> str | None:
    global _access_token
    _load_env()
    env_token = os.environ.get("TRUTH_ACCESS_TOKEN", "").strip()
    if env_token:
        _access_token = env_token
        return _access_token
    if SESSION_FILE.exists():
        try:
            data = json.loads(SESSION_FILE.read_text())
            t = data.get("access_token", "").strip()
            if t:
                _access_token = t
                return _access_token
        except Exception:
            pass
    return None


# ── Factbase API ─────────────────────────────────────────────────────────────

async def _fetch_factbase(page: int = 1) -> list[dict]:
    """Fetch posts from Factbase/Roll Call API."""
    params = {
        "page":       page,
        "sort":       "date",
        "sort_order": "desc",
        "page_size":  50,
    }
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        ),
        "Referer": "https://rollcall.com/factbase/trump/topic/social/",
        "Accept":  "application/json",
    }
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        resp = await client.get(API_URL, params=params, headers=headers)
        resp.raise_for_status()
        return resp.json().get("data", [])


# ── Main fetch ────────────────────────────────────────────────────────────────

async def fetch_posts() -> tuple[int, int]:
    """
    Poll Factbase for new posts since last run.
    Returns (fetched, new).
    """
    last_id = get_meta("factbase_last_id")

    try:
        posts = await _fetch_factbase(page=1)
    except Exception as e:
        logger.error(f"[Factbase] fetch error: {e}")
        _record_fetched()
        return 0, 0

    if not posts:
        _record_fetched()
        return 0, 0

    new_count = 0
    newest_id = None

    for post in posts:
        doc_id = str(post.get("document_id") or post.get("id", ""))
        if not doc_id:
            continue

        # Track newest ID seen this run
        if newest_id is None:
            newest_id = doc_id

        # Stop once we hit posts we've already stored
        if last_id and doc_id == last_id:
            break

        # Only process Truth Social posts
        platform = post.get("platform", "")
        if platform and "truth" not in platform.lower():
            continue

        content    = post.get("social", {}).get("post_html") or f"<p>{post.get('text', '')}</p>"
        text       = post.get("text", "")
        created_at = post.get("date", datetime.now(timezone.utc).isoformat())
        url        = post.get("post_url") or post.get("account_url", "")

        # Translate both languages in parallel
        try:
            content_zh, content_ja = await asyncio.gather(
                translate_async(text, "zh-TW"),
                translate_async(text, "ja"),
            )
        except Exception as e:
            logger.warning(f"Translation failed for {doc_id}: {e}")
            content_zh = text
            content_ja = text

        insert_post(doc_id, content, content_zh, content_ja, created_at, url)
        new_count += 1
        logger.info(f"[Factbase] stored post {doc_id} ({created_at[:10]})")

    if newest_id:
        set_meta("factbase_last_id", newest_id)

    _record_fetched()
    logger.info(f"[Factbase] done: {len(posts)} fetched, {new_count} new")
    return len(posts), new_count


def _record_fetched():
    set_meta("last_fetched", datetime.now(timezone.utc).isoformat())


async def poll_loop():
    delay = 0
    while True:
        await asyncio.sleep(delay)
        try:
            await fetch_posts()
        except Exception as e:
            logger.error(f"poll_loop error: {e}")
        delay = POLL_INTERVAL


def get_status() -> dict:
    return {
        "last_fetched": get_meta("last_fetched") or "never",
        "has_token":    False,   # token 不再需要
        "source":       "factbase",
        "last_id":      get_meta("factbase_last_id"),
    }
