#!/usr/bin/env bash
# NIZAM deploy script — run as 'nizam' user on the VPS after hardening.
# Pulls the repo, installs deps, builds, and starts the service.
set -euo pipefail

APP_DIR="/opt/nizam"
REPO="https://github.com/seifelsherbinyy/nizamfinancialapp.git"
BRANCH="master"

cd "$APP_DIR"

# Clone or pull
if [ -d ".git" ]; then
  echo "[*] pulling latest $BRANCH..."
  git fetch origin && git reset --hard "origin/$BRANCH"
else
  echo "[*] cloning $REPO..."
  git clone --branch "$BRANCH" "$REPO" .
fi

# Install production deps
echo "[*] installing dependencies..."
npm ci --production=false  # need devDeps for build

# Build the server (once server code exists)
if [ -f "server/package.json" ]; then
  echo "[*] building server..."
  cd server && npm ci && npm run build && cd ..
fi

# Create data directory (SQLite lives here)
mkdir -p "$APP_DIR/data"

# Restart the service
echo "[*] restarting nizam service..."
sudo systemctl restart nizam
sudo systemctl status nizam --no-pager -l

echo ""
echo "[+] deploy complete. Logs: journalctl -u nizam -f"
