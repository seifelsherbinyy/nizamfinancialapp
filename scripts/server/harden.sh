#!/usr/bin/env bash
# NIZAM VPS hardening script — run as root on first SSH login.
# Implements: docs/PFOS_SECRETS_PLAN.md section 7, provisioning order.
# No secrets in this file (it is tracked in git).
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# 1. Create application user (non-root, sudo-capable)
# ═══════════════════════════════════════════════════════════════
APP_USER="nizam"
if ! id "$APP_USER" &>/dev/null; then
  adduser --disabled-password --gecos "NIZAM service" "$APP_USER"
  usermod -aG sudo "$APP_USER"
  echo "$APP_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$APP_USER
  chmod 440 /etc/sudoers.d/$APP_USER
  echo "[+] created user $APP_USER with passwordless sudo"
else
  echo "[=] user $APP_USER already exists"
fi

# ═══════════════════════════════════════════════════════════════
# 2. Install SSH public key for the nizam user
# ═══════════════════════════════════════════════════════════════
NIZAM_HOME="/home/$APP_USER"
mkdir -p "$NIZAM_HOME/.ssh"
# The ed25519 public key generated on the dev machine
cat >> "$NIZAM_HOME/.ssh/authorized_keys" << 'PUBKEY'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKUTdHNk0FJdrxJHNn4nHko5a1ZiPiG+z7bZHty1SVWg nizam-vps
PUBKEY
sort -u -o "$NIZAM_HOME/.ssh/authorized_keys" "$NIZAM_HOME/.ssh/authorized_keys"
chown -R "$APP_USER:$APP_USER" "$NIZAM_HOME/.ssh"
chmod 700 "$NIZAM_HOME/.ssh"
chmod 600 "$NIZAM_HOME/.ssh/authorized_keys"
echo "[+] SSH key installed for $APP_USER"

# Also allow key login as root (for initial setup; will disable later)
mkdir -p /root/.ssh
cp "$NIZAM_HOME/.ssh/authorized_keys" /root/.ssh/authorized_keys
chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys
echo "[+] SSH key also installed for root (temporary)"

# ═══════════════════════════════════════════════════════════════
# 3. Harden SSH: disable password auth + root login
# ═══════════════════════════════════════════════════════════════
SSHD_CONF="/etc/ssh/sshd_config"
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONF"
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONF"
sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' "$SSHD_CONF"
sed -i 's/^#*UsePAM.*/UsePAM no/' "$SSHD_CONF"
systemctl restart sshd
echo "[+] SSH hardened: key-only, root disabled"

# ═══════════════════════════════════════════════════════════════
# 4. Firewall (ufw): allow only SSH + HTTPS
# ═══════════════════════════════════════════════════════════════
apt-get update -qq
apt-get install -y -qq ufw fail2ban
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment "SSH"
ufw allow 443/tcp comment "HTTPS (Caddy)"
ufw allow 80/tcp comment "HTTP (Caddy redirect)"
echo "y" | ufw enable
echo "[+] firewall: deny all except 22, 80, 443"

# ═══════════════════════════════════════════════════════════════
# 5. Install Node.js 24 (LTS via NodeSource)
# ═══════════════════════════════════════════════════════════════
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
  echo "[+] Node $(node -v) installed"
else
  echo "[=] Node $(node -v) already present"
fi

# ═══════════════════════════════════════════════════════════════
# 6. Install Caddy (reverse proxy + automatic HTTPS)
# ═══════════════════════════════════════════════════════════════
if ! command -v caddy &>/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
    gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
    tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
  echo "[+] Caddy installed"
else
  echo "[=] Caddy already present"
fi

# ═══════════════════════════════════════════════════════════════
# 7. Create the secret store
# ═══════════════════════════════════════════════════════════════
SECRET_FILE="/etc/nizam/nizam.env"
mkdir -p /etc/nizam
if [ ! -f "$SECRET_FILE" ]; then
  install -m 600 -o root -g root /dev/null "$SECRET_FILE"
  cat >> "$SECRET_FILE" << 'ENVTEMPLATE'
# NIZAM production secrets — root:root 600, loaded via EnvironmentFile=
# Fill each value; this file is NEVER in git, NEVER on Drive.
OPENROUTER_API_KEY=
NIZAM_DATA_ENCRYPTION_KEY=
NIZAM_BACKUP_ENCRYPTION_KEY=
# Optional channels (uncomment when ready):
# TELEGRAM_BOT_TOKEN=
# SMS_WEBHOOK_SECRET=
# GMAIL_GRANT_TOKEN=
ENVTEMPLATE
  echo "[+] secret store created at $SECRET_FILE (root:root 600)"
else
  echo "[=] secret store already exists at $SECRET_FILE"
fi

# ═══════════════════════════════════════════════════════════════
# 8. Create application directory
# ═══════════════════════════════════════════════════════════════
APP_DIR="/opt/nizam"
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"
echo "[+] app directory: $APP_DIR (owned by $APP_USER)"

# ═══════════════════════════════════════════════════════════════
# 9. Install systemd service unit
# ═══════════════════════════════════════════════════════════════
cat > /etc/systemd/system/nizam.service << 'UNIT'
[Unit]
Description=NIZAM Personal Finance Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nizam
Group=nizam
WorkingDirectory=/opt/nizam
EnvironmentFile=/etc/nizam/nizam.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/nizam/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
echo "[+] systemd unit installed (nizam.service)"

# ═══════════════════════════════════════════════════════════════
# 10. Install age (for backup encryption)
# ═══════════════════════════════════════════════════════════════
if ! command -v age &>/dev/null; then
  apt-get install -y -qq age 2>/dev/null || {
    # Fallback: download from GitHub if not in apt
    AGE_VER="v1.2.0"
    curl -fsSL "https://github.com/FiloSottile/age/releases/download/$AGE_VER/age-$AGE_VER-linux-amd64.tar.gz" | \
      tar -xz -C /usr/local/bin --strip-components=1 age/age age/age-keygen
  }
  echo "[+] age installed for backup encryption"
else
  echo "[=] age already present"
fi

# ═══════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  NIZAM VPS hardening COMPLETE                       ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  User:       nizam (sudo, key-only SSH)             ║"
echo "║  SSH:        key-only, root disabled                ║"
echo "║  Firewall:   22 + 80 + 443 only                    ║"
echo "║  Runtime:    Node $(node -v)                         "
echo "║  Proxy:      Caddy (auto-TLS on your domain)        ║"
echo "║  Secrets:    /etc/nizam/nizam.env (fill manually)   ║"
echo "║  Service:    systemctl start nizam                  ║"
echo "║  App dir:    /opt/nizam                             ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  NEXT: ssh nizam@<IP>, fill secrets, deploy app     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "IMPORTANT: Test SSH as 'nizam' user NOW (in another terminal)"
echo "before closing this root session. If locked out, use OVHcloud"
echo "rescue mode to recover."
