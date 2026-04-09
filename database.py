import sqlite3
import os
from datetime import datetime, timezone

# DATA_DIR env var lets deployment platforms (Railway/Fly.io) point to a persistent volume
_data_dir = os.environ.get("DATA_DIR", os.path.dirname(__file__))
DB_PATH = os.path.join(_data_dir, "posts.db")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS posts (
            id          TEXT PRIMARY KEY,
            content     TEXT NOT NULL,
            content_zh  TEXT,
            content_ja  TEXT,
            created_at  TEXT NOT NULL,
            url         TEXT,
            fetched_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_created_at ON posts(created_at DESC);

        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
    """)
    conn.commit()
    conn.close()


def get_meta(key: str) -> str | None:
    conn = get_conn()
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else None


def set_meta(key: str, value: str):
    conn = get_conn()
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()


def insert_post(post_id: str, content: str, content_zh: str, content_ja: str,
                created_at: str, url: str):
    conn = get_conn()
    fetched_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT OR IGNORE INTO posts
           (id, content, content_zh, content_ja, created_at, url, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (post_id, content, content_zh, content_ja, created_at, url, fetched_at)
    )
    conn.commit()
    conn.close()


def query_posts(lang: str = "zh-TW", q: str = "", date_from: str = "",
                date_to: str = "", limit: int = 20, offset: int = 0):
    conn = get_conn()
    conditions = []
    params: list = []

    if q:
        conditions.append("(content LIKE ? OR content_zh LIKE ? OR content_ja LIKE ?)")
        like = f"%{q}%"
        params += [like, like, like]

    if date_from:
        conditions.append("created_at >= ?")
        params.append(date_from + "T00:00:00")

    if date_to:
        conditions.append("created_at <= ?")
        params.append(date_to + "T23:59:59")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    total = conn.execute(
        f"SELECT COUNT(*) as cnt FROM posts {where}", params
    ).fetchone()["cnt"]

    rows = conn.execute(
        f"""SELECT id, content, content_zh, content_ja, created_at, url
            FROM posts {where}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?""",
        params + [limit, offset]
    ).fetchall()
    conn.close()

    translated_key = "content_ja" if lang == "ja" else "content_zh"
    posts = []
    for r in rows:
        posts.append({
            "id": r["id"],
            "content_original": r["content"],
            "content_translated": r[translated_key] or r["content"],
            "created_at": r["created_at"],
            "url": r["url"],
        })

    return {"posts": posts, "total": total, "has_more": (offset + limit) < total}
