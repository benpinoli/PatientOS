import Link from "next/link";
import type { AppUser, Task } from "@/lib/db-types";
import type { PatientAssignment } from "@/lib/task-permissions";
import {
  getTaskStatusClass,
  getTaskStatusLabel,
  ROLE_LABEL,
  isOverdue,
  formatDate,
  formatBirthDate,
} from "@/lib/format";
import type { LatestNoteSummary } from "@/lib/queries";
import { TaskActions, LinkAndNoteCell } from "../TaskActions";

export type TaskWorkCardProps = {
  task: Task;
  profile: AppUser;
  patient: PatientAssignment;
  highlight?: boolean;
  /** Dashboard cards include patient header; patient detail omits it. */
  showPatient?: boolean;
  patientInfo?: {
    id: string;
    last_name: string;
    first_name: string;
    birth_date: string | null;
    payer_name?: string | null;
    next_step_label?: string | null;
  };
  orderIndex?: number;
  latestNote?: LatestNoteSummary | null;
};

export function TaskWorkCard({
  task,
  profile,
  patient,
  highlight,
  showPatient,
  patientInfo,
  orderIndex,
  latestNote,
}: TaskWorkCardProps) {
  const overdue = isOverdue(task.due_date);

  return (
    <article
      className={
        "rounded-lg border bg-white p-4 shadow-sm " +
        (highlight ? "border-amber-300 bg-amber-50/40" : "border-zinc-200")
      }
    >
      {showPatient && patientInfo && (
        <div className="mb-3 border-b border-zinc-100 pb-3">
          <Link
            href={`/patients/${patientInfo.id}`}
            className="text-base font-semibold text-zinc-900 hover:underline"
          >
            {patientInfo.last_name}, {patientInfo.first_name}
          </Link>
          <p className="mt-0.5 text-xs text-zinc-500">
            DOB {formatBirthDate(patientInfo.birth_date)}
            {patientInfo.payer_name ? ` · ${patientInfo.payer_name}` : ""}
          </p>
          {patientInfo.next_step_label && (
            <p className="mt-1 text-xs text-zinc-600">
              Next: <span className="font-medium">{patientInfo.next_step_label}</span>
            </p>
          )}
        </div>
      )}

      <div className="flex items-start gap-2">
        {orderIndex != null && (
          <span className="mt-0.5 shrink-0 text-xs font-medium text-zinc-400">#{orderIndex}</span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium leading-snug text-zinc-900">{task.label}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <span
              className={
                "inline-block rounded px-2 py-0.5 text-xs font-medium " +
                getTaskStatusClass(task.status)
              }
            >
              {getTaskStatusLabel(task.status)}
            </span>
            {task.priority != null && (
              <span className="inline-block rounded bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-800">
                Priority {task.priority}
              </span>
            )}
          </div>
        </div>
      </div>

      {task.blocked_reason && (
        <p className="mt-2 text-xs italic text-red-600">Blocked: {task.blocked_reason}</p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="font-medium uppercase tracking-wide text-zinc-400">Final signature</dt>
          <dd className="mt-0.5 text-zinc-800">{ROLE_LABEL[task.responsible_role]}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide text-zinc-400">Due</dt>
          <dd className={"mt-0.5 " + (overdue ? "font-semibold text-red-700" : "text-zinc-800")}>
            {formatDate(task.due_date)}
            {overdue && " · overdue"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="font-medium uppercase tracking-wide text-zinc-400">Link / note</dt>
          <dd className="mt-0.5 break-all">
            <LinkAndNoteCell task={task} latestNote={latestNote} variant="card" />
          </dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-zinc-100 pt-4">
        <TaskActions task={task} profile={profile} patient={patient} layout="card" />
      </div>
    </article>
  );
}
