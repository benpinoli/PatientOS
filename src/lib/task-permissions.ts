import type { AppUser, Task } from "@/lib/db-types";

export type PatientAssignment = {
  assigned_rep_id: string | null;
  assigned_atp_id: string | null;
};

function hasRole(profile: AppUser, role: AppUser["roles"][number]) {
  return profile.roles?.includes(role) ?? false;
}

/** Rep and ATP are the same person on this case (solo ATP-rep). */
export function isSoloAtpRep(patient: PatientAssignment) {
  return (
    patient.assigned_rep_id != null &&
    patient.assigned_rep_id === patient.assigned_atp_id
  );
}

/** ATP signs only; a different rep owns the paperwork. */
export function isAtpOnlyReviewer(profile: AppUser, patient: PatientAssignment) {
  return (
    hasRole(profile, "ATP") &&
    patient.assigned_atp_id === profile.id &&
    patient.assigned_rep_id !== profile.id
  );
}

export function canWorkOnPatient(profile: AppUser, patient: PatientAssignment) {
  return (
    hasRole(profile, "BOSS") ||
    hasRole(profile, "MANAGER") ||
    patient.assigned_rep_id === profile.id ||
    patient.assigned_atp_id === profile.id
  );
}

/** Rep-side work: start tasks, mark done with link (not ATP-only reviewers). */
export function canDoRepWorkflow(profile: AppUser, patient: PatientAssignment) {
  if (isAtpOnlyReviewer(profile, patient)) return false;
  return (
    hasRole(profile, "BOSS") ||
    hasRole(profile, "MANAGER") ||
    patient.assigned_rep_id === profile.id
  );
}

/** ATP sign-off on pending-review tasks (matches DB trigger). */
export function canApproveAtpReview(
  profile: AppUser,
  patient: PatientAssignment,
) {
  if (hasRole(profile, "BOSS")) return true;
  if (isSoloAtpRep(patient) && patient.assigned_rep_id === profile.id) {
    return true;
  }
  if (patient.assigned_atp_id === profile.id && hasRole(profile, "ATP")) {
    return true;
  }
  return false;
}

/**
 * ATP approve with link — only on shared rep+ATP cases after rep marked done.
 * Solo ATP-rep uses "Mark as done (signed)" instead.
 */
export function canShowApproveButton(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status" | "requires_atp_review">,
) {
  if (isSoloAtpRep(patient)) return false;
  if (task.status !== "DONE_PENDING_REVIEW" || !task.requires_atp_review) return false;
  if (!canApproveAtpReview(profile, patient)) return false;
  if (hasRole(profile, "BOSS")) return true;
  return isAtpOnlyReviewer(profile, patient);
}

/** Solo ATP-rep: sign off directly (optional link, no approval queue). */
export function canShowMarkDoneSigned(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status">,
) {
  if (task.status !== "IN_PROGRESS" && task.status !== "NOT_STARTED") return false;
  return isSoloAtpRep(patient) && patient.assigned_rep_id === profile.id;
}

/** Rep marks done and sends to ATP (link required). */
export function canShowMarkDone(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status" | "requires_atp_review">,
) {
  if (task.status !== "IN_PROGRESS" && task.status !== "NOT_STARTED") return false;
  if (canShowMarkDoneSigned(profile, patient, task)) return false;
  return canDoRepWorkflow(profile, patient);
}

export function canShowStartTask(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status">,
) {
  if (task.status !== "NOT_STARTED") return false;
  return canDoRepWorkflow(profile, patient);
}
