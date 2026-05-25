import type { TaskTemplate } from "@/lib/db-types";
import { AdminTemplateRow } from "./AdminTemplateRow";

const PAYER_LABEL: Record<string, string> = {
  COMMERCIAL: "Insurance",
  MEDICAID: "Medicaid",
  MEDICARE: "Medicare",
};

export function AdminTaskTemplates({
  byType,
  canEdit,
}: {
  byType: Record<string, TaskTemplate[]>;
  canEdit: boolean;
}) {
  const types = Object.keys(byType).sort();

  return (
    <div className="space-y-4">
      {types.map((type) => {
        const templates = [...byType[type]].sort(
          (a, b) => a.default_order - b.default_order,
        );
        const title = PAYER_LABEL[type] ?? type;
        return (
          <div
            key={type}
            className="overflow-hidden rounded-lg border border-zinc-200 bg-white"
          >
            <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              {title}
            </div>

            <ul className="lg:hidden">
              {templates.map((t) => (
                <AdminTemplateRow
                  key={t.id}
                  template={t}
                  canEdit={canEdit}
                  variant="card"
                />
              ))}
            </ul>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[48rem] divide-y divide-zinc-200 text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="w-16 px-3 py-2">#</th>
                    <th className="min-w-[12rem] px-3 py-2">Label</th>
                    <th className="px-3 py-2">Awaiting</th>
                    <th className="px-3 py-2">ATP review</th>
                    <th className="px-3 py-2">Required</th>
                    {canEdit && (
                      <th className="w-24 px-3 py-2 text-right">Save</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {templates.map((t) => (
                    <AdminTemplateRow
                      key={t.id}
                      template={t}
                      canEdit={canEdit}
                      variant="table"
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
