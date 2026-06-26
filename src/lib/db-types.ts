// Hand-written row shapes for v1. Once the project is linked you can replace
// this file with `supabase gen types typescript --linked > src/lib/db-types.ts`.

import type { JsonTemplateDefinition } from "@/lib/paperwork/template-def";

export type Role = "ATP" | "REP" | "MANAGER" | "BOSS";
/** Payer workflow code — see `payer_types` table (e.g. MEDICARE, MEDICAID, COMMERCIAL). */
export type PayerType = string;
export type PayerTypeRecord = {
  code: string;
  display_name: string;
  sort_order: number;
  created_at?: string;
};
export type PatientStatus =
  | "ACTIVE"
  | "SUBMITTED"
  | "APPROVED"
  | "DENIED"
  | "DELIVERED"
  | "CLOSED";
export type TaskStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "AWAITING_SIGNATURE"
  | "DONE_PENDING_REVIEW"
  | "APPROVED"
  | "BLOCKED";
export type ResponsibleRole = "DOCTOR" | "PT" | "ATP" | "REP" | "FRONT_DESK";

export type AppUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  roles: Role[];
  location: string | null;
  manager_id: string | null;
  /** Default ATP supervisor for non-ATP reps. Null for ATP-credentialed users. */
  supervising_atp_id: string | null;
  active: boolean;
  created_at: string;
};

export type Payer = {
  id: string;
  name: string;
  type: PayerType;
};

export type Patient = {
  id: string;
  birth_date: string | null;
  first_name: string;
  last_name: string;
  payer_id: string;
  referral_source: string | null;
  assigned_rep_id: string | null;
  assigned_atp_id: string | null;
  status: PatientStatus;
  /** Link to the patient's shared Drive folder (same links used in the tracker). */
  drive_folder_url: string | null;
  created_at: string;
};

export type TaskTemplate = {
  id: string;
  payer_type: PayerType;
  label: string;
  responsible_role: ResponsibleRole;
  requires_atp_review: boolean;
  required: boolean;
  default_order: number;
};

export type Task = {
  id: string;
  patient_id: string;
  template_id: string | null;
  label: string;
  responsible_role: ResponsibleRole;
  requires_atp_review: boolean;
  required: boolean;
  order_index: number;
  status: TaskStatus;
  link: string | null;
  start_date: string | null;
  due_date: string | null;
  priority: number | null;
  completed_by: string | null;
  completed_at: string | null;
  blocked_reason: string | null;
  /** Bounce / snooze: while > now(), task is hidden from Top 5 dashboard. */
  snoozed_until: string | null;
  created_at: string;
};

/** Append-only per-task note. Visible to anyone who can see the task. Never edited/deleted. */
export type TaskNote = {
  id: string;
  task_id: string;
  body: string;
  author_id: string | null;
  created_at: string;
};

export type NotificationType =
  | "TASK_STARTED"
  | "TASK_LINK_ADDED"
  | "TASK_SENT_FOR_SIGNATURE"
  | "TASK_SUBMITTED_FOR_REVIEW"
  | "TASK_APPROVED"
  | "TASK_NOTE_ADDED";

/** In-app notification. Stores IDs only; patient name is joined at render time under RLS. */
export type Notification = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  task_id: string | null;
  patient_id: string;
  type: NotificationType;
  task_label: string | null;
  read_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Paperwork AI extension
// ---------------------------------------------------------------------------

/** Structured patient JSON — canonical shape in `src/lib/paperwork/schema.ts`. */
export type PaperworkPatientData = Record<string, unknown>;

/** One structured JSON record per patient. */
export type PaperworkPatientDataRow = {
  patient_id: string;
  data: PaperworkPatientData;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** A single field requirement extracted from a template (companion JSON entry). */
export type TemplateRequiredField = {
  /** Human label as it appears on the form. */
  label: string;
  /** Dotted path into the canonical patient JSON, when it maps cleanly. */
  json_path?: string | null;
  required?: boolean;
};

/** Shared, reusable PDF template converted to editable HTML. */
export type PaperworkTemplate = {
  id: string;
  name: string;
  source_path: string | null;
  source_mime: string | null;
  html: string;
  required_fields: TemplateRequiredField[];
  /** Branding logo (data URI) embedded into this template, if any. */
  logo_data_uri: string | null;
  /** Company/organization name rendered next to the logo, if any. */
  logo_company_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** A reusable branding logo (stored as a data URI) for the template library. */
export type PaperworkLogo = {
  id: string;
  name: string;
  data_uri: string;
  /** Optional company/organization name shown next to the logo on forms. */
  company_name: string | null;
  created_by: string | null;
  created_at: string;
};

export type PaperworkDocumentStatus = "DRAFT" | "FINAL";

/** Per patient+template filled output (editable HTML). */
export type PaperworkDocument = {
  id: string;
  patient_id: string;
  template_id: string | null;
  template_name: string | null;
  filled_html: string;
  status: PaperworkDocumentStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Metadata for an uploaded patient source document (bytes live in Storage). */
export type PaperworkSourceFile = {
  id: string;
  patient_id: string;
  storage_path: string;
  filename: string;
  mime: string | null;
  uploaded_by: string | null;
  created_at: string;
};

/** Editable JSON field-structure template for a patient (payer) type. */
export type PaperworkJsonTemplate = {
  id: string;
  payer_type: string;
  name: string;
  is_default: boolean;
  definition: JsonTemplateDefinition;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PaperworkJobKind = "extract" | "template" | "fill";
export type PaperworkJobStatus = "PENDING" | "RUNNING" | "DONE" | "ERROR";

/** Async AI job processed off-Amplify by the EC2 worker (see 0019 migration). */
export type PaperworkJob = {
  id: string;
  kind: PaperworkJobKind;
  status: PaperworkJobStatus;
  patient_id: string | null;
  template_id: string | null;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

// Minimal `Database` shape so the supabase-js generics know our tables.
export type Database = {
  public: {
    Tables: {
      app_users: { Row: AppUser; Insert: Partial<AppUser> & { id: string }; Update: Partial<AppUser> };
      payers:    { Row: Payer; Insert: Partial<Payer>; Update: Partial<Payer> };
      patients:  { Row: Patient; Insert: Partial<Patient>; Update: Partial<Patient> };
      task_templates: { Row: TaskTemplate; Insert: Partial<TaskTemplate>; Update: Partial<TaskTemplate> };
      tasks:     { Row: Task; Insert: Partial<Task>; Update: Partial<Task> };
      payer_types: { Row: PayerTypeRecord; Insert: Partial<PayerTypeRecord> & { code: string }; Update: Partial<PayerTypeRecord> };
      task_notes: { Row: TaskNote; Insert: Partial<TaskNote> & { task_id: string; body: string }; Update: Partial<TaskNote> };
      notifications: { Row: Notification; Insert: Partial<Notification> & { recipient_id: string; patient_id: string; type: NotificationType }; Update: Partial<Notification> };
      paperwork_patient_data: { Row: PaperworkPatientDataRow; Insert: Partial<PaperworkPatientDataRow> & { patient_id: string }; Update: Partial<PaperworkPatientDataRow> };
      paperwork_templates: { Row: PaperworkTemplate; Insert: Partial<PaperworkTemplate> & { name: string }; Update: Partial<PaperworkTemplate> };
      paperwork_logos: { Row: PaperworkLogo; Insert: Partial<PaperworkLogo> & { name: string; data_uri: string }; Update: Partial<PaperworkLogo> };
      paperwork_json_templates: { Row: PaperworkJsonTemplate; Insert: Partial<PaperworkJsonTemplate> & { payer_type: string; name: string }; Update: Partial<PaperworkJsonTemplate> };
      paperwork_documents: { Row: PaperworkDocument; Insert: Partial<PaperworkDocument> & { patient_id: string }; Update: Partial<PaperworkDocument> };
      paperwork_source_files: { Row: PaperworkSourceFile; Insert: Partial<PaperworkSourceFile> & { patient_id: string; storage_path: string; filename: string }; Update: Partial<PaperworkSourceFile> };
      paperwork_jobs: { Row: PaperworkJob; Insert: Partial<PaperworkJob> & { kind: PaperworkJobKind }; Update: Partial<PaperworkJob> };
    };
    Views: Record<string, never>;
    Functions: {
      insert_task_notification: {
        Args: {
          p_recipient_id: string;
          p_task_id: string;
          p_patient_id: string;
          p_type: NotificationType;
          p_task_label?: string | null;
        };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
  };
};
