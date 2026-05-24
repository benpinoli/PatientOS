import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task, Patient, AppUser } from "@/lib/db-types";

type SB = SupabaseClient;

// Patient + tasks bundle for the dashboard. RLS does the filtering for us —
// any patient that comes back is one the current user is allowed to see.
export type DashboardRow = Task & {
  patient: Pick<
    Patient,
    "id" | "external_code" | "first_name" | "last_name" | "payer_id" | "created_at"
  > & {
    payer_name?: string;
    next_step_label: string | null;
  };
};

export type DashboardPatientGroup = {
  patient: Pick<
    Patient,
    "id" | "external_code" | "first_name" | "last_name" | "payer_id" | "created_at"
  > & { payer_name?: string };
  openTasks: Task[];
};

export type DashboardBundle = {
  topFive: DashboardRow[];
  allPatients: DashboardPatientGroup[];
};

export async function fetchDashboardTasks(supabase: SB): Promise<DashboardRow[]> {
  // Pull all tasks + their parents in one trip. RLS filters tasks at the row level.
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select(
      `
      *,
      patient:patients!inner (
        id, external_code, first_name, last_name, payer_id, created_at,
        payer:payers ( name )
      )
      `,
    )
    .neq("status", "APPROVED");

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
      created_at: string;
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

  const rows: DashboardRow[] = (allTasks as unknown as RawTask[]).map((t) => ({
    ...t,
    patient: {
      id: t.patient.id,
      external_code: t.patient.external_code,
      first_name: t.patient.first_name,
      last_name: t.patient.last_name,
      payer_id: t.patient.payer_id,
      created_at: t.patient.created_at,
      payer_name: t.patient.payer?.name,
      next_step_label: nextStepByPatient.get(t.patient.id) ?? null,
    },
  }));

  return rows;
}

function sortFifoQueue(rows: DashboardRow[]): DashboardRow[] {
  return [...rows].sort((a, b) => {
    const ca = new Date(a.patient.created_at).getTime();
    const cb = new Date(b.patient.created_at).getTime();
    if (ca !== cb) return ca - cb;
    return a.order_index - b.order_index;
  });
}

export async function fetchDashboardBundle(supabase: SB): Promise<DashboardBundle> {
  const rows = sortFifoQueue(await fetchDashboardTasks(supabase));
  const topFive = rows.slice(0, 5);

  const [{ data: patients }, { data: openTasks }] = await Promise.all([
    supabase
      .from("patients")
      .select(
        `
        id, external_code, first_name, last_name, payer_id, created_at,
        payer:payers ( name )
      `,
      )
      .order("created_at", { ascending: true }),
    supabase.from("tasks").select("*").neq("status", "APPROVED").order("order_index"),
  ]);

  type PatientRow = {
    id: string;
    external_code: string | null;
    first_name: string;
    last_name: string;
    payer_id: string;
    created_at: string;
    payer: { name: string } | null;
  };

  const tasksByPatient = new Map<string, Task[]>();
  for (const t of (openTasks ?? []) as Task[]) {
    const list = tasksByPatient.get(t.patient_id) ?? [];
    list.push(t);
    tasksByPatient.set(t.patient_id, list);
  }

  const allPatients: DashboardPatientGroup[] = (patients ?? []).map((p) => {
    const row = p as unknown as PatientRow;
    return {
      patient: {
        id: row.id,
        external_code: row.external_code,
        first_name: row.first_name,
        last_name: row.last_name,
        payer_id: row.payer_id,
        created_at: row.created_at,
        payer_name: row.payer?.name,
      },
      openTasks: tasksByPatient.get(row.id) ?? [],
    };
  });

  return { topFive, allPatients };
}

export function isPatientAssignedToUser(
  patient: { assigned_rep_id: string | null; assigned_atp_id: string | null },
  userId: string,
) {
  return patient.assigned_rep_id === userId || patient.assigned_atp_id === userId;
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
