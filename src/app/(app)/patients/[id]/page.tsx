import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server-helpers";
import { fetchPatientWithTasks, computeNextStep } from "@/lib/queries";
import { getTaskStatusLabel, ROLE_LABEL } from "@/lib/format";
import { PatientTaskListResponsive } from "../../components/PatientTaskListResponsive";
import { DeletePatientButton } from "./DeletePatientButton";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireUser();
  const { patient, tasks, payers, users } = await fetchPatientWithTasks(supabase, id);
  if (!patient) notFound();

  const patientCtx = {
    assigned_rep_id: patient.assigned_rep_id,
    assigned_atp_id: patient.assigned_atp_id,
  };

  const payer = payers.find((p) => p.id === patient.payer_id);
  const rep = users.find((u) => u.id === patient.assigned_rep_id);
  const atp = users.find((u) => u.id === patient.assigned_atp_id);
  const nextStep = computeNextStep(tasks);

  const canDelete =
    profile.roles.includes("BOSS") ||
    profile.roles.includes("MANAGER") ||
    patient.assigned_rep_id === profile.id ||
    patient.assigned_atp_id === profile.id;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/patients" className="text-xs text-zinc-500 hover:underline">
            ← All patients
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-900">
            {patient.last_name}, {patient.first_name}
          </h1>
        </div>
        {canDelete && (
          <DeletePatientButton
            patientId={patient.id}
            patientName={`${patient.first_name} ${patient.last_name}`}
            patientLastName={patient.last_name}
          />
        )}
      </div>
      <div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-400">Code</dt>
            <dd className="text-zinc-800">{patient.external_code ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-400">Payer</dt>
            <dd className="text-zinc-800">{payer?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-400">Rep</dt>
            <dd className="text-zinc-800">{rep?.full_name ?? "unassigned"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-400">ATP</dt>
            <dd className="text-zinc-800">{atp?.full_name ?? "unassigned"}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Next step</div>
        <div className="mt-1 text-lg font-medium text-zinc-900">
          {nextStep ? nextStep.label : "All required tasks are approved."}
        </div>
        {nextStep && (
          <div className="mt-1 text-sm text-zinc-500">
            Final signature: {ROLE_LABEL[nextStep.responsible_role]} · Status:{" "}
            {getTaskStatusLabel(nextStep.status)}
          </div>
        )}
      </div>

      <PatientTaskListResponsive
        tasks={tasks}
        profile={profile}
        patient={patientCtx}
        nextStepId={nextStep?.id ?? null}
      />
    </div>
  );
}
