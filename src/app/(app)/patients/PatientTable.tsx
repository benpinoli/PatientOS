import Link from "next/link";

export type PatientListRow = {
  id: string;
  external_code: string | null;
  first_name: string;
  last_name: string;
  status: string;
  payer: { name: string; type: string } | null;
  rep: { full_name: string | null } | null;
  atp: { full_name: string | null } | null;
};

export function PatientTable({ rows }: { rows: PatientListRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-500">
        No patients in this section.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-3 lg:hidden">
        {rows.map((p) => (
          <li key={p.id} className="rounded-lg border border-zinc-200 bg-white p-4">
            <Link
              href={`/patients/${p.id}`}
              className="text-base font-semibold text-zinc-900 hover:underline"
            >
              {p.last_name}, {p.first_name}
            </Link>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="font-medium uppercase text-zinc-400">Code</dt>
                <dd className="mt-0.5 text-zinc-800">{p.external_code ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium uppercase text-zinc-400">Status</dt>
                <dd className="mt-0.5">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
                    {p.status}
                  </span>
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="font-medium uppercase text-zinc-400">Payer</dt>
                <dd className="mt-0.5 text-zinc-800">{p.payer?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium uppercase text-zinc-400">Rep</dt>
                <dd className="mt-0.5 text-zinc-800">{p.rep?.full_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium uppercase text-zinc-400">ATP</dt>
                <dd className="mt-0.5 text-zinc-800">{p.atp?.full_name ?? "—"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border border-zinc-200 bg-white lg:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Payer</th>
                <th className="px-4 py-2.5">Rep</th>
                <th className="px-4 py-2.5">ATP</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/patients/${p.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {p.last_name}, {p.first_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{p.external_code ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-zinc-600">{p.payer?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-zinc-600">{p.rep?.full_name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-zinc-600">{p.atp?.full_name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
