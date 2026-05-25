"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ResponsibleRole, TaskStatus, AppUser } from "@/lib/db-types";
import { DEFAULT_DUE_DAYS } from "@/lib/constants";
import { normalizeExternalUrl } from "@/lib/urls";
import {
  canApproveAtpReview,
  canShowMarkDone,
  canShowMarkDoneSigned,
  markDoneNextStatus,
  type PatientAssignment,
} from "@/lib/task-permissions";

export type CreatePatientState = { error: string } | null;

// =====================================================================
// Task mutations
// =====================================================================

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const supabase = await getSupabaseServer();
  const { error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

export async function updateTaskFields(
  taskId: string,
  patch: {
    link?: string | null;
    start_date?: string | null;
    priority?: number | null;
    blocked_reason?: string | null;
  },
) {
  const supabase = await getSupabaseServer();
  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

export type TaskLinkEvent = {
  id: string;
  task_id: string;
  link: string | null;
  via_other_means: boolean;
  posted_by: string | null;
  created_at: string;
};

export async function fetchTaskLinkHistory(taskId: string): Promise<TaskLinkEvent[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from("task_link_events")
    .select("id, task_id, link, via_other_means, posted_by, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskLinkEvent[];
}

async function loadTaskContext(supabase: Awaited<ReturnType<typeof getSupabaseServer>>, taskId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { data: profile } = await supabase
    .from("app_users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) throw new Error("User profile not found.");

  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select("id, patient_id, status, requires_atp_review")
    .eq("id", taskId)
    .maybeSingle();
  if (taskErr || !task) throw new Error("Task not found.");

  const { data: patient, error: pErr } = await supabase
    .from("patients")
    .select("assigned_rep_id, assigned_atp_id")
    .eq("id", task.patient_id)
    .maybeSingle();
  if (pErr || !patient) throw new Error("Patient not found.");

  return {
    userId: user.id,
    profile: profile as AppUser,
    task,
    patient: patient as PatientAssignment,
  };
}

function requireLinkOrOtherMeans(link: string | null, sentOtherMeans: boolean) {
  const trimmed = link?.trim() ?? "";
  if (!sentOtherMeans && !trimmed) {
    throw new Error(
      "Paste a document link or check that the document was already sent.",
    );
  }
  return trimmed;
}

async function recordLinkEvent(
  supabase: Awaited<ReturnType<typeof getSupabaseServer>>,
  taskId: string,
  userId: string,
  link: string,
  viaOtherMeans: boolean,
) {
  const { error: histErr } = await supabase.from("task_link_events").insert({
    task_id: taskId,
    link: link || null,
    via_other_means: viaOtherMeans,
    posted_by: userId,
  });
  if (histErr) throw new Error(histErr.message);
}

/** Rep/ATP mark work done — always requires link or “already sent”. */
export async function submitMarkDone(
  taskId: string,
  opts: {
    link: string | null;
    sentOtherMeans: boolean;
  },
) {
  const supabase = await getSupabaseServer();
  const { userId, profile, task, patient } = await loadTaskContext(supabase, taskId);

  if (!canShowMarkDone(profile, patient, task)) {
    throw new Error("You cannot mark this task done.");
  }

  const trimmed = requireLinkOrOtherMeans(opts.link, opts.sentOtherMeans);
  const normalized = normalizeExternalUrl(trimmed);
  const nextStatus: TaskStatus = markDoneNextStatus(task, patient);

  const patch: { status: TaskStatus; link?: string | null } = { status: nextStatus };
  if (normalized) patch.link = normalized;

  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);

  await recordLinkEvent(
    supabase,
    taskId,
    userId,
    normalized ?? "",
    opts.sentOtherMeans,
  );
  revalidatePath("/", "layout");
}

/** Solo ATP-rep: sign off directly; link optional. */
export async function submitMarkDoneSigned(
  taskId: string,
  opts: { link: string | null },
) {
  const supabase = await getSupabaseServer();
  const { userId, profile, task, patient } = await loadTaskContext(supabase, taskId);

  if (!canShowMarkDoneSigned(profile, patient, task)) {
    throw new Error("You cannot sign off on this task.");
  }

  const normalized = normalizeExternalUrl(opts.link?.trim() ?? "");

  const patch: { status: TaskStatus; link?: string | null } = { status: "APPROVED" };
  if (normalized) patch.link = normalized;

  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);

  if (normalized) {
    await recordLinkEvent(supabase, taskId, userId, normalized, false);
  }
  revalidatePath("/", "layout");
}

/** ATP (or BOSS) approve pending review — requires link or other-means. */
export async function completeTaskApproval(
  taskId: string,
  opts: {
    link: string | null;
    sentOtherMeans: boolean;
  },
) {
  const supabase = await getSupabaseServer();
  const { userId, profile, task, patient } = await loadTaskContext(supabase, taskId);

  if (task.status !== "DONE_PENDING_REVIEW") {
    throw new Error("This task is not awaiting ATP approval.");
  }
  if (!canApproveAtpReview(profile, patient)) {
    throw new Error("Only the assigned ATP may approve this task.");
  }

  const trimmed = requireLinkOrOtherMeans(opts.link, opts.sentOtherMeans);
  const normalized = normalizeExternalUrl(trimmed);

  const patch: { status: TaskStatus; link?: string | null } = { status: "APPROVED" };
  if (normalized) patch.link = normalized;

  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);

  await recordLinkEvent(
    supabase,
    taskId,
    userId,
    normalized ?? "",
    opts.sentOtherMeans,
  );
  revalidatePath("/", "layout");
}

export async function setTaskPriority(taskId: string, priority: number | null) {
  return updateTaskFields(taskId, { priority });
}

// =====================================================================
// New patient — atomic via create_patient_with_tasks() RPC.
// =====================================================================

export async function createPatient(
  _prev: CreatePatientState,
  form: FormData,
): Promise<CreatePatientState> {
  try {
    const supabase = await getSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "You must be signed in to create a patient." };

    const first_name = (form.get("first_name") as string)?.trim();
    const last_name = (form.get("last_name") as string)?.trim();
    const external_code = (form.get("external_code") as string)?.trim() || null;
    const referral_source = (form.get("referral_source") as string)?.trim() || null;
    const payer_id = form.get("payer_id") as string;
    let assigned_rep_id = ((form.get("assigned_rep_id") as string) || "").trim() || null;
    const assigned_atp_id = ((form.get("assigned_atp_id") as string) || "").trim() || null;

    if (!first_name || !last_name || !payer_id) {
      return { error: "First name, last name, and payer are required." };
    }

    if (!assigned_rep_id) assigned_rep_id = user.id;

    const { data: patientId, error } = await supabase.rpc("create_patient_with_tasks", {
      p_first_name: first_name,
      p_last_name: last_name,
      p_external_code: external_code,
      p_referral_source: referral_source,
      p_payer_id: payer_id,
      p_assigned_rep_id: assigned_rep_id,
      p_assigned_atp_id: assigned_atp_id,
      p_default_due_days: DEFAULT_DUE_DAYS,
    });

    if (error) {
      const hint = error.message.includes("create_patient_with_tasks")
        ? " Run migration 0005_harden_user_and_patient_workflows.sql on your database."
        : "";
      return { error: `${error.message}${hint}` };
    }
    if (!patientId) return { error: "Patient creation failed with no error detail." };

    revalidatePath("/", "layout");
    redirect(`/patients/${patientId}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const message = e instanceof Error ? e.message : "Unknown error creating patient.";
    return { error: message };
  }
}

// =====================================================================
// Admin: user activation / role assignment
// =====================================================================

export async function updateUser(
  userId: string,
  patch: {
    roles?: string[];
    manager_id?: string | null;
    supervising_atp_id?: string | null;
    active?: boolean;
    location?: string | null;
    full_name?: string | null;
  },
) {
  const supabase = await getSupabaseServer();
  const { error } = await supabase.rpc("update_app_user", {
    p_user_id: userId,
    p_roles: patch.roles ?? null,
    p_manager_id: patch.manager_id ?? null,
    p_supervising_atp_id: patch.supervising_atp_id ?? null,
    p_active: patch.active ?? null,
    p_location: patch.location ?? null,
    p_full_name: patch.full_name ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

// =====================================================================
// Admin: task template checklist (BOSS / MANAGER only)
// =====================================================================

async function requireTemplateEditor() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { data: profile, error } = await supabase
    .from("app_users")
    .select("roles")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const roles = (profile?.roles ?? []) as string[];
  if (!roles.includes("BOSS") && !roles.includes("MANAGER")) {
    throw new Error("Only managers can edit task templates.");
  }
  return supabase;
}

export async function updateTaskTemplate(
  templateId: string,
  patch: {
    label: string;
    responsible_role: ResponsibleRole;
    requires_atp_review: boolean;
    required: boolean;
    default_order: number;
  },
) {
  const supabase = await requireTemplateEditor();

  const label = patch.label.trim();
  if (!label) throw new Error("Label is required.");

  const order = Math.round(patch.default_order);
  if (!Number.isFinite(order) || order < 1) {
    throw new Error("Order must be a positive number.");
  }

  const { error } = await supabase
    .from("task_templates")
    .update({
      label,
      responsible_role: patch.responsible_role,
      requires_atp_review: patch.requires_atp_review,
      required: patch.required,
      default_order: order,
    })
    .eq("id", templateId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
