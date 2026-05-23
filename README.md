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
- Intended deployment: **Vercel** for the Next.js app, **Supabase** for
  data + auth. The Next.js app talks to Supabase over HTTPS — they are
  different layers, not alternatives.

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
- 6 fake patients with tasks in varied states (not started, in progress,
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
| `supabase/seed.sql` | Synthetic users + payers + task templates + 6 patients |
| `src/app/login/` | Provider-agnostic login screen |
| `src/app/(app)/page.tsx` | Aggregated dashboard with priority queue |
| `src/app/(app)/patients/[id]/page.tsx` | Patient detail w/ computed next step |
| `src/app/(app)/patients/new/page.tsx` | New-patient form (instantiates the task list) |
| `src/app/(app)/admin/page.tsx` | Activate users, set roles + manager hierarchy |
| `src/proxy.ts` | Auth gate + cookie refresh (Next 16 proxy convention) |
| `src/lib/auth-providers.ts` | Config-driven enabled providers |
| `src/lib/queries.ts` | Dashboard fetch + sort + next-step algorithm |

---

## Going to production

Local dev runs on the Supabase **free tier with synthetic data only**.
Before any real patient data is entered:

1. Upgrade Supabase to the paid HIPAA plan.
2. Enable HIPAA on the Supabase org, mark the production project
   high-compliance.
3. Sign the BAA.
4. Wire Azure AD / Entra OAuth credentials in production env vars.

The schema migrates forward unchanged — it's the same Postgres on either
side.

---

## What's explicitly out of v1

- Document storage / upload / signing
- Inventory management
- Automated outreach to doctors / PTs
- AI drafting of justifications / appeals
- Email / SMS notifications

These are deferred until v1's coordination layer is validated.
