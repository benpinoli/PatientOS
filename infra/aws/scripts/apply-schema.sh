#!/usr/bin/env bash
# Apply Choice Healthcare migrations + seed to a Postgres instance.
#
# Usage (from repo root on your laptop):
#   export DATABASE_URL="postgresql://postgres:PASSWORD@EC2_IP:5432/postgres"
#   ./infra/aws/scripts/apply-schema.sh
#
# Or via Docker on the EC2 host (tunnel 5432 only over SSH — do not expose publicly):
#   docker compose -f /opt/choice-supabase/docker-compose.yml exec -T db \
#     psql -U postgres -v ON_ERROR_STOP=1 < /path/to/0001_init.sql
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SEED="$ROOT/supabase/seed.sql"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL to postgresql://postgres:PASS@HOST:5432/postgres"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Install psql (PostgreSQL client) or run from EC2 with docker exec."
  exit 1
fi

echo "==> Migrations"
for f in "$MIGRATIONS"/0001_init.sql "$MIGRATIONS"/0002_rls.sql "$MIGRATIONS"/0003_approve_gate.sql; do
  echo "    $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Seed (synthetic demo data only)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SEED"

echo "==> Done. Copy ANON_KEY from Supabase .env into Amplify / .env.local."
