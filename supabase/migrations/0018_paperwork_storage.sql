-- Storage buckets + object policies for Paperwork AI.
--
-- Guarded by a to_regclass() check so the migration is a no-op until the
-- Supabase `storage` service has created the storage schema. On the local
-- Supabase CLI stack and on EC2 (once `storage` is enabled in the compose
-- override) the schema exists before migrations apply, so this runs normally.
--
-- Path conventions:
--   paperwork-source    : <patient_id>/<file-uuid>-<filename>
--   paperwork-templates : <template_id>/<file-uuid>-<filename>  (global library)
set search_path = public;

-- Safe text->uuid cast: returns null instead of erroring on non-uuid input,
-- so a storage.objects policy can guard a per-bucket uuid path segment without
-- breaking queries against other buckets.
create or replace function public.safe_uuid(t text)
returns uuid
language plpgsql
immutable
as $$
begin
  return t::uuid;
exception
  when others then
    return null;
end;
$$;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping Paperwork AI bucket setup. Re-run after the storage service is up.';
    return;
  end if;

  -- Private buckets (not publicly readable; access is via RLS + the app).
  insert into storage.buckets (id, name, public)
  values
    ('paperwork-source', 'paperwork-source', false),
    ('paperwork-templates', 'paperwork-templates', false)
  on conflict (id) do nothing;

  -- paperwork-source: scoped to the patient in the first path segment.
  execute $p$drop policy if exists paperwork_source_select on storage.objects$p$;
  execute $p$
    create policy paperwork_source_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'paperwork-source'
        and public.can_view_patient(public.safe_uuid((storage.foldername(name))[1]))
      )
  $p$;

  execute $p$drop policy if exists paperwork_source_insert on storage.objects$p$;
  execute $p$
    create policy paperwork_source_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'paperwork-source'
        and public.can_write_patient(public.safe_uuid((storage.foldername(name))[1]))
      )
  $p$;

  execute $p$drop policy if exists paperwork_source_delete on storage.objects$p$;
  execute $p$
    create policy paperwork_source_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'paperwork-source'
        and public.can_write_patient(public.safe_uuid((storage.foldername(name))[1]))
      )
  $p$;

  -- paperwork-templates: shared library readable/writable by any active user.
  execute $p$drop policy if exists paperwork_templates_obj_select on storage.objects$p$;
  execute $p$
    create policy paperwork_templates_obj_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'paperwork-templates'
        and public.current_user_active()
      )
  $p$;

  execute $p$drop policy if exists paperwork_templates_obj_write on storage.objects$p$;
  execute $p$
    create policy paperwork_templates_obj_write on storage.objects
      for all to authenticated
      using (
        bucket_id = 'paperwork-templates'
        and public.current_user_active()
      )
      with check (
        bucket_id = 'paperwork-templates'
        and public.current_user_active()
      )
  $p$;
end
$$;
