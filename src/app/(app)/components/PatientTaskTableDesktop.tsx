import type { AppUser } from "@/lib/db-types";
import type { TaskWithLatestNote } from "@/lib/queries";
import type { PatientAssignment } from "@/lib/task-permissions";
import { PatientTaskTableRow } from "./PatientTaskTableRow";

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
      <div className="overflow-x-auto">
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
            {tasks.map((t) => (
              <PatientTaskTableRow
                key={t.id}
                task={t}
                profile={profile}
                patient={patient}
                isNext={nextStepId === t.id}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
