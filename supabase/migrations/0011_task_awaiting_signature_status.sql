-- Allow tasks to wait on external Doctor/PT signatures.
set search_path = public;

alter table public.tasks drop constraint if exists tasks_status_check;

alter table public.tasks
  add constraint tasks_status_check
  check (
    status in (
      'NOT_STARTED',
      'IN_PROGRESS',
      'AWAITING_SIGNATURE',
      'DONE_PENDING_REVIEW',
      'APPROVED',
      'BLOCKED'
    )
  );
