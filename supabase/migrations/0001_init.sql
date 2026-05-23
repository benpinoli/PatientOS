-- Choice Healthcare Patient Pipeline Tracker — v1 schema
-- Postgres + Supabase. All tables live in `public`.

set search_path = public;

-- =====================================================================
-- ENUM-LIKE CHECK CONSTRAINTS
-- (kept as text + check for flexibility; not real ENUMs so we can edit easily)
-- =====================================================================

-- Roles a person can hold. Multi-valued on app_users.roles (text[]).
-- Allowed values: 'ATP','REP','MANAGER','BOSS'

-- Payer types
-- Allowed values: 'MEDICARE','MEDICAID','COMMERCIAL'

-- Patient pursuit status
-- Allowed values: 'ACTIVE','SUBMITTED','APPROVED','DENIED','DELIVERED','CLOSED'

-- Task status
-- Allowed values: 'NOT_STARTED','IN_PROGRESS','DONE_PENDING_REVIEW','APPROVED','BLOCKED'

-- Responsible role on a task
-- Allowed values: 'DOCTOR','PT','ATP','REP','FRONT_DESK'

-- =====================================================================
-- app_users — profile row, 1:1 with auth.users.id
-- =====================================================================
create table if not exists public.app_users (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  email         text,
  roles         text[] not null default array['REP']::text[],
  location      text,
  manager_id    uuid references public.app_users(id) on delete set null,
  active        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Validate roles array contains only known values
alter table public.app_users
  add constraint app_users_roles_valid
  check (
    roles <@ array['ATP','REP','MANAGER','BOSS']::text[]
  );

create index if not exists app_users_manager_id_idx on public.app_users(manager_id);

-- =====================================================================
-- payers
-- =====================================================================
create table if not exists public.payers (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  type   text not null check (type in ('MEDICARE','MEDICAID','COMMERCIAL'))
);

-- =====================================================================
-- patients (patient + active case merged)
-- =====================================================================
create table if not exists public.patients (
  id                uuid primary key default gen_random_uuid(),
  external_code     text unique,
  first_name        text not null,
  last_name         text not null,
  payer_id          uuid not null references public.payers(id),
  referral_source   text,
  assigned_rep_id   uuid references public.app_users(id) on delete set null,
  assigned_atp_id   uuid references public.app_users(id) on delete set null,
  status            text not null default 'ACTIVE'
                    check (status in ('ACTIVE','SUBMITTED','APPROVED','DENIED','DELIVERED','CLOSED')),
  created_at        timestamptz not null default now()
);

create index if not exists patients_assigned_rep_idx on public.patients(assigned_rep_id);
create index if not exists patients_assigned_atp_idx on public.patients(assigned_atp_id);
create index if not exists patients_payer_idx on public.patients(payer_id);

-- =====================================================================
-- task_templates — finite hand-made master checklist per payer type
-- =====================================================================
create table if not exists public.task_templates (
  id                  uuid primary key default gen_random_uuid(),
  payer_type          text not null check (payer_type in ('MEDICARE','MEDICAID','COMMERCIAL')),
  label               text not null,
  responsible_role    text not null check (responsible_role in ('DOCTOR','PT','ATP','REP','FRONT_DESK')),
  requires_atp_review boolean not null default false,
  required            boolean not null default true,
  default_order       int not null
);

create index if not exists task_templates_payer_type_idx on public.task_templates(payer_type, default_order);

-- =====================================================================
-- tasks — instantiated per-patient from task_templates
-- =====================================================================
create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references public.patients(id) on delete cascade,
  template_id         uuid references public.task_templates(id) on delete set null,

  -- snapshot of template at instantiation time
  label               text not null,
  responsible_role    text not null check (responsible_role in ('DOCTOR','PT','ATP','REP','FRONT_DESK')),
  requires_atp_review boolean not null default false,
  required            boolean not null default true,
  order_index         int not null,

  status              text not null default 'NOT_STARTED'
                      check (status in ('NOT_STARTED','IN_PROGRESS','DONE_PENDING_REVIEW','APPROVED','BLOCKED')),
  link                text,
  start_date          date,
  due_date            date,
  priority            int,                -- lower = higher priority; null = no bump
  completed_by        uuid references public.app_users(id) on delete set null,
  completed_at        timestamptz,
  blocked_reason      text,
  created_at          timestamptz not null default now()
);

create index if not exists tasks_patient_idx on public.tasks(patient_id, order_index);
create index if not exists tasks_status_idx  on public.tasks(status);
create index if not exists tasks_due_idx     on public.tasks(due_date);

-- =====================================================================
-- Trigger: on auth.users insert, bootstrap an app_users row (REP, inactive)
-- Admins later activate and assign roles.
-- =====================================================================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (id, email, full_name, roles, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    array['REP']::text[],
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
