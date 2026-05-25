-- Every task requires ATP review by default (tune per-template later).

set search_path = public;

alter table public.task_templates
  alter column requires_atp_review set default true;

alter table public.tasks
  alter column requires_atp_review set default true;

update public.task_templates
   set requires_atp_review = true
 where requires_atp_review = false;

update public.tasks
   set requires_atp_review = true
 where requires_atp_review = false;
