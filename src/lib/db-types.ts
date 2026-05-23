// Hand-written row shapes for v1. Once the project is linked you can replace
// this file with `supabase gen types typescript --linked > src/lib/db-types.ts`.

export type Role = "ATP" | "REP" | "MANAGER" | "BOSS";
export type PayerType = "MEDICARE" | "MEDICAID" | "COMMERCIAL";
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
