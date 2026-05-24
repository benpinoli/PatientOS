import Link from "next/link";
import { requireUser } from "@/lib/server-helpers";
import { fetchDashboardBundle, type DashboardRow } from "@/lib/queries";
import { STATUS_LABEL, STATUS_CLASS, isOverdue, formatDate, ROLE_LABEL } from "@/lib/format";
import { TaskActions } from "./TaskActions";

export const dynamic = "force-dynamic";

function TaskQueueTable({ rows }: { rows: DashboardRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
        No open tasks in your queue.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <table className="w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-4 py-2.5">Patient</th>
            <th className="px-4 py-2.5">Task</th>
            <th className="px-4 py-2.5">Awaiting</th>
            <th className="px-4 py-2.5">Due</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Next step</th>
            <th className="px-4 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r) => {
            const overdue = isOverdue(r.due_date);
            return (
              <tr key={r.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/patients/${r.patient.id}`}
                    className="font-medium text-zinc-900 hover:underline"
                  >
                    {r.patient.last_name}, {r.patient.first_name}
                  </Link>
                  <div className="text-xs text-zinc-400">
                    {r.patient.external_code} · {r.patient.payer_name}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-zinc-800">{r.label}</div>
                  {r.priority != null && (
                    <span className="mt-0.5 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800">
                      PRIORITY {r.priority}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">
                  {ROLE_LABEL[r.responsible_role]}
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className={overdue ? "font-semibold text-red-700" : "text-zinc-600"}>
                    {formatDate(r.due_date)}
                    {overdue && " · overdue"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      "inline-block rounded px-2 py-0.5 text-xs font-medium " +
                      STATUS_CLASS[r.status]
                    }
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-600">
                  {r.patient.next_step_label ?? "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <TaskActions task={r} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function DashboardPage() {
  const { supabase, profile } = await requireUser();
  const { topFive, allPatients } = await fetchDashboardBundle(supabase);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Top 5 tasks</h1>
          <p className="text-sm text-zinc-500">
            Sorted by urgency, blockers, due dates, and case progress. Same tasks
            may appear again under each patient below.
          </p>
        </div>
        <TaskQueueTable rows={topFive} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">All patients</h2>
          <p className="text-sm text-zinc-500">
            Every patient you can see, with all open tasks listed.
          </p>
        </div>

        {allPatients.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
            No patients visible.{" "}
            {profile.active ? "" : "Your account is inactive — ask an admin to activate it."}
          </div>
        ) : (
          <ul className="space-y-3">
            {allPatients.map(({ patient, openTasks }) => (
              <li
                key={patient.id}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-3"
              >
                <Link
                  href={`/patients/${patient.id}`}
                  className="font-medium text-zinc-900 hover:underline"
                >
                  {patient.last_name}, {patient.first_name}
                </Link>
                <span className="ml-2 text-xs text-zinc-400">
                  {patient.external_code}
                  {patient.payer_name ? ` · ${patient.payer_name}` : ""}
                </span>
                {openTasks.length === 0 ? (
                  <p className="mt-1 text-xs text-zinc-400">No open tasks</p>
                ) : (
                  <ul className="mt-2 space-y-0.5 text-xs text-zinc-600">
                    {openTasks.map((t) => (
                      <li key={t.id}>
                        <span className="text-zinc-400">{t.order_index}.</span> {t.label}{" "}
                        <span className="text-zinc-400">({STATUS_LABEL[t.status]})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
