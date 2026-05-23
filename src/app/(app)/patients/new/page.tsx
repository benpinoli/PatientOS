import { requireUser } from "@/lib/server-helpers";
import { createPatient } from "../../actions";
import { AssigneeFields } from "./AssigneeFields";

export const dynamic = "force-dynamic";

export default async function NewPatientPage() {
  const { supabase, profile } = await requireUser();
  const [{ data: payers }, { data: users }] = await Promise.all([
    supabase.from("payers").select("*").order("name"),
    supabase.from("app_users").select("*").eq("active", true).order("full_name"),
  ]);

  const activeUsers = users ?? [];

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-zinc-900">New patient</h1>
      <p className="text-sm text-zinc-500">
        Creating a patient auto-instantiates the task list from the matching
        payer-type template. You can edit/reorder tasks later.
      </p>

      <form action={createPatient} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" name="first_name" required />
          <Field label="Last name" name="last_name" required />
        </div>
        <Field label="External code (P-####)" name="external_code" />
        <Field label="Referral source" name="referral_source" />

        <Select label="Payer" name="payer_id" required>
          <option value="">Select a payer…</option>
          {(payers ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.type})
            </option>
          ))}
        </Select>

        <AssigneeFields users={activeUsers} defaultRepId={profile.id} />

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Create patient + tasks
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  required,
  type = "text",
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-700">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function Select({
  label,
  name,
  required,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-700">{label}</span>
      <select
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
      >
        {children}
      </select>
    </label>
  );
}
