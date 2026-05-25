#!/usr/bin/env bash
# Full Supabase stack setup on EC2 (run as ubuntu via SSH after scp).
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/choice-supabase}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-/tmp/choice-repo}"

echo "==> Bootstrap Docker + Supabase"
export INSTALL_DIR
bash "$SCRIPT_DIR/bootstrap-ec2.sh"

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  echo "==> Creating .env from example"
  if [[ ! -f "$INSTALL_DIR/.env.example" ]]; then
    echo "ERROR: $INSTALL_DIR missing — bootstrap clone failed?"
    exit 1
  fi
  sudo cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  cd "$INSTALL_DIR"
  if [[ -f ./utils/generate-keys.sh ]]; then
    sudo bash ./utils/generate-keys.sh || true
  else
    echo "WARNING: generate-keys.sh missing — edit $INSTALL_DIR/.env manually"
    sudo sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" "$INSTALL_DIR/.env"
    sudo sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" "$INSTALL_DIR/.env"
  fi
  PUBLIC_IP=$(curl -s https://checkip.amazonaws.com)
  sudo sed -i "s|^SITE_URL=.*|SITE_URL=http://${PUBLIC_IP}:8000|" "$INSTALL_DIR/.env"
  sudo sed -i "s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=http://${PUBLIC_IP}:8000|" "$INSTALL_DIR/.env"
  sudo sed -i "s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=http://${PUBLIC_IP}:8000|" "$INSTALL_DIR/.env"
fi

cd "$INSTALL_DIR"
echo "==> Starting services"
sudo docker compose -f docker-compose.yml -f docker-compose.override.yml pull db meta auth rest kong
sudo docker compose -f docker-compose.yml -f docker-compose.override.yml up -d db meta auth rest kong

echo "==> Waiting for Postgres"
for i in $(seq 1 60); do
  if sudo docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

if [[ -d "$REPO_ROOT/supabase/migrations" ]]; then
  echo "==> Applying Choice Healthcare migrations + seed"
  for f in "$REPO_ROOT/supabase/migrations"/*.sql; do
    echo "    $f"
    sudo docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 < "$f"
  done
  sudo docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 < "$REPO_ROOT/supabase/seed.sql"
fi

echo ""
echo "==> Setup complete"
echo "    API URL: http://$(curl -s https://checkip.amazonaws.com):8000"
echo "    Copy ANON_KEY from: $INSTALL_DIR/.env"
grep -E '^ANON_KEY=' "$INSTALL_DIR/.env" 2>/dev/null || sudo grep -E '^ANON_KEY=' "$INSTALL_DIR/.env" || true
