import type { AppUser } from "@/lib/db-types";
import type { PatientAssignment } from "@/lib/task-permissions";
import {
  getTaskStatusClass,
  getTaskStatusLabel,
  ROLE_LABEL,
  isOverdue,
  formatDate,
} from "@/lib/format";
import type { TaskWithLatestNote } from "@/lib/queries";
import { TaskActions, LinkAndNoteCell } from "../TaskActions";

export function PatientTaskTableDesktop({
  tasks,
  profile,
  patient,
  nextStepId,
}: {
  tasks: TaskWithLatestNote[];
  profile: AppUser;
  patient: PatientAssignment;
  nextStepId: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="overflow-x-auto overflow-y-visible">
        <table className="w-full min-w-[880px] divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-[10px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="w-10 px-3 py-1.5">#</th>
              <th className="px-3 py-1.5">Task</th>
              <th className="px-3 py-1.5">Final signature</th>
              <th className="px-3 py-1.5">Due</th>
              <th className="px-3 py-1.5">Status</th>
              <th className="px-3 py-1.5">Link / note</th>
              <th className="min-w-[240px] px-3 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {tasks.map((t) => {
              const overdue = isOverdue(t.due_date);
              const isNext = nextStepId === t.id;
              return (
                <tr key={t.id} className={"align-top " + (isNext ? "bg-amber-50" : "hover:bg-zinc-50")}>
                  <td className="px-3 py-2 text-xs text-zinc-500">{t.order_index}</td>
                  <td className="px-3 py-2">
                    <div className="text-sm leading-snug text-zinc-800">{t.label}</div>
                    {t.blocked_reason && (
                      <div className="mt-0.5 text-xs italic text-red-600">
                        Blocked: {t.blocked_reason}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {ROLE_LABEL[t.responsible_role]}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className={overdue ? "font-semibold text-red-700" : "text-zinc-600"}>
                      {formatDate(t.due_date)}
                      {overdue && " · late"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " +
                        getTaskStatusClass(t.status)
                      }
                    >
                      {getTaskStatusLabel(t.status)}
                    </span>
                  </td>
                  <td className="max-w-[11rem] px-3 py-2">
                    <LinkAndNoteCell task={t} latestNote={t.latest_note} />
                  </td>
                  <td className="relative overflow-visible px-3 py-2 text-right">
                    <TaskActions task={t} profile={profile} patient={patient} layout="table" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
