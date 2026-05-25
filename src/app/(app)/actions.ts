"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/db-types";
import { DEFAULT_DUE_DAYS } from "@/lib/constants";

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

/** Approve with link (or other-means). Records history; due dates are not editable. */
export async function completeTaskApproval(
  taskId: string,
  opts: {
    link: string | null;
    sentOtherMeans: boolean;
    requiresAtpReview: boolean;
  },
) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const trimmed = opts.link?.trim() ?? "";
  if (!opts.sentOtherMeans && !trimmed) {
    throw new Error("Paste a document link or check “Sent link through other means”.");
  }

  const patch: { status: TaskStatus; link?: string | null } = { status: "APPROVED" };
  if (trimmed) patch.link = trimmed;

  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);

  const { error: histErr } = await supabase.from("task_link_events").insert({
    task_id: taskId,
    link: trimmed || null,
    via_other_means: opts.sentOtherMeans,
    posted_by: user.id,
  });
  if (histErr) throw new Error(histErr.message);

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
