import type { AppUser } from "@/lib/db-types";
import type { TaskWithLatestNote } from "@/lib/queries";
import type { PatientAssignment } from "@/lib/task-permissions";
import { TaskWorkCard } from "./TaskWorkCard";
import { PatientTaskTableDesktop } from "./PatientTaskTableDesktop";

export function PatientTaskListResponsive({
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
    <>
      <div className="hidden lg:block">
        <PatientTaskTableDesktop
          tasks={tasks}
          profile={profile}
          patient={patient}
          nextStepId={nextStepId}
        />
      </div>
      <div className="space-y-4 lg:hidden">
        {tasks.map((t) => (
          <TaskWorkCard
            key={t.id}
            task={t}
            profile={profile}
            patient={patient}
            orderIndex={t.order_index}
            highlight={nextStepId === t.id}
            latestNote={t.latest_note}
            patientDetail
          />
        ))}
      </div>
    </>
  );
}
