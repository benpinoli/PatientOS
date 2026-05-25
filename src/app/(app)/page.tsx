import { requireUser } from "@/lib/server-helpers";
import { fetchDashboardBundle, fetchPayerTypes } from "@/lib/queries";
import { DashboardPatientMatrix } from "./components/DashboardPatientMatrix";
import { TaskQueueResponsive } from "./components/TaskQueueResponsive";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { supabase, profile } = await requireUser();
  const [{ topFive, allPatients }, payerTypes] = await Promise.all([
    fetchDashboardBundle(supabase, profile),
    fetchPayerTypes(supabase),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Top 5 tasks</h1>
          <p className="text-sm text-zinc-500">
            Work you can act on now — overdue items, your caseload, and ATP
            sign-offs. Pending review status appears in the patient tables
            below.
          </p>
        </div>
        <TaskQueueResponsive rows={topFive} profile={profile} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">All patients</h2>
          <p className="text-sm text-zinc-500">
            Separate tables by payer type so columns stay compact. Due is the
            next open step; soonest due first within each table.
          </p>
        </div>

        {!profile.active && allPatients.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
            No patients visible. Your account is inactive — ask an admin to
            activate it.
          </div>
        ) : (
          <DashboardPatientMatrix groups={allPatients} payerTypes={payerTypes} />
        )}
      </section>
    </div>
  );
}
