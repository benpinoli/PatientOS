-- Per-task link history (rep/ATP submissions). Latest URL also lives on tasks.link.
set search_path = public;

create table if not exists public.task_link_events (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  link        text,
  via_other_means boolean not null default false,
  posted_by   uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint task_link_events_payload check (
    via_other_means or nullif(btrim(link), '') is not null
  )
);

create index if not exists task_link_events_task_created_idx
  on public.task_link_events(task_id, created_at desc);

alter table public.task_link_events enable row level security;

drop policy if exists task_link_events_visible on public.task_link_events;
create policy task_link_events_visible on public.task_link_events
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      join public.patients p on p.id = t.patient_id
      where t.id = task_link_events.task_id
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

drop policy if exists task_link_events_insert on public.task_link_events;
create policy task_link_events_insert on public.task_link_events
  for insert to authenticated
  with check (
    exists (
      select 1 from public.tasks t
      join public.patients p on p.id = t.patient_id
      where t.id = task_link_events.task_id
        and (
          public.has_any_role(array['BOSS','MANAGER'])
          or p.assigned_rep_id = auth.uid()
          or p.assigned_atp_id = auth.uid()
        )
    )
  );
