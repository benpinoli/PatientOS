-- Paperwork AI branding: pair an optional company/organization name with each
-- logo so it can be rendered next to the logo on the form. The name is snapshot
-- onto the template at conversion time (alongside logo_data_uri).
set search_path = public;

alter table public.paperwork_logos
  add column if not exists company_name text;

alter table public.paperwork_templates
  add column if not exists logo_company_name text;
