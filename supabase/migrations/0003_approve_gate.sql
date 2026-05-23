-- Server-side enforcement of the ATP review gate (spec §7).
--
-- A task with requires_atp_review = true cannot transition to status='APPROVED'
-- unless one of:
--   - the actor is the patient's assigned_atp_id and has role ATP, or
--   - the actor is BOSS, or
--   - the actor is BOTH assigned_rep_id and assigned_atp_id on this patient
--     (the "solo case" carve-out from the spec).
--
-- Implemented as a BEFORE UPDATE trigger that raises on a bad transition.
-- (Policies alone aren't enough — they gate visibility, not status values.)

set search_path = public;

create or replace function public.enforce_task_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p_assigned_rep uuid;
  p_assigned_atp uuid;
  actor uuid := auth.uid();
  actor_roles text[];
begin
  -- Superuser / admin path: when there is no authenticated user (e.g. the
  -- seed running via psql as `postgres`), let the change through. The
  -- gate is only meaningful for app-API callers, who always have auth.uid().
  if actor is null then
    return new;
  end if;

  -- Only care about transitions that *land* on APPROVED, and only when the
  -- task requires ATP review.
  if (new.status is distinct from old.status)
     and new.status = 'APPROVED'
     and new.requires_atp_review = true then

    select p.assigned_rep_id, p.assigned_atp_id
      into p_assigned_rep, p_assigned_atp
      from public.patients p
     where p.id = new.patient_id;

    actor_roles := public.current_user_roles();

    -- BOSS bypass
    if 'BOSS' = any(actor_roles) then
      return new;
    end if;

    -- Solo case: actor is both rep and atp on this patient
    if p_assigned_rep = actor and p_assigned_atp = actor then
      return new;
    end if;

    -- Normal gate: actor must be the assigned ATP and hold ATP role
    if p_assigned_atp = actor and 'ATP' = any(actor_roles) then
      return new;
    end if;

    raise exception 'Task requires ATP approval; only the assigned ATP may set APPROVED.'
      using errcode = '42501';
  end if;

  -- Stamp completion metadata when entering a terminal-ish state
  if new.status in ('APPROVED','DONE_PENDING_REVIEW') and (old.status is distinct from new.status) then
    new.completed_at := now();
    new.completed_by := actor;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_approval_gate on public.tasks;
create trigger tasks_approval_gate
  before update on public.tasks
  for each row execute function public.enforce_task_approval_gate();
