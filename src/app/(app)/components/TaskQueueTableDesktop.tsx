import Link from "next/link";
import type { AppUser } from "@/lib/db-types";
import type { DashboardRow } from "@/lib/queries";
import {
  getTaskStatusClass,
  getTaskStatusLabel,
  isOverdue,
  formatDate,
  formatBirthDate,
  ROLE_LABEL,
} from "@/lib/format";
import { TaskActions, LinkAndNoteCell } from "../TaskActions";

export function TaskQueueTableDesktop({
  rows,
  profile,
}: {
  rows: DashboardRow[];
  profile: AppUser;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="overflow-x-auto overflow-y-visible">
        <table className="w-full min-w-[960px] divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-[10px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-1.5">Patient</th>
              <th className="px-3 py-1.5">Task</th>
              <th className="px-3 py-1.5">Final signature</th>
              <th className="px-3 py-1.5">Due</th>
              <th className="px-3 py-1.5">Status</th>
              <th className="px-3 py-1.5">Link / note</th>
              <th className="px-3 py-1.5">Next step</th>
              <th className="min-w-[240px] px-3 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((r) => {
              const overdue = isOverdue(r.due_date);
              const patientCtx = {
                assigned_rep_id: r.patient.assigned_rep_id,
                assigned_atp_id: r.patient.assigned_atp_id,
              };
              return (
                <tr key={r.id} className="align-top hover:bg-zinc-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/patients/${r.patient.id}`}
                      className="text-sm font-medium text-zinc-900 hover:underline"
                    >
                      {r.patient.last_name}, {r.patient.first_name}
                    </Link>
                    <div className="text-[11px] leading-tight text-zinc-400">
                      DOB {formatBirthDate(r.patient.birth_date)} · {r.patient.payer_name}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-sm leading-snug text-zinc-800">{r.label}</div>
                    {r.priority != null && (
                      <span className="mt-0.5 inline-block rounded bg-purple-100 px-1 py-0.5 text-[10px] font-medium text-purple-800">
                        PRI {r.priority}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {ROLE_LABEL[r.responsible_role]}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className={overdue ? "font-semibold text-red-700" : "text-zinc-600"}>
                      {formatDate(r.due_date)}
                      {overdue && " · late"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " +
                        getTaskStatusClass(r.status)
                      }
                    >
                      {getTaskStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="max-w-[11rem] px-3 py-2">
                    <LinkAndNoteCell task={r} latestNote={r.latest_note} />
                  </td>
                  <td className="px-3 py-2 text-xs leading-snug text-zinc-600">
                    {r.patient.next_step_label ?? "—"}
                  </td>
                  <td className="relative overflow-visible px-3 py-2 text-right">
                    <TaskActions
                      task={r}
                      profile={profile}
                      patient={patientCtx}
                      layout="table"
                    />
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
