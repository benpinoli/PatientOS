# AWS deployment — live stack

**Database:** self-hosted **open-source Supabase** on EC2 (not Supabase Cloud).  
**App:** Next.js on **AWS Amplify**, proxying API calls to EC2 over HTTPS.

| Resource | Value |
|----------|--------|
| Elastic IP | `44.253.198.43` |
| Instance | `i-0c55b5678f0ec6cf7` (t4g.small) |
| Security group | `sg-07721f9fedc45d2fa` |
| SSH key | `%USERPROFILE%\.ssh\choice-tracker-key.pem` |
| Supabase API (Kong) | `http://44.253.198.43:8000` |
| Install path on server | `/opt/choice-supabase` |
| Amplify app | `d2na0dxbmaa2o4` → `https://main.d2na0dxbmaa2o4.amplifyapp.com` |

## 1. Apply database migrations (required for new-patient form)

If the stack was created before May 2026, apply pending migrations on EC2:

```bash
# Copy latest repo to EC2, then:
export REPO_ROOT=/tmp/choice-repo
bash /tmp/choice-infra/scripts/apply-pending-migrations.sh
```

This applies migrations `0004` through `0011` (see the script list in `apply-pending-migrations.sh`), including ATP supervisor, patient workflows, payer types, and **Awaiting signature** task status.

Fresh installs: `apply-schema.sh` or `remote-setup-all.sh` runs **all** `supabase/migrations/*.sql` in order.

## 2. Local dev (`.env.local`)

```env
NEXT_PUBLIC_SUPABASE_URL=http://44.253.198.43:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from EC2 .env>
NEXT_PUBLIC_AUTH_EMAIL_ENABLED=true
NEXT_PUBLIC_AUTH_AZURE_ENABLED=false
```

Copy from [`.env.aws.local`](../../.env.aws.local).

SSH to read keys:

```bash
ssh -i ~/.ssh/choice-tracker-key.pem ubuntu@44.253.198.43
sudo grep -E '^ANON_KEY=|^SERVICE_ROLE_KEY=' /opt/choice-supabase/.env
```

Demo login (seed): `tara@choice.example` / `password123`

## 3. Amplify → EC2 (HTTPS proxy, no Supabase Cloud)

Browsers block HTTPS Amplify → HTTP EC2. The app proxies via Next.js:

| Variable | Example |
|----------|---------|
| `SUPABASE_INTERNAL_URL` | `http://44.253.198.43:8000` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://main.d2na0dxbmaa2o4.amplifyapp.com/supabase` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | EC2 `ANON_KEY` |

PowerShell helper (after setting `SUPABASE_ANON_KEY`):

```powershell
$env:AMPLIFY_APP_ID = "d2na0dxbmaa2o4"
$env:AMPLIFY_BRANCH = "main"
$env:EC2_SUPABASE_URL = "http://44.253.198.43:8000"
$env:AMPLIFY_APP_URL = "https://main.d2na0dxbmaa2o4.amplifyapp.com"
$env:SUPABASE_ANON_KEY = "<paste ANON_KEY>"
.\infra\aws\scripts\update-amplify-env.ps1
```

Then redeploy Amplify (push to `main` or “Redeploy this version”).

The script sets `NEXT_PUBLIC_APP_URL` so sign-out and OAuth callbacks redirect to your Amplify host (not `localhost`).

## 4. GoTrue redirect URLs on EC2

Edit `/opt/choice-supabase/.env`:

```env
SITE_URL=https://main.d2na0dxbmaa2o4.amplifyapp.com
API_EXTERNAL_URL=https://main.d2na0dxbmaa2o4.amplifyapp.com/supabase
SUPABASE_PUBLIC_URL=https://main.d2na0dxbmaa2o4.amplifyapp.com/supabase
```

Add the Amplify URL to `ADDITIONAL_REDIRECT_URLS`, then:

```bash
cd /opt/choice-supabase
sudo docker compose -f docker-compose.yml -f docker-compose.override.yml up -d auth kong
```

## 5. Retire Supabase Cloud

After smoke-testing Amplify + EC2, pause the managed project `ftxxexwzrhyrqjguagbi` in the Supabase dashboard.

## Optional: HTTPS on EC2 with a domain

See [caddy/Caddyfile](./caddy/Caddyfile). Then set `NEXT_PUBLIC_SUPABASE_URL=https://api.yourdomain.com` and skip the `/supabase` proxy.

## Tear down (cost control)

```powershell
aws ec2 terminate-instances --region us-west-2 --instance-ids i-0c55b5678f0ec6cf7
aws ec2 release-address --region us-west-2 --allocation-id <eip-allocation-id>
```
