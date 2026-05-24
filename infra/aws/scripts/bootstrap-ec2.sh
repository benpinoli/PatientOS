#!/usr/bin/env bash
# Run on a fresh Ubuntu 22.04 EC2 (t4g.small) as a sudo-capable user.
# Installs Docker, clones Supabase docker, starts trimmed services.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/choice-supabase}"
REPO_URL="${REPO_URL:-https://github.com/supabase/supabase.git}"

echo "==> System packages"
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y git curl ca-certificates
# Caddy optional until a domain is configured (install from https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
sudo apt-get install -y caddy 2>/dev/null || true

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi
# Use sudo for compose until group membership applies on next login.
alias docker='sudo docker'
shopt -s expand_aliases
export COMPOSE_BAKE=true

echo "==> Supabase docker (upstream)"
sudo mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  sudo rm -rf "$INSTALL_DIR"
  sudo git clone --depth 1 "$REPO_URL" /tmp/supabase-upstream
  sudo mv /tmp/supabase-upstream/docker "$INSTALL_DIR"
  sudo rm -rf /tmp/supabase-upstream
fi

echo "==> Tracker override compose"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo cp "$SCRIPT_DIR/../docker/docker-compose.override.yml" "$INSTALL_DIR/docker-compose.override.yml"

if [[ ! -f "$INSTALL_DIR/.env" ]] && [[ -f "$INSTALL_DIR/.env.example" ]]; then
  sudo cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
fi

if [[ -f "$INSTALL_DIR/.env" ]]; then
  cd "$INSTALL_DIR"
  echo "==> Starting core services (db meta auth rest kong)"
  sudo docker compose -f docker-compose.yml -f docker-compose.override.yml pull db meta auth rest kong
  sudo docker compose -f docker-compose.yml -f docker-compose.override.yml up -d db meta auth rest kong
fi

echo "==> Done. Kong API should be on port 8000."
echo "Studio: http://<host>:8000 (via Kong) — see Supabase self-hosting docs."
echo "Next: run apply-schema.sh from your laptop against this host."
