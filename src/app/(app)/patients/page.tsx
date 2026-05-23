import Link from "next/link";
import { requireUser } from "@/lib/server-helpers";

export const dynamic = "force-dynamic";

export default async function PatientsListPage() {
  const { supabase } = await requireUser();

  const { data: patients } = await supabase
    .from("patients")
    .select(`
      id, external_code, first_name, last_name, status,
      payer:payers ( name, type ),
      rep:app_users!patients_assigned_rep_id_fkey ( full_name ),
      atp:app_users!patients_assigned_atp_id_fkey ( full_name )
    `)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    external_code: string | null;
    first_name: string;
    last_name: string;
    status: string;
    payer: { name: string; type: string } | null;
    rep: { full_name: string | null } | null;
    atp: { full_name: string | null } | null;
  };
  const rows = (patients ?? []) as unknown as Row[];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Patients</h1>
          <p className="text-sm text-zinc-500">
            {rows.length} patient{rows.length === 1 ? "" : "s"} visible to you.
          </p>
        </div>
        <Link
          href="/patients/new"
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          + New patient
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full divide-y divide-zinc-200 text-sm">
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-500">
                  No patients yet. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
