import type { AppUser, ResponsibleRole, Task } from "@/lib/db-types";

const OPEN_REP_STATUSES = new Set<Task["status"]>([
  "NOT_STARTED",
  "IN_PROGRESS",
  "AWAITING_SIGNATURE",
]);

/** Final signature is collected outside the company (Doctor, PT). */
export function isExternalFinalSignature(role: ResponsibleRole) {
  return role === "DOCTOR" || role === "PT";
}

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

/** User is assigned as rep or ATP on this patient. */
export function isUserInvolvedOnPatient(
  patient: PatientAssignment,
  userId: string,
) {
  return (
    patient.assigned_rep_id === userId || patient.assigned_atp_id === userId
  );
}

/** User is both rep and ATP (fully owned caseload). */
export function isSoloOwnedByUser(patient: PatientAssignment, userId: string) {
  return isSoloAtpRep(patient) && patient.assigned_rep_id === userId;
}

/** User is rep or ATP but shares the case with someone else. */
export function isSharedWithUser(patient: PatientAssignment, userId: string) {
  return isUserInvolvedOnPatient(patient, userId) && !isSoloOwnedByUser(patient, userId);
}

/** Manager/BOSS: caseload of a direct report, not involving the viewer. */
export function isEmployeePatient(
  patient: PatientAssignment,
  userId: string,
  reportIds: ReadonlySet<string>,
) {
  if (isUserInvolvedOnPatient(patient, userId)) return false;
  return (
    (patient.assigned_rep_id != null && reportIds.has(patient.assigned_rep_id)) ||
    (patient.assigned_atp_id != null && reportIds.has(patient.assigned_atp_id))
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

/** Rep-side work on this case (assigned rep only; managers act on their own caseload). */
export function canDoRepWorkflow(profile: AppUser, patient: PatientAssignment) {
  if (isAtpOnlyReviewer(profile, patient)) return false;
  if (hasRole(profile, "BOSS")) return true;
  return patient.assigned_rep_id === profile.id;
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
  if (
    patient.assigned_atp_id === profile.id &&
    (hasRole(profile, "ATP") || hasRole(profile, "MANAGER"))
  ) {
    return true;
  }
  return false;
}

/**
 * Approve UI when a task is waiting on ATP review and this user may sign off.
 * Solo rep+ATP normally uses "Mark as done (signed)" on open steps, but steps already
 * in DONE_PENDING_REVIEW (demo seed, reassignment, or shared-then-solo) still need Approve.
 */
export function canShowApproveButton(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status">,
) {
  if (task.status !== "DONE_PENDING_REVIEW") return false;
  return canApproveAtpReview(profile, patient);
}

/** Solo ATP-rep: sign off directly (optional link, no approval queue). */
export function canShowMarkDoneSigned(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status">,
) {
  if (!OPEN_REP_STATUSES.has(task.status)) return false;
  return isSoloAtpRep(patient) && patient.assigned_rep_id === profile.id;
}

/** Rep marks done and sends to ATP (link required). */
export function canShowMarkDone(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status" | "requires_atp_review">,
) {
  if (!OPEN_REP_STATUSES.has(task.status)) return false;
  if (canShowMarkDoneSigned(profile, patient, task)) return false;
  return canDoRepWorkflow(profile, patient);
}

/** Save a document link; first link moves NOT_STARTED → IN_PROGRESS. */
export function canSaveTaskLink(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status">,
) {
  if (!OPEN_REP_STATUSES.has(task.status)) return false;
  return canDoRepWorkflow(profile, patient);
}

/** Doctor/PT steps: assigned rep sent paperwork out for external signature. */
export function canShowSentForSignature(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status" | "responsible_role">,
) {
  if (task.status !== "IN_PROGRESS") return false;
  if (!isExternalFinalSignature(task.responsible_role)) return false;
  return patient.assigned_rep_id === profile.id;
}

/** Rep submitted work; waiting on assigned ATP (not actionable for rep). */
export function isRepAwaitingAtpReview(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status">,
) {
  return (
    task.status === "DONE_PENDING_REVIEW" &&
    patient.assigned_rep_id === profile.id &&
    !isSoloAtpRep(patient)
  );
}

/** ATP queue: rep has not started — ATP cannot act yet. */
export function isAtpBlockedUntilRepStarts(
  profile: AppUser,
  patient: PatientAssignment,
  task: Pick<Task, "status">,
) {
  return isAtpOnlyReviewer(profile, patient) && task.status === "NOT_STARTED";
}

/** Status after rep "mark done" on a shared rep+ATP case (always pending review). */
export function markDoneNextStatus(
  task: Pick<Task, "requires_atp_review">,
  patient: PatientAssignment,
): Task["status"] {
  if (isSoloAtpRep(patient)) {
    return "APPROVED";
  }
  if (patient.assigned_atp_id != null) {
    return "DONE_PENDING_REVIEW";
  }
  return task.requires_atp_review ? "DONE_PENDING_REVIEW" : "APPROVED";
}
