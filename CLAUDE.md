# trump-monitor

川普 Truth Social 即時監控網站，自動抓取並翻譯為繁體中文與日文。
部署於 GitHub Pages（純靜態，無後端）。

## 架構

純前端，無伺服器：

- **`index.html`** — 主頁面，含 SEO meta、OG tags、JSON-LD structured data
- **`app.js`** — 核心邏輯：呼叫 Factbase API、翻譯佇列、localStorage 快取、分頁、搜尋
- **`style.css`** — 深色主題 CSS
- **`favicon.svg`** — SVG favicon（含即時動畫綠點）

## 資料來源

- **Factbase / Roll Call API**: `https://rollcall.com/wp-json/factbase/v1/twitter`
  - 免費，無需登入，CORS 開放
  - 含川普所有社群媒體貼文（Truth Social、Twitter 等）
  - 前端直接呼叫，支援關鍵字搜尋與分頁

## 翻譯

- **MyMemory API**: `https://api.mymemory.translated.net/get`
  - 免費，可直接從瀏覽器呼叫
  - 依使用者瀏覽器語言自動切換：`zh-TW`（繁體中文）或 `ja`（日文）
  - 翻譯結果快取於 `localStorage`（key: `trump_trans_v1:<id>`）
  - 佇列式循序翻譯（每篇間隔 150ms），避免超出速率限制

## 部署

- **GitHub Pages**: `https://howardKHhu.github.io/trump-monitor`
  - 直接從 `main` branch 根目錄提供服務
  - 推送到 main 即自動部署，無需任何 build 步驟

## 開發

直接用瀏覽器開啟 `index.html`，或啟動任意靜態伺服器：

```bash
python3 -m http.server 8080
```
