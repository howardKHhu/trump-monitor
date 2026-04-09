# trump-monitor

川普 Truth Social 即時監控網站，自動抓取並翻譯為繁體中文與日文。

## 架構

- **Backend**: FastAPI + SQLite (`main.py`, `database.py`)
- **Poller**: `poller.py` — 每 2 分鐘從 Factbase API 抓取新貼文，翻譯後存入 DB
- **Translator**: `translator.py` — 使用 `deep-translator`（Google Translate）
- **Frontend**: Vanilla JS (`app.js`) + HTML (`index.html`) + CSS (`style.css`)

## 重要注意事項

### 雙重資料路徑（已知不一致）
- **Backend** (`poller.py`) 抓取 → Google Translate 翻譯 → 存入 SQLite → `/api/posts`
- **Frontend** (`app.js`) **直接**呼叫 Factbase API + MyMemory 翻譯，**完全繞過後端**
- `/api/posts` 目前沒有被前端使用

### 靜態檔案
- `main.py` 從 `static/` 目錄提供服務（`static/index.html`）
- 根目錄的 `index.html`、`app.js`、`style.css` 是來源檔案，需複製到 `static/`

### 環境變數
- `DATA_DIR` — SQLite DB 與 session 檔案的存放路徑（部署用持久化 volume）
- `TRUTH_ACCESS_TOKEN` — 選用，目前未使用

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/` | 前端頁面 |
| GET | `/api/posts` | 查詢貼文（lang, q, date_from, date_to, limit, offset） |
| GET | `/api/status` | 輪詢狀態與最後抓取時間 |
| POST | `/api/poll` | 手動觸發抓取 |
| POST | `/api/token` | 設定 access token（已棄用） |
| GET | `/api/token/status` | 查詢 token 狀態 |

## 開發

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

## 部署

- **Fly.io**: `fly.toml`
- **Railway**: `railway.toml`
- **Docker**: `Dockerfile`

## 資料來源

- Factbase / Roll Call API: `https://rollcall.com/wp-json/factbase/v1/twitter`
  - 免費，無需登入
  - 含川普所有社群媒體貼文，包括 Truth Social
