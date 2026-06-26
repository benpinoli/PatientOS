# AWS deployment — live stack

**Database:** self-hosted **open-source Supabase** on EC2 (not Supabase Cloud).  
**App:** Next.js on **AWS Amplify**, proxying API calls to EC2 over HTTPS.

| Resource | Value |
|----------|--------|
| Elastic IP | `32.185.154.166` |
| Instance | `i-0ceb5f7f69abea322` (t4g.small) |
| Security group | `sg-09cf02af40a8a785f` |
| SSH key | `%USERPROFILE%\.ssh\choice-tracker-key.pem` |
| Supabase API (Kong) | `http://32.185.154.166:8000` |
| Install path on server | `/opt/choice-supabase` |
| Amplify app | `d2na0dxbmaa2o4` → `https://main.d2na0dxbmaa2o4.amplifyapp.com` |

## 1. Apply database migrations (required for new-patient form)

If the stack was created before May 2026, apply pending migrations on EC2.

This applies migrations `0004` through `0011` (see `apply-pending-migrations.sh`), including ATP supervisor, patient workflows, payer types, and **Awaiting signature** task status.

Fresh installs: `apply-schema.sh` or `remote-setup-all.sh` runs **all** `supabase/migrations/*.sql` in order.

### Option A — Browser terminal (no SSH key, recommended if SSH fails)

You only need AWS Console access and region **us-west-2**.

1. [AWS Console](https://console.aws.amazon.com/) → search **EC2** → **Instances**.
2. Select instance **`i-0ceb5f7f69abea322`** (IP `32.185.154.166`).
3. Click **Connect** (top right).
4. Tab **EC2 Instance Connect** → **Connect** (opens a terminal in the browser).
5. Run these commands one block at a time (or paste the whole helper script):

```bash
curl -fsSL https://raw.githubusercontent.com/benpinoli/Choice-Healthcare-Task-System/main/infra/aws/scripts/apply-migrations-browser-shell.sh | bash
```

If `curl` fails (private network), open that file in the GitHub repo on your PC, copy its contents, and paste into the browser terminal.

When it finishes, try **Sent for signature** in the Amplify app again.

### Option B — SSH from Windows (`.pem` key)

```powershell
cd "C:\Users\pinol\Documents\Choice Healthcare\Choice-Healthcare-Task-System"
.\infra\aws\scripts\apply-migrations-from-windows.ps1
```

The script will:

- Check for `%USERPROFILE%\.ssh\choice-tracker-key.pem`
- Add your **current** public IP to the security group for port 22 (fixes “used to work, doesn’t now”)
- Copy migrations and run `apply-pending-migrations.sh` on the server

Manual SSH test:

```powershell
ssh -i $env:USERPROFILE\.ssh\choice-tracker-key.pem ubuntu@32.185.154.166
```

### Can't SSH? — quick fixes

| Symptom | What to try |
|--------|-------------|
| `Permission denied (publickey)` | Wrong/missing `.pem`, or key never saved when EC2 was created. Use **Option A** (browser) or get the `.pem` from whoever ran `launch-ec2.ps1`. |
| `Connection timed out` | Security group blocks port 22 from your IP. Run `apply-migrations-from-windows.ps1` (updates SG), or in EC2 → Security groups → `choice-tracker-sg-v2` → Inbound → SSH from **My IP**. |
| `UNPROTECTED PRIVATE KEY FILE` | Run `.\infra\aws\scripts\fix-pem.ps1` or `icacls %USERPROFILE%\.ssh\choice-tracker-key.pem /inheritance:r /grant:r "%USERNAME%:(R)"` |
| No `.pem` at all | **Option A** — EC2 Instance Connect in the browser does not need the file. |

**Do not** open Postgres port **5432** to the public internet. Migrations run **inside** Docker on the instance (`docker compose exec db psql`), not from your laptop to port 5432.

### Option C — AWS CloudShell (when EC2 Instance Connect tab fails)

Your **My IP** rule only allows SSH from your house/office. **CloudShell** and the browser connect proxy use **different** AWS addresses, so they still get blocked. Fix: add one **temporary** SSH rule, use CloudShell, then remove the rule.

#### C1. Temporary firewall (2 minutes)

1. EC2 → **Security Groups** → **choice-tracker-sg-v2** (`sg-09cf02af40a8a785f`).
2. **Inbound rules** → **Edit inbound rules** → **Add rule**:
   - Type: **SSH**, Port **22**, Source: **Anywhere-IPv4** (`0.0.0.0/0`)
   - Description: `TEMP migration — delete after`
3. **Save rules**. (Leave your existing **My IP** rules; adding one more is fine.)

#### C2. Open CloudShell

1. Region (top-right): **US West (Oregon)**.
2. Click the **CloudShell** icon (terminal) in the **top** navigation bar (not the bottom status bar on every layout).
3. Wait until you see a prompt like `~ $`.

#### C3. Connect to the server (no `.pem` file)

Paste this **whole block** into CloudShell and press Enter:

```bash
export AWS_DEFAULT_REGION=us-west-2
ssh-keygen -t rsa -f ~/ec2-temp -N "" -q
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-0ceb5f7f69abea322 \
  --instance-os-user ubuntu \
  --ssh-public-key "file://$HOME/ec2-temp.pub"
ssh -i ~/ec2-temp -o StrictHostKeyChecking=no -o ConnectTimeout=15 ubuntu@32.185.154.166
```

You should see an `ubuntu@ip-...` prompt. (If `send-ssh-public-key` errors with **AccessDenied**, your IAM user needs `ec2-instance-connect:SendSSHPublicKey` — ask the account admin.)

#### C4. Run migrations (on the server)

At the `ubuntu@...` prompt, paste:

```bash
curl -fsSL https://raw.githubusercontent.com/benpinoli/Choice-Healthcare-Task-System/main/infra/aws/scripts/apply-migrations-browser-shell.sh | bash
```

Wait for **Done** and **AWAITING_SIGNATURE**. Type `exit` to leave SSH.

#### C5. Lock down again (recommended)

Security group → **Edit inbound rules** → delete the **Anywhere / 0.0.0.0/0** SSH rule you added in C1 → **Save rules**.

You can keep **My IP** on port 22 for future admin work.

## 2. Local dev (`.env.local`)

```env
NEXT_PUBLIC_SUPABASE_URL=http://32.185.154.166:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from EC2 .env>
NEXT_PUBLIC_AUTH_EMAIL_ENABLED=true
NEXT_PUBLIC_AUTH_AZURE_ENABLED=false
```

Copy from [`.env.aws.local`](../../.env.aws.local).

SSH to read keys:

```bash
ssh -i ~/.ssh/choice-tracker-key.pem ubuntu@32.185.154.166
sudo grep -E '^ANON_KEY=|^SERVICE_ROLE_KEY=' /opt/choice-supabase/.env
```

Demo login (seed): `tara@patientos.example` / `password123`

## 3. Amplify → EC2 (HTTPS proxy, no Supabase Cloud)

Browsers block HTTPS Amplify → HTTP EC2. The app proxies via Next.js:

| Variable | Example |
|----------|---------|
| `SUPABASE_INTERNAL_URL` | `http://32.185.154.166:8000` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://main.d2na0dxbmaa2o4.amplifyapp.com/supabase` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | EC2 `ANON_KEY` |

PowerShell helper (after setting `SUPABASE_ANON_KEY`):

```powershell
$env:AMPLIFY_APP_ID = "d2na0dxbmaa2o4"
$env:AMPLIFY_BRANCH = "main"
$env:EC2_SUPABASE_URL = "http://32.185.154.166:8000"
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

## Paperwork AI (Gemini extension)

The `/paperwork` section uses Gemini to extract a structured patient JSON, turn
blank PDF templates into editable HTML, and auto-fill them. It needs object
storage and a Gemini key.

### 1. Enable Supabase Storage on EC2

`infra/aws/docker/docker-compose.override.yml` no longer disables `storage` /
`imgproxy`. Bring them up and ensure the storage env vars exist in
`/opt/choice-supabase/.env` (upstream defaults: `STORAGE_BACKEND=file`,
`FILE_SIZE_LIMIT`, `GLOBAL_S3_BUCKET`, etc. — keep the values shipped with the
Supabase docker template):

```bash
cd /opt/choice-supabase
git pull   # or copy the updated override file up
sudo docker compose -f docker-compose.yml -f docker-compose.override.yml up -d db meta auth rest kong storage imgproxy
```

### 2. Apply migrations

`0017_paperwork_ai.sql` (tables + RLS) and `0018_paperwork_storage.sql`
(buckets `paperwork-source` / `paperwork-templates` + object policies). The
0018 migration is guarded by a `to_regclass('storage.buckets')` check, so run it
**after** the storage container is up; otherwise it logs a notice and skips the
bucket setup (re-run it once storage exists). Apply with the usual
`infra/aws/scripts/apply-migrations-*` flow.

### 3. Gemini API key (server-only)

Add `GEMINI_API_KEY` to Amplify branch env and local `.env.local`. NEVER prefix
it with `NEXT_PUBLIC`. Optional `GEMINI_MODEL` / `GEMINI_MODEL_PRO` overrides.

```powershell
aws amplify update-app --region us-west-2 --app-id <app-id> --environment-variables GEMINI_API_KEY=<key>,...existing
```

### 4. Real-PHI gate (must clear before any real patient data)

This feature reverses the v1 "no document storage / no AI drafting" stance
(`CLAUDE.md` §15–16), so until every item below is done it runs on **synthetic
data only** (the in-app amber banner states this):

- [ ] **Google Cloud / Vertex AI BAA** covering Gemini for the data you send.
      Until signed, do not send real PHI to `/api/paperwork/*`.
- [ ] **HIPAA-grade Storage**: encrypted EBS for the storage volume, restricted
      bucket access (private buckets + the RLS policies in 0018), no public URLs.
- [ ] **Audit logging** for storage object access and paperwork table writes.
- [ ] **Backups + retention** for the new tables and storage volume.
- [ ] **Key handling**: `GEMINI_API_KEY` stored only in server env / secrets
      manager; rotate on staff changes.
- [ ] **Re-confirm** the synthetic-only banner is removed only after the above.

## Tear down (cost control)

```powershell
aws ec2 terminate-instances --region us-west-2 --instance-ids i-0ceb5f7f69abea322
aws ec2 release-address --region us-west-2 --allocation-id eipalloc-0ebe51c98d326a9bf
```
