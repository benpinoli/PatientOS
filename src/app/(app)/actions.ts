"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isBuiltInPayerType,
  normalizePayerTypeCode,
} from "@/lib/payer-types";
import type {
  AppUser,
  Database,
  NotificationType,
  PayerType,
  ResponsibleRole,
  TaskStatus,
} from "@/lib/db-types";
import { dueDateAfterBusinessDays, toISODateString } from "@/lib/business-days";
import { DEFAULT_DUE_DAYS } from "@/lib/constants";
import { counterpartyOnCase } from "@/lib/notifications";
import { normalizeExternalUrl } from "@/lib/urls";
import {
  canApproveAtpReview,
  canSaveTaskLink,
  canShowMarkDone,
  canShowMarkDoneSigned,
  canShowSentForSignature,
  markDoneNextStatus,
  type PatientAssignment,
} from "@/lib/task-permissions";

export type CreatePatientState = { error: string } | null;

// =====================================================================
// Task mutations
// =====================================================================

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const supabase = await getSupabaseServer();
  const { userId, task, patient } = await loadTaskContext(supabase, taskId);
  const previousStatus = task.status;

  const { error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", taskId);
  if (error) throw new Error(error.message);

  if (previousStatus === "NOT_STARTED" && status === "IN_PROGRESS") {
    await notifyCounterparty(supabase, {
      actorId: userId,
      patient,
      taskId,
      patientId: task.patient_id,
      type: "TASK_STARTED",
      taskLabel: task.label,
    });
  }

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
    .select("id, patient_id, status, requires_atp_review, responsible_role, link, label")
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

function wrapTaskMutationError(error: { message: string }) {
  const msg = error.message ?? "";
  if (
    msg.includes("tasks_status_check") ||
    msg.includes("AWAITING_SIGNATURE")
  ) {
    throw new Error(
      "The database does not support “Awaiting signature” yet. Run migration 0011_task_awaiting_signature_status.sql on the server, then try again.",
    );
  }
  throw new Error(msg);
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

/**
 * Notify the other assignee on a shared rep+ATP case. Uses the insert_task_notification
 * RPC (migration 0016) so production works without SUPABASE_SERVICE_ROLE_KEY.
 * Falls back to the service-role client when the RPC is not deployed yet.
 */
async function notifyCounterparty(
  supabase: Awaited<ReturnType<typeof getSupabaseServer>>,
  opts: {
    actorId: string;
    patient: PatientAssignment;
    taskId: string;
    patientId: string;
    type: NotificationType;
    taskLabel: string | null;
  },
) {
  const recipientId = counterpartyOnCase(opts.actorId, opts.patient);
  if (!recipientId) return;

  const { error } = await supabase.rpc("insert_task_notification", {
    p_recipient_id: recipientId,
    p_task_id: opts.taskId,
    p_patient_id: opts.patientId,
    p_type: opts.type,
    p_task_label: opts.taskLabel,
  });

  if (!error) return;

  await notifyTaskEventAdminFallback({
    recipientId,
    actorId: opts.actorId,
    taskId: opts.taskId,
    patientId: opts.patientId,
    type: opts.type,
    taskLabel: opts.taskLabel,
  });
}

/** Legacy path: service-role insert when RPC is unavailable (pre-0016). */
async function notifyTaskEventAdminFallback(opts: {
  recipientId: string;
  actorId: string;
  taskId: string;
  patientId: string;
  type: NotificationType;
  taskLabel: string | null;
}) {
  const { recipientId, actorId, taskId, patientId, type, taskLabel } = opts;
  if (!recipientId || recipientId === actorId) return;
  try {
    const admin = getSupabaseAdmin();
    const row: Database["public"]["Tables"]["notifications"]["Insert"] = {
      recipient_id: recipientId,
      actor_id: actorId,
      task_id: taskId,
      patient_id: patientId,
      type,
      task_label: taskLabel,
    };
    const { error } = await admin.from("notifications").insert(row as never);
    if (error) {
      console.error("[notifications] insert failed:", error.message);
    }
  } catch (e) {
    console.error("[notifications] admin client unavailable:", e);
  }
}

/** Save document link; first link on a step starts it (NOT_STARTED → IN_PROGRESS). */
export async function submitTaskLink(taskId: string, link: string | null) {
  const supabase = await getSupabaseServer();
  const { userId, profile, task, patient } = await loadTaskContext(supabase, taskId);

  if (!canSaveTaskLink(profile, patient, task)) {
    throw new Error("You cannot update the link on this task.");
  }

  const trimmed = link?.trim() ?? "";
  if (!trimmed) throw new Error("Enter a document link to save.");

  const normalized = normalizeExternalUrl(trimmed);
  if (!normalized) throw new Error("Enter a valid document link.");

  const today = toISODateString(new Date());
  const patch: {
    link: string;
    status?: TaskStatus;
    start_date?: string;
  } = { link: normalized };

  if (task.status === "NOT_STARTED") {
    patch.status = "IN_PROGRESS";
    patch.start_date = today;
  }

  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);

  await recordLinkEvent(supabase, taskId, userId, normalized, false);

  await notifyCounterparty(supabase, {
    actorId: userId,
    patient,
    taskId,
    patientId: task.patient_id,
    type: "TASK_LINK_ADDED",
    taskLabel: task.label,
  });

  revalidatePath("/", "layout");
}

/** Doctor/PT: sent paperwork out; due in 2 business days for signature return. */
export async function submitSentForSignature(taskId: string) {
  const supabase = await getSupabaseServer();
  const { profile, task, patient } = await loadTaskContext(supabase, taskId);

  if (!canShowSentForSignature(profile, patient, task)) {
    throw new Error("You cannot mark this step as sent for signature.");
  }

  const due = dueDateAfterBusinessDays(2);

  const { error } = await supabase
    .from("tasks")
    .update({
      status: "AWAITING_SIGNATURE",
      due_date: due,
    })
    .eq("id", taskId);

  if (error) wrapTaskMutationError(error);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await notifyCounterparty(supabase, {
      actorId: user.id,
      patient,
      taskId,
      patientId: task.patient_id,
      type: "TASK_SENT_FOR_SIGNATURE",
      taskLabel: task.label,
    });
  }

  revalidatePath("/", "layout");
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

  // Notify the other assignee on shared cases.
  if (nextStatus === "DONE_PENDING_REVIEW") {
    await notifyCounterparty(supabase, {
      actorId: userId,
      patient,
      taskId,
      patientId: task.patient_id,
      type: "TASK_SUBMITTED_FOR_REVIEW",
      taskLabel: task.label,
    });
  } else if (nextStatus === "APPROVED") {
    await notifyCounterparty(supabase, {
      actorId: userId,
      patient,
      taskId,
      patientId: task.patient_id,
      type: "TASK_APPROVED",
      taskLabel: task.label,
    });
  }

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

  await notifyCounterparty(supabase, {
    actorId: userId,
    patient,
    taskId,
    patientId: task.patient_id,
    type: "TASK_APPROVED",
    taskLabel: task.label,
  });

  revalidatePath("/", "layout");
}

export async function setTaskPriority(taskId: string, priority: number | null) {
  return updateTaskFields(taskId, { priority });
}

// NOTE: bounceTask() was removed. Bounce is now per-browser via
// localStorage (src/lib/bounce-store.ts) because migration 0012 has not
// been applied to production yet. Re-introduce a server-backed version
// when 0012 lands and you want cross-device snooze sync.

/**
 * Delete a patient and all of its tasks. Permission gated:
 * BOSS, MANAGER (on a direct report's patient), or the assigned
 * rep/ATP may delete. `confirmLastName` MUST match the patient's
 * actual last_name (case-insensitive trim) — this is the second
 * confirmation step from the UI modal.
 *
 * Task rows cascade via `on delete cascade` on tasks.patient_id.
 */
export async function deletePatient(
  patientId: string,
  confirmLastName: string,
) {
  const supabase = await getSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { data: profile } = await supabase
    .from("app_users")
    .select("id, roles, active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.active) throw new Error("Inactive accounts cannot delete patients.");
  const roles: string[] = profile.roles ?? [];

  const { data: patient, error: pErr } = await supabase
    .from("patients")
    .select("id, last_name, assigned_rep_id, assigned_atp_id")
    .eq("id", patientId)
    .maybeSingle();
  if (pErr || !patient) throw new Error("Patient not found.");

  const isAssignee =
    patient.assigned_rep_id === user.id || patient.assigned_atp_id === user.id;
  const isAdmin = roles.includes("BOSS") || roles.includes("MANAGER");
  if (!isAssignee && !isAdmin) {
    throw new Error("You are not allowed to delete this patient.");
  }

  // Belt-and-suspenders: verify the user typed the right last name.
  const typed = (confirmLastName ?? "").trim().toLowerCase();
  const actual = (patient.last_name ?? "").trim().toLowerCase();
  if (!typed || typed !== actual) {
    throw new Error(`Type the patient's last name (“${patient.last_name}”) to confirm.`);
  }

  const { error: dErr } = await supabase.from("patients").delete().eq("id", patientId);
  if (dErr) throw new Error(dErr.message);

  revalidatePath("/", "layout");
  redirect("/patients");
}

// =====================================================================
// Task notes (append-only; visible to anyone who can see the task)
// =====================================================================

export type TaskNote = {
  id: string;
  task_id: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
};

function isMissingRelation(message: string, relation: string) {
  const m = message.toLowerCase();
  return (
    m.includes(relation) &&
    (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"))
  );
}

/** Add a note to a task. RLS insert policy enforces who may write. */
export async function addTaskNote(taskId: string, body: string) {
  const trimmed = (body ?? "").trim();
  if (!trimmed) throw new Error("Write a note before saving.");

  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select("id, patient_id, label")
    .eq("id", taskId)
    .maybeSingle();
  if (taskErr || !task) throw new Error("Task not found.");

  const { data: patient, error: pErr } = await supabase
    .from("patients")
    .select("assigned_rep_id, assigned_atp_id")
    .eq("id", task.patient_id)
    .maybeSingle();
  if (pErr || !patient) throw new Error("Patient not found.");

  const { error } = await supabase.from("task_notes").insert({
    task_id: taskId,
    body: trimmed,
    author_id: user.id,
  });
  if (error) {
    if (isMissingRelation(error.message, "task_notes")) {
      throw new Error(
        "Notes aren’t enabled on the database yet. Run migration 0013_task_notes.sql on the server, then try again.",
      );
    }
    throw new Error(error.message);
  }

  await notifyCounterparty(supabase, {
    actorId: user.id,
    patient: patient as PatientAssignment,
    taskId,
    patientId: task.patient_id,
    type: "TASK_NOTE_ADDED",
    taskLabel: task.label,
  });

  revalidatePath("/", "layout");
}

/** Notes for a task, newest first. Returns [] if the table isn't migrated yet. */
export async function fetchTaskNotes(taskId: string): Promise<TaskNote[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from("task_notes")
    .select("id, task_id, body, author_id, created_at, author:app_users!author_id(full_name)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingRelation(error.message, "task_notes")) return [];
    throw new Error(error.message);
  }

  type Row = Omit<TaskNote, "author_name"> & {
    author: { full_name: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    task_id: r.task_id,
    body: r.body,
    author_id: r.author_id,
    author_name: r.author?.full_name ?? null,
    created_at: r.created_at,
  }));
}

// =====================================================================
// Notifications (rep <-> ATP handoff; see notifyTaskEvent above)
// =====================================================================

export type NotificationItem = {
  id: string;
  type: NotificationType;
  task_label: string | null;
  patient_id: string;
  patient_name: string | null;
  actor_name: string | null;
  read_at: string | null;
  created_at: string;
};

/** Recent notifications + unread count (for bell polling). */
export async function fetchNotificationBellState(): Promise<{
  count: number;
  items: NotificationItem[];
}> {
  const items = await fetchNotifications();
  return {
    count: items.filter((n) => !n.read_at).length,
    items,
  };
}

/** Recent notifications for the current user, newest first. RLS scopes to recipient. */
export async function fetchNotifications(): Promise<NotificationItem[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, type, task_label, patient_id, read_at, created_at, patient:patients(first_name, last_name), actor:app_users!actor_id(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    if (isMissingRelation(error.message, "notifications")) return [];
    throw new Error(error.message);
  }

  type Row = {
    id: string;
    type: NotificationType;
    task_label: string | null;
    patient_id: string;
    read_at: string | null;
    created_at: string;
    patient: { first_name: string; last_name: string } | null;
    actor: { full_name: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    type: r.type,
    task_label: r.task_label,
    patient_id: r.patient_id,
    patient_name: r.patient ? `${r.patient.last_name}, ${r.patient.first_name}` : null,
    actor_name: r.actor?.full_name ?? null,
    read_at: r.read_at,
    created_at: r.created_at,
  }));
}

/** Mark every unread notification for the current user as read. */
export async function markNotificationsRead() {
  const supabase = await getSupabaseServer();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error && !isMissingRelation(error.message, "notifications")) {
    throw new Error(error.message);
  }
  revalidatePath("/", "layout");
}

/** Mark a single notification read (used on click-through). */
export async function markNotificationRead(id: string) {
  const supabase = await getSupabaseServer();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error && !isMissingRelation(error.message, "notifications")) {
    throw new Error(error.message);
  }
  revalidatePath("/", "layout");
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
    const birth_date = (form.get("birth_date") as string)?.trim();
    const referral_source = (form.get("referral_source") as string)?.trim() || null;
    const drive_folder_url = ((form.get("drive_folder_url") as string) || "").trim() || null;
    const payer_id = form.get("payer_id") as string;
    let assigned_rep_id = ((form.get("assigned_rep_id") as string) || "").trim() || null;
    const assigned_atp_id = ((form.get("assigned_atp_id") as string) || "").trim() || null;

    if (!first_name || !last_name || !payer_id || !birth_date) {
      return { error: "First name, last name, birth date, and payer are required." };
    }

    if (!assigned_rep_id) assigned_rep_id = user.id;

    const { data: patientId, error } = await supabase.rpc("create_patient_with_tasks", {
      p_first_name: first_name,
      p_last_name: last_name,
      p_birth_date: birth_date,
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

    // Optional Drive folder link (not part of the create RPC); set it after.
    if (drive_folder_url) {
      await supabase
        .from("patients")
        .update({ drive_folder_url })
        .eq("id", patientId);
    }

    revalidatePath("/", "layout");
    redirect(`/patients/${patientId}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const message = e instanceof Error ? e.message : "Unknown error creating patient.";
    return { error: message };
  }
}

// =====================================================================
// Patient: update the shared Drive folder link.
// =====================================================================

export type DriveFolderState = { error?: string; ok?: boolean } | null;

export async function updatePatientDriveFolder(
  patientId: string,
  url: string,
): Promise<DriveFolderState> {
  try {
    const supabase = await getSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "You must be signed in." };

    const trimmed = url.trim();
    const { error } = await supabase
      .from("patients")
      .update({ drive_folder_url: trimmed || null })
      .eq("id", patientId);
    if (error) return { error: error.message };

    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update link." };
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
// Admin: create / delete users (BOSS / MANAGER + service role)
// =====================================================================

async function requireUserManager() {
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
    throw new Error("Only managers can add or remove users.");
  }
  return { supabase, actorId: user.id };
}

export async function createUserAccount(input: {
  email: string;
  password: string;
  full_name?: string;
}) {
  await requireUserManager();

  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const fullName = input.full_name?.trim() || null;

  if (!email) throw new Error("Email is required.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });
  if (error) throw new Error(error.message);

  if (fullName && data.user) {
    const supabase = await getSupabaseServer();
    await supabase.rpc("update_app_user", {
      p_user_id: data.user.id,
      p_full_name: fullName,
    });
  }

  revalidatePath("/admin");
}

export async function deleteUserAccount(userId: string) {
  const { supabase, actorId } = await requireUserManager();
  if (userId === actorId) throw new Error("You cannot delete your own account.");

  const [{ count: repCount }, { count: atpCount }] = await Promise.all([
    supabase
      .from("patients")
      .select("id", { count: "exact", head: true })
      .eq("assigned_rep_id", userId),
    supabase
      .from("patients")
      .select("id", { count: "exact", head: true })
      .eq("assigned_atp_id", userId),
  ]);

  const assigned = (repCount ?? 0) + (atpCount ?? 0);
  if (assigned > 0) {
    throw new Error(
      "This user is assigned to patients. Reassign those patients before deleting.",
    );
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(userId);
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
  },
) {
  const supabase = await requireTemplateEditor();

  const label = patch.label.trim();
  if (!label) throw new Error("Label is required.");

  const { error } = await supabase
    .from("task_templates")
    .update({
      label,
      responsible_role: patch.responsible_role,
      requires_atp_review: patch.requires_atp_review,
      required: patch.required,
    })
    .eq("id", templateId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

/** Persist drag-and-drop order (1..n) for one payer type. */
export async function reorderTaskTemplates(
  payerType: PayerType,
  orderedTemplateIds: string[],
) {
  const supabase = await requireTemplateEditor();
  if (orderedTemplateIds.length === 0) return;

  const updates = orderedTemplateIds.map((id, index) =>
    supabase
      .from("task_templates")
      .update({ default_order: index + 1 })
      .eq("id", id)
      .eq("payer_type", payerType),
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  revalidatePath("/admin");
}

export async function createTaskTemplate(payerType: PayerType) {
  const supabase = await requireTemplateEditor();

  const { data: last, error: lastErr } = await supabase
    .from("task_templates")
    .select("default_order")
    .eq("payer_type", payerType)
    .order("default_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(lastErr.message);

  const nextOrder = (last?.default_order ?? 0) + 1;
  const { error } = await supabase.from("task_templates").insert({
    payer_type: payerType,
    label: "New step",
    responsible_role: "REP",
    requires_atp_review: true,
    required: true,
    default_order: nextOrder,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function deleteTaskTemplate(templateId: string, payerType: PayerType) {
  const supabase = await requireTemplateEditor();

  const { error: delErr } = await supabase
    .from("task_templates")
    .delete()
    .eq("id", templateId)
    .eq("payer_type", payerType);
  if (delErr) throw new Error(delErr.message);

  const { data: remaining, error: listErr } = await supabase
    .from("task_templates")
    .select("id")
    .eq("payer_type", payerType)
    .order("default_order");
  if (listErr) throw new Error(listErr.message);

  if (remaining?.length) {
    await reorderTaskTemplates(
      payerType,
      remaining.map((r) => r.id),
    );
  }

  revalidatePath("/admin");
}

export async function createPayerType(displayName: string) {
  const supabase = await requireTemplateEditor();
  const name = displayName.trim();
  if (!name) throw new Error("Name is required.");

  const code = normalizePayerTypeCode(name);

  const { data: existing } = await supabase
    .from("payer_types")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  if (existing) throw new Error(`Patient type "${code}" already exists.`);

  const { data: maxRow } = await supabase
    .from("payer_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { error: typeErr } = await supabase.from("payer_types").insert({
    code,
    display_name: name,
    sort_order: sortOrder,
  });
  if (typeErr) throw new Error(typeErr.message);

  const { error: payerErr } = await supabase.from("payers").insert({
    name,
    type: code,
  });
  if (payerErr) throw new Error(payerErr.message);

  revalidatePath("/admin");
  revalidatePath("/");
}

export async function deletePayerType(code: PayerType) {
  const supabase = await requireTemplateEditor();

  if (isBuiltInPayerType(code)) {
    throw new Error(
      "Insurance, Medicaid, and Medicare are built-in types and cannot be deleted.",
    );
  }

  const { data: payers, error: payersErr } = await supabase
    .from("payers")
    .select("id")
    .eq("type", code);
  if (payersErr) throw new Error(payersErr.message);

  const payerIds = (payers ?? []).map((p) => p.id);
  if (payerIds.length > 0) {
    const { count, error: patientErr } = await supabase
      .from("patients")
      .select("id", { count: "exact", head: true })
      .in("payer_id", payerIds);
    if (patientErr) throw new Error(patientErr.message);
    if ((count ?? 0) > 0) {
      throw new Error(
        "Patients use this type. Move or close those cases before deleting the type.",
      );
    }

    const { error: delPayersErr } = await supabase.from("payers").delete().eq("type", code);
    if (delPayersErr) throw new Error(delPayersErr.message);
  }

  const { error: typeErr } = await supabase.from("payer_types").delete().eq("code", code);
  if (typeErr) throw new Error(typeErr.message);

  revalidatePath("/admin");
  revalidatePath("/");
}
