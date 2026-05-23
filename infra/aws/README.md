# AWS migration (self-hosted Supabase + Amplify)

This folder holds infrastructure notes for the cutover described in [`HANDOFF.md`](../../HANDOFF.md).

## Prerequisites

- AWS account with IAM user (not root) — `AdministratorAccess` for initial setup only; rotate keys after
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) — `aws configure` (region: `us-west-2`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) on the EC2 instance (Ubuntu 22.04)
- Domain optional for v1 (can use Elastic IP + port 8000 until HTTPS domain is ready)

## Punch list

1. EC2 `t4g.small`, Ubuntu 22.04, 30GB encrypted EBS, security group (22 from your IP, 80/443 public, 5432 internal only)
2. Elastic IP associated
3. Docker + Supabase compose (trim to: db, auth, rest, kong, studio)
4. Apply repo migrations: `0001_init.sql`, `0002_rls.sql`, `0003_approve_gate.sql`, then `seed.sql`
5. Caddy → Kong HTTPS when domain is available
6. Amplify app (us-west-2) from GitHub `main`, env vars pointing at new Supabase URL + anon key
7. HIPAA hardening before real PHI: nightly `pg_dump` → S3, pg_audit, CloudTrail, breach notification doc

## Cutover

1. Parallel run against managed `ftxxexwzrhyrqjguagbi` until AWS stack passes smoke tests
2. Update `.env.local` / Amplify env to new URL
3. Pilot ~1 week, then pause managed Supabase project
