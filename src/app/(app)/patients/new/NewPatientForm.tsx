"use client";

import { useMemo, useState } from "react";
import type { AppUser, Payer } from "@/lib/db-types";
import { createPatient } from "../../actions";

// Reactive form: when the rep selection changes, auto-default the ATP
// dropdown to either (a) the rep themselves if they have the ATP role,
// or (b) the rep's supervising_atp_id otherwise. The user can override
// the suggestion, which is handy for vacation coverage cases.

export function NewPatientForm({
  payers,
  users,
  currentUserId,
}: {
  payers: Payer[];
  users: AppUser[];
  currentUserId: string;
}) {
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const reps = useMemo(
    () =>
      users.filter(
        (u) => u.roles?.includes("REP") || u.roles?.includes("ATP") || u.roles?.includes("MANAGER"),
      ),
    [users],
  );
  const atps = useMemo(() => users.filter((u) => u.roles?.includes("ATP")), [users]);

  const defaultAtpForRep = (repId: string): string => {
    const rep = userById.get(repId);
    if (!rep) return "";
    if (rep.roles?.includes("ATP")) return rep.id;
    if (rep.supervising_atp_id) return rep.supervising_atp_id;
    return "";
  };

  const [repId, setRepId] = useState<string>(currentUserId);
  const [atpId, setAtpId] = useState<string>(defaultAtpForRep(currentUserId));

  const onRepChange = (next: string) => {
    setRepId(next);
    setAtpId(defaultAtpForRep(next));
  };

  const repHasNoAtp = repId !== "" && atpId === "";

  return (
    <form action={createPatient} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" name="first_name" required />
        <Field label="Last name" name="last_name" required />
      </div>
      <Field label="External code (P-####)" name="external_code" />
      <Field label="Referral source" name="referral_source" />

      <Select label="Payer" name="payer_id" required>
        <option value="">Select a payer…</option>
        {payers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.type})
          </option>
        ))}
      </Select>

      <label className="block">
        <span className="text-xs font-medium text-zinc-700">Assigned rep</span>
        <select
          name="assigned_rep_id"
          value={repId}
          onChange={(e) => onRepChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">— unassigned —</option>
          {reps.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name} ({u.roles?.join("/")})
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-zinc-700">
          Assigned ATP{" "}
          <span className="font-normal text-zinc-400">
            (auto-filled from rep; override only if you really need to)
          </span>
        </span>
        <select
          name="assigned_atp_id"
          value={atpId}
          onChange={(e) => setAtpId(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">— unassigned —</option>
          {atps.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name}
            </option>
          ))}
        </select>
        {repHasNoAtp && (
          <p className="mt-1 text-xs text-amber-700">
            This rep has no supervising ATP set. Pick one manually, or ask an
            admin to set their default supervisor.
          </p>
        )}
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Create patient + tasks
        </button>
      </div>
    </form>
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
