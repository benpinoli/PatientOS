# AWS deployment — live stack

**Last provisioned:** self-hosted Supabase on EC2 (us-west-2).

| Resource | Value |
|----------|--------|
| Elastic IP | `44.253.198.43` |
| Instance | `i-0c55b5678f0ec6cf7` (t4g.small) |
| Security group | `sg-07721f9fedc45d2fa` |
| SSH key | `%USERPROFILE%\.ssh\choice-tracker-key.pem` |
| Supabase API (Kong) | `http://44.253.198.43:8000` |
| Install path on server | `/opt/choice-supabase` |

## Point the Next.js app here

In `.env.local` (and Amplify env vars):

```env
NEXT_PUBLIC_SUPABASE_URL=http://44.253.198.43:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from /opt/choice-supabase/.env ANON_KEY on server>
NEXT_PUBLIC_AUTH_EMAIL_ENABLED=true
```

SSH to read keys:

```bash
ssh -i ~/.ssh/choice-tracker-key.pem ubuntu@44.253.198.43
sudo grep -E '^ANON_KEY=|^SERVICE_ROLE_KEY=' /opt/choice-supabase/.env
```

Demo login (seed): `tara@choice.example` / `password123`

## Amplify (step 7)

1. [Amplify Console](https://us-west-2.console.aws.amazon.com/amplify/) → **Create new app** → GitHub → `benpinoli/Choice-Healthcare-Task-System` → branch `main` or `build/v1-tracker`.
2. Build spec: root [`amplify.yml`](../../amplify.yml).
3. Add the same env vars as above.
4. After deploy, set GoTrue `SITE_URL` on EC2 to your Amplify URL and add it to redirect allow list in `/opt/choice-supabase/.env`, then `sudo docker compose ... up -d auth`.

## Rotate JWT keys (before real PHI)

On EC2:

```bash
cd /opt/choice-supabase
sudo bash ./utils/generate-keys.sh   # if present in upstream docker
sudo docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --force-recreate auth rest kong
```

Update Amplify + `.env.local` with the new `ANON_KEY`.

## Tear down (cost control)

```powershell
aws ec2 terminate-instances --region us-west-2 --instance-ids i-0c55b5678f0ec6cf7
aws ec2 release-address --region us-west-2 --allocation-id <eip-allocation-id>
```
