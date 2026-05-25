import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task, Patient, AppUser, PayerType } from "@/lib/db-types";
import {
  canApproveAtpReview,
  canShowApproveButton,
  isAtpBlockedUntilRepStarts,
  isRepAwaitingAtpReview,
  isSoloAtpRep,
  type PatientAssignment,
} from "@/lib/task-permissions";

type SB = SupabaseClient;

const EXTERNAL_WAITING_ROLES = new Set(["DOCTOR", "PT", "FRONT_DESK"]);

const QUEUE_WEIGHTS = {
  overduePerDay: 100,
  blocked: 80,
  externalPartyWaiting: 50,
  pendingAtpReviewForApprover: 200,
  pendingAtpReview: 45,
  nearSubmission: 35,
  patientNextStep: 30,
  manualPriorityBase: 70,
  manualPriorityStep: 5,
  workflowOrderPenalty: 0.25,
};

// Patient + tasks bundle for the dashboard. RLS does the filtering for us —
// any patient that comes back is one the current user is allowed to see.
export type DashboardRow = Task & {
  patient: Pick<
    Patient,
    | "id"
    | "external_code"
    | "first_name"
    | "last_name"
    | "payer_id"
    | "created_at"
    | "assigned_rep_id"
    | "assigned_atp_id"
  > & {
    payer_name?: string;
    next_step_label: string | null;
  };
};

export type DashboardPatientGroup = {
  patient: Pick<
    Patient,
    "id" | "external_code" | "first_name" | "last_name" | "payer_id" | "created_at"
  > & { payer_name?: string; payer_type?: PayerType };
  /** All tasks for matrix view (includes approved). */
  tasks: Task[];
};

export type DashboardBundle = {
  topFive: DashboardRow[];
  pendingAtpReview: DashboardRow[];
  allPatients: DashboardPatientGroup[];
};

type RawDashboardTask = Task & {
  patient: {
    id: string;
    external_code: string | null;
    first_name: string;
    last_name: string;
    payer_id: string;
    created_at: string;
    assigned_rep_id: string | null;
    assigned_atp_id: string | null;
    payer: { name: string } | null;
  };
};

type PatientQueueContext = {
  nextStepId: string | null;
  nextStepLabel: string | null;
  requiredCount: number;
  approvedRequiredCount: number;
};

async function fetchAllDashboardTaskRows(supabase: SB): Promise<RawDashboardTask[]> {
  const { data: tasks, error } = await supabase.from("tasks").select(
    `
    *,
    patient:patients!inner (
      id, external_code, first_name, last_name, payer_id, created_at,
      assigned_rep_id, assigned_atp_id,
      payer:payers ( name )
    )
    `,
  );

  if (error) throw error;
  return (tasks ?? []) as unknown as RawDashboardTask[];
}

export async function fetchDashboardTasks(supabase: SB): Promise<DashboardRow[]> {
  const allTasks = await fetchAllDashboardTaskRows(supabase);
  const contextByPatient = buildPatientQueueContext(allTasks);

  const rows: DashboardRow[] = allTasks
    .filter((t) => t.status !== "APPROVED")
    .map((t) => {
      const context = contextByPatient.get(t.patient.id);
      return {
        ...t,
        patient: {
          id: t.patient.id,
          external_code: t.patient.external_code,
          first_name: t.patient.first_name,
          last_name: t.patient.last_name,
          payer_id: t.patient.payer_id,
          created_at: t.patient.created_at,
          assigned_rep_id: t.patient.assigned_rep_id,
          assigned_atp_id: t.patient.assigned_atp_id,
          payer_name: t.patient.payer?.name,
          next_step_label: context?.nextStepLabel ?? null,
        },
      };
    });

  return rows;
}

function sortIntelligentQueue<T extends Task>(
  rows: T[],
  contextByPatient: Map<string, PatientQueueContext>,
  profile?: AppUser,
): T[] {
  return [...rows].sort((a, b) => {
    const contextA = contextByPatient.get(a.patient_id);
    const contextB = contextByPatient.get(b.patient_id);
    const scoreA = scoreDashboardTask(a, contextA, profile);
    const scoreB = scoreDashboardTask(b, contextB, profile);
    if (scoreA !== scoreB) return scoreB - scoreA;

    const da = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
    const db = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;

    return a.order_index - b.order_index;
  });
}

function patientAssignment(row: DashboardRow): PatientAssignment {
  return {
    assigned_rep_id: row.patient.assigned_rep_id,
    assigned_atp_id: row.patient.assigned_atp_id,
  };
}

/** Top 5 = work the user can do now; pending review is a separate bucket for reps. */
function isActionableInTopFive(row: DashboardRow, profile: AppUser) {
  const patient = patientAssignment(row);

  if (isRepAwaitingAtpReview(profile, patient, row)) {
    return false;
  }

  if (isAtpBlockedUntilRepStarts(profile, patient, row)) {
    return false;
  }

  return true;
}

function partitionDashboardRows(rows: DashboardRow[], profile: AppUser) {
  const contextByPatient = buildPatientQueueContext(
    rows as unknown as RawDashboardTask[],
  );

  const pendingAtpReview = sortIntelligentQueue(
    rows.filter((r) => isRepAwaitingAtpReview(profile, patientAssignment(r), r)),
    contextByPatient,
    profile,
  );

  const actionable = rows.filter((r) => isActionableInTopFive(r, profile));
  const topFive = sortIntelligentQueue(actionable, contextByPatient, profile).slice(
    0,
    5,
  );

  return { topFive, pendingAtpReview };
}

export async function fetchDashboardBundle(
  supabase: SB,
  profile: AppUser,
): Promise<DashboardBundle> {
  const allTaskRows = await fetchAllDashboardTaskRows(supabase);
  const contextByPatient = buildPatientQueueContext(allTaskRows);

  const rows: DashboardRow[] = allTaskRows
    .filter((t) => t.status !== "APPROVED")
    .map((t) => {
      const context = contextByPatient.get(t.patient.id);
      return {
        ...t,
        patient: {
          id: t.patient.id,
          external_code: t.patient.external_code,
          first_name: t.patient.first_name,
          last_name: t.patient.last_name,
          payer_id: t.patient.payer_id,
          created_at: t.patient.created_at,
          assigned_rep_id: t.patient.assigned_rep_id,
          assigned_atp_id: t.patient.assigned_atp_id,
          payer_name: t.patient.payer?.name,
          next_step_label: context?.nextStepLabel ?? null,
        },
      };
    });

  const { topFive, pendingAtpReview } = partitionDashboardRows(rows, profile);

  const { data: patients, error } = await supabase
    .from("patients")
    .select(
      `
        id, external_code, first_name, last_name, payer_id, created_at,
        assigned_rep_id, assigned_atp_id,
        payer:payers ( name, type )
      `,
    )
    .order("created_at", { ascending: true });

  if (error) throw error;

  type PatientRow = {
    id: string;
    external_code: string | null;
    first_name: string;
    last_name: string;
    payer_id: string;
    created_at: string;
    payer: { name: string; type: PayerType } | null;
  };

  const tasksByPatient = new Map<string, Task[]>();
  for (const t of allTaskRows) {
    const list = tasksByPatient.get(t.patient_id) ?? [];
    list.push(t);
    tasksByPatient.set(t.patient_id, list);
  }
  for (const list of tasksByPatient.values()) {
    list.sort((a, b) => a.order_index - b.order_index);
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
        payer_type: row.payer?.type,
      },
      tasks: tasksByPatient.get(row.id) ?? [],
    };
  });

  return { topFive, pendingAtpReview, allPatients };
}

export { isUserInvolvedOnPatient as isPatientAssignedToUser } from "@/lib/task-permissions";

function buildPatientQueueContext(tasks: RawDashboardTask[]) {
  const contextByPatient = new Map<string, PatientQueueContext>();
  const requiredTasksByPatient = new Map<string, RawDashboardTask[]>();

  for (const task of tasks) {
    if (!task.required) continue;
    const existing = requiredTasksByPatient.get(task.patient_id) ?? [];
    existing.push(task);
    requiredTasksByPatient.set(task.patient_id, existing);
  }

  for (const [patientId, requiredTasks] of requiredTasksByPatient) {
    const ordered = [...requiredTasks].sort((a, b) => a.order_index - b.order_index);
    const nextStep = ordered.find((task) => task.status !== "APPROVED") ?? null;
    contextByPatient.set(patientId, {
      nextStepId: nextStep?.id ?? null,
      nextStepLabel: nextStep?.label ?? null,
      requiredCount: ordered.length,
      approvedRequiredCount: ordered.filter((task) => task.status === "APPROVED").length,
    });
  }

  return contextByPatient;
}

function scoreDashboardTask(
  task: Task,
  context?: PatientQueueContext,
  profile?: AppUser,
) {
  let score = 0;
  const patientCtx = profile
    ? ({
        assigned_rep_id: (task as DashboardRow).patient?.assigned_rep_id ?? null,
        assigned_atp_id: (task as DashboardRow).patient?.assigned_atp_id ?? null,
      } as PatientAssignment)
    : null;

  const overdueDays = daysOverdue(task.due_date);
  if (overdueDays > 0) {
    score += overdueDays * QUEUE_WEIGHTS.overduePerDay;
  }

  if (task.status === "BLOCKED") {
    score += QUEUE_WEIGHTS.blocked;
  }

  if (EXTERNAL_WAITING_ROLES.has(task.responsible_role)) {
    score += QUEUE_WEIGHTS.externalPartyWaiting;
  }

  if (task.status === "DONE_PENDING_REVIEW") {
    if (
      profile &&
      patientCtx &&
      canShowApproveButton(profile, patientCtx, task)
    ) {
      score += QUEUE_WEIGHTS.pendingAtpReviewForApprover;
    } else {
      score += QUEUE_WEIGHTS.pendingAtpReview;
    }
  }

  if (context && context.requiredCount > 0) {
    const completionRatio = context.approvedRequiredCount / context.requiredCount;
    if (completionRatio >= 0.7) {
      score += QUEUE_WEIGHTS.nearSubmission;
    }
    if (context.nextStepId === task.id) {
      score += QUEUE_WEIGHTS.patientNextStep;
    }
  }

  if (profile && patientCtx) {
    if (
      task.status === "IN_PROGRESS" &&
      (patientCtx.assigned_rep_id === profile.id ||
        (isSoloAtpRep(patientCtx) && patientCtx.assigned_rep_id === profile.id))
    ) {
      score += QUEUE_WEIGHTS.patientNextStep;
    }
    if (
      canApproveAtpReview(profile, patientCtx) &&
      patientCtx.assigned_atp_id === profile.id &&
      !isSoloAtpRep(patientCtx) &&
      task.status === "DONE_PENDING_REVIEW"
    ) {
      score += QUEUE_WEIGHTS.pendingAtpReviewForApprover;
    }
  }

  if (task.priority != null) {
    score += Math.max(
      QUEUE_WEIGHTS.manualPriorityBase - task.priority * QUEUE_WEIGHTS.manualPriorityStep,
      1,
    );
  }

  score -= task.order_index * QUEUE_WEIGHTS.workflowOrderPenalty;
  return score;
}

function daysOverdue(dueDate: string | null) {
  if (!dueDate) return 0;
  const due = new Date(dueDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
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
