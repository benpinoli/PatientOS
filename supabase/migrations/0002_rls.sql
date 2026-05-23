-- Row-Level Security policies.
--
-- Visibility model (per spec §8):
--   REP     — patients where assigned_rep_id = auth.uid() OR assigned_atp_id = auth.uid()
--   ATP     — same plus where assigned_atp_id = auth.uid()
--   MANAGER — the above + patients of any user whose manager_id = auth.uid()
--   BOSS    — full read across everything
-- The roles[] array is checked with the most permissive matching policy.

set search_path = public;

-- =====================================================================
-- Helpers (security definer so policies can call without recursion)
-- =====================================================================

-- Returns the roles array for the current authenticated user.
create or replace function public.current_user_roles()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select roles from public.app_users where id = auth.uid()),
    array[]::text[]
  );
$$;

-- True if current user has any of the given roles.
create or replace function public.has_any_role(needed text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from unnest(public.current_user_roles()) r
    where r = any(needed)
  );
$$;

-- True if `victim_id` reports (directly) to auth.uid()
create or replace function public.reports_to_me(victim_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.app_users u
    where u.id = victim_id and u.manager_id = auth.uid()
  );
$$;

grant execute on function public.current_user_roles() to authenticated;
grant execute on function public.has_any_role(text[]) to authenticated;
grant execute on function public.reports_to_me(uuid) to authenticated;

-- =====================================================================
-- Enable RLS
-- =====================================================================
alter table public.app_users      enable row level security;
alter table public.payers         enable row level security;
alter table public.patients       enable row level security;
alter table public.task_templates enable row level security;
alter table public.tasks          enable row level security;

-- =====================================================================
-- app_users — everyone can read all profiles (needed for assignee
-- dropdowns and manager rollup). Users can update their own row;
-- BOSS/MANAGER (admins) can update anyone.
-- =====================================================================
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated
  using (true);

drop policy if exists app_users_update_self on public.app_users;
create policy app_users_update_self on public.app_users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists app_users_admin_all on public.app_users;
create policy app_users_admin_all on public.app_users
  for all to authenticated
  using (public.has_any_role(array['BOSS','MANAGER']))
  with check (public.has_any_role(array['BOSS','MANAGER']));

-- =====================================================================
-- payers — readable by all authenticated; only BOSS may write.
-- =====================================================================
drop policy if exists payers_select on public.payers;
create policy payers_select on public.payers
  for select to authenticated
  using (true);

drop policy if exists payers_boss_write on public.payers;
create policy payers_boss_write on public.payers
  for all to authenticated
  using (public.has_any_role(array['BOSS']))
  with check (public.has_any_role(array['BOSS']));

-- =====================================================================
-- task_templates — readable by all; only BOSS/MANAGER may write.
-- =====================================================================
drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates
  for select to authenticated
  using (true);

drop policy if exists task_templates_admin_write on public.task_templates;
create policy task_templates_admin_write on public.task_templates
  for all to authenticated
  using (public.has_any_role(array['BOSS','MANAGER']))
  with check (public.has_any_role(array['BOSS','MANAGER']));

-- =====================================================================
-- patients — visibility per spec §8.
-- =====================================================================
drop policy if exists patients_visible on public.patients;
create policy patients_visible on public.patients
  for select to authenticated
  using (
    public.has_any_role(array['BOSS'])
    or assigned_rep_id = auth.uid()
    or assigned_atp_id = auth.uid()
    or (
      public.has_any_role(array['MANAGER'])
      and (
        public.reports_to_me(assigned_rep_id)
        or public.reports_to_me(assigned_atp_id)
      )
    )
  );

drop policy if exists patients_writable on public.patients;
create policy patients_writable on public.patients
  for all to authenticated
  using (
    public.has_any_role(array['BOSS'])
    or assigned_rep_id = auth.uid()
    or assigned_atp_id = auth.uid()
    or (
      public.has_any_role(array['MANAGER'])
      and (
        public.reports_to_me(assigned_rep_id)
        or public.reports_to_me(assigned_atp_id)
      )
    )
  )
  with check (
    public.has_any_role(array['BOSS','MANAGER'])
    or assigned_rep_id = auth.uid()
    or assigned_atp_id = auth.uid()
  );

-- =====================================================================
-- tasks — same visibility as their parent patient.
-- =====================================================================
drop policy if exists tasks_visible on public.tasks;
create policy tasks_visible on public.tasks
  for select to authenticated
  using (
    exists (
      select 1 from public.patients p
      where p.id = tasks.patient_id
        and (
          public.has_any_role(array['BOSS'])
          or p.assigned_rep_id = auth.uid()
          or p.assigned_atp_id = auth.uid()
          or (
            public.has_any_role(array['MANAGER'])
            and (
              public.reports_to_me(p.assigned_rep_id)
              or public.reports_to_me(p.assigned_atp_id)
            )
          )
        )
    )
  );

drop policy if exists tasks_writable on public.tasks;
create policy tasks_writable on public.tasks
  for all to authenticated
  using (
    exists (
      select 1 from public.patients p
      where p.id = tasks.patient_id
        and (
          public.has_any_role(array['BOSS'])
          or p.assigned_rep_id = auth.uid()
          or p.assigned_atp_id = auth.uid()
          or (
            public.has_any_role(array['MANAGER'])
            and (
              public.reports_to_me(p.assigned_rep_id)
              or public.reports_to_me(p.assigned_atp_id)
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.patients p
      where p.id = tasks.patient_id
        and (
          public.has_any_role(array['BOSS','MANAGER'])
          or p.assigned_rep_id = auth.uid()
          or p.assigned_atp_id = auth.uid()
        )
    )
  );
