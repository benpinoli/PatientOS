"use client";

import { useActionState, useMemo, useState } from "react";
import type { AppUser, Payer } from "@/lib/db-types";
import { createPatient, type CreatePatientState } from "../../actions";

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
  const [atpSearch, setAtpSearch] = useState<string>(() => {
    const initialAtp = userById.get(defaultAtpForRep(currentUserId));
    return initialAtp?.full_name ?? initialAtp?.email ?? "";
  });

  const onRepChange = (next: string) => {
    const nextAtpId = defaultAtpForRep(next);
    const nextAtp = userById.get(nextAtpId);
    setRepId(next);
    setAtpId(nextAtpId);
    setAtpSearch(nextAtp?.full_name ?? nextAtp?.email ?? "");
  };

  const selectedRep = userById.get(repId);
  const selectedAtp = userById.get(atpId);
  const repIsAtp = selectedRep?.roles?.includes("ATP") ?? false;
  const atpMatches = atps.filter((u) => {
    const needle = atpSearch.trim().toLowerCase();
    if (!needle) return true;
    return [u.full_name, u.email, u.location]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(needle));
  });

  const chooseAtp = (id: string) => {
    const nextAtp = userById.get(id);
    setAtpId(id);
    setAtpSearch(nextAtp?.full_name ?? nextAtp?.email ?? "");
  };

  const repHasNoAtp = repId !== "" && atpId === "";
  const [state, formAction, pending] = useActionState<CreatePatientState, FormData>(
    createPatient,
    null,
  );

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
      {state?.error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" name="first_name" required />
        <Field label="Last name" name="last_name" required />
      </div>
      <Field label="Birth date" name="birth_date" type="date" required />
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
          Assigned ATP
        </span>
        <input type="hidden" name="assigned_atp_id" value={atpId} />
        {repIsAtp ? (
          <div className="mt-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {selectedRep?.full_name ?? selectedRep?.email} (self)
          </div>
        ) : (
          <div className="mt-1 space-y-2">
            <input
              type="search"
              value={atpSearch}
              onChange={(e) => {
                setAtpSearch(e.target.value);
                setAtpId("");
              }}
              placeholder="Search active ATPs..."
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            <div className="max-h-36 overflow-auto rounded-md border border-zinc-200 bg-white">
              {atpMatches.map((u) => {
                const selected = u.id === atpId;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => chooseAtp(u.id)}
                    className={
                      "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-50 " +
                      (selected ? "bg-zinc-900 text-white hover:bg-zinc-800" : "text-zinc-700")
                    }
                  >
                    <span>{u.full_name ?? u.email}</span>
                    {u.location && (
                      <span className={selected ? "text-zinc-200" : "text-zinc-400"}>
                        {u.location}
                      </span>
                    )}
                  </button>
                );
              })}
              {atpMatches.length === 0 && (
                <div className="px-3 py-2 text-sm text-zinc-400">No active ATPs found.</div>
              )}
            </div>
            {selectedAtp && (
              <p className="text-xs text-zinc-500">
                Selected: {selectedAtp.full_name ?? selectedAtp.email}
              </p>
            )}
          </div>
        )}
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
          disabled={pending || repHasNoAtp}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create patient + tasks"}
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
