import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server-helpers";
import { fetchPatientWithTasks, computeNextStep } from "@/lib/queries";
import { STATUS_LABEL, STATUS_CLASS, ROLE_LABEL, isOverdue, formatDate } from "@/lib/format";
import { TaskActions } from "../../TaskActions";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { patient, tasks, payers, users } = await fetchPatientWithTasks(supabase, id);
  if (!patient) notFound();

  const payer = payers.find((p) => p.id === patient.payer_id);
  const rep = users.find((u) => u.id === patient.assigned_rep_id);
  const atp = users.find((u) => u.id === patient.assigned_atp_id);
  const nextStep = computeNextStep(tasks);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/patients" className="text-xs text-zinc-500 hover:underline">
          ← All patients
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-zinc-900">
          {patient.last_name}, {patient.first_name}
        </h1>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
          <span><span className="font-medium text-zinc-700">{patient.external_code ?? "—"}</span></span>
          <span>Payer: <span className="text-zinc-700">{payer?.name ?? "—"}</span></span>
          <span>Rep: <span className="text-zinc-700">{rep?.full_name ?? "unassigned"}</span></span>
          <span>ATP: <span className="text-zinc-700">{atp?.full_name ?? "unassigned"}</span></span>
          <span>Status: <span className="text-zinc-700">{patient.status}</span></span>
          {patient.referral_source && (
            <span>Referral: <span className="text-zinc-700">{patient.referral_source}</span></span>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Next step</div>
        <div className="mt-1 text-lg font-medium text-zinc-900">
          {nextStep ? nextStep.label : "All required tasks are approved."}
        </div>
        {nextStep && (
          <div className="mt-1 text-xs text-zinc-500">
            Awaiting: {ROLE_LABEL[nextStep.responsible_role]} · Status: {STATUS_LABEL[nextStep.status]}
            {nextStep.requires_atp_review && " · Requires ATP review"}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5 w-10">#</th>
              <th className="px-4 py-2.5">Task</th>
              <th className="px-4 py-2.5">Awaiting</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Link</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {tasks.map((t) => {
              const overdue = isOverdue(t.due_date);
              const isNext = nextStep?.id === t.id;
              return (
                <tr key={t.id} className={isNext ? "bg-amber-50" : "hover:bg-zinc-50"}>
                  <td className="px-4 py-3 text-xs text-zinc-500">{t.order_index}</td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-800">{t.label}</div>
                    {t.requires_atp_review && (
                      <span className="mt-0.5 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                        ATP review
                      </span>
                    )}
                    {t.blocked_reason && (
                      <div className="mt-1 text-xs italic text-red-600">
                        Blocked: {t.blocked_reason}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{ROLE_LABEL[t.responsible_role]}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className={overdue ? "font-semibold text-red-700" : "text-zinc-600"}>
                      {formatDate(t.due_date)}{overdue && " · overdue"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={"inline-block rounded px-2 py-0.5 text-xs font-medium " + STATUS_CLASS[t.status]}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.link ? (
                      <a href={t.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        open
                      </a>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <TaskActions task={t} />
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
