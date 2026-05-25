import type { AppUser, Task } from "@/lib/db-types";

export type PatientAssignment = {
  assigned_rep_id: string | null;
  assigned_atp_id: string | null;
};

function hasRole(profile: AppUser, role: AppUser["roles"][number]) {
  return profile.roles?.includes(role) ?? false;
}

/** Can set APPROVED on a task pending ATP review (matches DB trigger). */
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

/** Show the Approve control for this task in the current state. */
export function canShowApproveButton(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status" | "requires_atp_review">,
): boolean {
  if (task.status === "DONE_PENDING_REVIEW" && task.requires_atp_review) {
    return canApproveAtpReview(profile, patient);
  }
  if (
    (task.status === "IN_PROGRESS" || task.status === "NOT_STARTED") &&
    !task.requires_atp_review
  ) {
    return (
      hasRole(profile, "BOSS") ||
      hasRole(profile, "MANAGER") ||
      patient.assigned_rep_id === profile.id ||
      patient.assigned_atp_id === profile.id
    );
  }
  return false;
}

export function canShowMarkDone(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status" | "requires_atp_review">,
): boolean {
  if (task.status !== "IN_PROGRESS" && task.status !== "NOT_STARTED") return false;
  if (!task.requires_atp_review) return false;
  return (
    hasRole(profile, "BOSS") ||
    hasRole(profile, "MANAGER") ||
    patient.assigned_rep_id === profile.id ||
    patient.assigned_atp_id === profile.id
  );
}
