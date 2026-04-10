#!/usr/bin/env bash
#
# One-shot setup script for deploying Carmenita on a SUSE server.
#
# Run this ONCE on the server after cloning the repo:
#   git clone https://github.com/mohsaqr/carmenita.git
#   cd carmenita
#   sudo bash scripts/server-setup.sh
#
set -euo pipefail

USER_NAME="saqr"
SERVER_IP="192.168.50.221"
APP_PORT="3000"
WEBHOOK_PORT="9000"
APP_DIR="/home/${USER_NAME}/carmenita"
DEPLOY_DIR="/home/${USER_NAME}/carmenita-deploy"
WEBHOOK_SECRET="$(openssl rand -hex 20)"
REQUIRED_NODE_MAJOR="22"

echo "============================================"
echo "  Carmenita Server Setup"
echo "============================================"
echo ""

# ── 1. Ensure Node.js 22 (remove wrong versions) ─────────────────────

current_node_major=""
if command -v node &>/dev/null; then
  current_node_major="$(node -v | sed 's/^v//' | cut -d. -f1)"
fi

if [[ "$current_node_major" == "$REQUIRED_NODE_MAJOR" ]]; then
  echo "[1/5] Node.js $(node -v) OK"
else
  echo "[1/5] Installing Node.js ${REQUIRED_NODE_MAJOR}..."

  # Remove any existing Node that isn't v22
  if [[ -n "$current_node_major" ]]; then
    echo "  Removing Node.js v${current_node_major} first..."
    sudo zypper remove -y nodejs* npm* 2>/dev/null || true
    sudo rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx 2>/dev/null || true
    hash -r
  fi

  # Install v22 via NodeSource RPM (works on SUSE/openSUSE)
  if ! curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -; then
    echo "  NodeSource setup failed, trying zypper directly..."
    sudo zypper addrepo --refresh \
      "https://rpm.nodesource.com/pub_22.x/nodistro/nodejs/" nodesource 2>/dev/null || true
    sudo zypper --gpg-auto-import-keys refresh nodesource
  fi
  sudo zypper install -y nodejs

  # Verify
  hash -r
  if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js installation failed. Install Node.js 22 manually and re-run."
    exit 1
  fi
  installed_major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [[ "$installed_major" != "$REQUIRED_NODE_MAJOR" ]]; then
    echo "ERROR: Got Node.js v${installed_major} instead of v${REQUIRED_NODE_MAJOR}."
    echo "  Remove it and install v22 manually:"
    echo "    sudo zypper remove nodejs"
    echo "    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -"
    echo "    sudo zypper install -y nodejs"
    exit 1
  fi
  echo "  Node.js $(node -v) installed"
fi

# ── 2. Build ──────────────────────────────────────────────────────────

echo "[2/5] Installing dependencies and building..."
cd "${APP_DIR}"

# Clean any stale native modules from a different Node version
rm -rf node_modules

npm install --no-audit --no-fund
npm run db:migrate
npm run build

# Copy static assets into standalone output
cp -r .next/static .next/standalone/.next/static
mkdir -p .next/standalone/public
cp -r public/. .next/standalone/public/ 2>/dev/null || true

echo "  Build complete"

# ── 3. App service ────────────────────────────────────────────────────

echo "[3/5] Creating systemd service..."

NODE_BIN="$(command -v node)"

sudo tee /etc/systemd/system/carmenita.service > /dev/null << SERVICEEOF
[Unit]
Description=Carmenita Quiz Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} .next/standalone/server.js
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

# Deploy script
cat > "${DEPLOY_DIR}/redeploy.sh" << DEPLOYEOF
#!/bin/bash
set -e
LOG="${DEPLOY_DIR}/deploy.log"
exec >> "\$LOG" 2>&1
echo ""
echo "=== Deploy started: \$(date) ==="
cd ${APP_DIR}
git pull origin main
rm -rf node_modules
npm install --no-audit --no-fund
npm run db:migrate
npm run build
cp -r .next/static .next/standalone/.next/static
mkdir -p .next/standalone/public
cp -r public/. .next/standalone/public/ 2>/dev/null || true
sudo systemctl restart carmenita
echo "=== Deploy complete: \$(date) ==="
DEPLOYEOF
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

# Install webhook binary
if ! command -v webhook &>/dev/null; then
  echo "  Installing webhook tool..."
  WEBHOOK_VER="2.8.1"
  TMP_DIR="$(mktemp -d)"
  curl -fsSL "https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VER}/webhook-linux-amd64.tar.gz" \
    -o "${TMP_DIR}/webhook.tar.gz"
  tar -xzf "${TMP_DIR}/webhook.tar.gz" -C "${TMP_DIR}"
  sudo cp "${TMP_DIR}/webhook-linux-amd64/webhook" /usr/local/bin/webhook
  sudo chmod +x /usr/local/bin/webhook
  rm -rf "${TMP_DIR}"
fi
WEBHOOK_BIN="$(command -v webhook)"

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

# Passwordless restart for deploy script
SUDOERS_LINE="${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart carmenita"
if ! sudo grep -qF "$SUDOERS_LINE" /etc/sudoers.d/carmenita 2>/dev/null; then
  echo "$SUDOERS_LINE" | sudo tee /etc/sudoers.d/carmenita > /dev/null
  sudo chmod 0440 /etc/sudoers.d/carmenita
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
echo "    1. github.com/mohsaqr/carmenita/settings/hooks"
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
