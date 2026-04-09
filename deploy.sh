#!/bin/bash
# ============================================================
# 更新部署腳本 — 在 Oracle Cloud VM 上執行
# 用法：ssh 進入 VM 後執行 bash /opt/trump-monitor/deploy.sh
# ============================================================
set -e

APP_DIR="/opt/trump-monitor"
SERVICE_NAME="trump-monitor"

echo "🔄 拉取最新程式碼..."
cd "$APP_DIR"
git pull origin main

echo "📦 更新 Python 套件..."
source venv/bin/activate
pip install --quiet -r requirements.txt

echo "🔁 重啟服務..."
sudo systemctl restart "$SERVICE_NAME"

echo "✅ 部署完成！"
sudo systemctl status "$SERVICE_NAME" --no-pager -l
