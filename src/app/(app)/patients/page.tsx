import Link from "next/link";
import { requireUser, hasRole } from "@/lib/server-helpers";
import {
  isEmployeePatient,
  isSharedWithUser,
  isSoloOwnedByUser,
  isUserInvolvedOnPatient,
} from "@/lib/task-permissions";
import { PatientListSection } from "./PatientListSection";
import { type PatientListRow } from "./PatientTable";

export const dynamic = "force-dynamic";

export default async function PatientsListPage() {
  const { supabase, profile } = await requireUser();

  const [{ data: patients }, { data: reports }] = await Promise.all([
    supabase
      .from("patients")
      .select(
        `
      id, birth_date, first_name, last_name, status, created_at,
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
  const showTeamSection = isManager || isBoss;

  const soloOwned: PatientListRow[] = [];
  const shared: PatientListRow[] = [];
  const team: PatientListRow[] = [];

  for (const p of rows) {
    const listRow: PatientListRow = {
      id: p.id,
      birth_date: p.birth_date,
      first_name: p.first_name,
      last_name: p.last_name,
      status: p.status,
      payer: p.payer,
      rep: p.rep,
      atp: p.atp,
    };

    const assignment = {
      assigned_rep_id: p.assigned_rep_id,
      assigned_atp_id: p.assigned_atp_id,
    };

    if (isSoloOwnedByUser(assignment, profile.id)) {
      soloOwned.push(listRow);
      continue;
    }

    if (isSharedWithUser(assignment, profile.id)) {
      shared.push(listRow);
      continue;
    }

    if (showTeamSection && !isUserInvolvedOnPatient(assignment, profile.id)) {
      if (
        isBoss ||
        isEmployeePatient(assignment, profile.id, reportIds)
      ) {
        team.push(listRow);
      }
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Patients</h1>
          <p className="text-sm text-zinc-500">
            {rows.length} patient{rows.length === 1 ? "" : "s"} visible to you.
          </p>
        </div>
        <Link
          href="/patients/new"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          + New patient
        </Link>
      </div>

      <PatientListSection
        title="My patients"
        description="You are both the rep and the ATP on these cases — your fully owned caseload."
        rows={soloOwned}
      />

      <PatientListSection
        title="Shared patients"
        description="You are the rep or the ATP; the other role is handled by someone else on your team."
        rows={shared}
      />

      {showTeamSection && (
        <PatientListSection
          title={isBoss ? "Other patients" : "Patients of my employees"}
          description={
            isBoss
              ? "All other cases in the organization — not on your personal or shared caseload."
              : "Cases owned by your direct reports — you can view progress but are not the assigned rep or ATP."
          }
          rows={team}
        />
      )}
    </div>
  );
}
