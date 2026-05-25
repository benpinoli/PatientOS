#!/usr/bin/env bash
# Production-readiness audit for self-hosted Supabase Postgres.
set -euo pipefail
cd /opt/choice-supabase

PSQL="sudo docker compose -f docker-compose.yml -f docker-compose.override.yml exec -T db psql -U postgres -v ON_ERROR_STOP=0"

echo "=== 1. Tables + RLS ==="
$PSQL -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"

echo "=== 2. Required functions ==="
$PSQL -c "SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND proname IN ('create_patient_with_tasks', 'update_app_user', 'current_user_active', 'current_user_roles', 'has_any_role', 'reports_to_me') ORDER BY proname;"

echo "=== 3. supervising_atp_id column ==="
$PSQL -c "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'supervising_atp_id';"

echo "=== 4. Row counts ==="
$PSQL -c "SELECT 'app_users' AS t, count(*)::text FROM app_users UNION ALL SELECT 'patients', count(*)::text FROM patients UNION ALL SELECT 'tasks', count(*)::text FROM tasks UNION ALL SELECT 'task_templates', count(*)::text FROM task_templates UNION ALL SELECT 'payers', count(*)::text FROM payers;"

echo "=== 5. Task approve-gate trigger ==="
$PSQL -c "SELECT tgname FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid WHERE c.relname = 'tasks' AND NOT t.tgisinternal;"

echo "=== 6. Policy count per table ==="
$PSQL -c "SELECT tablename, count(*) AS policies FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename ORDER BY tablename;"

echo "=== 7. Demo users (seed) ==="
$PSQL -c "SELECT email, active, roles FROM app_users ORDER BY email;"

echo "=== 8. JWT key check (demo key = NOT production) ==="
grep -E '^ANON_KEY=' /opt/choice-supabase/.env | head -1
if grep -q 'supabase-demo' /opt/choice-supabase/.env 2>/dev/null || grep -q '1641769200' /opt/choice-supabase/.env 2>/dev/null; then
  echo "WARNING: Default/demo JWT keys detected — rotate before real PHI."
fi

echo "=== 9. GoTrue SITE_URL ==="
grep -E '^SITE_URL=|^API_EXTERNAL_URL=' /opt/choice-supabase/.env

echo "=== DONE ==="
