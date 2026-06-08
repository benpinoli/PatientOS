-- Per-task notes thread (rep/ATP commentary, e.g. why a task isn't done).
-- Append-only and visible to everyone who can see the task. Notes are never
-- edited or deleted (no update/delete policies) and survive bounce — bounce
-- never touches the task row. Mirrors task_link_events (0007).
set search_path = public;

create table if not exists public.task_notes (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  body       text not null,
  author_id  uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_notes_body_present check (nullif(btrim(body), '') is not null)
);

create index if not exists task_notes_task_created_idx
  on public.task_notes(task_id, created_at desc);

alter table public.task_notes enable row level security;

-- Visible to anyone who can see the parent patient (same predicate as tasks).
drop policy if exists task_notes_visible on public.task_notes;
create policy task_notes_visible on public.task_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      join public.patients p on p.id = t.patient_id
      where t.id = task_notes.task_id
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

-- BOSS/MANAGER or the assigned rep/ATP may add a note.
drop policy if exists task_notes_insert on public.task_notes;
create policy task_notes_insert on public.task_notes
  for insert to authenticated
  with check (
    exists (
      select 1 from public.tasks t
      join public.patients p on p.id = t.patient_id
      where t.id = task_notes.task_id
        and (
          public.has_any_role(array['BOSS','MANAGER'])
          or p.assigned_rep_id = auth.uid()
          or p.assigned_atp_id = auth.uid()
        )
    )
  );

-- No update/delete policies on purpose: notes are permanent.
