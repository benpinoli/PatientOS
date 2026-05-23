"use client";

import { useState, useTransition } from "react";
import type { AppUser, Role } from "@/lib/db-types";
import { updateUser } from "../actions";

const ALL_ROLES: Role[] = ["BOSS", "MANAGER", "ATP", "REP"];

export function AdminUserRow({ user, allUsers }: { user: AppUser; allUsers: AppUser[] }) {
  const [pending, start] = useTransition();
  const [roles, setRoles] = useState<Role[]>((user.roles ?? []) as Role[]);
  const [managerId, setManagerId] = useState<string>(user.manager_id ?? "");
  const [active, setActive] = useState<boolean>(user.active);
  const [saved, setSaved] = useState(false);

  const toggleRole = (r: Role) => {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  };

  const save = () =>
    start(async () => {
      await updateUser(user.id, {
        roles,
        manager_id: managerId || null,
        active,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });

  return (
    <tr className="hover:bg-zinc-50">
      <td className="px-4 py-3 text-zinc-800">{user.full_name ?? "—"}</td>
      <td className="px-4 py-3 text-xs text-zinc-500">{user.email}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {ALL_ROLES.map((r) => (
            <button
              key={r}
              onClick={() => toggleRole(r)}
              className={
                "rounded px-1.5 py-0.5 text-xs font-medium transition " +
                (roles.includes(r)
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-50")
              }
            >
              {r}
            </button>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <select
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
        >
          <option value="">— none —</option>
          {allUsers
            .filter((u) => u.id !== user.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name ?? u.email}
              </option>
            ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {active ? "active" : "inactive"}
        </label>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={save}
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {saved ? "Saved" : pending ? "Saving…" : "Save"}
        </button>
      </td>
    </tr>
  );
}
