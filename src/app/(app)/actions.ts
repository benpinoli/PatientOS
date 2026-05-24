"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/db-types";
import { DEFAULT_DUE_DAYS } from "@/lib/constants";

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
    due_date?: string | null;
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

export async function setTaskPriority(taskId: string, priority: number | null) {
  return updateTaskFields(taskId, { priority });
}

// =====================================================================
// New patient — instantiates the task list from matching templates.
// =====================================================================

export async function createPatient(form: FormData) {
  const supabase = await getSupabaseServer();

  const first_name = (form.get("first_name") as string)?.trim();
  const last_name = (form.get("last_name") as string)?.trim();
  const external_code = (form.get("external_code") as string)?.trim() || null;
  const referral_source = (form.get("referral_source") as string)?.trim() || null;
  const payer_id = form.get("payer_id") as string;
  const assigned_rep_id = (form.get("assigned_rep_id") as string) || null;
  const assigned_atp_id = (form.get("assigned_atp_id") as string) || null;

  if (!first_name || !last_name || !payer_id) {
    throw new Error("first_name, last_name, and payer_id are required");
  }

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
  if (error || !patientId) throw new Error(error?.message ?? "patient creation failed");

  revalidatePath("/", "layout");
  redirect(`/patients/${patientId}`);
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
