#!/bin/bash
# Cloud-init user-data: bootstrap Supabase + apply all Choice Healthcare migrations.
# Logs: /var/log/choice-bootstrap.log
set -euo pipefail
exec > /var/log/choice-bootstrap.log 2>&1

INSTALL_DIR="/opt/choice-supabase"
REPO_RAW="https://raw.githubusercontent.com/benpinoli/Choice-Healthcare-Task-System/main"
INFRA_RAW="$REPO_RAW/infra/aws"
MIG_RAW="$REPO_RAW/supabase/migrations"
SEED_RAW="$REPO_RAW/supabase/seed.sql"

echo "==> Choice Healthcare EC2 bootstrap $(date -Is)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Supabase docker"
mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  rm -rf /tmp/supabase-upstream
  git clone --depth 1 https://github.com/supabase/supabase.git /tmp/supabase-upstream
  rm -rf "$INSTALL_DIR"
  mv /tmp/supabase-upstream/docker "$INSTALL_DIR"
  rm -rf /tmp/supabase-upstream
fi

curl -fsSL "$INFRA_RAW/docker/docker-compose.override.yml" -o "$INSTALL_DIR/docker-compose.override.yml"

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  cd "$INSTALL_DIR"
  if [[ -f ./utils/generate-keys.sh ]]; then
    bash ./utils/generate-keys.sh || true
  fi
  PUBLIC_IP=$(curl -s https://checkip.amazonaws.com)
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" "$INSTALL_DIR/.env"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" "$INSTALL_DIR/.env"
  sed -i "s|^SITE_URL=.*|SITE_URL=http://${PUBLIC_IP}:8000|" "$INSTALL_DIR/.env"
  sed -i "s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=http://${PUBLIC_IP}:8000|" "$INSTALL_DIR/.env"
  sed -i "s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=http://${PUBLIC_IP}:8000|" "$INSTALL_DIR/.env"
fi

cd "$INSTALL_DIR"
docker compose -f docker-compose.yml -f docker-compose.override.yml pull db meta auth rest kong
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d db meta auth rest kong

echo "==> Waiting for Postgres"
for i in $(seq 1 90); do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

echo "==> Migrations"
for f in \
  0001_init.sql 0002_rls.sql 0003_approve_gate.sql 0004_supervising_atp.sql \
  0005_harden_user_and_patient_workflows.sql 0006_fix_create_patient_payer_type.sql \
  0007_task_link_history.sql 0008_requires_atp_review_default_true.sql \
  0009_payer_types_admin.sql 0010_ensure_builtin_payer_types.sql \
  0011_task_awaiting_signature_status.sql 0012_task_snoozed_until.sql \
  0013_task_notes.sql 0014_notifications.sql; do
  echo "    $f"
  curl -fsSL "$MIG_RAW/$f" | docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1
done

echo "==> Seed"
curl -fsSL "$SEED_RAW" | docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1

docker compose restart rest kong

echo "==> DONE $(date -Is)"
echo "API: http://$(curl -s https://checkip.amazonaws.com):8000"
grep -E '^ANON_KEY=|^SERVICE_ROLE_KEY=' "$INSTALL_DIR/.env" || true
