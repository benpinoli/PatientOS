-- In-app notifications for the rep<->ATP handoff loop.
--   TASK_SUBMITTED_FOR_REVIEW : rep submitted a gated task  -> notify assigned ATP
--   TASK_APPROVED             : ATP approved the rep's work  -> notify assigned rep
-- Rows store IDs only (+ a non-PHI task_label snapshot); the patient name is
-- joined at render time through the recipient's RLS-bound client, so PHI is
-- never denormalized here. Inserts come from the server action via the
-- service-role client (recipient != actor), so there is no INSERT policy.
set search_path = public;

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.app_users(id) on delete cascade,
  actor_id     uuid references public.app_users(id) on delete set null,
  task_id      uuid references public.tasks(id) on delete cascade,
  patient_id   uuid not null references public.patients(id) on delete cascade,
  type         text not null check (type in ('TASK_SUBMITTED_FOR_REVIEW', 'TASK_APPROVED')),
  task_label   text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_recipient_unread_idx
  on public.notifications(recipient_id, read_at, created_at desc);

alter table public.notifications enable row level security;

-- You can read only your own notifications.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid());

-- You can update only your own (to set read_at).
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- No INSERT policy: notifications are written by the app's service-role client
-- after the originating task mutation has already been authorized.
