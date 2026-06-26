-- Paperwork AI branding: a shared library of logo images that can be embedded
-- into converted templates so the organization's branding survives the
-- PDF -> HTML conversion (Gemini cannot reproduce the original logo graphic).
--
-- Logos are stored as data URIs (data:image/png;base64,...) directly in the row.
-- The stored template HTML keeps a small `__LOGO_IMG__` placeholder token; the
-- real <img> is swapped in at preview/fill time so the (large) base64 never has
-- to pass back through the model.
set search_path = public;

create table if not exists public.paperwork_logos (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  data_uri   text not null,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint paperwork_logos_name_present check (nullif(btrim(name), '') is not null)
);

alter table public.paperwork_logos enable row level security;

-- Shared library: any active user may read and manage logos (same as templates).
drop policy if exists paperwork_logos_select on public.paperwork_logos;
create policy paperwork_logos_select on public.paperwork_logos
  for select to authenticated
  using (public.current_user_active());

drop policy if exists paperwork_logos_write on public.paperwork_logos;
create policy paperwork_logos_write on public.paperwork_logos
  for all to authenticated
  using (public.current_user_active())
  with check (public.current_user_active());

-- The logo embedded into a given template (null = no branding logo).
alter table public.paperwork_templates
  add column if not exists logo_data_uri text;
