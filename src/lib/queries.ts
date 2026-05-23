import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task, Patient, AppUser } from "@/lib/db-types";

type SB = SupabaseClient;

// Patient + tasks bundle for the dashboard. RLS does the filtering for us —
// any patient that comes back is one the current user is allowed to see.
export type DashboardRow = Task & {
  patient: Pick<Patient, "id" | "external_code" | "first_name" | "last_name" | "payer_id"> & {
    payer_name?: string;
    next_step_label: string | null;
  };
};

export async function fetchDashboardTasks(supabase: SB): Promise<DashboardRow[]> {
  // Pull all tasks + their parents in one trip. RLS filters tasks at the row level.
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select(
      `
      *,
      patient:patients!inner (
        id, external_code, first_name, last_name, payer_id,
        payer:payers ( name )
      )
      `,
    )
    .neq("status", "APPROVED")
    .order("priority", { ascending: true, nullsFirst: false });

  if (error) throw error;

  // Compute next step per patient (lowest order_index where status != APPROVED).
  // We have all visible tasks in hand, so do it in-process.
  const allTasks = tasks ?? [];

  type RawTask = Task & {
    patient: {
      id: string;
      external_code: string | null;
      first_name: string;
      last_name: string;
      payer_id: string;
      payer: { name: string } | null;
    };
  };

  const nextStepByPatient = new Map<string, string>();
  for (const t of allTasks as unknown as RawTask[]) {
    if (!t.required) continue;
    if (t.status === "APPROVED") continue;
    const cur = nextStepByPatient.get(t.patient_id);
    if (cur === undefined) {
      nextStepByPatient.set(t.patient_id, t.label);
    }
    // We rely on the patient-level ordering done separately below.
  }

  // Build dashboard rows + sort by priority asc (nulls last), then due_date
  // asc (nulls last; overdue floats to top by being a past date), then order_index.
  const rows: DashboardRow[] = (allTasks as unknown as RawTask[]).map((t) => ({
    ...t,
    patient: {
      id: t.patient.id,
      external_code: t.patient.external_code,
      first_name: t.patient.first_name,
      last_name: t.patient.last_name,
      payer_id: t.patient.payer_id,
      payer_name: t.patient.payer?.name,
      next_step_label: nextStepByPatient.get(t.patient.id) ?? null,
    },
  }));

  rows.sort((a, b) => {
    const pa = a.priority ?? Number.POSITIVE_INFINITY;
    const pb = b.priority ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    const da = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
    const db = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.order_index - b.order_index;
  });

  return rows;
}

export async function fetchPatientWithTasks(supabase: SB, patientId: string) {
  const [{ data: patient }, { data: tasks }, { data: payers }, { data: users }] =
    await Promise.all([
      supabase.from("patients").select("*").eq("id", patientId).maybeSingle(),
      supabase.from("tasks").select("*").eq("patient_id", patientId).order("order_index"),
      supabase.from("payers").select("*"),
      supabase.from("app_users").select("*"),
    ]);
  return {
    patient: patient as Patient | null,
    tasks: (tasks ?? []) as Task[],
    payers: payers ?? [],
    users: (users ?? []) as AppUser[],
  };
}

export function computeNextStep(tasks: Task[]) {
  const required = tasks
    .filter((t) => t.required && t.status !== "APPROVED")
    .sort((a, b) => a.order_index - b.order_index);
  return required[0] ?? null;
}
