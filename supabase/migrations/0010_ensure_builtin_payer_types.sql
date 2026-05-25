-- Re-ensure built-in patient types exist (safe if 0009 already ran).
set search_path = public;

insert into public.payer_types (code, display_name, sort_order) values
  ('COMMERCIAL', 'Insurance', 1),
  ('MEDICAID',   'Medicaid',  2),
  ('MEDICARE',   'Medicare',  3)
on conflict (code) do update
  set display_name = excluded.display_name,
      sort_order = excluded.sort_order;
