-- Broader in-app notification types + security-definer insert (no service-role key required).
set search_path = public;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'TASK_STARTED',
    'TASK_LINK_ADDED',
    'TASK_SENT_FOR_SIGNATURE',
    'TASK_SUBMITTED_FOR_REVIEW',
    'TASK_APPROVED',
    'TASK_NOTE_ADDED'
  ));

-- Inserts a notification for the counterparty on a shared rep/ATP case.
-- Callable by authenticated users after an authorized task mutation (security definer).
create or replace function public.insert_task_notification(
  p_recipient_id uuid,
  p_task_id uuid,
  p_patient_id uuid,
  p_type text,
  p_task_label text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.current_user_active() then
    raise exception 'Account is inactive.' using errcode = '42501';
  end if;

  if p_recipient_id is null or p_recipient_id = actor then
    return;
  end if;

  if p_type not in (
    'TASK_STARTED',
    'TASK_LINK_ADDED',
    'TASK_SENT_FOR_SIGNATURE',
    'TASK_SUBMITTED_FOR_REVIEW',
    'TASK_APPROVED',
    'TASK_NOTE_ADDED'
  ) then
    raise exception 'Invalid notification type.' using errcode = '22023';
  end if;

  -- Actor must be allowed to work this patient (same bar as task writes).
  if not exists (
    select 1
      from public.patients p
     where p.id = p_patient_id
       and (
         public.has_any_role(array['BOSS'])
         or p.assigned_rep_id = actor
         or p.assigned_atp_id = actor
         or (
           public.has_any_role(array['MANAGER'])
           and (public.reports_to_me(p.assigned_rep_id) or public.reports_to_me(p.assigned_atp_id))
         )
       )
  ) then
    raise exception 'Not allowed to notify on this patient.' using errcode = '42501';
  end if;

  -- Recipient must be the assigned rep or ATP on this case (not arbitrary users).
  if not exists (
    select 1
      from public.patients p
     where p.id = p_patient_id
       and p_recipient_id in (p.assigned_rep_id, p.assigned_atp_id)
       and p.assigned_rep_id is distinct from p.assigned_atp_id
  ) then
    return;
  end if;

  insert into public.notifications (
    recipient_id,
    actor_id,
    task_id,
    patient_id,
    type,
    task_label
  )
  values (
    p_recipient_id,
    actor,
    p_task_id,
    p_patient_id,
    p_type,
    nullif(btrim(p_task_label), '')
  );
end;
$$;

grant execute on function public.insert_task_notification(
  uuid, uuid, uuid, text, text
) to authenticated;
