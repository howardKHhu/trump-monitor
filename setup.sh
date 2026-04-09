#!/bin/bash
# ============================================================
# Oracle Cloud Ubuntu VM 一鍵安裝腳本
# 用法：ssh 進入 VM 後執行
#   bash <(curl -s https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/setup.sh)
# ============================================================
set -e

REPO_URL="https://github.com/YOUR_USER/YOUR_REPO.git"  # ← 部署前改這裡
APP_DIR="/opt/trump-monitor"
SERVICE_NAME="trump-monitor"
PYTHON="python3"

echo "======================================"
echo " Trump Truth Social Monitor - Setup"
echo "======================================"

# 1. 系統更新 & 安裝依賴
echo "[1/7] 更新系統套件..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3 python3-pip python3-venv git nginx certbot python3-certbot-nginx curl

# 1b. 建立 2GB Swap（E2.1.Micro 只有 1GB RAM，加 Swap 防止 OOM）
echo "[1b/7] 設定 Swap 空間..."
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  # 降低 swappiness，減少不必要的 swap 使用
  echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
  sudo sysctl -p
  echo "  Swap 已建立：$(free -h | grep Swap)"
else
  echo "  Swap 已存在，跳過"
fi

# 2. 複製程式碼
echo "[2/6] 下載程式碼..."
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR" && sudo git pull
else
  sudo git clone "$REPO_URL" "$APP_DIR"
fi
sudo chown -R ubuntu:ubuntu "$APP_DIR"

# 3. Python 虛擬環境 & 安裝套件
echo "[3/6] 安裝 Python 套件..."
cd "$APP_DIR"
$PYTHON -m venv venv
source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# 4. 建立資料目錄
echo "[4/6] 建立資料目錄..."
sudo mkdir -p /data/trump-monitor
sudo chown ubuntu:ubuntu /data/trump-monitor

# 5. 安裝 systemd 服務
echo "[5/6] 設定系統服務..."
sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=Trump Truth Social Monitor
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=${APP_DIR}
Environment="DATA_DIR=/data/trump-monitor"
ExecStart=${APP_DIR}/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 --limit-concurrency 20
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# 6. 設定 Nginx
echo "[6/6] 設定 Nginx..."
sudo tee /etc/nginx/sites-available/trump-monitor > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;   # 先用 IP，設定網域後再改

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/trump-monitor /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# 防火牆開放 80/443
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

echo ""
echo "======================================"
echo " ✅ 安裝完成！"
echo "======================================"
echo " 服務狀態：sudo systemctl status trump-monitor"
echo " 查看 log：sudo journalctl -u trump-monitor -f"
echo " 網站位址：http://$(curl -s ifconfig.me)"
echo ""
echo " 如果有網域，執行以下指令設定 HTTPS："
echo "   sudo certbot --nginx -d yourdomain.com"
echo "======================================"
