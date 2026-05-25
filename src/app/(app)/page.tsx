import Link from "next/link";
import { requireUser } from "@/lib/server-helpers";
import { fetchDashboardBundle } from "@/lib/queries";
import { STATUS_LABEL, isOverdue, formatDate } from "@/lib/format";
import { TaskQueueResponsive } from "./components/TaskQueueResponsive";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { supabase, profile } = await requireUser();
  const { topFive, pendingAtpReview, allPatients } =
    await fetchDashboardBundle(supabase, profile);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Top 5 tasks</h1>
          <p className="text-sm text-zinc-500">
            Work you can act on now — overdue items, your caseload, and ATP
            sign-offs. Tasks waiting on ATP after you submitted them are listed
            separately below.
          </p>
        </div>
        <TaskQueueResponsive rows={topFive} profile={profile} />
      </section>

      {pendingAtpReview.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              Pending ATP review
            </h2>
            <p className="text-sm text-zinc-500">
              You marked these done; the assigned ATP must approve before they
              show as approved.
            </p>
          </div>
          <TaskQueueResponsive rows={pendingAtpReview} profile={profile} />
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">All patients</h2>
          <p className="text-sm text-zinc-500">
            Every patient you can see, with open tasks and due dates.
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
                  className="text-base font-medium text-zinc-900 hover:underline"
                >
                  {patient.last_name}, {patient.first_name}
                </Link>
                <span className="mt-0.5 block text-xs text-zinc-400">
                  {patient.external_code}
                  {patient.payer_name ? ` · ${patient.payer_name}` : ""}
                </span>
                {openTasks.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-400">No open tasks</p>
                ) : (
                  <ul className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
                    {openTasks.map((t) => {
                      const overdue = isOverdue(t.due_date);
                      return (
                        <li
                          key={t.id}
                          className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                        >
                          <span className="font-medium text-zinc-900">
                            {t.order_index}. {t.label}
                          </span>
                          <span className="mt-1 block text-xs text-zinc-500">
                            {STATUS_LABEL[t.status]}
                            <span
                              className={
                                overdue ? " font-semibold text-red-700" : " text-zinc-600"
                              }
                            >
                              {" "}
                              · due {formatDate(t.due_date)}
                              {overdue && " (overdue)"}
                            </span>
                          </span>
                        </li>
                      );
                    })}
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
