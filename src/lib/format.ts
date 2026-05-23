import type { TaskStatus, ResponsibleRole } from "@/lib/db-types";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  DONE_PENDING_REVIEW: "Pending ATP review",
  APPROVED: "Approved",
  BLOCKED: "Blocked",
};

export const STATUS_CLASS: Record<TaskStatus, string> = {
  NOT_STARTED: "bg-zinc-100 text-zinc-700",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  DONE_PENDING_REVIEW: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  BLOCKED: "bg-red-100 text-red-800",
};

export const ROLE_LABEL: Record<ResponsibleRole, string> = {
  DOCTOR: "Doctor",
  PT: "PT",
  ATP: "ATP",
  REP: "Rep",
  FRONT_DESK: "Front desk",
};

export function isOverdue(due: string | null) {
  if (!due) return false;
  const d = new Date(due + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

export function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
