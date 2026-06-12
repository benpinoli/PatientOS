import type { AppUser } from "@/lib/db-types";
import type { DashboardRow } from "@/lib/queries";
import { TaskWorkCard } from "./TaskWorkCard";
import { TaskQueueTableDesktop } from "./TaskQueueTableDesktop";

export function TaskQueueResponsive({
  rows,
  profile,
}: {
  rows: DashboardRow[];
  profile: AppUser;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
        No open tasks in your queue.
      </div>
    );
  }

  return (
    <>
      <div className="hidden lg:block">
        <TaskQueueTableDesktop rows={rows} profile={profile} />
      </div>
      <div className="space-y-4 lg:hidden">
        {rows.map((r) => (
          <TaskWorkCard
            key={r.id}
            task={r}
            profile={profile}
            patient={{
              assigned_rep_id: r.patient.assigned_rep_id,
              assigned_atp_id: r.patient.assigned_atp_id,
            }}
            showPatient
            patientInfo={{
              id: r.patient.id,
              last_name: r.patient.last_name,
              first_name: r.patient.first_name,
              birth_date: r.patient.birth_date,
              payer_name: r.patient.payer_name,
              next_step_label: r.patient.next_step_label,
            }}
            latestNote={r.latest_note}
          />
        ))}
      </div>
    </>
  );
}
