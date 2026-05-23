"use client";

import { useMemo, useState } from "react";
import type { AppUser } from "@/lib/db-types";

type UserOption = Pick<AppUser, "id" | "full_name" | "roles">;

export function AssigneeFields({
  users,
  defaultRepId,
}: {
  users: UserOption[];
  defaultRepId: string;
}) {
  const reps = useMemo(
    () => users.filter((u) => u.roles?.includes("REP") || u.roles?.includes("ATP")),
    [users],
  );
  const atps = useMemo(
    () => users.filter((u) => u.roles?.includes("ATP")),
    [users],
  );

  const [repId, setRepId] = useState(defaultRepId);
  const [atpId, setAtpId] = useState(() => initialAtpForRep(defaultRepId, users));

  function onRepChange(nextRepId: string) {
    setRepId(nextRepId);
    const rep = users.find((u) => u.id === nextRepId);
    if (rep?.roles?.includes("ATP")) {
      setAtpId(nextRepId);
    } else {
      setAtpId("");
    }
  }

  return (
    <>
      <label className="block">
        <span className="text-xs font-medium text-zinc-700">Assigned rep</span>
        <select
          name="assigned_rep_id"
          required
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
        <span className="text-xs font-medium text-zinc-700">Assigned ATP</span>
        <select
          name="assigned_atp_id"
          value={atpId}
          onChange={(e) => setAtpId(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">— pick ATP (rep has no ATP credential) —</option>
          {atps.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name} ({u.roles?.join("/")})
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          ATP-credentialed reps are auto-selected as their own ATP. Pure reps need
          an explicit ATP pick.
        </p>
      </label>
    </>
  );
}

function initialAtpForRep(repId: string, users: UserOption[]): string {
  const rep = users.find((u) => u.id === repId);
  return rep?.roles?.includes("ATP") ? repId : "";
}
