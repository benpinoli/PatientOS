#!/usr/bin/env bash
# Apply migrations 0004+ on an existing self-hosted Supabase DB (safe to re-run 0004).
# Run on EC2:
#   cd /opt/choice-supabase
#   export REPO_ROOT=/tmp/choice-repo
#   bash /tmp/choice-infra/scripts/apply-pending-migrations.sh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/tmp/choice-repo}"
INSTALL_DIR="${INSTALL_DIR:-/opt/choice-supabase}"
MIGRATIONS="$REPO_ROOT/supabase/migrations"

cd "$INSTALL_DIR"

for f in "$MIGRATIONS"/0004_supervising_atp.sql \
         "$MIGRATIONS"/0005_harden_user_and_patient_workflows.sql; do
  if [[ -f "$f" ]]; then
    echo "==> $f"
    sudo docker compose -f docker-compose.yml -f docker-compose.override.yml exec -T db \
      psql -U postgres -v ON_ERROR_STOP=1 < "$f"
  else
    echo "SKIP missing $f"
  fi
done

echo "==> Done"
