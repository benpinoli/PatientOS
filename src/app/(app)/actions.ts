"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/db-types";

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

  // Find the payer to learn its type (which templates to instantiate).
  const { data: payer, error: pErr } = await supabase
    .from("payers")
    .select("id, type")
    .eq("id", payer_id)
    .maybeSingle();
  if (pErr || !payer) throw new Error("payer not found");

  // Insert the patient
  const { data: inserted, error: insErr } = await supabase
    .from("patients")
    .insert({
      first_name,
      last_name,
      external_code,
      referral_source,
      payer_id,
      assigned_rep_id,
      assigned_atp_id,
      status: "ACTIVE",
    })
    .select()
    .single();
  if (insErr || !inserted) throw new Error(insErr?.message ?? "patient insert failed");

  // Pull matching templates and instantiate tasks (snapshotting fields).
  const { data: templates, error: tErr } = await supabase
    .from("task_templates")
    .select("*")
    .eq("payer_type", payer.type)
    .order("default_order");
  if (tErr) throw new Error(tErr.message);

  if (templates && templates.length > 0) {
    const taskRows = templates.map((t) => ({
      patient_id: inserted.id,
      template_id: t.id,
      label: t.label,
      responsible_role: t.responsible_role,
      requires_atp_review: t.requires_atp_review,
      required: t.required,
      order_index: t.default_order,
      status: "NOT_STARTED" as const,
    }));
    const { error: tInsErr } = await supabase.from("tasks").insert(taskRows);
    if (tInsErr) throw new Error(tInsErr.message);
  }

  revalidatePath("/", "layout");
  redirect(`/patients/${inserted.id}`);
}

// =====================================================================
// Admin: user activation / role assignment
// =====================================================================

export async function updateUser(
  userId: string,
  patch: {
    roles?: string[];
    manager_id?: string | null;
    active?: boolean;
    location?: string | null;
    full_name?: string | null;
  },
) {
  const supabase = await getSupabaseServer();
  const { error } = await supabase.from("app_users").update(patch).eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
