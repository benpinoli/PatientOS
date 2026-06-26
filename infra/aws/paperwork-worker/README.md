# Paperwork AI worker

A small long-running container that processes `public.paperwork_jobs` so the AI
calls (Gemini PDF→HTML conversion, form fill, extraction) are **not** subject to
Amplify Hosting's hard ~30s SSR response cap.

## Why this exists

Amplify's SSR/compute runtime kills any request at ~30 seconds and AWS does not
allow raising it ([feature request #3223](https://github.com/aws-amplify/amplify-hosting/issues/3223)).
Generating a full editable HTML form, or filling one, routinely takes longer.

So instead of the browser calling a long API route:

1. The browser inserts a row into `paperwork_jobs` (RLS-guarded) and polls it.
2. This worker (on the EC2 Supabase host, no 30s cap) claims the job, calls
   Gemini, writes the result into the real `paperwork_*` tables, and sets the
   job to `DONE` with a `result` payload.
3. The browser sees `DONE` and updates the UI.

## How it connects

The worker runs as a container attached to the existing `supabase_default`
Docker network and talks to Postgres directly (`supabase-db:5432`) as the
`postgres` superuser, which bypasses RLS. No PostgREST, no storage bucket needed
— uploaded file bytes travel inside the job row as base64.

## Deploy (on the EC2 host)

```bash
# 1. Put these files in /opt/paperwork-worker (scp or git).
# 2. Create the secret env file (NOT committed):
sudo tee /opt/paperwork-worker/worker.env >/dev/null <<'EOF'
GEMINI_API_KEY=YOUR_KEY_HERE
GEMINI_MODEL=gemini-2.5-flash
EOF

# 3. Build + start (reads POSTGRES_PASSWORD from the Supabase .env automatically):
cd /opt/paperwork-worker
sudo docker compose -f docker-compose.worker.yml up -d --build

# 4. Watch it:
sudo docker logs -f paperwork-worker
```

The DB migration `supabase/migrations/0019_paperwork_jobs.sql` must be applied to
the Supabase Postgres before the worker (or the app) is used.

## Environment

| Var | Source | Default |
|---|---|---|
| `GEMINI_API_KEY` | `worker.env` | — (required) |
| `GEMINI_MODEL` | `worker.env` | `gemini-2.5-flash` |
| `POSTGRES_PASSWORD` | `/opt/choice-supabase/.env` | — (required) |
| `POSTGRES_DB` | `/opt/choice-supabase/.env` | `postgres` |
| `PGHOST` | compose | `supabase-db` |

## Notes

- Never logs PHI — only job ids, kinds, durations, and error messages.
- One worker is enough; it claims jobs with `FOR UPDATE SKIP LOCKED`, so you can
  scale to multiple replicas safely if needed.
