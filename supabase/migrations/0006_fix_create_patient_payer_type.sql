-- Fix ambiguous payer_type reference in create_patient_with_tasks (PL/pgSQL vs column).
set search_path = public;

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
  v_payer_type text;
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

  select type into v_payer_type
    from public.payers
   where id = p_payer_id;

  if v_payer_type is null then
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
  where t.payer_type = v_payer_type
  order by t.default_order;

  return patient_id;
end;
$$;
