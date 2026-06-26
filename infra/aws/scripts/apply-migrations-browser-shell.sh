#!/usr/bin/env bash
# Paste this entire script into the AWS Console terminal (no local SSH required).
#
# How to open the terminal:
#   EC2 → Instances → select i-0ceb5f7f69abea322 → Connect →
#   "EC2 Instance Connect" tab → Connect
#
# Downloads pending migrations from GitHub main and applies them to Postgres in Docker.
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/choice-supabase}"
# Branch the migrations are pulled from. Override with REPO_BRANCH=main once the
# Paperwork AI work is merged to main.
REPO_BRANCH="${REPO_BRANCH:-integrated_AI}"
REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/benpinoli/Choice-Healthcare-Task-System/${REPO_BRANCH}/supabase/migrations}"

# Listed in order. Re-running is safe: each migration is idempotent (drop/create
# + if-not-exists), so already-applied ones are no-ops.
MIGS=(
  0004_supervising_atp.sql
  0005_harden_user_and_patient_workflows.sql
  0006_fix_create_patient_payer_type.sql
  0007_task_link_history.sql
  0008_requires_atp_review_default_true.sql
  0009_payer_types_admin.sql
  0010_ensure_builtin_payer_types.sql
  0011_task_awaiting_signature_status.sql
  0012_task_snoozed_until.sql
  0013_task_notes.sql
  0014_notifications.sql
  0015_patient_birth_date.sql
  0016_notification_events.sql
  0017_paperwork_ai.sql
  0018_paperwork_storage.sql
)

if [[ ! -d "$INSTALL_DIR" ]]; then
  echo "ERROR: $INSTALL_DIR not found. Is Supabase installed on this instance?"
  exit 1
fi

cd "$INSTALL_DIR"
COMPOSE="sudo docker compose -f docker-compose.yml -f docker-compose.override.yml"

if ! $COMPOSE ps db 2>/dev/null | grep -q running; then
  echo "ERROR: Postgres container 'db' is not running. Try:"
  echo "  cd $INSTALL_DIR && sudo docker compose up -d db"
  exit 1
fi

echo "Applying migrations from $REPO_RAW"
echo ""

for f in "${MIGS[@]}"; do
  echo "==> $f"
  url="$REPO_RAW/$f"
  if ! curl -fsSL "$url" | $COMPOSE exec -T db psql -U postgres -v ON_ERROR_STOP=1; then
    echo "    (failed or already applied — continuing)"
  fi
  echo ""
done

echo "Done. Quick check (should mention AWAITING_SIGNATURE):"
$COMPOSE exec -T db psql -U postgres -c \
  "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tasks'::regclass and conname = 'tasks_status_check';"

echo ""
echo "If that succeeded, try Sent for signature in the Amplify app."
