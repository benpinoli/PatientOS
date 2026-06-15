# AWS migration — self-hosted Supabase + Amplify

Implements [HANDOFF.md](../../HANDOFF.md) § “Plan for the AWS migration”. Target: **~$30–50/mo** (EC2 + Amplify) vs managed Supabase HIPAA tier.

## Architecture

```
Browser → AWS Amplify (Next.js)
              → HTTPS → EC2 Elastic IP :8000 (Kong)
                    → PostgREST + GoTrue + Postgres 17
```

## Step 0 — Windows dev machine

```powershell
cd "C:\Users\pinol\Documents\Choice Healthcare\Choice-Healthcare-Task-System"
.\infra\aws\scripts\install-aws-cli.ps1
aws configure   # region: us-west-2, IAM access key from Addison
aws sts get-caller-identity
```

## Step 1 — AWS account prep

- IAM user (not root) with admin for bootstrap; **rotate keys after** setup.
- Enable **CloudTrail** in the AWS account (control-plane audit).

## Step 2 — Network + EC2 (automated)

```powershell
.\infra\aws\scripts\launch-ec2.ps1
```

Creates (or reuses):

- Security group `choice-tracker-sg` — SSH from your IP, 80/443/8000 public, **5432 closed**
- Key pair `choice-tracker-key` → `%USERPROFILE%\.ssh\choice-tracker-key.pem`
- `t4g.small` Ubuntu 22.04, **30 GB encrypted EBS**, Elastic IP

Manual alternative: follow console steps in HANDOFF.md.

## Step 3–4 — Bootstrap Supabase on the instance

```bash
scp -i ~/.ssh/choice-tracker-key.pem -r infra/aws/scripts infra/aws/docker ubuntu@<ELASTIC_IP>:/tmp/choice-infra/
ssh -i ~/.ssh/choice-tracker-key.pem ubuntu@<ELASTIC_IP>
bash /tmp/choice-infra/scripts/bootstrap-ec2.sh
```

Edit `/opt/choice-supabase/.env` (passwords, `SITE_URL`, JWT keys — use upstream `utils/generate-keys.sh` in the cloned docker folder).

Start stack (script does this):

```bash
cd /opt/choice-supabase
sudo docker compose -f docker-compose.yml -f docker-compose.override.yml up -d db meta auth rest kong studio
```

`docker-compose.override.yml` disables storage/realtime/analytics for v1.

## Step 5 — Caddy (optional, when you have a domain)

See [caddy/Caddyfile](./caddy/Caddyfile). Until then, use `http://<ELASTIC_IP>:8000` as `NEXT_PUBLIC_SUPABASE_URL`.

## Step 6 — Migrations + seed

From your laptop (open **5432 only via SSH tunnel**, not the public internet):

```powershell
ssh -i $env:USERPROFILE\.ssh\choice-tracker-key.pem -L 5432:localhost:5432 ubuntu@<ELASTIC_IP>
# On EC2, Postgres is inside Docker — tunnel to container host port mapped in compose, or run apply on EC2:
```

On EC2 after stack is up:

```bash
export DATABASE_URL="postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres"
# Copy repo supabase/migrations + seed.sql to the instance, then:
bash /tmp/choice-infra/scripts/apply-schema.sh
```

Copy `ANON_KEY` / `SERVICE_ROLE_KEY` from `/opt/choice-supabase/.env` into Amplify env vars.

## Step 7 — Amplify (Next.js)

1. Amplify Console → **us-west-2** → Host web app → GitHub → `benpinoli/Choice-Healthcare-Task-System` → branch `main`.
2. Build uses root [`amplify.yml`](../../amplify.yml).
3. Environment variables (same names as `.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL` = `http://<ELASTIC_IP>:8000` (or HTTPS domain)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_AUTH_*_ENABLED`
4. Add Amplify URL to GoTrue `SITE_URL` / redirect allow list on the EC2 `.env`, restart `auth` container.

## Step 8 — Cutover

1. Smoke-test Amplify URL (login as `tara@patientos.example` / `password123` on **seeded** stack only).
2. Parallel-run against managed `ftxxexwzrhyrqjguagbi` until confident.
3. Pause managed Supabase project after ~1 week.

## Step 9 — HIPAA hardening (before real PHI)

- [ ] EBS encryption (enabled at launch)
- [ ] Nightly `pg_dump` → S3 (versioned, 6-year lifecycle)
- [ ] `pg_audit` + CloudWatch Logs
- [ ] CloudTrail enabled
- [ ] Rotate setup IAM keys; use roles for ongoing access
- [ ] One-page breach notification plan (paperwork)

## Files

| Path | Purpose |
|------|---------|
| `scripts/launch-ec2.ps1` | Step 2 from Windows |
| `scripts/bootstrap-ec2.sh` | Docker + Supabase on Ubuntu |
| `scripts/apply-schema.sh` | Run repo migrations + seed |
| `scripts/install-aws-cli.ps1` | AWS CLI on Windows |
| `docker/docker-compose.override.yml` | Trim services for v1 |
| `docker/env.tracker.example` | Extra env notes |
| `caddy/Caddyfile` | HTTPS when domain exists |
| `../../amplify.yml` | Amplify build spec |
