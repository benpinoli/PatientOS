-- Paperwork AI: download tracking.
--   * paperwork_documents.download_count — how many times THIS patient+template
--     PDF has actually been downloaded (a document only counts as "filled" once
--     it has been downloaded at least once). Re-filling keeps the count (the
--     upsert in the worker does not touch this column).
--   * paperwork_stats.total_downloads — a single monotonic counter of every PDF
--     downloaded by anyone, ever (shown at the top of the Paperwork screen).
--   * record_paperwork_downloads() — security-definer RPC that bumps both, only
--     for documents the caller is allowed to see.
set search_path = public;

-- ---------------------------------------------------------------------------
-- Per-document download counter.
-- ---------------------------------------------------------------------------
alter table public.paperwork_documents
  add column if not exists download_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- Global, all-time download counter (single row, id is always true).
-- ---------------------------------------------------------------------------
create table if not exists public.paperwork_stats (
  id              boolean primary key default true,
  total_downloads bigint not null default 0,
  constraint paperwork_stats_singleton check (id = true)
);

insert into public.paperwork_stats (id, total_downloads)
values (true, 0)
on conflict (id) do nothing;

alter table public.paperwork_stats enable row level security;

-- Everyone signed in can read the global counter.
drop policy if exists paperwork_stats_select on public.paperwork_stats;
create policy paperwork_stats_select on public.paperwork_stats
  for select to authenticated
  using (true);
-- No write policy: the counter is only ever bumped through the RPC below, which
-- runs as the function owner (security definer) and so bypasses RLS.

-- ---------------------------------------------------------------------------
-- Record one download for each given document (deduped to those the caller may
-- view), bump the global counter by that many, and return the new per-document
-- counts plus the new global total. Returns the current total even when nothing
-- valid was passed, so the UI can still refresh the header number.
-- ---------------------------------------------------------------------------
create or replace function public.record_paperwork_downloads(p_doc_ids uuid[])
returns table(document_id uuid, download_count integer, total_downloads bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed uuid[];
  v_n integer;
begin
  select array_agg(d.id) into v_allowed
  from public.paperwork_documents d
  where d.id = any(p_doc_ids)
    and public.can_view_patient(d.patient_id);

  if v_allowed is null then
    return query
      select null::uuid, null::integer, s.total_downloads
      from public.paperwork_stats s
      where s.id = true;
    return;
  end if;

  v_n := array_length(v_allowed, 1);

  update public.paperwork_documents d
    set download_count = d.download_count + 1
  where d.id = any(v_allowed);

  update public.paperwork_stats s
    set total_downloads = s.total_downloads + v_n
  where s.id = true;

  return query
    select d.id,
           d.download_count,
           (select s.total_downloads from public.paperwork_stats s where s.id = true)
    from public.paperwork_documents d
    where d.id = any(v_allowed);
end;
$$;

grant execute on function public.record_paperwork_downloads(uuid[]) to authenticated;
