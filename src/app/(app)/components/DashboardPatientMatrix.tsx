import Link from "next/link";
import type { PayerTypeRecord, Task } from "@/lib/db-types";
import type { DashboardPatientGroup } from "@/lib/queries";
import { payerTypeMatrixDescription, payerTypeMatrixTitle } from "@/lib/payer-types";
import { STATUS_CLASS, STATUS_LABEL, formatDate, isOverdue } from "@/lib/format";

type MatrixColumn = {
  key: string;
  order_index: number;
  label: string;
};

const FALLBACK_PAYER_TYPES: PayerTypeRecord[] = [
  { code: "COMMERCIAL", display_name: "Insurance", sort_order: 1 },
  { code: "MEDICAID", display_name: "Medicaid", sort_order: 2 },
  { code: "MEDICARE", display_name: "Medicare", sort_order: 3 },
];

function buildColumns(groups: DashboardPatientGroup[]): MatrixColumn[] {
  const byKey = new Map<string, MatrixColumn>();
  for (const { tasks } of groups) {
    for (const t of tasks) {
      const key = `${t.order_index}::${t.label}`;
      if (!byKey.has(key)) {
        byKey.set(key, { key, order_index: t.order_index, label: t.label });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.order_index - b.order_index);
}

function nextOpenDue(tasks: Task[]): string | null {
  const open = tasks
    .filter((t) => t.status !== "APPROVED")
    .sort((a, b) => a.order_index - b.order_index);
  return open[0]?.due_date ?? null;
}

function dueSortKey(due: string | null): number {
  if (!due) return Number.POSITIVE_INFINITY;
  return new Date(due + "T00:00:00").getTime();
}

function sortGroupsByDue(groups: DashboardPatientGroup[]) {
  return [...groups].sort(
    (a, b) =>
      dueSortKey(nextOpenDue(a.tasks)) - dueSortKey(nextOpenDue(b.tasks)),
  );
}

function taskByColumn(tasks: Task[], col: MatrixColumn): Task | undefined {
  return tasks.find(
    (t) => t.order_index === col.order_index && t.label === col.label,
  );
}

function PatientMatrixTable({ groups }: { groups: DashboardPatientGroup[] }) {
  const sortedGroups = sortGroupsByDue(groups);
  const columns = buildColumns(sortedGroups);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="sticky left-0 z-20 min-w-[10rem] border-r border-zinc-200 bg-zinc-50 px-3 py-2.5">
                Patient
              </th>
              <th className="min-w-[5.5rem] whitespace-nowrap px-3 py-2.5">
                Due
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="min-w-[6.5rem] max-w-[8.5rem] px-2 py-2.5 align-bottom font-medium normal-case"
                  title={col.label}
                >
                  <span className="block text-[10px] text-zinc-400">
                    #{col.order_index}
                  </span>
                  <span className="line-clamp-2 text-xs leading-snug text-zinc-700">
                    {col.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sortedGroups.map(({ patient, tasks }) => {
              const due = nextOpenDue(tasks);
              const overdue = isOverdue(due);
              return (
                <tr key={patient.id} className="hover:bg-zinc-50/80">
                  <td className="sticky left-0 z-10 border-r border-zinc-100 bg-white px-3 py-2">
                    <Link
                      href={`/patients/${patient.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {patient.last_name}, {patient.first_name}
                    </Link>
                    <div className="text-xs text-zinc-400">
                      {patient.external_code}
                      {patient.payer_name ? ` · ${patient.payer_name}` : ""}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <span
                      className={
                        overdue ? "font-semibold text-red-700" : "text-zinc-600"
                      }
                    >
                      {formatDate(due)}
                      {overdue && due ? " · late" : ""}
                    </span>
                  </td>
                  {columns.map((col) => {
                    const task = taskByColumn(tasks, col);
                    if (!task) {
                      return (
                        <td
                          key={col.key}
                          className="bg-zinc-50/60 px-2 py-2 text-center text-xs text-zinc-300"
                        >
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} className="p-1.5">
                        <div
                          className={
                            "flex min-h-[2.75rem] items-center justify-center rounded-md px-1.5 py-1.5 text-center text-[10px] font-semibold leading-tight " +
                            STATUS_CLASS[task.status]
                          }
                          title={`${task.label}: ${STATUS_LABEL[task.status]}`}
                        >
                          {STATUS_LABEL[task.status]}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DashboardPatientMatrix({
  groups,
  payerTypes = FALLBACK_PAYER_TYPES,
}: {
  groups: DashboardPatientGroup[];
  payerTypes?: PayerTypeRecord[];
}) {
  const tables =
    payerTypes.length > 0 ? payerTypes : FALLBACK_PAYER_TYPES;
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
        No patients visible.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {tables.map((pt) => {
        const title = payerTypeMatrixTitle(pt);
        const description = payerTypeMatrixDescription(pt.code, pt.display_name);
        const sectionGroups = groups.filter((g) => g.patient.payer_type === pt.code);
        return (
          <section key={pt.code} className="space-y-2">
            <div>
              <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
              <p className="text-sm text-zinc-500">{description}</p>
            </div>
            {sectionGroups.length === 0 ? (
              <p className="rounded-md border border-dashed border-zinc-200 bg-white px-4 py-5 text-center text-sm text-zinc-400">
                No {title.toLowerCase()} in your view.
              </p>
            ) : (
              <PatientMatrixTable groups={sectionGroups} />
            )}
          </section>
        );
      })}
    </div>
  );
}
