-- Paperwork AI extension: structured patient JSON, template library, filled
-- documents, and uploaded source-file metadata. Storage buckets + object
-- policies live in 0018_paperwork_storage.sql (guarded so they only run once
-- the storage schema exists).
set search_path = public;

-- ---------------------------------------------------------------------------
-- patients.drive_folder_url — the patient's shared Drive folder (item 9).
-- ---------------------------------------------------------------------------
alter table public.patients
  add column if not exists drive_folder_url text;

-- ---------------------------------------------------------------------------
-- Reusable patient-visibility predicates (security definer to avoid RLS
-- recursion when called from policies on dependent tables). Mirrors the
-- inline predicate in 0013_task_notes.sql.
-- ---------------------------------------------------------------------------
create or replace function public.can_view_patient(p_patient_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.patients p
    where p.id = p_patient_id
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
  );
$$;

create or replace function public.can_write_patient(p_patient_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.patients p
    where p.id = p_patient_id
      and (
        public.has_any_role(array['BOSS','MANAGER'])
        or p.assigned_rep_id = auth.uid()
        or p.assigned_atp_id = auth.uid()
      )
  );
$$;

grant execute on function public.can_view_patient(uuid) to authenticated;
grant execute on function public.can_write_patient(uuid) to authenticated;

-- Touch trigger to maintain updated_at columns.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- paperwork_patient_data — one structured JSON record per patient.
-- ---------------------------------------------------------------------------
create table if not exists public.paperwork_patient_data (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists paperwork_patient_data_touch on public.paperwork_patient_data;
create trigger paperwork_patient_data_touch
  before update on public.paperwork_patient_data
  for each row execute function public.touch_updated_at();

alter table public.paperwork_patient_data enable row level security;

drop policy if exists paperwork_patient_data_select on public.paperwork_patient_data;
create policy paperwork_patient_data_select on public.paperwork_patient_data
  for select to authenticated
  using (public.can_view_patient(patient_id));

drop policy if exists paperwork_patient_data_write on public.paperwork_patient_data;
create policy paperwork_patient_data_write on public.paperwork_patient_data
  for all to authenticated
  using (public.can_write_patient(patient_id))
  with check (public.can_write_patient(patient_id));

-- ---------------------------------------------------------------------------
-- paperwork_templates — shared global library of editable PDF templates.
-- ---------------------------------------------------------------------------
create table if not exists public.paperwork_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  source_path     text,
  source_mime     text,
  html            text not null default '',
  required_fields jsonb not null default '[]'::jsonb,
  created_by      uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint paperwork_templates_name_present check (nullif(btrim(name), '') is not null)
);

drop trigger if exists paperwork_templates_touch on public.paperwork_templates;
create trigger paperwork_templates_touch
  before update on public.paperwork_templates
  for each row execute function public.touch_updated_at();

alter table public.paperwork_templates enable row level security;

-- Library is shared: any active user may read and manage templates.
drop policy if exists paperwork_templates_select on public.paperwork_templates;
create policy paperwork_templates_select on public.paperwork_templates
  for select to authenticated
  using (public.current_user_active());

drop policy if exists paperwork_templates_write on public.paperwork_templates;
create policy paperwork_templates_write on public.paperwork_templates
  for all to authenticated
  using (public.current_user_active())
  with check (public.current_user_active());

-- ---------------------------------------------------------------------------
-- paperwork_documents — per patient+template filled output (editable HTML).
-- ---------------------------------------------------------------------------
create table if not exists public.paperwork_documents (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete cascade,
  template_id   uuid references public.paperwork_templates(id) on delete set null,
  template_name text,
  filled_html   text not null default '',
  status        text not null default 'DRAFT' check (status in ('DRAFT', 'FINAL')),
  created_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (patient_id, template_id)
);

create index if not exists paperwork_documents_patient_idx
  on public.paperwork_documents(patient_id, updated_at desc);

drop trigger if exists paperwork_documents_touch on public.paperwork_documents;
create trigger paperwork_documents_touch
  before update on public.paperwork_documents
  for each row execute function public.touch_updated_at();

alter table public.paperwork_documents enable row level security;

drop policy if exists paperwork_documents_select on public.paperwork_documents;
create policy paperwork_documents_select on public.paperwork_documents
  for select to authenticated
  using (public.can_view_patient(patient_id));

drop policy if exists paperwork_documents_write on public.paperwork_documents;
create policy paperwork_documents_write on public.paperwork_documents
  for all to authenticated
  using (public.can_write_patient(patient_id))
  with check (public.can_write_patient(patient_id));

-- ---------------------------------------------------------------------------
-- paperwork_source_files — metadata for uploaded patient source documents.
-- (Bytes live in the paperwork-source storage bucket.)
-- ---------------------------------------------------------------------------
create table if not exists public.paperwork_source_files (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  storage_path text not null,
  filename     text not null,
  mime         text,
  uploaded_by  uuid references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists paperwork_source_files_patient_idx
  on public.paperwork_source_files(patient_id, created_at desc);

alter table public.paperwork_source_files enable row level security;

drop policy if exists paperwork_source_files_select on public.paperwork_source_files;
create policy paperwork_source_files_select on public.paperwork_source_files
  for select to authenticated
  using (public.can_view_patient(patient_id));

drop policy if exists paperwork_source_files_write on public.paperwork_source_files;
create policy paperwork_source_files_write on public.paperwork_source_files
  for all to authenticated
  using (public.can_write_patient(patient_id))
  with check (public.can_write_patient(patient_id));
