# Choice Healthcare — Patient Pipeline Tracker (v1)

A shared, role-aware checklist for getting a custom power wheelchair through
the documentation-and-approval gauntlet. Replaces the current Google
Drive / email mess with one prioritized view of "who's done what, what's
next, and what's blocking each patient."

**v1 is the tracker only.** It does NOT store documents. Tasks can hold an
optional external link (a URL the user pastes), but no files are hosted
in the app. This sidesteps the cost of a BAA-covered document platform
while the team validates whether the tracker alone solves the workflow.

For the full system tour, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).
For the orientation pack a future Claude/dev should read end-to-end,
see [`CLAUDE.md`](./CLAUDE.md).

---

## Stack

- **Next.js 16** (App Router, React 19, TypeScript)
- **Supabase** (Postgres 17 + GoTrue Auth + Row-Level Security)
- **Tailwind CSS 4**
- Auth via Microsoft (Azure AD / Entra) OAuth by default; providers are
  config-driven (see `src/lib/auth-providers.ts`).
- Intended deployment: **AWS Amplify** for the Next.js app and **self-hosted
  Supabase** (Docker on EC2) for Postgres + auth. See
  [`infra/aws/DEPLOYMENT.md`](infra/aws/DEPLOYMENT.md). Do **not** use
  Supabase Cloud for production.

---

## Local dev

### 1. Prerequisites

- Node.js 22+
- Supabase CLI: `brew install supabase/tap/supabase`

### 2. Env vars

```bash
cp .env.example .env.local
```

Fill in the local Supabase keys (you'll get them in step 3 below).

### 3. Start Supabase locally

```bash
supabase start
```

This launches Postgres (`:54322`), Studio UI (`:54323`), and the Auth +
PostgREST API (`:54321`). Copy the `anon key` and `service_role key` it
prints into your `.env.local`.

### 4. Apply migrations + seed

```bash
supabase db reset
```

This runs every file in `supabase/migrations/` in order and then
`supabase/seed.sql`, which loads:

- 5 fake users (DeAnne / Matt / Steve / Tara / Jack) with password
  `password123`
- 3 payers (Medicare, Nevada Medicaid, Anthem BCBS)
- The Medicaid Group 3 strawman task templates (+ stubs for Medicare and
  commercial)
- 9 fake patients with tasks in varied states (not started, in progress,
  pending ATP review, blocked, fully approved) so every dashboard pivot
  has something interesting on it

### 5. Run the app

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Sign in with any seed user
(`<name>@choice.example` / `password123`). The dashboard, patient detail,
manager rollup, and ATP gate are all wired through RLS — sign in as
different users to see the visibility model in action.

---

## What's in here

| Path | What it does |
|---|---|
| `supabase/migrations/0001_init.sql` | All 5 tables + the auth-user → app-user trigger |
| `supabase/migrations/0002_rls.sql` | RLS helpers + per-table policies |
| `supabase/migrations/0003_approve_gate.sql` | Server-side enforcement of the ATP review gate |
| `supabase/migrations/0004_supervising_atp.sql` | Default ATP supervisor relationship on users |
| `supabase/migrations/0005_harden_user_and_patient_workflows.sql` | Hardened user admin RPCs + atomic patient/task creation |
| `supabase/seed.sql` | Synthetic users + payers + task templates + 9 patients |
| `src/app/login/` | Provider-agnostic login screen |
| `src/app/(app)/page.tsx` | Intelligence-sorted dashboard queue + patient task groups |
| `src/app/(app)/patients/[id]/page.tsx` | Patient detail w/ computed next step |
| `src/app/(app)/patients/new/page.tsx` | New-patient form (instantiates the task list) |
| `src/app/(app)/admin/page.tsx` | Activate users, set roles + manager hierarchy |
| `src/proxy.ts` | Auth gate + cookie refresh (Next 16 proxy convention) |
| `src/lib/auth-providers.ts` | Config-driven enabled providers |
| `src/lib/queries.ts` | Dashboard fetch + sort + next-step algorithm |

---

## Going to production

Local dev and the temporary hosted Supabase project use **synthetic data
only**. Real patient data belongs only on the AWS deployment after the
HIPAA-relevant controls are in place: AWS BAA, encrypted EBS, restricted
network access, backups, audit logging, OS patching, and documented breach
response. The planned production shape is AWS Amplify for Next.js plus the
open-source Supabase stack on EC2.

---

## What's explicitly out of v1

- Document storage / upload / signing
- Inventory management
- Automated outreach to doctors / PTs
- AI drafting of justifications / appeals
- Email / SMS notifications

These are deferred until v1's coordination layer is validated.
