import type { NotificationType } from "@/lib/db-types";
import type { PatientAssignment } from "@/lib/task-permissions";
import { isSoloAtpRep } from "@/lib/task-permissions";

/** Other assignee on a shared rep+ATP case; null for solo or unknown actor. */
export function counterpartyOnCase(
  actorId: string,
  patient: PatientAssignment,
): string | null {
  if (isSoloAtpRep(patient)) return null;
  const { assigned_rep_id: rep, assigned_atp_id: atp } = patient;
  if (!rep || !atp || rep === atp) return null;
  if (actorId === rep) return atp;
  if (actorId === atp) return rep;
  return null;
}

export function notificationMessage(
  type: NotificationType,
  actorName: string | null,
  taskLabel: string | null,
): string {
  const actor = actorName ?? "Someone";
  const label = taskLabel ? `“${taskLabel}”` : "a task";
  switch (type) {
    case "TASK_STARTED":
      return `${actor} started ${label}`;
    case "TASK_LINK_ADDED":
      return `${actor} added a document link on ${label}`;
    case "TASK_SENT_FOR_SIGNATURE":
      return `${actor} sent ${label} for signature`;
    case "TASK_SUBMITTED_FOR_REVIEW":
      return `${actor} submitted ${label} for ATP review`;
    case "TASK_APPROVED":
      return `${actor} approved ${label}`;
    case "TASK_NOTE_ADDED":
      return `${actor} added a note on ${label}`;
    default:
      return `${actor} updated ${label}`;
  }
}
