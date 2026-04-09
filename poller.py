"""
poller.py — 雙來源策略：
  1. 若有 Bearer Token → 用 Truth Social 官方 API（完整貼文）
  2. 若無 Token        → 用 Google News RSS（主要新聞報導中引用的貼文，無需登入）
"""
import asyncio
import json
import logging
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import httpx

from database import get_meta, set_meta, insert_post
from translator import translate_async

logger = logging.getLogger(__name__)

POLL_INTERVAL = 120  # seconds
_data_dir     = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
SESSION_FILE  = _data_dir / ".ts_session.json"
ENV_FILE      = Path(__file__).parent / ".env"

_access_token: str | None = None


# ── Token management ──────────────────────────────────────────────────────────

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
        logger.info("Token loaded from env")
        return _access_token
    if SESSION_FILE.exists():
        try:
            data = json.loads(SESSION_FILE.read_text())
            t = data.get("access_token", "").strip()
            if t:
                _access_token = t
                logger.info("Token loaded from session file")
                return _access_token
        except Exception:
            pass
    logger.info("No token — will use Google News RSS fallback")
    return None


# ── Source 1: Truth Social API (requires token) ───────────────────────────────

async def _api_get(path: str, params: dict = {}) -> list | dict | None:
    token = _access_token
    if not token:
        return None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        ),
    }
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        resp = await client.get(
            f"https://truthsocial.com{path}", params=params, headers=headers
        )
    if resp.status_code == 401:
        logger.warning("Token rejected (401) — falling back to RSS")
        clear_token()
        return None
    resp.raise_for_status()
    return resp.json()


async def _resolve_account_id() -> str | None:
    # Trump's account ID is stable, use cached or the known value
    cached = get_meta("account_id")
    if cached:
        return cached
    # Hardcode the known ID as fallback (from og:image URL)
    known_id = "107780257626128497"
    try:
        data = await _api_get("/api/v1/accounts/lookup", {"acct": "realDonaldTrump"})
        if data and "id" in data:
            set_meta("account_id", data["id"])
            return data["id"]
    except Exception:
        pass
    set_meta("account_id", known_id)
    return known_id


async def _fetch_from_api() -> list[dict]:
    """Fetch posts via official Truth Social API. Returns list of raw post dicts."""
    account_id = await _resolve_account_id()
    since_id   = get_meta("since_id")
    params: dict = {"limit": 40, "exclude_replies": "true"}
    if since_id:
        params["since_id"] = since_id
    try:
        posts = await _api_get(f"/api/v1/accounts/{account_id}/statuses", params)
        if not isinstance(posts, list):
            return []
        logger.info(f"[API] fetched {len(posts)} posts")
        return posts
    except Exception as e:
        logger.error(f"[API] error: {e}")
        return []


# ── Source 2: Google News RSS (no auth needed) ────────────────────────────────

_GNEWS_URL = (
    "https://news.google.com/rss/search"
    "?q=%22realDonaldTrump%22+site:truthsocial.com"
    "&hl=en-US&gl=US&ceid=US:en"
)

# Also search for news articles that QUOTE his Truth Social posts
_GNEWS_QUOTE_URL = (
    "https://news.google.com/rss/search"
    '?q=Trump+"Truth+Social"&hl=en-US&gl=US&ceid=US:en'
)


def _clean_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text).strip()


def _extract_quote_from_article(description: str) -> str:
    """Try to extract quoted Truth Social content from news article description."""
    desc = _clean_html(description)
    # Look for quoted phrases
    quotes = re.findall(r'"([^"]{30,})"', desc)
    if quotes:
        return " | ".join(quotes[:2])
    return desc


async def _fetch_from_gnews() -> list[dict]:
    """
    Fetch Google News items about Trump's Truth Social posts.
    Returns them in the same format as API posts for unified processing.
    """
    results = []
    seen_ids = set()

    for url in [_GNEWS_URL, _GNEWS_QUOTE_URL]:
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                headers = {
                    "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)",
                    "Accept": "application/rss+xml, application/xml, text/xml",
                }
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                xml_text = resp.text
        except Exception as e:
            logger.warning(f"[GNews] fetch error: {e}")
            continue

        try:
            root    = ET.fromstring(xml_text)
            channel = root.find("channel")
            if channel is None:
                continue
            items = channel.findall("item")
            logger.info(f"[GNews] {len(items)} items from {url[:60]}")

            for item in items:
                raw_title = item.findtext("title", "")
                raw_link  = item.findtext("link", "")
                raw_desc  = item.findtext("description", "")
                pub_date  = item.findtext("pubDate", "")
                source_el = item.find("source")
                source    = source_el.text if source_el is not None else "News"

                title  = _clean_html(raw_title)
                link   = raw_link.strip()

                # Generate a stable ID from the URL
                post_id = "news_" + str(abs(hash(link)))[:16]
                if post_id in seen_ids:
                    continue
                seen_ids.add(post_id)

                # Parse publish time
                try:
                    from email.utils import parsedate_to_datetime
                    created_at = parsedate_to_datetime(pub_date).isoformat()
                except Exception:
                    created_at = datetime.now(timezone.utc).isoformat()

                # Build content: title + extracted quote + source attribution
                quote   = _extract_quote_from_article(raw_desc)
                content = (
                    f"<p><strong>[{source}]</strong> {title}</p>"
                    f"<p>{quote}</p>"
                    f"<p><a href='{link}'>閱讀完整報導 →</a></p>"
                )

                results.append({
                    "id":         post_id,
                    "content":    content,
                    "created_at": created_at,
                    "url":        link,
                    "source":     "gnews",
                })
        except ET.ParseError as e:
            logger.warning(f"[GNews] XML parse error: {e}")
            continue

    # Sort by date, newest first
    results.sort(key=lambda x: x["created_at"], reverse=True)
    return results


# ── Unified fetch ─────────────────────────────────────────────────────────────

async def fetch_posts() -> tuple[int, int]:
    """Main poll entry point. Uses API if token available, else Google News."""
    if _access_token:
        raw_posts = await _fetch_from_api()
        source    = "api"
    else:
        raw_posts = await _fetch_from_gnews()
        source    = "gnews"

    if not raw_posts:
        _record_fetched()
        return 0, 0

    new_count = 0
    max_id    = get_meta("since_id") or "0"

    for post in raw_posts:
        post_id    = str(post["id"])
        content    = post.get("content", "")
        created_at = post.get("created_at", datetime.now(timezone.utc).isoformat())
        url        = post.get("url", "")

        # For API source: skip already-known posts using since_id
        if source == "api":
            try:
                if int(post_id) > int(max_id):
                    max_id = post_id
            except ValueError:
                pass

        # Translate
        try:
            content_zh, content_ja = await asyncio.gather(
                translate_async(content, "zh-TW"),
                translate_async(content, "ja"),
            )
        except Exception as e:
            logger.warning(f"Translation failed for {post_id}: {e}")
            content_zh = content
            content_ja = content

        insert_post(post_id, content, content_zh, content_ja, created_at, url)
        new_count += 1

    if source == "api" and max_id != (get_meta("since_id") or "0"):
        set_meta("since_id", max_id)

    _record_fetched()
    logger.info(f"[{source.upper()}] done: {len(raw_posts)} fetched, {new_count} new")
    return len(raw_posts), new_count


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
        "has_token":    bool(_access_token),
        "account_id":   get_meta("account_id"),
        "source":       "api" if _access_token else "gnews",
    }
