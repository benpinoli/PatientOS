# Handoff — paste this into your Claude conversation

**Status as of 2026-06-08.** The AWS migration is **done and live** — the app is deployed on AWS Amplify, pointed at a self-hosted Supabase stack running on EC2 in us-west-2. Multiple feature rounds have shipped since the May handoff (sent-for-signature / `AWAITING_SIGNATURE`, admin-managed payer types, task bounce/snooze, patient delete, UI cleanups). The active branch is now **`main`** (Amplify auto-deploys from it); `build/v1-tracker` is stale and should not be used.

Read this whole file in your first conversation so your Claude has the full picture. Companion files in the repo: `README.md`, `ARCHITECTURE.md` (has the live production identifiers + non-technical AWS guide), `CLAUDE.md` (the persistent context pack — read that second), and `infra/aws/DEPLOYMENT.md` (SSH, env vars, migration scripts for the live server).

---

## Production deployment (live as of 2026-06-08)

The app is no longer "about to migrate" — it's deployed. Identifiers (also in `ARCHITECTURE.md` §3):

| Piece | Value |
|---|---|
| Live app URL | `https://main.d2na0dxbmaa2o4.amplifyapp.com` |
| Amplify app ID | `d2na0dxbmaa2o4` (builds from branch `main`) |
| Database server (EC2) | instance `i-0c55b5678f0ec6cf7`, Elastic IP `44.253.198.43` |
| AWS region | `us-west-2` (US West / Oregon) |
| Supabase install path | `/opt/choice-supabase` on the EC2 box |
| Ops runbook | `infra/aws/DEPLOYMENT.md` (SSH, env, migration scripts incl. browser/Windows helpers) |

**Code → Amplify is automatic** (push to `main` rebuilds the UI). **Schema changes are NOT** — a new migration must be applied on EC2 by hand (SSH, EC2 Instance Connect, or the helper scripts in `infra/aws/scripts/`). This split is why migration `0012` is in the repo but not yet live (see below).

> **Still synthetic-data-only until HIPAA hardening is signed off.** The EC2 stack exists, but the §"HIPAA-relevant hardening" checklist (backups to S3, pg_audit, CloudTrail, key rotation, breach-notification doc) must be completed before any real PHI lands. Don't load real patients yet.

---

## What changed since the 2026-05-23 handoff (delta)

Several rounds of work landed on `main` between 2026-05-23 and 2026-06-08:

1. **AWS migration completed.** Self-hosted Supabase on EC2 + Amplify deploy are live (see the table above). The step-by-step plan that used to be "the next big piece of work" is now the historical record in the "AWS migration" section near the bottom — keep it for reference, but it's done.

2. **Migrations grew `0005` → `0012`:**
   - `0006_fix_create_patient_payer_type.sql` — fix ambiguous `payer_type` reference in `create_patient_with_tasks` (PL/pgSQL var vs. column).
   - `0007_task_link_history.sql` — per-task link history (rep/ATP submissions); latest URL still mirrored on `tasks.link`.
   - `0008_requires_atp_review_default_true.sql` — every task requires ATP review by default now (tune per-template later).
   - `0009_payer_types_admin.sql` — **dynamic, admin-managed payer/patient types**; replaces the hard-coded `CHECK` constraints with a `payer_types` table + FK. (CLAUDE.md's "add a payer type = alter a CHECK constraint" recipe is now partly outdated — types are data, managed in the admin UI.)
   - `0010_ensure_builtin_payer_types.sql` — re-seeds the built-in types idempotently (safe if 0009 already ran).
   - `0011_task_awaiting_signature_status.sql` — adds `AWAITING_SIGNATURE` task status for tasks waiting on an external Doctor/PT signature.
   - `0012_task_snoozed_until.sql` — adds `tasks.snoozed_until` for server-backed task bounce/snooze. **⚠ NOT YET APPLIED to production** — so the shipped bounce feature uses per-browser `localStorage` instead (see below).

3. **Feature changes (all on `main`):**
   - **Task bounce / snooze** — temporarily push a task off the Top-5 dashboard. Implemented **per-browser via `localStorage`** (`src/lib/bounce-store.ts` + `src/app/(app)/components/Top5WithBounce.tsx`) because migration `0012` isn't live yet. The server-backed `bounceTask()` action was removed; re-introduce it when `0012` lands and you want cross-device snooze sync (note left in `actions.ts`). ATPs/managers can bounce from their own view.
   - **Patient delete** — `deletePatient()` server action; permission-gated (BOSS, MANAGER on a direct report, or assigned rep/ATP) with a last-name-confirmation modal. Tasks cascade via `on delete cascade`.
   - **Sent-for-signature flow** — rep-only, uses the new `AWAITING_SIGNATURE` status; the "Final signature" column (formerly "Awaiting").
   - **UI cleanups** — explicit "Start task" button (replaced the bare save-link box and an earlier auto-start-on-first-link behavior); removed the broken "Sent for signature" button and the "ATP review" badge; Top-5 limited to patients where the user is the assigned rep or ATP.
   - **Dropped "Block"** — the old BLOCKED affordance was removed from the task UI in favor of bounce. (`tasks.status` still allows `BLOCKED` at the DB level; it's just not surfaced in the UI.)

4. **`db-types.ts` updated** for the new columns/statuses (`snoozed_until`, link history, `AWAITING_SIGNATURE`, dynamic payer types). Still hand-written — keep editing it by hand.

---

## What changed on 2026-05-23 evening (older delta — historical)

Two feature changes have landed on `build/v1-tracker`. Both are also already applied to the production Supabase database at `ftxxexwzrhyrqjguagbi.supabase.co` (migration applied, seed values backfilled, NULL due_dates on existing tasks filled in too).

1. **Rep → ATP supervisor relationship.** New column `app_users.supervising_atp_id` (FK → `app_users.id`, nullable, `on delete set null`). Non-ATP reps point at their default ATP supervisor; ATP-credentialed users keep it `NULL` (they are their own ATP). The new-patient form auto-fills `assigned_atp_id` from the selected rep (rep is ATP → rep themselves; rep is not ATP → rep's supervising_atp_id). `createPatient` server action does the same computation as a safety net and errors loudly if no ATP can be derived. Admin UI gained an **"ATP supervisor"** column. Seed: Tara → Steve, Jack → Matt.
   - Migration: `supabase/migrations/0004_supervising_atp.sql`
   - Memory file: `rep-supervisor-atp.md` (in Addison's local Claude memory dir)

2. **Default 14-day due dates.** New constant `DEFAULT_DUE_DAYS = 14` in `src/lib/constants.ts`. `createPatient` stamps every instantiated task with `due_date = today + DEFAULT_DUE_DAYS`. Seed instantiation mirrors this with `patient.created_at::date + 14`. Remote DB tasks that previously had NULL `due_date` were backfilled.

3. **gstack hook added.** A PreToolUse hook fires on `Skill` invocations (`.claude/settings.json` + `.claude/hooks/check-gstack.sh`). It blocks skill usage unless `~/.claude/skills/gstack/bin` exists. CLAUDE.md was updated with a "gstack REQUIRED" section. This is an intentional decision made by Addison or his partner — don't investigate or revisit it. If you hit a "gstack missing" block, follow the install instructions or ask Addison.

4. **`AppUser` type updated.** `src/lib/db-types.ts` now includes `supervising_atp_id: string | null`. The `updateUser` server action accepts it.

5. **Security/workflow hardening added locally after the AWS infra pull.** New migration `supabase/migrations/0005_harden_user_and_patient_workflows.sql` removes broad direct `app_users` self-update, adds active-user checks, exposes guarded `update_app_user()` for BOSS/MANAGER plus ATP-on-pure-REP maintenance, and moves new-patient creation into `create_patient_with_tasks()` so patient + task rows commit atomically. Dashboard ordering now uses a quiet queue score instead of pure FIFO/manual priority.

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
- Schema: 5 tables (`app_users`, `payers`, `patients`, `task_templates`, `tasks`) + RLS policies + ATP-review-gate trigger + supervising_atp + dynamic payer types + link history + `AWAITING_SIGNATURE` status. Migrations `0001_init.sql` → `0012_task_snoozed_until.sql` in `supabase/migrations/` (note: `0012` not yet applied to production — see the delta section).
- Seed: 5 demo users (DeAnne / Matt / Steve / Tara / Jack, all `password123`), payers, all template rows, 9 patients with varied states, supervising_atp_id wired for Tara → Steve and Jack → Matt. In `supabase/seed.sql`.
- Next.js front-end: login, dashboard with priority queue + Top-5 (with bounce/snooze), patient list, patient detail with computed next-step + patient delete, **reactive** new-patient form (rep selection auto-fills ATP), sent-for-signature flow, admin screen for user activation + roles + ATP supervisor + payer-type management. App passes `npx tsc --noEmit` and `npx next build`.
- Default 14-day due dates wired into both server-action and seed-side task instantiation.
- **Deployed to production on AWS:** self-hosted Supabase on EC2 (`44.253.198.43`, us-west-2) + Next.js on Amplify (`https://main.d2na0dxbmaa2o4.amplifyapp.com`). See the "Production deployment" section above and `infra/aws/DEPLOYMENT.md`.
- Local dev: works at `localhost:3000`. `npm run dev` boots Next, talks to whichever Supabase URL is in `.env.local`.
- Pushed to GitHub: `https://github.com/benpinoli/Choice-Healthcare-Task-System`. **Active branch: `main`** (Amplify deploys from it). `build/v1-tracker` is stale (~34 commits behind `main`) — don't branch from it.

🟡 **In progress / next:**
- **Apply migration `0012` to the production EC2 Postgres**, then swap task bounce from `localStorage` back to a server-backed `snoozed_until` (cross-device sync). See the note in `src/app/(app)/actions.ts`.
- **HIPAA-relevant hardening** before real PHI: nightly `pg_dump` → encrypted S3, `pg_audit` → CloudWatch, CloudTrail, IAM key rotation, breach-notification one-pager. (EBS encryption was enabled at launch.) Detail in the "AWS migration" hardening step below.
- Then: load the real staff roster, configure Azure SSO, disable dev email/password signup, and cut over to real patient data.

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

These are decisions / clarifications from the customer that override what the original spec said. Future code should respect them. Memory files for each rule live in Addison's local Claude memory dir:
`~/.claude/projects/-Users-addisonlewis-Documents-GitHub-Choice-Healthcare-Task-System/memory/`.

### 1. Managers carry direct caseloads.

The org structure is NOT "managers manage, reps rep." Most everyone — including managers like Matt — works patients directly. Management is a minority slice; direct patient work is the dominant activity. When designing UI, don't push the team-rollup view at the expense of the user's own queue. Manager's primary view = their own work; team rollup = secondary.

(Memory: `org-direct-patient-work.md`.)

### 2. ATP-credentialed reps handle ATP review on their own patients.

If a rep has `ATP` in their `roles` array, they are the `assigned_atp_id` on their own patients — the "solo case" is the NORM for ATP-credentialed staff, not an edge case. ATPs don't farm out ATP review to other ATPs. A separate ATP is assigned ONLY when the rep is a pure REP (no ATP credential — e.g. Tara, Jack).

In the new-patient form (now reactive): if the selected rep has `ATP`, the ATP dropdown auto-fills to them; otherwise it auto-fills to their `supervising_atp_id`.

(Memory: `atp-self-handling.md`.)

### 3. Non-ATP reps have a default ATP supervisor (new 2026-05-23).

`app_users.supervising_atp_id` holds each non-ATP rep's default ATP signatory. Stored on the user row (not per-patient) because reps usually work with the same ATP across all their patients — and asking the user to re-pick every time was friction.

Rules:
- ATP-credentialed user → `supervising_atp_id` is NULL (they're their own ATP).
- Pure REP → `supervising_atp_id` must point to an ATP-credentialed user. **Not enforced by DB constraint** — onboarding flexibility (a fresh rep may briefly exist with no supervisor yet). Enforced by the new-patient form and admin UI instead.
- The approval-gate trigger does NOT look at `supervising_atp_id`. The supervisor is only a default for the patient-level `assigned_atp_id`; once a patient exists, the patient's `assigned_atp_id` is the source of truth for the gate.

Seed: Tara → Steve (pure ATP); Jack → Matt (manager + ATP).

(Memory: `rep-supervisor-atp.md`.)

### 4. Supabase HIPAA isn't ~$25/mo, it's ~$600/mo.

The Pro tier is $25 but the HIPAA add-on is ~$599. Quote the all-in figure in cost conversations. This number drove the AWS pivot.

(Memory: `supabase-hipaa-cost.md`.)

### 5. Doctors / PTs / front-desk staff are NOT app users.

The `tasks.responsible_role` field labels who needs to act in the real world (Doctor, PT, Rep, ATP, Front desk). Only the app users (REP/ATP/MANAGER/BOSS roles) have accounts. The column in the UI is labeled "Awaiting" (not "Owner") to make this clear — when a task shows `Awaiting: Doctor`, the rep's next action is to call the doctor's office, not to assign a doctor account.

### 6. Never log PHI.

Patient names + payer info = PHI. Logs / error traces / analytics should reference IDs only, never names. The Supabase free tier in use today is explicitly synthetic data only — no real patient names in there.

### 7. Snapshot template fields onto tasks at instantiation.

When creating a patient, we copy the matching `task_templates` rows into `tasks` rows and freeze `label`, `responsible_role`, `requires_atp_review`, `required`, `order_index`. Editing a template later does NOT rewrite in-flight tasks. This is intentional — patients in mid-pipeline don't get rug-pulled if someone reorders the checklist.

We now also stamp every new task with a `due_date` of `today + DEFAULT_DUE_DAYS` (= 14) at instantiation. Changing the constant later does NOT change due dates on previously-created tasks; same snapshot rule.

### 8. Status flow + the ATP review gate.

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
│                              # (includes the gstack-required section at the bottom)
├── HANDOFF.md                 # This file
├── AGENTS.md                  # Next 16 != older Next reminder
├── .env.example               # Template for .env.local — secrets NOT committed
├── .env.local                 # ⚠ gitignored — get the values from Addison
├── .claude/
│   ├── settings.json          # Hooks config (PreToolUse → check-gstack.sh on Skill)
│   └── hooks/
│       └── check-gstack.sh    # Blocks Skill use unless ~/.claude/skills/gstack/bin exists
├── package.json, tsconfig.json, next.config.ts, postcss.config.mjs
├── infra/                     # AWS deployment (self-hosted Supabase on EC2 + Amplify)
│   └── aws/
│       ├── DEPLOYMENT.md      # Ops runbook: SSH, env vars, applying migrations on EC2
│       ├── README.md          # infra overview
│       ├── caddy/             # Caddyfile (reverse proxy + Let's Encrypt)
│       ├── docker/            # trimmed Supabase docker-compose for the EC2 box
│       └── scripts/           # migration helpers (browser/EC2 Instance Connect, Windows PS1)
├── supabase/
│   ├── config.toml            # Local supabase CLI config
│   ├── seed.sql               # 5 users + payers + templates + 9 patients (synthetic only)
│   │                          # Tara/Jack get supervising_atp_id; tasks stamped with
│   │                          # due_date = patient.created_at + 14
│   └── migrations/
│       ├── 0001_init.sql               # 5 tables, indexes, handle_new_auth_user trigger
│       ├── 0002_rls.sql                # RLS helpers + per-table policies
│       ├── 0003_approve_gate.sql       # ATP review gate trigger
│       ├── 0004_supervising_atp.sql    # adds app_users.supervising_atp_id
│       ├── 0005_harden_user_and_patient_workflows.sql # RPC hardening + atomic create
│       ├── 0006_fix_create_patient_payer_type.sql     # fix ambiguous payer_type in RPC
│       ├── 0007_task_link_history.sql                 # per-task link submission history
│       ├── 0008_requires_atp_review_default_true.sql  # ATP review default → true
│       ├── 0009_payer_types_admin.sql                 # dynamic admin-managed payer types
│       ├── 0010_ensure_builtin_payer_types.sql        # idempotent built-in type re-seed
│       ├── 0011_task_awaiting_signature_status.sql    # AWAITING_SIGNATURE status
│       ├── 0012_task_snoozed_until.sql                # tasks.snoozed_until (⚠ NOT live yet)
│       ├── 0013_task_notes.sql                        # append-only per-task notes
│       └── 0014_notifications.sql                     # in-app rep<->ATP notifications (⚠ apply on EC2)
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
    │       ├── page.tsx       # Dashboard: priority queue + Top-5 (with bounce) across visible tasks
    │       ├── actions.ts     # Server actions: updateTaskStatus, updateTaskFields,
    │       │                  #                 createPatient, updateUser, deletePatient
    │       │                  #   createPatient: derives assigned_atp_id from rep, errors if
    │       │                  #   none derivable, stamps tasks with due_date = today + 14.
    │       │                  #   deletePatient: gated + last-name-confirmation; tasks cascade.
    │       │                  #   (bounceTask removed — bounce is localStorage until 0012 lands)
    │       ├── components/
    │       │   └── Top5WithBounce.tsx # Client: Top-5 list w/ per-browser bounce/snooze
    │       ├── TaskActions.tsx # Client: inline status / priority / link / due-date editor
    │       ├── patients/
    │       │   ├── page.tsx                # Patient list (RLS filters visibility)
    │       │   ├── new/
    │       │   │   ├── page.tsx            # Server component: loads payers + users,
    │       │   │   │                       # renders NewPatientForm
    │       │   │   └── NewPatientForm.tsx  # NEW: client component, reactive rep → ATP fill
    │       │   └── [id]/page.tsx           # Patient detail w/ computed next-step
    │       └── admin/
    │           ├── page.tsx                # User activation + roles + ATP supervisor column
    │           └── AdminUserRow.tsx        # Client: per-user editor (incl. ATP supervisor)
    └── lib/
        ├── auth-providers.ts  # Config-driven enabled providers (Azure primary)
        ├── constants.ts       # DEFAULT_DUE_DAYS = 14
        ├── bounce-store.ts    # NEW: per-browser bounce/snooze via localStorage (until 0012 lands)
        ├── db-types.ts        # HAND-WRITTEN row types (supervising_atp_id, snoozed_until,
        │                      #   link history, AWAITING_SIGNATURE, dynamic payer types)
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

3. **AWS account** — Addison's. He'll need to set up an IAM user with appropriate permissions and share access keys, OR you'll need to do the AWS setup in his account via the console with him driving. (Addison's partner is currently active on the EC2 setup — coordinate before duplicating work.)

4. **GitHub** — repo is at `github.com/benpinoli/Choice-Healthcare-Task-System`. Both Addison (`Addisonslewis`) and `benpinoli` (whoever this is) have push access. Confirm yours.

5. **gstack** — required globally per `CLAUDE.md`. If `~/.claude/skills/gstack/bin` doesn't exist, the PreToolUse hook will block all Skill calls. Install with:
   ```
   git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
   cd ~/.claude/skills/gstack && ./setup --team
   ```

---

## AWS migration (COMPLETED — kept as historical reference)

> **This is done.** The plan below was executed; production is live (see the "Production deployment" section near the top, and `infra/aws/DEPLOYMENT.md` for the as-built ops runbook). It's retained so you understand how the stack was built and can reproduce/rebuild it. The one part still outstanding is the **HIPAA-relevant hardening** in step 8 — that must finish before real PHI lands.

Approach was single-EC2 with Docker Compose — simplest deployment that meets the goals. Can be upgraded to RDS + ECS Fargate later if scale demands.

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
                         │      └─ Postgres 17 + migrations + seed          │
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
   - Run every file in `supabase/migrations/` in order, then `seed.sql`. Same files in `supabase/migrations/` and `supabase/seed.sql` — they don't care what Postgres they're talking to.
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

### Change the default due-date offset
1. Edit `DEFAULT_DUE_DAYS` in `src/lib/constants.ts`.
2. **That's it for new patients.** Existing tasks already in the DB are unchanged (snapshot rule). If you want to bulk-rewrite, do it via a one-off SQL UPDATE — not by changing the constant.

### Add a new role beyond ATP/REP/MANAGER/BOSS
1. Update the CHECK constraint on `app_users.roles` (it's array-typed; the check restricts allowed values)
2. Update `current_user_roles()` and `has_any_role()` if needed
3. Add to `Role` type in `src/lib/db-types.ts`
4. Update RLS policies if the new role gets a special visibility tier
5. Update the admin UI's role-button list in `src/app/(app)/admin/AdminUserRow.tsx`
6. If the new role is ATP-like (capable of signing off `requires_atp_review`), update the gate trigger in `0003_approve_gate.sql` and the supervising_atp self-rule logic in `NewPatientForm.tsx` + `AdminUserRow.tsx`.

### Enable Google OAuth alongside Microsoft
1. Flip `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` in env
2. In Supabase config (or AWS-hosted GoTrue env vars), set up the Google OAuth provider with client ID + secret
3. Done — `src/app/login/LoginForm.tsx` already renders any enabled provider

### Add a payer type (e.g. "PRIVATE_PAY")
As of migration `0009`, payer/patient types are a **dynamic, admin-managed registry** (`payer_types` table + FK) — NOT hard-coded CHECK constraints anymore.
1. Add the type via the **admin UI** (preferred), or insert a row into `payer_types`. Built-in types (Insurance/Medicaid/Medicare) are protected from deletion.
2. Seed task templates for the new type so new patients of that type get a checklist.
3. No `db-types.ts` change is needed just to add a *value* (it's data, not a union) — only if you change the type's shape.

### Assign a new rep their ATP supervisor
1. Go to /admin as DeAnne (or any BOSS/MANAGER).
2. In the "ATP supervisor" column, pick from the dropdown (it lists only ATP-credentialed users).
3. Save. Next time that rep creates a patient, the ATP dropdown will auto-fill to that supervisor.

---

## Footguns / things NOT to do

- **`db-types.ts` is hand-written.** Supabase JS v2 generic `<Database>` collapses Insert/Update inference to `never` when given our simplified types — so we dropped the generic. After running `supabase gen types`, you can re-add it. Don't pretend the existing types are auto-generated; they're not. When you add a column (like the recent `supervising_atp_id`), edit this file by hand.

- **Next 16 renamed `middleware` → `proxy`.** Our file is `src/proxy.ts` exporting a `proxy()` function. If you're regenerating from older Next docs, don't reintroduce a `middleware.ts`.

- **CHECK constraints are not Postgres enums.** Adding a new value to `roles[]`, `payer_type`, `status`, etc. requires a migration that drops + re-adds the check. Existing rows with non-listed values would also break the new check.

- **RLS is OFF by default on new tables.** When you add a table, you MUST `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` and write policies. Otherwise authenticated users can read/write everything.

- **`auth.uid()` is null when running as superuser via psql.** The approval gate trigger handles this with a bypass (see `0003_approve_gate.sql`). If you add new triggers that check `auth.uid()`, mirror that bypass logic or your seeds will explode.

- **Never put real patient names in logs.** Use IDs only. The free Supabase project is explicitly synthetic-only — real PHI goes only on the HIPAA-compliant stack (self-hosted on AWS).

- **The `(app)` route group children are server components.** Inline editors / interactive forms must be in client components (`"use client"`). See `TaskActions.tsx`, `AdminUserRow.tsx`, `NewPatientForm.tsx` for the pattern.

- **The middleware matcher excludes `/api`.** If you add API routes under `/api`, you have to gate auth in each one explicitly.

- **`supervising_atp_id` is NOT enforced by the DB.** The "ATPs are NULL; non-ATPs point at an ATP" rule lives in the UI and `createPatient`. If you bulk-insert users via SQL, you can leave both ATP-credentialed users and pure REPs with a null supervisor — the new-patient form will then refuse to create a patient for that rep until an admin fixes it. That's the intended failure mode.

- **The approval-gate trigger does NOT consult `supervising_atp_id`.** It only looks at the patient row's `assigned_atp_id`. The supervisor is just a default that flows into `assigned_atp_id` at patient creation.

- **gstack hook can block tool use.** `.claude/settings.json` runs `.claude/hooks/check-gstack.sh` on every `Skill` PreToolUse. If gstack isn't installed globally, Skill calls are denied. This is intentional — install gstack, don't disable the hook.

---

## Open questions for the customer (carry-forwards from spec §12)

These haven't been answered and shouldn't be invented:

1. **Medicaid Group 3 task list correctness.** The 14-item list in `seed.sql` is a strawman from spec discussion. Real Nevada Medicaid PMD checklist needs review.
2. **Medicare and commercial template variants.** Stubs in seed; actual variants unknown — Choice may not know yet either.
3. **Role structure validation.** Is the ATP / REP / MANAGER / BOSS set actually correct for how Choice operates? (Probably yes per recent input, but unconfirmed across the whole org.)
4. **Is the task set finite?** If per-patient custom tasks happen often, we'd promote the "editable task types" enhancement sooner.
5. **Is 14 days the right default due-date offset?** It's a guess. Real workflow data may want something tighter (or per-task offsets driven from the template).
6. **Should `supervising_atp_id` be required at the DB level for non-ATP users?** Currently soft-enforced in app code only. If we never need the "fresh rep with no supervisor yet" state in practice, harden it as a CHECK constraint.

---

## How this conversation reached this point

Brief context for your Claude. Across one long conversation, Addison:

1. Started from a v1 spec document; we scaffolded Next 16 + Supabase + Tailwind, wrote 3 migrations + seed + all the screens, did a `next build` clean pass.
2. Stood up a free hosted Supabase project at `ftxxexwzrhyrqjguagbi.supabase.co` and pushed schema + seed via psql against the connection pooler (`aws-1-us-west-2.pooler.supabase.com:5432` — the direct DB host is IPv6-only and his network is IPv4-only).
3. Localhost dev server confirmed working at `localhost:3000`. Sign-in works for all 5 seed users.
4. Iterated on the seed based on Addison's feedback: renamed "Owner" column to "Awaiting" (responsible_role is who needs to act IRL, not an app user); added 3 patients for Matt (managers carry their own caseload); fixed Henry's ATP from Steve to Matt (ATP-credentialed reps handle their own ATP review).
5. Pushed to GitHub on `build/v1-tracker` and `main`.
6. Started a Vercel deploy. Got partway through (CLI auth was in progress). Pivoted to AWS — Vercel BAA cost (~$350/mo) plus Supabase HIPAA cost (~$600/mo) didn't make sense vs self-hosting Supabase on AWS (~$30-50/mo all-in). Got AWS CLI installed locally.
7. **2026-05-23 evening:** added the rep-supervisor-ATP relationship and the 14-day default due-date. Migration `0004_supervising_atp.sql` was applied to the production database; the seed was updated to assign Tara → Steve and Jack → Matt; existing tasks with NULL due_dates were backfilled. The new-patient form was refactored into a reactive client component (`NewPatientForm.tsx`) that auto-fills the ATP dropdown from rep selection. The admin UI gained an "ATP supervisor" column. Addison's partner is now working on the EC2 self-host setup.

That's where you start.

---

## What to do first when you pick this up

1. Read `CLAUDE.md` (deeper persistent context, more than this handoff — note the gstack-required block at the bottom).
2. Read `ARCHITECTURE.md` (system overview with diagram).
3. Confirm `~/.claude/skills/gstack/bin` exists. If it doesn't, install gstack before you do anything else (see Credentials §5 above) — the PreToolUse hook will block Skill calls otherwise.
4. Have Addison send `.env.local` securely. Run `npm install` + `npm run dev`. Confirm the app boots and you can sign in as Tara at `localhost:3000`. Create a new patient as Tara and verify that the ATP dropdown auto-fills to Steve and the resulting tasks all have a due date 14 days out.
5. Work on `main` (the live/deploy branch). Pushing to `main` triggers an Amplify rebuild of the UI. **Schema changes need a migration applied on EC2 by hand** — see `infra/aws/DEPLOYMENT.md`. Don't branch from `build/v1-tracker` (stale).
6. Two known follow-ups are queued: apply migration `0012` on EC2 (then move bounce off `localStorage`), and the HIPAA hardening checklist before real PHI. See "Where we are right now → In progress / next".
7. When you make changes, follow the existing patterns — see CLAUDE.md §12 "Common tasks & how to do them" and the recipes in this file. CLAUDE.md, this handoff, and `ARCHITECTURE.md` were all reconciled to the live state on 2026-06-08; if you find a fresh discrepancy, trust the running code + `infra/aws/DEPLOYMENT.md`.

Welcome. Have fun.
