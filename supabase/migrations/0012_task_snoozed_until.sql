-- "Bounce" / snooze: temporarily push a task off the Top 5 dashboard.
--
-- A task with snoozed_until > now() is excluded from the priority queue.
-- The task itself isn't paused — work can still happen on it via the
-- patient detail page. Snooze only affects dashboard surfacing.

set search_path = public;

alter table public.tasks
  add column if not exists snoozed_until timestamptz;

create index if not exists tasks_snoozed_until_idx
  on public.tasks(snoozed_until)
  where snoozed_until is not null;
