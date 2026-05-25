import type { TaskTemplate } from "@/lib/db-types";
import { ROLE_LABEL } from "@/lib/format";

const PAYER_LABEL: Record<string, string> = {
  COMMERCIAL: "Insurance",
  MEDICAID: "Medicaid",
  MEDICARE: "Medicare",
};

export function AdminTaskTemplates({
  byType,
}: {
  byType: Record<string, TaskTemplate[]>;
}) {
  const types = Object.keys(byType).sort();

  return (
    <div className="space-y-4">
      {types.map((type) => {
        const templates = byType[type];
        const title = PAYER_LABEL[type] ?? type;
        return (
          <div
            key={type}
            className="overflow-hidden rounded-lg border border-zinc-200 bg-white"
          >
            <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              {title}
            </div>

            <ul className="divide-y divide-zinc-100 lg:hidden">
              {templates.map((t) => (
                <li key={t.id} className="px-4 py-3">
                  <p className="text-sm font-medium text-zinc-900">
                    <span className="text-zinc-400">#{t.default_order}</span> {t.label}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="font-medium uppercase text-zinc-400">Awaiting</dt>
                      <dd className="mt-0.5 text-zinc-700">
                        {ROLE_LABEL[t.responsible_role]}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium uppercase text-zinc-400">ATP review</dt>
                      <dd className="mt-0.5 text-zinc-700">
                        {t.requires_atp_review ? "Yes" : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium uppercase text-zinc-400">Required</dt>
                      <dd className="mt-0.5 text-zinc-700">{t.required ? "Yes" : "—"}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>

            <div className="hidden lg:block">
              <table className="w-full divide-y divide-zinc-200 text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="w-10 px-4 py-2">#</th>
                    <th className="px-4 py-2">Label</th>
                    <th className="px-4 py-2">Awaiting</th>
                    <th className="px-4 py-2">ATP review</th>
                    <th className="px-4 py-2">Required</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-2 text-xs text-zinc-500">{t.default_order}</td>
                      <td className="px-4 py-2 text-zinc-800">{t.label}</td>
                      <td className="px-4 py-2 text-xs text-zinc-500">
                        {t.responsible_role}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {t.requires_atp_review ? "yes" : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs">{t.required ? "yes" : "—"}</td>
                    </tr>
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
