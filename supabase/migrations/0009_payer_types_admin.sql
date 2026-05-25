-- Dynamic payer / patient types + admin-managed registry.
-- Replaces hard-coded CHECK constraints with payer_types FK.

set search_path = public;

-- =====================================================================
-- payer_types — workflow categories (Medicare, Medicaid, custom, …)
-- =====================================================================
create table if not exists public.payer_types (
  code          text primary key,
  display_name  text not null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

insert into public.payer_types (code, display_name, sort_order) values
  ('COMMERCIAL', 'Insurance', 1),
  ('MEDICAID',   'Medicaid',  2),
  ('MEDICARE',   'Medicare',  3)
on conflict (code) do nothing;

-- Drop enum-like checks; enforce via FK instead.
alter table public.payers drop constraint if exists payers_type_check;
alter table public.task_templates drop constraint if exists task_templates_payer_type_check;

alter table public.payers
  drop constraint if exists payers_type_fkey;

alter table public.task_templates
  drop constraint if exists task_templates_payer_type_fkey;

alter table public.payers
  add constraint payers_type_fkey
  foreign key (type) references public.payer_types(code) on delete restrict;

alter table public.task_templates
  add constraint task_templates_payer_type_fkey
  foreign key (payer_type) references public.payer_types(code) on delete cascade;

-- =====================================================================
-- RLS — payer_types (read: all active users; write: BOSS / MANAGER)
-- =====================================================================
alter table public.payer_types enable row level security;

drop policy if exists payer_types_select on public.payer_types;
create policy payer_types_select on public.payer_types
  for select to authenticated
  using (public.current_user_active());

drop policy if exists payer_types_admin_write on public.payer_types;
create policy payer_types_admin_write on public.payer_types
  for all to authenticated
  using (public.current_user_active() and public.has_any_role(array['BOSS','MANAGER']))
  with check (public.current_user_active() and public.has_any_role(array['BOSS','MANAGER']));

-- Let managers maintain payer rows when adding a new type.
drop policy if exists payers_boss_write on public.payers;
create policy payers_admin_write on public.payers
  for all to authenticated
  using (public.current_user_active() and public.has_any_role(array['BOSS','MANAGER']))
  with check (public.current_user_active() and public.has_any_role(array['BOSS','MANAGER']));
