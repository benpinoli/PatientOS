# Handoff — paste this into your Claude conversation

**Status as of 2026-05-23.** Project is mid-pivot. App works end-to-end against a hosted Supabase backend; we're about to migrate the backend off of managed Supabase onto self-hosted Supabase on AWS. Next.js front-end will deploy to AWS Amplify.

Read this whole file in your first conversation so your Claude has the full picture. Companion files in the repo: `README.md`, `ARCHITECTURE.md`, `CLAUDE.md` (the persistent context pack — read that second).

---

## TL;DR project mission

Choice Healthcare manually drives custom power-wheelchair documentation through Google-Drive-and-email chaos. We're building a shared, role-aware checklist app:

- One prioritized queue per logged-in user, scoped by role (REP / ATP / MANAGER / BOSS)
- Per-patient checklist instantiated from per-payer templates
- ATP-review gate enforced at the DB layer
- v1 stores no documents — task rows just hold an optional URL link

The customer (Choice) doesn't currently pay for the dev work; we're doing it for portfolio / relationship / experience. They WILL use it in production — this isn't a toy. The owner (DeAnne in the seed; real org may differ) has greenlit the team using it.

---

## Where we are right now

✅ **Done:**
- Schema: 5 tables (`app_users`, `payers`, `patients`, `task_templates`, `tasks`) + RLS policies + ATP-review-gate trigger. Migrations are in `supabase/migrations/`. Working on hosted Supabase at `https://ftxxexwzrhyrqjguagbi.supabase.co`.
- Seed: 5 demo users (DeAnne / Matt / Steve / Tara / Jack, all `password123`), 3 payers, all template rows, 9 patients with varied states. In `supabase/seed.sql`.
- Next.js front-end: login, dashboard with priority queue, patient list, patient detail with computed next-step, new-patient form (instantiates tasks), admin screen for user activation + roles. App passes `npx tsc --noEmit` and `npx next build`.
- Local dev: works at `localhost:3000`. `npm run dev` boots Next, talks to hosted Supabase.
- Pushed to GitHub: `https://github.com/benpinoli/Choice-Healthcare-Task-System` on both `build/v1-tracker` and `main` branches.

🟡 **In progress / next:**
- Self-host Supabase on AWS (EC2 + Docker Compose, us-west-2).
- Deploy Next.js to AWS Amplify pointed at the new Supabase URL.
- After cutover, retire the managed Supabase project.

❌ **Explicitly out of scope for v1 (don't build):**
- Document storage / upload
- E-signature
- Email/SMS notifications
- Automated outreach to doctors / PTs
- AI drafting of justifications / appeals
- Inventory management

---

## Why we're self-hosting Supabase instead of using paid Supabase HIPAA

Long version is in the conversation that produced this handoff. Short version:

| Path | Monthly | Trade-off |
|---|---|---|
| Managed Supabase HIPAA + Vercel BAA | ~$950 | Zero ops; biggest bill |
| Managed Supabase HIPAA + AWS Amplify | ~$610 | Zero ops on DB; AWS for app |
| **Self-hosted Supabase on AWS (chosen)** | **~$30-50** | We own the ops |

The customer can't fund $600-950/mo without seeing the product work first. Self-hosting on AWS lets us deliver a real HIPAA-eligible deployment for a cost the customer can stomach.

**Important caveat about HIPAA + self-hosting:** AWS BAA covers the infrastructure for free, but HIPAA compliance is more than the BAA — encryption at rest, audit logs, backups, OS patching, network isolation, breach-notification policy all have to be set up correctly by us. Don't assume "we picked the cheap option, we're done." The AWS setup plan below explicitly does these.

---

## Tech stack

- **Frontend:** Next.js 16.2.6 (App Router) + React 19 + TypeScript + Tailwind 4
- **Auth pattern:** `@supabase/ssr` with cookie-based sessions; `src/proxy.ts` (Next 16 renamed `middleware` → `proxy`) refreshes the cookie every request
- **Backend:** Supabase open-source stack (Postgres 17 + GoTrue + PostgREST + Kong gateway). Currently on managed Supabase free tier; migrating to self-hosted on AWS EC2.
- **Auth providers:** config-driven via `src/lib/auth-providers.ts`. Microsoft (Azure/Entra) is the default. Email/password is enabled for dev. Add Google or anything else by flipping `NEXT_PUBLIC_AUTH_*_ENABLED` env vars — no code rewrite.
- **Hosting (final state):** AWS — EC2 t4g.small for Supabase, Amplify for Next.js.

---

## Domain rules you must internalize before writing code

These are decisions / clarifications from the customer that override what the original spec said. Future code should respect them.

### 1. Managers carry direct caseloads.

The org structure is NOT "managers manage, reps rep." Most everyone — including managers like Matt — works patients directly. Management is a minority slice; direct patient work is the dominant activity. When designing UI, don't push the team-rollup view at the expense of the user's own queue. Manager's primary view = their own work; team rollup = secondary.

(Memory file in Addison's local Claude: `org-direct-patient-work.md`.)

### 2. ATP-credentialed reps handle ATP review on their own patients.

If a rep has `ATP` in their `roles` array, they are the `assigned_atp_id` on their own patients — the "solo case" is the NORM for ATP-credentialed staff, not an edge case. ATPs don't farm out ATP review to other ATPs. A separate ATP is assigned ONLY when the rep is a pure REP (no ATP credential — e.g. Tara, Jack).

In the new-patient form: if assigned rep has `ATP`, pre-fill `assigned_atp_id` to them. Otherwise leave blank for explicit pick.

(Memory file: `atp-self-handling.md`.)

### 3. Supabase HIPAA isn't ~$25/mo, it's ~$600/mo.

The Pro tier is $25 but the HIPAA add-on is ~$599. Quote the all-in figure in cost conversations. This number drove the AWS pivot.

(Memory file: `supabase-hipaa-cost.md`.)

### 4. Doctors / PTs / front-desk staff are NOT app users.

The `tasks.responsible_role` field labels who needs to act in the real world (Doctor, PT, Rep, ATP, Front desk). Only the app users (REP/ATP/MANAGER/BOSS roles) have accounts. The column in the UI is labeled "Awaiting" (not "Owner") to make this clear — when a task shows `Awaiting: Doctor`, the rep's next action is to call the doctor's office, not to assign a doctor account.

### 5. Never log PHI.

Patient names + payer info = PHI. Logs / error traces / analytics should reference IDs only, never names. The Supabase free tier in use today is explicitly synthetic data only — no real patient names in there.

### 6. Snapshot template fields onto tasks at instantiation.

When creating a patient, we copy the matching `task_templates` rows into `tasks` rows and freeze `label`, `responsible_role`, `requires_atp_review`, `required`, `order_index`. Editing a template later does NOT rewrite in-flight tasks. This is intentional — patients in mid-pipeline don't get rug-pulled if someone reorders the checklist.

### 7. Status flow + the ATP review gate.

```
NOT_STARTED → IN_PROGRESS → [DONE_PENDING_REVIEW if requires_atp_review] → APPROVED
                                  ↘ BLOCKED (from any state, with reason)
```

The gate (`supabase/migrations/0003_approve_gate.sql`) enforces: a task with `requires_atp_review=true` can only become `APPROVED` if the actor is the assigned ATP (or BOSS, or the rep-who-is-also-ATP via the solo-case carve-out). The gate bypasses when `auth.uid()` is null (i.e. server-side admin scripts via psql) — that's how seeds run without tripping it.

---

## What's where in the repo

Read this section to know what file does what.

```
/
├── README.md                  # Project pitch + local dev quickstart
├── ARCHITECTURE.md            # System design overview with Mermaid ERD
├── CLAUDE.md                  # 400+ line orientation pack for Claude sessions — READ THIS SECOND
├── HANDOFF.md                 # This file
├── AGENTS.md                  # Next 16 != older Next reminder
├── .env.example               # Template for .env.local — secrets NOT committed
├── .env.local                 # ⚠ gitignored — get the values from Addison
├── package.json, tsconfig.json, next.config.ts, postcss.config.mjs
├── supabase/
│   ├── config.toml            # Local supabase CLI config (unused once we move to AWS)
│   ├── seed.sql               # 5 users + payers + templates + 9 patients (synthetic only)
│   └── migrations/
│       ├── 0001_init.sql      # 5 tables, indexes, handle_new_auth_user trigger
│       ├── 0002_rls.sql       # RLS helpers + per-table policies
│       └── 0003_approve_gate.sql  # ATP review gate trigger
└── src/
    ├── proxy.ts               # Cookie refresh + auth gate (Next 16 proxy convention)
    ├── app/
    │   ├── layout.tsx         # Root HTML + Geist fonts
    │   ├── globals.css        # Tailwind imports
    │   ├── login/
    │   │   ├── page.tsx       # Server component, reads enabled providers
    │   │   └── LoginForm.tsx  # Client component, OAuth + dev password form
    │   ├── auth/
    │   │   ├── callback/route.ts   # exchangeCodeForSession then redirect
    │   │   └── signout/route.ts    # POST → signOut → /login
    │   └── (app)/             # Authed shell
    │       ├── layout.tsx     # Nav (Dashboard / Patients / New patient / Admin if admin)
    │       ├── page.tsx       # Dashboard: priority queue across all visible tasks
    │       ├── actions.ts     # Server actions: updateTaskStatus, updateTaskFields,
    │       │                  #                 createPatient, updateUser
    │       ├── TaskActions.tsx # Client: inline status / priority / link / due-date editor
    │       ├── patients/
    │       │   ├── page.tsx           # Patient list (RLS filters visibility)
    │       │   ├── new/page.tsx       # New-patient form (auto-instantiates tasks)
    │       │   └── [id]/page.tsx      # Patient detail w/ computed next-step
    │       └── admin/
    │           ├── page.tsx           # User activation + roles + read-only templates
    │           └── AdminUserRow.tsx   # Client: per-user editor
    └── lib/
        ├── auth-providers.ts  # Config-driven enabled providers (Azure primary)
        ├── db-types.ts        # HAND-WRITTEN row types (replaceable with `supabase gen types`)
        ├── format.ts          # STATUS_LABEL, STATUS_CLASS, ROLE_LABEL, isOverdue, formatDate
        ├── queries.ts         # fetchDashboardTasks, fetchPatientWithTasks, computeNextStep
        ├── server-helpers.ts  # requireUser, hasRole, isAdmin
        └── supabase/
            ├── server.ts      # createServerClient bound to next/headers cookies
            └── browser.ts     # Memoized createBrowserClient for "use client" code
```

---

## Credentials you need

The repo has no secrets in it. To run locally OR to drive the AWS migration, you need:

1. **`.env.local`** — Addison has this. Ask him to send it via 1Password / Signal / encrypted whatever. Contains: Supabase URL, anon key, service_role key, auth provider flags. NEVER commit this.

2. **Hosted Supabase admin** — Addison has dashboard access at supabase.com. The project ref is `ftxxexwzrhyrqjguagbi`. If you need to push migrations to that project directly, use psql against `aws-1-us-west-2.pooler.supabase.com:5432` as user `postgres.ftxxexwzrhyrqjguagbi` (the direct DB host is IPv6-only on free tier). DB password is in `.env.local`.

3. **AWS account** — Addison's. He'll need to set up an IAM user with appropriate permissions and share access keys, OR you'll need to do the AWS setup in his account via the console with him driving.

4. **GitHub** — repo is at `github.com/benpinoli/Choice-Healthcare-Task-System`. Both Addison (`Addisonslewis`) and `benpinoli` (whoever this is) have push access. Confirm yours.

---

## Plan for the AWS migration (the next major piece of work)

This is what's next on the punchlist. Approach is single-EC2 with Docker Compose — simplest deployment that meets the goals. Can be upgraded to RDS + ECS Fargate later if scale demands.

### Architecture

```
                              ┌─────────────────────────┐
   Browser ── HTTPS ────► AWS Amplify (Next.js app)
                              └────────────┬────────────┘
                                           │ HTTPS, anon key + JWT
                                           ▼
                         ┌──────────── EC2 t4g.small (us-west-2) ────────────┐
                         │  Caddy reverse proxy (HTTPS via Let's Encrypt)    │
                         │      │                                            │
                         │      ▼                                            │
                         │  Kong API gateway                                 │
                         │      │                                            │
                         │      ├─ PostgREST (REST API on RLS)              │
                         │      ├─ GoTrue (auth)                            │
                         │      └─ Postgres 17 + our 3 migrations + seed    │
                         │            (data on encrypted EBS volume)        │
                         └────────────────────┬──────────────────────────────┘
                                              │
                                              ▼
                                  Nightly pg_dump → S3 (encrypted, retained)
```

### Step-by-step (~4-6 hours)

1. **AWS account prep** (10 min)
   - Create an IAM user (not root) with `AdministratorAccess` for the setup (rotate after).
   - Generate access key + secret. Run `aws configure` on the dev machine (region: `us-west-2`).

2. **Network + EC2** (45 min)
   - Use default VPC in us-west-2 (no new VPC needed for v1).
   - Create a security group `choice-tracker-sg`:
     - inbound 22 from your IP (SSH)
     - inbound 80 + 443 from anywhere (Caddy)
     - 5432 NOT exposed (Postgres internal-only)
   - Create an SSH key pair `choice-tracker-key`. Save the .pem locally with `chmod 400`.
   - Launch EC2: Ubuntu 22.04 LTS, `t4g.small` (ARM), 30GB EBS, **encryption enabled**, security group above, the key pair.
   - Allocate an Elastic IP and associate it (so the IP doesn't change on reboot).

3. **Server bootstrap** (30 min)
   - SSH in, run system updates: `sudo apt update && sudo apt upgrade -y`
   - Install Docker + Compose plugin: `curl -fsSL https://get.docker.com | sh; sudo usermod -aG docker $USER`
   - Install Caddy: `sudo apt install caddy`
   - Create `/opt/supabase` directory; clone `https://github.com/supabase/supabase` (or just copy the `docker/` subfolder).

4. **Trim the Supabase Docker Compose** (45 min)
   - Start from `supabase/docker/docker-compose.yml`
   - Keep: `db` (Postgres), `auth` (GoTrue), `rest` (PostgREST), `kong`, `studio`
   - Drop: `realtime`, `storage`, `imgproxy`, `edge-functions`, `logflare`, `vector`, `meta` (unless you keep Studio, in which case keep meta)
   - Generate fresh secrets: `openssl rand -hex 32` for JWT secret, separate strong password for Postgres
   - Set `SITE_URL=https://your-amplify-url.amplifyapp.com` (or domain later) in `.env`
   - `docker compose up -d`; verify Studio reachable at `:8000` over the localhost-tunneled SSH

5. **Caddy config** (15 min)
   - Caddyfile points your EC2's Elastic IP (or eventual domain) at Kong's port. Caddy auto-handles HTTPS via Let's Encrypt. Example:
     ```
     api.choicetracker.app {
       reverse_proxy localhost:8000
     }
     ```
   - For now without a domain: skip HTTPS, talk to Kong on port 8000 directly. Add HTTPS when domain lands.

6. **Apply migrations + seed** (15 min)
   - `psql` from your laptop to the new Postgres (you'll need to open 5432 temporarily, or use the EC2's psql via SSH tunnel — safer).
   - Run `0001_init.sql`, `0002_rls.sql`, `0003_approve_gate.sql`, then `seed.sql`. Same files in `supabase/migrations/` and `supabase/seed.sql` — they don't care what Postgres they're talking to.
   - **Important:** the seed inserts directly into `auth.users` with a bcrypted password using `crypt(... gen_salt('bf'))`. Requires `pgcrypto` extension — enable with `CREATE EXTENSION pgcrypto WITH SCHEMA extensions;` and add `extensions` to the search path. Same gotcha tripped us up on hosted Supabase. The seed already has `set search_path = public, extensions;` at the top.

7. **Update Next.js env vars + deploy to Amplify** (45 min)
   - In Amplify Console (us-west-2): "Host web app" → Connect GitHub → pick the repo → branch `main`.
   - Amplify auto-detects Next.js. Default build config works.
   - Add env vars in Amplify: `NEXT_PUBLIC_SUPABASE_URL=https://<your-EC2-or-domain>`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=...` (from the self-hosted Supabase's generated keys), `SUPABASE_SERVICE_ROLE_KEY=...`, plus the three `NEXT_PUBLIC_AUTH_*_ENABLED` flags.
   - Deploy. Get the `<branch>.<id>.amplifyapp.com` URL.

8. **HIPAA-relevant hardening before going live with real data** (1-2 hrs the day before Phase 2)
   - EBS encryption: confirmed enabled at launch (good)
   - Backups: cron pg_dump nightly, upload to S3 with versioning + lifecycle to retain 6 years
   - Audit logs: enable pg_audit; ship CloudWatch Logs
   - CloudTrail: enable in the AWS account for control-plane logging
   - Access: rotate / delete the setup IAM user's keys; use IAM roles for ongoing access
   - Document: write a one-pager "breach notification plan" — this is paperwork, not engineering

### Cutover plan from current managed Supabase

1. Get self-hosted Supabase running with the same migrations + seed (Steps 1-6 above)
2. Update `.env.local` to point at the new URL — verify the app works end-to-end against AWS
3. Deploy to Amplify with the new env vars (Step 7)
4. Hand the URL to the team for the demo / pilot phase
5. After confidence period (~1 week), retire / pause the managed Supabase project

You can keep both running in parallel for as long as you want during the validation window — they're independent Postgres instances and there's no data we'd lose retiring the managed one.

---

## Recipes for common changes

### Add a new task template
1. Insert into `supabase/migrations/000X_new_templates.sql` (next file in sequence)
2. Apply the migration to whichever Postgres you're targeting (`psql -f`)
3. New patients will get the new task; existing patients are unaffected (intentional — snapshot rule)

### Add a new role beyond ATP/REP/MANAGER/BOSS
1. Update the CHECK constraint on `app_users.roles` (it's array-typed; the check restricts allowed values)
2. Update `current_user_roles()` and `has_any_role()` if needed
3. Add to `Role` type in `src/lib/db-types.ts`
4. Update RLS policies if the new role gets a special visibility tier
5. Update the admin UI's role-button list in `src/app/(app)/admin/AdminUserRow.tsx`

### Enable Google OAuth alongside Microsoft
1. Flip `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` in env
2. In Supabase config (or AWS-hosted GoTrue env vars), set up the Google OAuth provider with client ID + secret
3. Done — `src/app/login/LoginForm.tsx` already renders any enabled provider

### Add a payer type (e.g. "PRIVATE_PAY")
1. Migration to alter the CHECK constraint on `payers.type` and `task_templates.payer_type`
2. Add the new value to `PayerType` type in `src/lib/db-types.ts`
3. Seed new templates for the new payer type

---

## Footguns / things NOT to do

- **`db-types.ts` is hand-written.** Supabase JS v2 generic `<Database>` collapses Insert/Update inference to `never` when given our simplified types — so we dropped the generic. After running `supabase gen types`, you can re-add it. Don't pretend the existing types are auto-generated; they're not.

- **Next 16 renamed `middleware` → `proxy`.** Our file is `src/proxy.ts` exporting a `proxy()` function. If you're regenerating from older Next docs, don't reintroduce a `middleware.ts`.

- **CHECK constraints are not Postgres enums.** Adding a new value to `roles[]`, `payer_type`, `status`, etc. requires a migration that drops + re-adds the check. Existing rows with non-listed values would also break the new check.

- **RLS is OFF by default on new tables.** When you add a table, you MUST `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` and write policies. Otherwise authenticated users can read/write everything.

- **`auth.uid()` is null when running as superuser via psql.** The approval gate trigger handles this with a bypass (see `0003_approve_gate.sql`). If you add new triggers that check `auth.uid()`, mirror that bypass logic or your seeds will explode.

- **Never put real patient names in logs.** Use IDs only. The free Supabase project is explicitly synthetic-only — real PHI goes only on the HIPAA-compliant stack (self-hosted on AWS).

- **The `(app)` route group children are server components.** Inline editors / interactive forms must be in client components (`"use client"`). See `TaskActions.tsx`, `AdminUserRow.tsx` for the pattern.

- **The middleware matcher excludes `/api`.** If you add API routes under `/api`, you have to gate auth in each one explicitly.

---

## Open questions for the customer (carry-forwards from spec §12)

These haven't been answered and shouldn't be invented:

1. **Medicaid Group 3 task list correctness.** The 14-item list in `seed.sql` is a strawman from spec discussion. Real Nevada Medicaid PMD checklist needs review.
2. **Medicare and commercial template variants.** Stubs in seed; actual variants unknown — Choice may not know yet either.
3. **Role structure validation.** Is the ATP / REP / MANAGER / BOSS set actually correct for how Choice operates? (Probably yes per recent input, but unconfirmed across the whole org.)
4. **Is the task set finite?** If per-patient custom tasks happen often, we'd promote the "editable task types" enhancement sooner.

---

## How this conversation reached this point

Brief context for your Claude. Across one long conversation, Addison:

1. Started from a v1 spec document; we scaffolded Next 16 + Supabase + Tailwind, wrote 3 migrations + seed + all the screens, did a `next build` clean pass.
2. Stood up a free hosted Supabase project at `ftxxexwzrhyrqjguagbi.supabase.co` and pushed schema + seed via psql against the connection pooler (`aws-1-us-west-2.pooler.supabase.com:5432` — the direct DB host is IPv6-only and his network is IPv4-only).
3. Localhost dev server confirmed working at `localhost:3000`. Sign-in works for all 5 seed users.
4. Iterated on the seed based on Addison's feedback: renamed "Owner" column to "Awaiting" (responsible_role is who needs to act IRL, not an app user); added 3 patients for Matt (managers carry their own caseload); fixed Henry's ATP from Steve to Matt (ATP-credentialed reps handle their own ATP review).
5. Pushed to GitHub on `build/v1-tracker` and `main`. The "merge to main" is fast-forward — both branches point at the same commit.
6. Started a Vercel deploy. Got partway through (CLI auth was in progress). Pivoted to AWS during it — Vercel BAA cost (~$350/mo) plus Supabase HIPAA cost (~$600/mo) didn't make sense vs self-hosting Supabase on AWS (~$30-50/mo all-in).
7. Got AWS CLI installed locally. Awaiting AWS account access to proceed with self-host setup.

That's where you start.

---

## What to do first when you pick this up

1. Read `CLAUDE.md` (deeper persistent context, more than this handoff)
2. Read `ARCHITECTURE.md` (system overview with diagram)
3. Have Addison send `.env.local` securely. Run `npm install` + `npm run dev`. Confirm the app boots and you can sign in as Tara at `localhost:3000`.
4. Pick up the AWS migration plan above. If Addison has shared AWS credentials, drive it; otherwise wait for him.
5. When you make changes, follow the existing patterns — see CLAUDE.md §12 "Common tasks & how to do them" and the recipes in this file.

Welcome. Have fun.
