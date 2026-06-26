-- Paperwork AI: editable JSON field templates per patient (payer) type.
--
-- Each template's `definition` is the field STRUCTURE used to drive the patient
-- completeness checklist and the AI extraction shape for patients of that payer
-- type. One template per type is marked `is_default` and is used automatically;
-- extras are allowed. Until a type has a saved template, the app/worker fall
-- back to a built-in default structure, so behavior is unchanged out of the box.
--
-- `definition` shape:
--   { "sections": [ { "key": "...", "label": "...",
--       "fields": [ { "path": "...", "label": "...", "kind": "text|number|boolean|list|date|choice", "options": [..]? } ] } ] }
set search_path = public;

create table if not exists public.paperwork_json_templates (
  id         uuid primary key default gen_random_uuid(),
  payer_type text not null,
  name       text not null,
  is_default boolean not null default false,
  definition jsonb not null default '{"sections":[]}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paperwork_json_templates_name_present check (nullif(btrim(name), '') is not null)
);

alter table public.paperwork_json_templates enable row level security;

-- Shared library: any active user may read and manage JSON templates (same as
-- PDF templates and logos).
drop policy if exists paperwork_json_templates_select on public.paperwork_json_templates;
create policy paperwork_json_templates_select on public.paperwork_json_templates
  for select to authenticated
  using (public.current_user_active());

drop policy if exists paperwork_json_templates_write on public.paperwork_json_templates;
create policy paperwork_json_templates_write on public.paperwork_json_templates
  for all to authenticated
  using (public.current_user_active())
  with check (public.current_user_active());

-- At most one default template per payer type.
create unique index if not exists paperwork_json_templates_one_default
  on public.paperwork_json_templates (payer_type)
  where is_default;
