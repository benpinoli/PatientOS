import { requireUser } from "@/lib/server-helpers";
import type { AppUser, Payer } from "@/lib/db-types";
import { DEFAULT_DUE_DAYS } from "@/lib/constants";
import { NewPatientForm } from "./NewPatientForm";

export const dynamic = "force-dynamic";

export default async function NewPatientPage() {
  const { supabase, profile } = await requireUser();
  const [{ data: payers }, { data: users }] = await Promise.all([
    supabase.from("payers").select("*").order("name"),
    supabase.from("app_users").select("*").eq("active", true).order("full_name"),
  ]);

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-zinc-900">New patient</h1>
      <p className="text-sm text-zinc-500">
        Creating a patient auto-instantiates the task list from the matching
        payer-type template. All tasks default to a {DEFAULT_DUE_DAYS}-day due
        date from today (configurable in <code>src/lib/constants.ts</code>).
      </p>
      <NewPatientForm
        payers={(payers ?? []) as Payer[]}
        users={(users ?? []) as AppUser[]}
        currentUserId={profile.id}
      />
    </div>
  );
}
