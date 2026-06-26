-- Paperwork AI async job queue.
--
-- Amplify Hosting's SSR runtime hard-caps responses at ~30s, which is too short
-- for Gemini PDF->HTML conversion and form fills. Instead of running those calls
-- inside an API route, the browser enqueues a job row here; a long-running worker
-- container on the EC2 Supabase host (no 30s cap) picks it up, calls Gemini, and
-- writes the result back. The browser polls the row until it is DONE/ERROR.
set search_path = public;

create table if not exists public.paperwork_jobs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('extract', 'template', 'fill')),
  status      text not null default 'PENDING'
                check (status in ('PENDING', 'RUNNING', 'DONE', 'ERROR')),
  patient_id  uuid references public.patients(id) on delete cascade,
  template_id uuid references public.paperwork_templates(id) on delete set null,
  -- Inbound payload: { text?, files?: [{name,mimeType,data(base64)}], name?, template_id? }
  input       jsonb not null default '{}'::jsonb,
  -- Worker output the client applies: { data? } | { template } | { document }
  result      jsonb,
  error       text,
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  updated_at  timestamptz not null default now()
);

create index if not exists paperwork_jobs_status_idx
  on public.paperwork_jobs(status, created_at);
create index if not exists paperwork_jobs_creator_idx
  on public.paperwork_jobs(created_by, created_at desc);

drop trigger if exists paperwork_jobs_touch on public.paperwork_jobs;
create trigger paperwork_jobs_touch
  before update on public.paperwork_jobs
  for each row execute function public.touch_updated_at();

alter table public.paperwork_jobs enable row level security;

-- The creator can always see their own job; patient-scoped jobs are also visible
-- to anyone who can view that patient.
drop policy if exists paperwork_jobs_select on public.paperwork_jobs;
create policy paperwork_jobs_select on public.paperwork_jobs
  for select to authenticated
  using (
    created_by = auth.uid()
    or (patient_id is not null and public.can_view_patient(patient_id))
  );

-- A user may enqueue a job only as themselves, only while active, and only for a
-- patient they can write (or a global template job with no patient).
drop policy if exists paperwork_jobs_insert on public.paperwork_jobs;
create policy paperwork_jobs_insert on public.paperwork_jobs
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.current_user_active()
    and (patient_id is null or public.can_write_patient(patient_id))
  );

-- No update/delete policies: the worker connects as the superuser role and
-- bypasses RLS to flip status and write results. Clients only read.
