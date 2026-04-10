#!/usr/bin/env bash
#
# One-shot setup script for deploying Carmenita on a SUSE server.
#
# Run this ONCE on the server after cloning the repo:
#   git clone https://github.com/mohsaqr/carmenita.git
#   cd carmenita
#   bash scripts/server-setup.sh
#
# What it does:
#   1. Installs Node.js 22 if missing
#   2. Installs npm dependencies and builds the app
#   3. Creates a systemd service (carmenita) on port 3000
#   4. Creates a deploy script + webhook listener service
#      so pushes to main auto-redeploy
#   5. Prints the webhook URL to add on GitHub
#
set -euo pipefail

USER_NAME="saqr"
SERVER_IP="192.168.50.221"
APP_PORT="3000"
WEBHOOK_PORT="9000"
APP_DIR="/home/${USER_NAME}/carmenita"
DEPLOY_DIR="/home/${USER_NAME}/carmenita-deploy"
WEBHOOK_SECRET="$(openssl rand -hex 20)"

echo "============================================"
echo "  Carmenita Server Setup"
echo "  User:   ${USER_NAME}"
echo "  Server: ${SERVER_IP}"
echo "  Port:   ${APP_PORT}"
echo "============================================"
echo ""

# ── 1. Node.js ────────────────────────────────────────────────────────

if command -v node &>/dev/null && [[ "$(node -v)" == v2[0-9]* || "$(node -v)" == v22* ]]; then
  echo "[1/5] Node.js already installed: $(node -v)"
else
  echo "[1/5] Installing Node.js 22..."
  if command -v zypper &>/dev/null; then
    # Try NodeSource RPM first, fall back to zypper packages
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - || true
    sudo zypper install -y nodejs || sudo zypper install -y nodejs22 npm22
  else
    echo "ERROR: zypper not found. Install Node.js 22 manually."
    exit 1
  fi
  echo "  Node $(node -v) installed"
fi

# ── 2. Build ──────────────────────────────────────────────────────────

echo "[2/5] Installing dependencies and building..."
cd "${APP_DIR}"
npm install --no-audit --no-fund
npm run db:migrate
npm run build

# Copy static assets into standalone output
cp -r .next/static .next/standalone/.next/static
mkdir -p .next/standalone/public
cp -r public/. .next/standalone/public/ 2>/dev/null || true

echo "  Build complete"

# ── 3. App service ────────────────────────────────────────────────────

echo "[3/5] Creating systemd service for Carmenita..."
sudo tee /etc/systemd/system/carmenita.service > /dev/null << SERVICEEOF
[Unit]
Description=Carmenita Quiz Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node) .next/standalone/server.js
Environment=PORT=${APP_PORT}
Environment=HOSTNAME=0.0.0.0
Restart=always
RestartSec=5
User=${USER_NAME}

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable --now carmenita
echo "  Carmenita running on http://${SERVER_IP}:${APP_PORT}"

# ── 4. Auto-deploy webhook ───────────────────────────────────────────

echo "[4/5] Setting up auto-deploy webhook..."

mkdir -p "${DEPLOY_DIR}"

# Deploy script — called by the webhook on each push to main
cat > "${DEPLOY_DIR}/redeploy.sh" << 'DEPLOYEOF'
#!/bin/bash
set -e
LOG="/home/USERPLACEHOLDER/carmenita-deploy/deploy.log"
exec >> "$LOG" 2>&1
echo ""
echo "=== Deploy started: $(date) ==="
cd /home/USERPLACEHOLDER/carmenita
git pull origin main
npm install --no-audit --no-fund
npm run db:migrate
npm run build
cp -r .next/static .next/standalone/.next/static
mkdir -p .next/standalone/public
cp -r public/. .next/standalone/public/ 2>/dev/null || true
sudo systemctl restart carmenita
echo "=== Deploy complete: $(date) ==="
DEPLOYEOF

# Replace placeholder with actual username
sed -i "s|USERPLACEHOLDER|${USER_NAME}|g" "${DEPLOY_DIR}/redeploy.sh"
chmod +x "${DEPLOY_DIR}/redeploy.sh"

# Webhook config
cat > "${DEPLOY_DIR}/hooks.json" << HOOKSEOF
[
  {
    "id": "redeploy",
    "execute-command": "${DEPLOY_DIR}/redeploy.sh",
    "command-working-directory": "${APP_DIR}",
    "trigger-rule": {
      "and": [
        {
          "match": {
            "type": "payload-hmac-sha256",
            "secret": "${WEBHOOK_SECRET}",
            "parameter": {
              "source": "header",
              "name": "X-Hub-Signature-256"
            }
          }
        },
        {
          "match": {
            "type": "value",
            "value": "refs/heads/main",
            "parameter": {
              "source": "payload",
              "name": "ref"
            }
          }
        }
      ]
    }
  }
]
HOOKSEOF

# Install webhook binary if not present
if ! command -v webhook &>/dev/null; then
  echo "  Installing webhook tool..."
  if command -v go &>/dev/null; then
    GOBIN=/usr/local/bin sudo -E go install github.com/adnanh/webhook@latest
  else
    # Download pre-built binary
    WEBHOOK_VER="2.8.1"
    curl -fsSL "https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VER}/webhook-linux-amd64.tar.gz" \
      | sudo tar -xz -C /usr/local/bin --strip-components=1
  fi
fi
WEBHOOK_BIN=$(command -v webhook || echo "/usr/local/bin/webhook")

# Webhook systemd service
sudo tee /etc/systemd/system/carmenita-webhook.service > /dev/null << WHSERVICEEOF
[Unit]
Description=Carmenita deploy webhook
After=network.target

[Service]
Type=simple
ExecStart=${WEBHOOK_BIN} -hooks ${DEPLOY_DIR}/hooks.json -port ${WEBHOOK_PORT} -verbose
Restart=always
RestartSec=5
User=${USER_NAME}

[Install]
WantedBy=multi-user.target
WHSERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable --now carmenita-webhook
echo "  Webhook listening on port ${WEBHOOK_PORT}"

# Allow the deploy script to restart the service without a password
SUDOERS_LINE="${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart carmenita"
if ! sudo grep -qF "$SUDOERS_LINE" /etc/sudoers.d/carmenita 2>/dev/null; then
  echo "$SUDOERS_LINE" | sudo tee /etc/sudoers.d/carmenita > /dev/null
  sudo chmod 0440 /etc/sudoers.d/carmenita
  echo "  Sudoers rule added for passwordless restart"
fi

# ── 5. Done ──────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  App:     http://${SERVER_IP}:${APP_PORT}"
echo "  Webhook: http://${SERVER_IP}:${WEBHOOK_PORT}/hooks/redeploy"
echo ""
echo "  WEBHOOK SECRET (save this!):"
echo "  ${WEBHOOK_SECRET}"
echo ""
echo "  Add this webhook on GitHub:"
echo "    1. Go to: github.com/mohsaqr/carmenita/settings/hooks"
echo "    2. Payload URL: http://${SERVER_IP}:${WEBHOOK_PORT}/hooks/redeploy"
echo "    3. Content type: application/json"
echo "    4. Secret: ${WEBHOOK_SECRET}"
echo "    5. Events: Just pushes"
echo ""
echo "  Logs:"
echo "    App:    sudo journalctl -u carmenita -f"
echo "    Deploy: tail -f ${DEPLOY_DIR}/deploy.log"
echo "    Hook:   sudo journalctl -u carmenita-webhook -f"
echo ""
echo "  To password-protect, edit the service:"
echo "    sudo systemctl edit carmenita"
echo "    Add: Environment=CARMENITA_USER=admin"
echo "    Add: Environment=CARMENITA_PASS=your-secret"
echo "    Then: sudo systemctl restart carmenita"
echo ""
