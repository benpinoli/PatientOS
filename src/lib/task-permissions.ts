import type { AppUser, Task } from "@/lib/db-types";

export type PatientAssignment = {
  assigned_rep_id: string | null;
  assigned_atp_id: string | null;
};

function hasRole(profile: AppUser, role: AppUser["roles"][number]) {
  return profile.roles?.includes(role) ?? false;
}

export function canWorkOnPatient(profile: AppUser, patient: PatientAssignment) {
  return (
    hasRole(profile, "BOSS") ||
    hasRole(profile, "MANAGER") ||
    patient.assigned_rep_id === profile.id ||
    patient.assigned_atp_id === profile.id
  );
}

/** ATP sign-off on pending-review tasks (matches DB trigger). */
export function canApproveAtpReview(
  profile: AppUser,
  patient: PatientAssignment,
): boolean {
  if (hasRole(profile, "BOSS")) return true;
  if (
    patient.assigned_rep_id === profile.id &&
    patient.assigned_atp_id === profile.id
  ) {
    return true;
  }
  if (patient.assigned_atp_id === profile.id && hasRole(profile, "ATP")) {
    return true;
  }
  return false;
}

/**
 * Approve is ONLY for ATP review sign-off (never for plain reps).
 * Reps use "Mark done" with a required link instead.
 */
export function canShowApproveButton(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status" | "requires_atp_review">,
): boolean {
  return (
    task.status === "DONE_PENDING_REVIEW" &&
    !!task.requires_atp_review &&
    canApproveAtpReview(profile, patient)
  );
}

/** Mark done: rep/ATP submit work + document link (required). */
export function canShowMarkDone(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status" | "requires_atp_review">,
): boolean {
  if (task.status !== "IN_PROGRESS" && task.status !== "NOT_STARTED") return false;
  return canWorkOnPatient(profile, patient);
}
