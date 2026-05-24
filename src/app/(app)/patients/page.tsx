import Link from "next/link";
import { requireUser, hasRole } from "@/lib/server-helpers";
import { isPatientAssignedToUser } from "@/lib/queries";
import { PatientTable, type PatientListRow } from "./PatientTable";

export const dynamic = "force-dynamic";

export default async function PatientsListPage() {
  const { supabase, profile } = await requireUser();

  const [{ data: patients }, { data: reports }] = await Promise.all([
    supabase
      .from("patients")
      .select(
        `
      id, external_code, first_name, last_name, status, created_at,
      assigned_rep_id, assigned_atp_id,
      payer:payers ( name, type ),
      rep:app_users!patients_assigned_rep_id_fkey ( full_name ),
      atp:app_users!patients_assigned_atp_id_fkey ( full_name )
    `,
      )
      .order("created_at", { ascending: false }),
    supabase.from("app_users").select("id").eq("manager_id", profile.id),
  ]);

  type Row = PatientListRow & {
    assigned_rep_id: string | null;
    assigned_atp_id: string | null;
  };

  const rows = (patients ?? []) as unknown as Row[];
  const reportIds = new Set((reports ?? []).map((r) => r.id));

  const isManager = hasRole(profile, "MANAGER");
  const isBoss = hasRole(profile, "BOSS");
  const showTeamSplit = isManager || isBoss;

  const myPatients: PatientListRow[] = [];
  const otherPatients: PatientListRow[] = [];

  for (const p of rows) {
    const listRow: PatientListRow = {
      id: p.id,
      external_code: p.external_code,
      first_name: p.first_name,
      last_name: p.last_name,
      status: p.status,
      payer: p.payer,
      rep: p.rep,
      atp: p.atp,
    };

    if (!showTeamSplit) {
      myPatients.push(listRow);
      continue;
    }

    if (isPatientAssignedToUser(p, profile.id)) {
      myPatients.push(listRow);
      continue;
    }

    const onTeam =
      (p.assigned_rep_id && reportIds.has(p.assigned_rep_id)) ||
      (p.assigned_atp_id && reportIds.has(p.assigned_atp_id));

    if (isBoss || (isManager && onTeam)) {
      otherPatients.push(listRow);
    }
  }

  return (
    <div className="space-y-6">
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

      {showTeamSplit ? (
        <>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900">My patients</h2>
            <p className="text-sm text-zinc-500">
              Cases where you are the assigned rep or ATP.
            </p>
            <PatientTable rows={myPatients} />
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900">Other patients</h2>
            <p className="text-sm text-zinc-500">
              Your team&apos;s caseload — you can view progress but others own the work.
            </p>
            <PatientTable rows={otherPatients} />
          </section>
        </>
      ) : (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-zinc-900">My patients</h2>
          <PatientTable rows={myPatients} />
        </section>
      )}
    </div>
  );
}
