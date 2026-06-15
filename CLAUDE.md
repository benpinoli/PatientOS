# Choice Healthcare Patient Pipeline Tracker

This file is the orientation pack for any future Claude session working on this repo. Read it end-to-end before making changes. The companion file `AGENTS.md` reminds you that this is **Next.js 16 + React 19**, which has breaking changes vs. older versions — consult `node_modules/next/dist/docs/` before writing Next-specific code.

---

## 1. Project mission

Choice Healthcare currently runs the multi-week process of getting a custom power wheelchair through documentation and payer approvals via Google Drive folders and chains of email — work gets dropped, no one is sure who owns the next step, and managers can't see status at a glance. This project replaces that with a single shared, prioritized checklist per patient: one app, one ordered to-do list, role-aware visibility, an ATP review gate, and a manager dashboard. **v1 is the tracker only — it does NOT store documents.** Avoiding document storage in v1 deliberately sidesteps the cost of a HIPAA-tier Supabase plan + BAA while the team validates whether the tracker alone solves the workflow problem. A task can have a `link` URL (e.g. to a doc still living in Drive); the app never holds the file.

---

## 2. Roles & users

The system has four roles. A user can hold multiple (e.g. Matt is both `MANAGER` and `ATP`). Roles are stored as `text[]` on `app_users.roles`.

- **REP** — sales/intake rep. Owns the patient, drives the checklist forward, talks to the doctor's office, PT, payer.
- **ATP** — Assistive Technology Professional. The credentialed person whose review is required for clinical/spec tasks (`requires_atp_review = true`). They approve or reject the rep's submissions.
- **MANAGER** — sees their direct reports' patients in addition to anything they're personally assigned to. Can edit task templates.
- **BOSS** — owner; full read/write across all data. The only role who can write `payers`.

### Seed users (local dev only — `password123`)

| Email | Name | Roles | Manager | Notes |
|---|---|---|---|---|
| `deanne@patientos.example` | DeAnne Choice | `BOSS` | — | Owner; full visibility |
| `matt@patientos.example` | Matt Manager | `MANAGER`, `ATP` | — | Managers Steve/Tara/Jack |
| `steve@patientos.example` | Steve ATP | `ATP` | Matt | Pure ATP |
| `tara@patientos.example` | Tara Rep | `REP` | Matt | Reno location |
| `jack@patientos.example` | Jack Rep | `REP` | Matt | Las Vegas location |

UUIDs are deterministic in `supabase/seed.sql` (`00000000-0000-0000-0000-00000000000{1..5}`) so foreign keys can be wired by hand.

---

## 3. Core domain object: a patient + their task list

- A **patient** in v1 also represents their *current pursuit* of one chair — `patient` and "case" are merged into a single row. (If a patient ever needs a second chair later, that's a future schema decision; today it would be a new row.)
- Each patient has an ordered list of **tasks** instantiated from `task_templates` filtered by the patient's payer type at creation time.
- Task instantiation **snapshots** every relevant field (`label`, `responsible_role`, `requires_atp_review`, `required`, `order_index`) onto the row. Editing a template later does NOT rewrite in-flight tasks. This is intentional — patients in mid-process don't get rug-pulled if someone edits the checklist.
- `requires_atp_review` marks tasks that the rep cannot self-approve. The status flow is:

  ```
  NOT_STARTED → IN_PROGRESS → DONE_PENDING_REVIEW → APPROVED
                                                  ↘ BLOCKED (with blocked_reason)
  ```

  Any state may also move to `BLOCKED`. A rep advances a `requires_atp_review` task to `DONE_PENDING_REVIEW`; the assigned ATP (or BOSS) then moves it to `APPROVED`.

- **Solo case carve-out:** when `patients.assigned_rep_id == patients.assigned_atp_id` (the same person is both rep AND ATP on this patient), that person can transition straight to `APPROVED` without the gate. This is enforced in the `enforce_task_approval_gate` trigger (see §8).

---

## 4. Tech stack

- **Next.js 16.2.6** (App Router) — see `AGENTS.md`: APIs differ from older versions; verify against `node_modules/next/dist/docs/`.
- **React 19.2.4**.
- **TypeScript 5**.
- **Tailwind CSS 4** via `@tailwindcss/postcss`.
- **Supabase**: Postgres 17 + GoTrue Auth + PostgREST + Kong + Row-Level Security. Local dev can run the Supabase CLI stack; **production is self-hosted Supabase on AWS EC2 — already deployed** (see §16 and `infra/aws/DEPLOYMENT.md`).
- **`@supabase/ssr`** for cookie-based auth on Next App Router — server client in `src/lib/supabase/server.ts`, browser client in `src/lib/supabase/browser.ts`, cookie refresh in `src/proxy.ts`.
- Deployment (**live**): **AWS Amplify** for the Next.js app (auto-builds from branch `main`), pointed at self-hosted Supabase on AWS EC2 in us-west-2. Microsoft (Azure AD / Entra) OAuth is the default auth provider; other providers are config-driven (see `src/lib/auth-providers.ts`). Active branch is `main`; `build/v1-tracker` is stale.

---

## 5. Directory tour

```
/
├── AGENTS.md                   # Reminder: Next.js 16 is not the Next you remember
├── CLAUDE.md                   # This file
├── README.md                   # Default create-next-app scaffold, not project docs
├── next.config.ts, postcss.config.mjs, tsconfig.json, package.json
├── supabase/
│   ├── config.toml             # Local supabase CLI: ports, Azure provider, email auth
│   ├── seed.sql                # Synthetic auth.users + app_users + payers + templates + 9 patients
│   └── migrations/
│       ├── 0001_init.sql       # All 5 tables + handle_new_auth_user trigger
│       ├── 0002_rls.sql        # current_user_roles, has_any_role, reports_to_me + policies
│       ├── 0003_approve_gate.sql # enforce_task_approval_gate trigger
│       ├── 0004_supervising_atp.sql # app_users.supervising_atp_id
│       ├── 0005_harden_user_and_patient_workflows.sql # user RPCs + atomic create patient
│       ├── 0006_fix_create_patient_payer_type.sql # fix ambiguous payer_type in RPC
│       ├── 0007_task_link_history.sql # per-task link submission history
│       ├── 0008_requires_atp_review_default_true.sql # ATP review default → true
│       ├── 0009_payer_types_admin.sql # dynamic admin-managed payer types (replaces CHECK)
│       ├── 0010_ensure_builtin_payer_types.sql # idempotent built-in type re-seed
│       ├── 0011_task_awaiting_signature_status.sql # AWAITING_SIGNATURE status
│       ├── 0012_task_snoozed_until.sql # tasks.snoozed_until (NOT applied to prod yet — bounce uses localStorage)
│       ├── 0013_task_notes.sql # append-only per-task notes (mirrors task_link_events)
│       └── 0014_notifications.sql # in-app rep<->ATP notifications (bell)
└── src/
    ├── proxy.ts                # Refresh Supabase cookie on every req + redirect unauth users to /login (Next 16 proxy convention)
    ├── app/
    │   ├── layout.tsx          # Root HTML shell; sets app title
    │   ├── globals.css         # Tailwind 4 imports
    │   ├── login/
    │   │   ├── page.tsx        # Server component; reads enabledProviders() and renders LoginForm
    │   │   └── LoginForm.tsx   # Client component; OAuth buttons + dev email/password form
    │   ├── auth/
    │   │   ├── callback/route.ts  # GET /auth/callback: exchangeCodeForSession then redirect ?next=
    │   │   └── signout/route.ts   # POST /auth/signout: supabase.auth.signOut + redirect /login
    │   └── (app)/
    │       ├── layout.tsx      # Authed shell: header w/ nav + sign-out
    │       ├── page.tsx        # Dashboard (priority queue across all visible patients)
    │       ├── actions.ts      # Server actions: updateTaskStatus, updateTaskFields, createPatient, updateUser
    │       ├── TaskActions.tsx # Client component: inline status/priority/link/due-date editor
    │       ├── patients/
    │       │   ├── page.tsx          # Patient list
    │       │   ├── new/page.tsx      # New-patient form (instantiates tasks from template)
    │       │   └── [id]/page.tsx     # Patient detail (full checklist + computed next step)
    │       └── admin/
    │           ├── page.tsx          # Admin: user activation/roles + read-only templates view
    │           └── AdminUserRow.tsx  # Client component: per-user editor
    └── lib/
        ├── auth-providers.ts   # Config-driven list of enabled providers (Azure primary, Google off, email dev-only)
        ├── db-types.ts         # HAND-WRITTEN row types + minimal `Database` shape (replaceable with `supabase gen types`)
        ├── format.ts           # STATUS_LABEL, STATUS_CLASS, ROLE_LABEL, isOverdue, formatDate helpers
        ├── queries.ts          # fetchDashboardTasks, fetchPatientWithTasks, computeNextStep
        ├── server-helpers.ts   # requireUser (redirects to /login), hasRole, isAdmin
        └── supabase/
            ├── server.ts       # createServerClient bound to next/headers cookies
            └── browser.ts      # Memoized createBrowserClient for "use client" code
```

**Implemented pages:** the `(app)` route group now contains the dashboard (`page.tsx`), `patients/`, `patients/new/`, `patients/[id]/`, and `admin/`. The create-next-app boilerplate at `src/app/page.tsx` has been deleted (the dashboard at `(app)/page.tsx` claims `/`).

---

## 6. Database schema cheat sheet

All tables live in `public`. See `supabase/migrations/0001_init.sql` for the source of truth.

### `app_users` — 1:1 with `auth.users.id`, holds roles + manager hierarchy
| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid` PK | FK → `auth.users(id)` cascade |
| `full_name` | `text` | Display name; trigger sets from `raw_user_meta_data.full_name` |
| `email` | `text` | Copied from auth user at trigger time |
| `roles` | `text[]` NOT NULL DEFAULT `{REP}` | Multi-valued; check constraint limits to `ATP/REP/MANAGER/BOSS` |
| `location` | `text` | Free text (e.g. "Las Vegas", "Reno") |
| `manager_id` | `uuid` | Self-FK to another `app_users`; null for top of org |
| `supervising_atp_id` | `uuid` | Default ATP supervisor for non-ATP reps; null for ATP-credentialed users |
| `active` | `boolean` DEFAULT `false` | New users start inactive; admins flip to true |
| `created_at` | `timestamptz` DEFAULT `now()` | |

### `payers`
| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` NOT NULL | e.g. "Nevada Medicaid", "Anthem BCBS" |
| `type` | `text` NOT NULL | FK → `payer_types.key` (as of `0009`; was a CHECK in `MEDICARE`/`MEDICAID`/`COMMERCIAL`). Built-ins protected; admin-managed. |

### `patients` — patient + active pursuit merged
| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid` PK | |
| `external_code` | `text` UNIQUE | Optional human ID (e.g. "P-0001") |
| `first_name` | `text` NOT NULL | PHI — do not log |
| `last_name` | `text` NOT NULL | PHI — do not log |
| `payer_id` | `uuid` NOT NULL | FK → `payers` |
| `referral_source` | `text` | Free text |
| `assigned_rep_id` | `uuid` | FK → `app_users`; primary owner |
| `assigned_atp_id` | `uuid` | FK → `app_users`; approves gated tasks |
| `status` | `text` DEFAULT `ACTIVE` | check in (`ACTIVE`, `SUBMITTED`, `APPROVED`, `DENIED`, `DELIVERED`, `CLOSED`) |
| `created_at` | `timestamptz` DEFAULT `now()` | |

### `task_templates` — finite hand-curated checklist per payer type
| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid` PK | |
| `payer_type` | `text` NOT NULL | FK → `payer_types.key` (as of `0009`; was a CHECK in `MEDICARE`/`MEDICAID`/`COMMERCIAL`). |
| `label` | `text` NOT NULL | Task title; copied to each instantiated `tasks.label` |
| `responsible_role` | `text` NOT NULL | check in (`DOCTOR`, `PT`, `ATP`, `REP`, `FRONT_DESK`) |
| `requires_atp_review` | `boolean` DEFAULT `false` | If true, only the ATP/BOSS/solo-case can move to APPROVED |
| `required` | `boolean` DEFAULT `true` | If false, task is optional (skipped from next-step calc) |
| `default_order` | `int` NOT NULL | Position in the checklist for this payer type |

### `tasks` — instantiated per-patient (snapshot of template + state)
| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid` PK | |
| `patient_id` | `uuid` NOT NULL | FK → `patients` on delete cascade |
| `template_id` | `uuid` | FK → `task_templates` on delete SET NULL (history survives template deletion) |
| `label` | `text` NOT NULL | **Snapshot** of template label at instantiation |
| `responsible_role` | `text` NOT NULL | **Snapshot**; check same as template |
| `requires_atp_review` | `boolean` DEFAULT `false` | **Snapshot** |
| `required` | `boolean` DEFAULT `true` | **Snapshot** |
| `order_index` | `int` NOT NULL | **Snapshot** of `default_order` |
| `status` | `text` DEFAULT `NOT_STARTED` | check in (`NOT_STARTED`, `IN_PROGRESS`, `DONE_PENDING_REVIEW`, `APPROVED`, `BLOCKED`, `AWAITING_SIGNATURE`) — `AWAITING_SIGNATURE` added in `0011`. `BLOCKED` still valid in DB but no longer surfaced in the UI (replaced by bounce). |
| `snoozed_until` | `timestamptz` | Added in `0012` for server-backed task bounce/snooze. **NOT yet applied to prod** — UI bounce currently uses per-browser localStorage. |
| `link` | `text` | Optional URL (e.g. to a Drive doc) — the only "doc" support in v1 |
| `start_date` | `date` | Optional |
| `due_date` | `date` | Optional; drives overdue/priority sort |
| `priority` | `int` | Lower = more urgent. Null = no manual bump. Used as one signal in the dashboard queue score |
| `completed_by` | `uuid` | Stamped by trigger when status enters DONE_PENDING_REVIEW / APPROVED |
| `completed_at` | `timestamptz` | Stamped by trigger |
| `blocked_reason` | `text` | Free text; used when status = BLOCKED |
| `created_at` | `timestamptz` DEFAULT `now()` | |

### Recap of all CHECK-constraint allowed values
- `app_users.roles` (elements of array): `ATP`, `REP`, `MANAGER`, `BOSS`
- `patients.status`: `ACTIVE`, `SUBMITTED`, `APPROVED`, `DENIED`, `DELIVERED`, `CLOSED`
- `task_templates.responsible_role` + `tasks.responsible_role`: `DOCTOR`, `PT`, `ATP`, `REP`, `FRONT_DESK`
- `tasks.status`: `NOT_STARTED`, `IN_PROGRESS`, `DONE_PENDING_REVIEW`, `APPROVED`, `BLOCKED`, `AWAITING_SIGNATURE`

**Payer/patient types are no longer a CHECK constraint.** As of `0009_payer_types_admin.sql` they live in a dedicated `payer_types` table referenced by FK, managed through the admin UI (built-in Insurance/Medicaid/Medicare are protected from deletion; `0010` re-seeds them idempotently). To add a type, add a row — don't alter a constraint. The remaining lists above are still `text` + `check`.

The lists above are kept as `text` + `check` rather than Postgres `ENUM`s on purpose — adding a new allowed value is one `ALTER TABLE ... DROP/ADD CONSTRAINT` rather than the more painful enum-rename dance.

---

## 7. RLS deep dive

RLS is enabled on all 5 tables in `0002_rls.sql`. Visibility, in plain English:

- **BOSS** — sees and writes everything. No filtering.
- **MANAGER** — sees everything BOSS would on their own assignments, PLUS any patient whose `assigned_rep_id` or `assigned_atp_id` reports to them (i.e. that person's `manager_id == auth.uid()`). Can write templates and manage users. Cannot write `payers` (BOSS only).
- **ATP** — sees patients where they are `assigned_atp_id`, plus any patient where they are `assigned_rep_id` (the solo case). No manager-level rollup.
- **REP** — sees patients where they are `assigned_rep_id`, OR (for the solo case) `assigned_atp_id`.

Tasks inherit their parent patient's visibility via an `EXISTS` subquery in the `tasks_visible` / `tasks_writable` policies. Inactive users can read only their own profile. Active users can read profiles for assignee dropdowns and reporting rollups. Direct `app_users` updates are disabled; `update_app_user()` allows BOSS/MANAGER to manage anyone and ATPs to maintain pure REP accounts.

### Helper functions — and why `security definer`

`0002_rls.sql` defines three helpers:

- `current_user_roles() returns text[]` — `select roles from public.app_users where id = auth.uid()`.
- `has_any_role(needed text[]) returns boolean` — checks whether `current_user_roles()` overlaps `needed`.
- `reports_to_me(victim_id uuid) returns boolean` — checks if `app_users.manager_id` of `victim_id` equals `auth.uid()`.

All three are `security definer` because they query `public.app_users` from inside policies that are themselves attached to `app_users` (or its dependents). Without `security definer`, the policy would re-trigger the same policy on the helper's lookup → either infinite recursion or a permission denial depending on Postgres version. Definer-rights execution sidesteps that by running the lookup as the function owner (postgres) rather than as the policy-subject role. `execute` is granted to `authenticated`.

### When you add a new table, RLS is OFF

Postgres defaults new tables to **RLS disabled**, which means `authenticated` users can read/write everything via PostgREST until you intervene. After every new `create table`, you MUST:

```sql
alter table public.your_table enable row level security;
-- then write at least one select + one all/write policy
```

If you forget, the table is wide open. There is no test in the repo that catches this — be deliberate.

---

## 8. The ATP approval gate

Defined in `supabase/migrations/0003_approve_gate.sql` as a `BEFORE UPDATE` trigger on `tasks`, function `enforce_task_approval_gate()`. It does two things:

### a. Gate the APPROVED transition

The check only fires when **all three** conditions are true:
1. `new.status IS DISTINCT FROM old.status` (it's an actual change)
2. `new.status = 'APPROVED'` (we're landing on APPROVED specifically)
3. `new.requires_atp_review = true` (the snapshotted flag on this task)

When it fires, exactly one of these must be true or the trigger raises `42501`:

- `BOSS` is in the actor's roles → allow (bypass).
- **Solo case:** the patient's `assigned_rep_id == assigned_atp_id == auth.uid()` → allow.
- Normal case: `auth.uid() == assigned_atp_id` AND the actor has the `ATP` role → allow.

Otherwise: `raise exception 'Task requires ATP approval; only the assigned ATP may set APPROVED.' using errcode = '42501';`

### b. Stamp completion metadata

On any transition INTO `APPROVED` or `DONE_PENDING_REVIEW` (where the old status was different), the trigger sets `new.completed_at = now()` and `new.completed_by = auth.uid()`. So clients don't need to send those fields — the DB owns them. Note that going back out of those states leaves the stamps as-is (history of the most recent completion attempt).

Policies alone can't enforce this gate because RLS controls *whether the row is writable*, not *which value of `status` is acceptable*. The trigger does the value-level enforcement.

---

## 9. Next-step + dashboard queue algorithm

Both implemented in `src/lib/queries.ts`.

### Per-patient "next step"

`computeNextStep(tasks)`:
1. Filter to `required && status !== 'APPROVED'`.
2. Sort ascending by `order_index`.
3. Return the first one (or `null` if the patient is done).

`fetchDashboardTasks` also populates `patient.next_step_label` from the same lowest-order required open task per patient.

### Dashboard sort

`fetchDashboardTasks` fetches every visible task (RLS filters automatically), joins to the parent patient + payer, computes patient context, filters out `APPROVED` rows for display, then sorts in JS by a queue score. The score is deliberately not shown in the UI; it is just the operating logic for "what should this person do next?"

Signals in the score:

- Days overdue.
- Blocked tasks.
- Tasks awaiting external parties (`DOCTOR`, `PT`, `FRONT_DESK`).
- `DONE_PENDING_REVIEW` tasks that require ATP review.
- Patients near submission / completion.
- The patient's true next required workflow step.
- Manual `priority` as a bump, not as the whole sort.
- Small workflow-order penalty so later tasks do not dominate earlier work without a reason.

Ties fall back to due date and then `order_index`. Tune the weights in `QUEUE_WEIGHTS` in `src/lib/queries.ts`.

---

## 10. Auth flow end-to-end

1. **Login page** (`src/app/login/page.tsx`) calls `enabledProviders()` from `src/lib/auth-providers.ts` and renders the `LoginForm` client component with the result. Microsoft is primary; email/password is shown as a dev-only fallback when `NEXT_PUBLIC_AUTH_EMAIL_ENABLED` is truthy (default true).
2. **User clicks "Sign in with Microsoft"** → `LoginForm.oauth("azure")` → `supabase.auth.signInWithOAuth({ provider: "azure", options: { redirectTo: ".../auth/callback?next=..." } })`. The browser is redirected to Microsoft.
3. **Microsoft redirects back** to `http://localhost:54321/auth/v1/callback` (Supabase Auth), which finishes the OAuth handshake and then redirects to **`/auth/callback`** in our Next app with a `?code=` parameter.
4. **`src/app/auth/callback/route.ts`** runs `supabase.auth.exchangeCodeForSession(code)`, which writes the session into the response cookies. It then redirects to the `next` query param (default `/`).
5. **Trigger `on_auth_user_created`** (defined in `0001_init.sql`) fires on the insert into `auth.users` and creates a matching `app_users` row with `roles = ['REP']`, `active = false`. A BOSS/MANAGER can promote/activate anyone; an ATP can maintain pure REP accounts.
6. **`src/proxy.ts`** runs on every non-`/api`, non-static request. It calls `supabase.auth.getUser()`, which validates the cookie and (importantly) refreshes it via the cookie adapter when needed. If the user isn't signed in and the path isn't public (`/login`, `/auth/*`, `/_next/*`, `/favicon.ico`), it redirects to `/login?next=<path>`. If the user IS signed in and is on `/login`, it redirects to `/`.
7. **Server components** call `requireUser()` from `src/lib/server-helpers.ts`, which fetches the `app_users` profile. If the trigger somehow failed, it returns a minimal in-memory placeholder with `roles: ['REP']`, `active: false` so the page still renders (the layout shows a "awaiting activation" banner).
8. **Sign out** is a `POST /auth/signout` form (in `(app)/layout.tsx`) that calls `supabase.auth.signOut()` and redirects to `/login`.

---

## 11. Local dev setup

You need the Supabase CLI installed (`brew install supabase/tap/supabase` or equivalent). Then:

```bash
# 1. Copy .env.example to .env.local and fill in the local anon key.
cp .env.example .env.local
# Then paste the values printed by `supabase status` (anon + service_role keys).

# 2. Start the Supabase stack (Postgres on :54322, Studio on :54323, API on :54321).
supabase start

# 3. Reset the DB — runs every migration in supabase/migrations/, then seed.sql.
supabase db reset

# 4. Run Next.js.
npm install
npm run dev
```

The seed creates 5 dev users with password `password123`. The `.gitignore` excludes `.env*`, so your secrets stay local.

### Synthetic-data-only before AWS hardening

The hosted Supabase project is temporary and synthetic-only. Until the AWS deployment has the controls in §16, this app must only see fake patient data — exactly what `seed.sql` provides. Don't load anything real until production cutover.

---

## 12. Common tasks & how to do them

### Add a new task template / edit an existing one

Append (or `UPDATE`) rows in `public.task_templates` for the relevant `payer_type`. Reorder by changing `default_order`. Either do it via SQL migration (preferred for repeatable setup) or via the admin UI once it exists. **Edits do not propagate to in-flight `tasks` rows** (§3 snapshot rule) — only patients created after the edit get the new template.

### Add a new payer type (e.g. `WORKERS_COMP`)

**This changed in `0009_payer_types_admin.sql`.** Payer/patient types are now rows in the `payer_types` table referenced by FK — NOT a CHECK constraint. To add one:

1. Add the type via the **admin UI** (preferred), or `insert into public.payer_types (...)`. Built-in Insurance/Medicaid/Medicare are protected from deletion.
2. Add `task_templates` rows for the new type so new patients of that type get a checklist.
3. No `db-types.ts` change is needed to add a *value* (types are data, not a TS union anymore).

> Historical note: before `0009`, this required dropping + re-adding CHECK constraints on `payers.type` and `task_templates.payer_type` and editing a `PayerType` union. That's no longer how it works.

### Enable Google OAuth

Pure config change — no code rewrite needed.

1. Configure Google as a provider in the Supabase dashboard (or `supabase/config.toml` for local).
2. Set `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` in `.env.local`.
3. Restart Next. The login page reads `enabledProviders()` and renders the Google button automatically (see `src/lib/auth-providers.ts`).

### Add a new role (e.g. `BILLING`)

Three places to touch:

1. **DB constraint** on `app_users.roles`:
   ```sql
   alter table public.app_users drop constraint app_users_roles_valid,
     add constraint app_users_roles_valid
     check (roles <@ array['ATP','REP','MANAGER','BOSS','BILLING']::text[]);
   ```
2. **RLS policies** in `0002_rls.sql`-style follow-ups — decide what this role can see/write and add `has_any_role(array['BILLING'])` clauses.
3. **App code** — add `'BILLING'` to the `Role` union in `src/lib/db-types.ts`, and update `isAdmin` / nav rendering in `src/app/(app)/layout.tsx` if relevant.

### Add notifications (email / SMS)

Out of scope for v1 (see §15). When the time comes, the natural seam is a Postgres `AFTER UPDATE` trigger on `tasks` (similar to `enforce_task_approval_gate`) that calls `pg_net` or enqueues into a Supabase Edge Function. Don't sprinkle send-email calls through the Next app — keep it event-driven from the DB so it survives manual SQL edits too.

---

## 13. Invariants & footguns

- **NEVER log PHI.** `patients.first_name` / `last_name` are PHI. Log patient IDs and external codes only. Same for any future free-text task fields that might capture clinical notes.
- **Editing `task_templates` does NOT touch in-flight `tasks`.** This is by design (§3 snapshot rule). If product wants retroactive edits, that's a new feature with explicit per-task migration.
- **RLS uses `auth.uid()`.** That means policies fail (deny) for the `service_role` key and for unauthenticated/anon requests. If you ever need a server-side script to read across users, use the service role key with a `supabase-js` client that bypasses RLS — but be careful: that client circumvents every safety check, so audit those code paths.
- **`roles` is `text[]`, not a single column.** Don't write `where roles = 'REP'`. Use `'REP' = any(roles)` in SQL, or `roles?.includes('REP')` in TS (see `hasRole` in `server-helpers.ts`).
- **The CHECK constraints on text columns are NOT real Postgres enums.** Adding a value requires a migration that drops + re-adds the check. Old rows with non-listed values would also break the new check, so re-check existing data first.
- **The middleware matcher excludes `/api`.** `matcher: ["/((?!api|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|webp|ico)).*)"]`. If you later add API routes or server actions under `/api`, they are NOT protected by the global redirect-to-login. Either handle auth in those routes explicitly (call `getSupabaseServer()` and check the user) or revisit the matcher.
- **`seed.sql` writes directly into `auth.users` and `auth.identities`.** That only works locally because `supabase db reset` runs as the database superuser; PostgREST + the anon/authenticated roles cannot do this. Do not try to run this script against a remote project — use the dashboard or Admin API.
- **`db-types.ts` is hand-written.** If you change the schema, update this file too — or regenerate with `supabase gen types typescript --linked > src/lib/db-types.ts` once the project is linked. Note: the Supabase client generic is currently NOT parameterized with `Database` (see `src/lib/supabase/{server,browser}.ts`) because the hand-written types make the v2 client's Insert/Update inference collapse to `never`. Casts in pages do the type work. After running `supabase gen types`, you can re-introduce `<Database>` on the clients.
- **Next.js 16 renamed `middleware` to `proxy`.** Our file is `src/proxy.ts` exporting a `proxy()` function. If you regenerate from older docs or examples, don't reintroduce a `proxy.ts` — Next 16 will warn (and eventually error).

---

## 14. Open questions / TODOs (carry-overs from the spec)

These are questions for the client (Choice Healthcare) that have not yet been answered. Don't invent answers — surface them.

- **Medicaid Group 3 task list correctness.** The seed in `seed.sql` is a 14-item strawman. The actual Medicaid PMD checklist needs to be reviewed by DeAnne / Matt and corrected.
- **Medicare and commercial variants.** The Medicare and commercial templates in `seed.sql` are 5-item stubs. They need real lists per payer type (and possibly per major commercial payer).
- **Is the "finite task set" actually finite?** v1 assumes a hand-curated template per payer type covers every patient. If real-world cases routinely add or remove tasks, the UI may need a "add ad-hoc task" affordance — currently not in scope.
- **Role structure validation.** Confirm that `ATP / REP / MANAGER / BOSS` covers everyone who needs system access (e.g. front-desk staff, biller, owner's assistant). Front desk shows up as a `responsible_role` on tasks but NOT as a login role today.

---

## 15. Out of scope for v1

Explicit non-goals, all to keep v1 cheap, fast to ship, and free of HIPAA-tier infra:

- **No document storage.** No file uploads, no PDF hosting. Tasks may have a `link` URL pointing at an external doc (e.g. Google Drive), and that's the entire "doc" surface area.
- **No automated outreach.** No auto-emailing doctors, PT, or payers.
- **No e-signature.** Sign-offs are clicks in this app, not legally-binding signatures.
- **No AI drafting.** No model-generated letters, LIJs, or chart notes.
- **No notifications.** No email, no SMS, no Slack. People look at the dashboard.
- **No mobile app.** Web only (responsive Tailwind is enough for tablet/phone browsers).

---

## 16. Going to production

**The AWS infrastructure is already deployed** (self-hosted Supabase on EC2 `44.253.198.43` / instance `i-0c55b5678f0ec6cf7` in us-west-2, Next.js on Amplify `d2na0dxbmaa2o4` → `https://main.d2na0dxbmaa2o4.amplifyapp.com`). The as-built ops runbook is `infra/aws/DEPLOYMENT.md`; `ARCHITECTURE.md` §3 has the non-technical AWS console guide. Amplify auto-builds from branch `main`; **schema changes require applying the migration on EC2 by hand** (push does not migrate the DB).

Status of the production checklist:

1. ✅ **Self-hosted Supabase on AWS EC2** in `us-west-2`, encrypted EBS, restricted security groups, no public Postgres port.
2. ✅ **Next.js on AWS Amplify**, env vars pointed at the self-hosted Supabase URL + keys.
3. ✅ **Migrations applied** to the self-hosted Postgres — **except `0012`** (`snoozed_until`), which is not yet applied (bounce runs on localStorage until it is). No demo patients/password users in prod.
4. ⏳ **Configure Microsoft/Azure OAuth** in GoTrue and disable dev email/password before real users enter PHI.
5. ⏳ **HIPAA-relevant hardening before real data** — still outstanding: AWS BAA, encrypted backups (S3), audit logging (pg_audit), CloudTrail, OS patching, access-key rotation, breach-response doc.
6. **Same applies to any future provider**: if storage, notifications, or documents are added, that provider also needs the right BAA and controls.

**Until the HIPAA hardening (4–5) is complete, this project sees synthetic data only** — the EC2 box existing does not make it PHI-ready yet.

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).
