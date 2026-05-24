-- Harden app-user administration, active-user access, and patient creation.
--
-- Direct client updates to app_users are intentionally removed. User edits
-- now go through update_app_user(), which validates the actor and target.
-- Patient creation now goes through create_patient_with_tasks(), so the
-- patient row and its instantiated checklist commit or roll back together.

set search_path = public;

-- =====================================================================
-- Helpers
-- =====================================================================

create or replace function public.current_user_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select active from public.app_users where id = auth.uid()),
    false
  );
$$;

grant execute on function public.current_user_active() to authenticated;

-- =====================================================================
-- Replace broad app_users updates with a validated RPC.
-- =====================================================================

drop policy if exists app_users_update_self on public.app_users;
drop policy if exists app_users_admin_all on public.app_users;

drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated
  using (
    id = auth.uid()
    or (
      public.current_user_active()
      and (
        active = true
        or public.has_any_role(array['BOSS','MANAGER','ATP'])
      )
    )
  );

create or replace function public.update_app_user(
  p_user_id uuid,
  p_roles text[] default null,
  p_manager_id uuid default null,
  p_supervising_atp_id uuid default null,
  p_active boolean default null,
  p_location text default null,
  p_full_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_roles text[];
  target_roles text[];
  next_roles text[];
  next_supervising_atp_id uuid;
begin
  if actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.current_user_active() then
    raise exception 'Account is inactive.' using errcode = '42501';
  end if;

  actor_roles := public.current_user_roles();

  select roles into target_roles
    from public.app_users
   where id = p_user_id;

  if target_roles is null then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;

  next_roles := coalesce(p_roles, target_roles);
  if not (next_roles <@ array['ATP','REP','MANAGER','BOSS']::text[]) then
    raise exception 'Invalid role.' using errcode = '23514';
  end if;

  -- BOSS and MANAGER are trusted local admins. ATPs can maintain pure REP
  -- accounts, but cannot grant elevated roles or modify ATP/admin users.
  if 'BOSS' = any(actor_roles) or 'MANAGER' = any(actor_roles) then
    null;
  elsif 'ATP' = any(actor_roles)
        and target_roles <@ array['REP']::text[]
        and next_roles <@ array['REP']::text[] then
    null;
  else
    raise exception 'Not allowed to update this user.' using errcode = '42501';
  end if;

  next_supervising_atp_id := p_supervising_atp_id;
  if 'ATP' = any(next_roles) then
    next_supervising_atp_id := null;
  elsif next_supervising_atp_id is not null and not exists (
    select 1
      from public.app_users u
     where u.id = next_supervising_atp_id
       and u.active = true
       and 'ATP' = any(u.roles)
  ) then
    raise exception 'Supervisor must be an active ATP.' using errcode = '23503';
  end if;

  update public.app_users
     set roles = next_roles,
         manager_id = p_manager_id,
         supervising_atp_id = next_supervising_atp_id,
         active = coalesce(p_active, active),
         location = coalesce(p_location, location),
         full_name = coalesce(p_full_name, full_name)
   where id = p_user_id;
end;
$$;

grant execute on function public.update_app_user(uuid, text[], uuid, uuid, boolean, text, text)
  to authenticated;

-- =====================================================================
-- Active users only for operational tables.
-- =====================================================================

drop policy if exists payers_select on public.payers;
create policy payers_select on public.payers
  for select to authenticated
  using (public.current_user_active());

drop policy if exists payers_boss_write on public.payers;
create policy payers_boss_write on public.payers
  for all to authenticated
  using (public.current_user_active() and public.has_any_role(array['BOSS']))
  with check (public.current_user_active() and public.has_any_role(array['BOSS']));

drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates
  for select to authenticated
  using (public.current_user_active());

drop policy if exists task_templates_admin_write on public.task_templates;
create policy task_templates_admin_write on public.task_templates
  for all to authenticated
  using (public.current_user_active() and public.has_any_role(array['BOSS','MANAGER']))
  with check (public.current_user_active() and public.has_any_role(array['BOSS','MANAGER']));

drop policy if exists patients_visible on public.patients;
create policy patients_visible on public.patients
  for select to authenticated
  using (
    public.current_user_active()
    and (
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
  );

drop policy if exists patients_writable on public.patients;
create policy patients_writable on public.patients
  for all to authenticated
  using (
    public.current_user_active()
    and (
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
  )
  with check (
    public.current_user_active()
    and (
      public.has_any_role(array['BOSS','MANAGER'])
      or assigned_rep_id = auth.uid()
      or assigned_atp_id = auth.uid()
    )
  );

drop policy if exists tasks_visible on public.tasks;
create policy tasks_visible on public.tasks
  for select to authenticated
  using (
    public.current_user_active()
    and exists (
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
    public.current_user_active()
    and exists (
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
    public.current_user_active()
    and exists (
      select 1 from public.patients p
      where p.id = tasks.patient_id
        and (
          public.has_any_role(array['BOSS','MANAGER'])
          or p.assigned_rep_id = auth.uid()
          or p.assigned_atp_id = auth.uid()
        )
    )
  );

-- =====================================================================
-- Atomic patient creation + task instantiation.
-- =====================================================================

create or replace function public.create_patient_with_tasks(
  p_first_name text,
  p_last_name text,
  p_external_code text,
  p_referral_source text,
  p_payer_id uuid,
  p_assigned_rep_id uuid,
  p_assigned_atp_id uuid,
  p_default_due_days int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_roles text[];
  rep_roles text[];
  rep_supervising_atp_id uuid;
  final_atp_id uuid;
  payer_type text;
  patient_id uuid;
begin
  if actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.current_user_active() then
    raise exception 'Account is inactive.' using errcode = '42501';
  end if;

  if nullif(btrim(p_first_name), '') is null
     or nullif(btrim(p_last_name), '') is null
     or p_payer_id is null then
    raise exception 'First name, last name, and payer are required.' using errcode = '23502';
  end if;

  actor_roles := public.current_user_roles();

  select type into payer_type
    from public.payers
   where id = p_payer_id;

  if payer_type is null then
    raise exception 'Payer not found.' using errcode = 'P0002';
  end if;

  if p_assigned_rep_id is not null then
    select roles, supervising_atp_id
      into rep_roles, rep_supervising_atp_id
      from public.app_users
     where id = p_assigned_rep_id
       and active = true;

    if rep_roles is null then
      raise exception 'Assigned rep must be an active user.' using errcode = '23503';
    end if;

    if 'ATP' = any(rep_roles) then
      final_atp_id := p_assigned_rep_id;
    else
      final_atp_id := coalesce(p_assigned_atp_id, rep_supervising_atp_id);
    end if;
  else
    final_atp_id := p_assigned_atp_id;
  end if;

  if final_atp_id is null then
    raise exception 'An ATP must be assigned before creating a patient.' using errcode = '23502';
  end if;

  if not exists (
    select 1
      from public.app_users u
     where u.id = final_atp_id
       and u.active = true
       and 'ATP' = any(u.roles)
  ) then
    raise exception 'Assigned ATP must be an active ATP user.' using errcode = '23503';
  end if;

  if not (
    'BOSS' = any(actor_roles)
    or 'MANAGER' = any(actor_roles)
    or p_assigned_rep_id = actor
    or final_atp_id = actor
  ) then
    raise exception 'Not allowed to create this patient assignment.' using errcode = '42501';
  end if;

  insert into public.patients (
    first_name,
    last_name,
    external_code,
    referral_source,
    payer_id,
    assigned_rep_id,
    assigned_atp_id,
    status
  )
  values (
    btrim(p_first_name),
    btrim(p_last_name),
    nullif(btrim(p_external_code), ''),
    nullif(btrim(p_referral_source), ''),
    p_payer_id,
    p_assigned_rep_id,
    final_atp_id,
    'ACTIVE'
  )
  returning id into patient_id;

  insert into public.tasks (
    patient_id,
    template_id,
    label,
    responsible_role,
    requires_atp_review,
    required,
    order_index,
    status,
    due_date
  )
  select
    patient_id,
    t.id,
    t.label,
    t.responsible_role,
    t.requires_atp_review,
    t.required,
    t.default_order,
    'NOT_STARTED',
    current_date + greatest(p_default_due_days, 0)
  from public.task_templates t
  where t.payer_type = payer_type
  order by t.default_order;

  return patient_id;
end;
$$;

grant execute on function public.create_patient_with_tasks(
  text, text, text, text, uuid, uuid, uuid, int
) to authenticated;
