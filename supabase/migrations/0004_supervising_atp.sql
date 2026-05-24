-- Adds a default ATP supervisor on the user row.
--
-- Why: non-ATP reps need ATP signatures on `requires_atp_review` tasks.
-- They typically work with the same ATP across patients, so storing the
-- relationship per-user lets the new-patient form pre-fill assigned_atp_id
-- automatically instead of forcing the user to pick every time.
--
-- Rules:
--   - If user.roles contains 'ATP'  → supervising_atp_id should be NULL
--                                     (ATPs are their own ATP).
--   - If user.roles does NOT contain 'ATP' → supervising_atp_id must point
--                                     to an ATP-credentialed user.
-- We don't enforce the latter as a DB constraint to keep onboarding
-- flexible (a fresh rep may exist briefly before admin assigns one);
-- the new-patient form and admin UI enforce it instead.

set search_path = public;

alter table public.app_users
  add column if not exists supervising_atp_id uuid
    references public.app_users(id) on delete set null;

create index if not exists app_users_supervising_atp_idx
  on public.app_users(supervising_atp_id);

-- Seed assignments for the existing demo users. ATPs get NULL; the two
-- pure REPs get pointed at their working ATP.
update public.app_users
   set supervising_atp_id = '00000000-0000-0000-0000-000000000003' -- Steve
 where id = '00000000-0000-0000-0000-000000000004';                -- Tara

update public.app_users
   set supervising_atp_id = '00000000-0000-0000-0000-000000000002' -- Matt
 where id = '00000000-0000-0000-0000-000000000005';                -- Jack
