-- ============================================================
-- Synthetic seed data for the Choice Healthcare tracker.
--
-- This file is for LOCAL DEV / DEMO ONLY on the Supabase free tier.
-- It uses entirely made-up patients. Never load this in production.
--
-- It does the following:
--   1. Creates 5 demo auth users with email/password (handy for local dev).
--      Passwords are all `password123`.
--   2. The on_auth_user_created trigger seeds matching app_users rows
--      (defaulted to REP, inactive). We then UPDATE them with the right
--      roles, manager hierarchy, and active=true.
--   3. Seeds payers + the Medicaid Group 3 task template list (§6).
--   4. Seeds 6 fake patients with tasks instantiated in varied states.
-- ============================================================

set search_path = public, extensions;

-- ------------------------------------------------------------
-- 1. Auth users (LOCAL DEV ONLY — password auth)
-- ------------------------------------------------------------
-- Fixed UUIDs so we can wire foreign keys deterministically below.
-- These map to:
--   00000000-0000-0000-0000-000000000001  DeAnne (BOSS)
--   00000000-0000-0000-0000-000000000002  Matt   (MANAGER, ATP)
--   00000000-0000-0000-0000-000000000003  Steve  (ATP)
--   00000000-0000-0000-0000-000000000004  Tara   (REP)
--   00000000-0000-0000-0000-000000000005  Jack   (REP)

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'deanne@choice.example',
    crypt('password123', gen_salt('bf')),
    now(),
    jsonb_build_object('provider','email','providers',array['email']),
    jsonb_build_object('full_name','DeAnne Choice'),
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'matt@choice.example',
    crypt('password123', gen_salt('bf')),
    now(),
    jsonb_build_object('provider','email','providers',array['email']),
    jsonb_build_object('full_name','Matt Manager'),
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'steve@choice.example',
    crypt('password123', gen_salt('bf')),
    now(),
    jsonb_build_object('provider','email','providers',array['email']),
    jsonb_build_object('full_name','Steve ATP'),
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'tara@choice.example',
    crypt('password123', gen_salt('bf')),
    now(),
    jsonb_build_object('provider','email','providers',array['email']),
    jsonb_build_object('full_name','Tara Rep'),
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'jack@choice.example',
    crypt('password123', gen_salt('bf')),
    now(),
    jsonb_build_object('provider','email','providers',array['email']),
    jsonb_build_object('full_name','Jack Rep'),
    now(), now(), '', '', '', ''
  )
on conflict (id) do nothing;

-- Identity rows for the email provider so password sign-in works
insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  u.id::text,
  now(), now(), now()
from auth.users u
where u.id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
)
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Promote app_users rows the trigger just made
-- ------------------------------------------------------------
update public.app_users set
  full_name = 'DeAnne Choice',
  roles = array['BOSS'],
  location = 'HQ',
  active = true
where id = '00000000-0000-0000-0000-000000000001';

update public.app_users set
  full_name = 'Matt Manager',
  roles = array['MANAGER','ATP'],
  location = 'Las Vegas',
  active = true
where id = '00000000-0000-0000-0000-000000000002';

update public.app_users set
  full_name = 'Steve ATP',
  roles = array['ATP'],
  location = 'Las Vegas',
  manager_id = '00000000-0000-0000-0000-000000000002',
  active = true
where id = '00000000-0000-0000-0000-000000000003';

update public.app_users set
  full_name = 'Tara Rep',
  roles = array['REP'],
  location = 'Reno',
  manager_id = '00000000-0000-0000-0000-000000000002',
  -- Tara is a pure REP, so she needs an ATP supervisor. Steve.
  supervising_atp_id = '00000000-0000-0000-0000-000000000003',
  active = true
where id = '00000000-0000-0000-0000-000000000004';

update public.app_users set
  full_name = 'Jack Rep',
  roles = array['REP'],
  location = 'Las Vegas',
  manager_id = '00000000-0000-0000-0000-000000000002',
  -- Jack is a pure REP, supervised by Matt (MANAGER+ATP) — demos the
  -- pattern where a manager is also someone's ATP signatory.
  supervising_atp_id = '00000000-0000-0000-0000-000000000002',
  active = true
where id = '00000000-0000-0000-0000-000000000005';

-- ------------------------------------------------------------
-- 3. Payers
-- ------------------------------------------------------------
insert into public.payers (id, name, type) values
  ('10000000-0000-0000-0000-000000000001', 'Medicare',         'MEDICARE'),
  ('10000000-0000-0000-0000-000000000002', 'Nevada Medicaid',  'MEDICAID'),
  ('10000000-0000-0000-0000-000000000003', 'Anthem BCBS',      'COMMERCIAL')
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 4. Task templates — Medicaid Group 3 strawman (§6)
-- ------------------------------------------------------------
insert into public.task_templates
  (payer_type, label, responsible_role, requires_atp_review, required, default_order)
values
  ('MEDICAID', 'Insurance eligibility / benefits verification',         'REP',    false, true, 1),
  ('MEDICAID', 'Patient demographic / face sheet (dx codes)',           'REP',    false, true, 2),
  ('MEDICAID', 'Medicaid mobility assessment / prior-auth form',        'REP',    false, true, 3),
  ('MEDICAID', 'Physician face-to-face mobility exam note',             'DOCTOR', true,  true, 4),
  ('MEDICAID', 'Physician written order / prescription',                'DOCTOR', true,  true, 5),
  ('MEDICAID', 'PT mobility evaluation (signed)',                       'PT',     true,  true, 6),
  ('MEDICAID', 'ATP specialty evaluation / assessment',                 'ATP',    false, true, 7),
  ('MEDICAID', 'Home / accessibility assessment',                       'REP',    false, true, 8),
  ('MEDICAID', 'Manufacturer quote w/ HCPCS codes',                     'ATP',    true,  true, 9),
  ('MEDICAID', 'Line-item justification (LIJ)',                         'ATP',    true,  true, 10),
  ('MEDICAID', 'Detailed product description (DPD)',                    'ATP',    true,  true, 11),
  ('MEDICAID', 'Supporting chart notes / medical records',              'DOCTOR', false, true, 12),
  ('MEDICAID', 'Final packet QA (dates align, all signatures present)', 'ATP',    true,  true, 13),
  ('MEDICAID', 'Submission to payer',                                   'REP',    false, true, 14);

-- Stub templates for Medicare + Commercial so new-patient flows don't break
insert into public.task_templates
  (payer_type, label, responsible_role, requires_atp_review, required, default_order)
values
  ('MEDICARE',   'Insurance eligibility / benefits verification', 'REP',    false, true, 1),
  ('MEDICARE',   'Face-to-face evaluation note',                  'DOCTOR', true,  true, 2),
  ('MEDICARE',   'Written order prior to delivery (WOPD)',        'DOCTOR', true,  true, 3),
  ('MEDICARE',   'ATP specialty evaluation',                      'ATP',    false, true, 4),
  ('MEDICARE',   'Submission to payer',                           'REP',    false, true, 5),

  ('COMMERCIAL', 'Insurance eligibility / benefits verification', 'REP',    false, true, 1),
  ('COMMERCIAL', 'Prior authorization form',                      'REP',    false, true, 2),
  ('COMMERCIAL', 'Physician documentation',                       'DOCTOR', true,  true, 3),
  ('COMMERCIAL', 'ATP evaluation',                                'ATP',    false, true, 4),
  ('COMMERCIAL', 'Submission to payer',                           'REP',    false, true, 5);

-- ------------------------------------------------------------
-- 5. Patients
-- ------------------------------------------------------------
-- IDs: 2x000000... = patients
insert into public.patients
  (id, external_code, first_name, last_name, payer_id, referral_source,
   assigned_rep_id, assigned_atp_id, status)
values
  ('20000000-0000-0000-0000-000000000001', 'P-0001', 'Alice',  'Anderson',
    '10000000-0000-0000-0000-000000000002', 'Dr. Smith clinic',
    '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'ACTIVE'),
  ('20000000-0000-0000-0000-000000000002', 'P-0002', 'Bob',    'Baker',
    '10000000-0000-0000-0000-000000000002', 'Hospital referral',
    '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'ACTIVE'),
  ('20000000-0000-0000-0000-000000000003', 'P-0003', 'Carol',  'Carter',
    '10000000-0000-0000-0000-000000000001', 'Self-referred',
    '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'ACTIVE'),
  ('20000000-0000-0000-0000-000000000004', 'P-0004', 'David',  'Diaz',
    '10000000-0000-0000-0000-000000000003', 'PT clinic',
    '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'ACTIVE'),
  ('20000000-0000-0000-0000-000000000005', 'P-0005', 'Erin',   'Edwards',
    '10000000-0000-0000-0000-000000000002', 'Word of mouth',
    '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'APPROVED'),
  ('20000000-0000-0000-0000-000000000006', 'P-0006', 'Frank',  'Foster',
    '10000000-0000-0000-0000-000000000002', 'Hospital referral',
    '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003', 'ACTIVE'),
  -- Matt-as-rep patients. Managers at Choice carry their own caseload too;
  -- their dashboard isn't primarily a rollup of other people's work.
  -- P-0007 is a SOLO CASE (Matt is both rep and ATP) — common pattern.
  ('20000000-0000-0000-0000-000000000007', 'P-0007', 'Grace',  'Greene',
    '10000000-0000-0000-0000-000000000002', 'Returning customer',
    '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'ACTIVE'),
  -- Matt is ATP-credentialed, so he's the ATP on his own patients (solo
  -- case is the default for ATP-credentialed reps; you only assign a
  -- separate ATP when the rep is a pure REP without the credential).
  ('20000000-0000-0000-0000-000000000008', 'P-0008', 'Henry',  'Hernandez',
    '10000000-0000-0000-0000-000000000001', 'Hospital referral',
    '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'ACTIVE'),
  ('20000000-0000-0000-0000-000000000009', 'P-0009', 'Iris',   'Ito',
    '10000000-0000-0000-0000-000000000002', 'PT clinic',
    '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'SUBMITTED')
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 6. Instantiate tasks for each patient from the matching templates,
--    then bump some statuses so the UI shows variety.
-- ------------------------------------------------------------
-- All paperwork is due 14 days after the patient is created. Matches
-- DEFAULT_DUE_DAYS in src/lib/constants.ts. Specific overrides (overdue
-- demo state, priority bumps) are applied further down.
insert into public.tasks
  (patient_id, template_id, label, responsible_role, requires_atp_review,
   required, order_index, status, due_date, created_at)
select
  p.id,
  t.id,
  t.label,
  t.responsible_role,
  t.requires_atp_review,
  t.required,
  t.default_order,
  'NOT_STARTED',
  (p.created_at::date + 14),
  now()
from public.patients p
join public.payers pa on pa.id = p.payer_id
join public.task_templates t on t.payer_type = pa.type;

-- Vary the states so the dashboard looks alive.
--
-- Patient 1 (Alice, Medicaid): first 3 done, #4 needs ATP review pending, due-date overdue on #4.
update public.tasks set status='APPROVED'
  where patient_id='20000000-0000-0000-0000-000000000001' and order_index in (1,2,3);
update public.tasks
   set status='DONE_PENDING_REVIEW',
       due_date = current_date - 2
 where patient_id='20000000-0000-0000-0000-000000000001' and order_index = 4;

-- Patient 2 (Bob, Medicaid): in-progress mid-flow, #6 blocked.
update public.tasks set status='APPROVED'
  where patient_id='20000000-0000-0000-0000-000000000002' and order_index in (1,2);
update public.tasks set status='IN_PROGRESS'
  where patient_id='20000000-0000-0000-0000-000000000002' and order_index in (3,5);
update public.tasks set status='BLOCKED', blocked_reason='Awaiting PT clinic callback'
  where patient_id='20000000-0000-0000-0000-000000000002' and order_index = 6;

-- Patient 3 (Carol, Medicare): early stage.
update public.tasks set status='IN_PROGRESS'
  where patient_id='20000000-0000-0000-0000-000000000003' and order_index = 1;

-- Patient 4 (David, Commercial): mid-flow with a priority bump.
update public.tasks set status='APPROVED'
  where patient_id='20000000-0000-0000-0000-000000000004' and order_index in (1,2);
update public.tasks
   set status='DONE_PENDING_REVIEW', priority = 1, due_date = current_date + 1
 where patient_id='20000000-0000-0000-0000-000000000004' and order_index = 3;

-- Patient 5 (Erin, Medicaid): fully approved.
update public.tasks set status='APPROVED'
  where patient_id='20000000-0000-0000-0000-000000000005';

-- Patient 6 (Frank, Medicaid): not started except QA priority on #7.
update public.tasks set priority = 5, due_date = current_date + 3
  where patient_id='20000000-0000-0000-0000-000000000006' and order_index = 7;

-- Patient 7 (Grace, Medicaid): Matt's solo case — he's both rep and ATP.
-- Demonstrates the solo-case carve-out: requires_atp_review tasks can be
-- auto-approved by the rep-who-is-also-ATP (Matt here) without the gate.
update public.tasks set status='APPROVED'
  where patient_id='20000000-0000-0000-0000-000000000007' and order_index in (1,2,3,4);
update public.tasks set status='IN_PROGRESS', due_date = current_date + 1
  where patient_id='20000000-0000-0000-0000-000000000007' and order_index = 5;

-- Patient 8 (Henry, Medicare): Matt's solo case, mid-pipeline. Note the
-- DONE_PENDING_REVIEW state with priority=2 — Matt-as-ATP can self-approve
-- this since he's the assigned_atp (solo-case carve-out in the gate trigger).
update public.tasks set status='APPROVED'
  where patient_id='20000000-0000-0000-0000-000000000008' and order_index in (1,2);
update public.tasks
   set status='DONE_PENDING_REVIEW', priority = 2
 where patient_id='20000000-0000-0000-0000-000000000008' and order_index = 3;

-- Patient 9 (Iris, Medicaid): Matt's, fully submitted to payer.
update public.tasks set status='APPROVED'
  where patient_id='20000000-0000-0000-0000-000000000009';
