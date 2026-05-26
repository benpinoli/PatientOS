// Hand-written row shapes for v1. Once the project is linked you can replace
// this file with `supabase gen types typescript --linked > src/lib/db-types.ts`.

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
  external_code: string | null;
  first_name: string;
  last_name: string;
  payer_id: string;
  referral_source: string | null;
  assigned_rep_id: string | null;
  assigned_atp_id: string | null;
  status: PatientStatus;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
