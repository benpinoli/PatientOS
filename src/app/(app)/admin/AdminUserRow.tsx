"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { AppUser, Role } from "@/lib/db-types";
import { updateUser } from "../actions";

const ALL_ROLES: Role[] = ["BOSS", "MANAGER", "ATP", "REP"];

function AdminField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function AdminUserRow({
  user,
  allUsers,
  variant = "table",
}: {
  user: AppUser;
  allUsers: AppUser[];
  variant?: "table" | "card";
}) {
  const [pending, start] = useTransition();
  const [roles, setRoles] = useState<Role[]>((user.roles ?? []) as Role[]);
  const [managerId, setManagerId] = useState<string>(user.manager_id ?? "");
  const [supervisingAtpId, setSupervisingAtpId] = useState<string>(
    user.supervising_atp_id ?? "",
  );
  const [active, setActive] = useState<boolean>(user.active);
  const [saved, setSaved] = useState(false);

  const isAtp = roles.includes("ATP");
  const atpCandidates = allUsers.filter(
    (u) => u.id !== user.id && (u.roles?.includes("ATP") ?? false),
  );

  const toggleRole = (r: Role) => {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  };

  const save = () =>
    start(async () => {
      await updateUser(user.id, {
        roles,
        manager_id: managerId || null,
        supervising_atp_id: isAtp ? null : supervisingAtpId || null,
        active,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });

  const roleButtons = (
    <div className="flex flex-wrap gap-2">
      {ALL_ROLES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => toggleRole(r)}
          className={
            "min-h-9 rounded-lg px-2.5 py-1.5 text-xs font-medium transition " +
            (roles.includes(r)
              ? "bg-zinc-900 text-white"
              : "border border-zinc-300 text-zinc-600 hover:bg-zinc-50")
          }
        >
          {r}
        </button>
      ))}
    </div>
  );

  const managerSelect = (
    <select
      value={managerId}
      onChange={(e) => setManagerId(e.target.value)}
      className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
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
  );

  const atpSupervisorField = isAtp ? (
    <span className="text-sm italic text-zinc-500">Self (ATP)</span>
  ) : (
    <select
      value={supervisingAtpId}
      onChange={(e) => setSupervisingAtpId(e.target.value)}
      className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
    >
      <option value="">— none —</option>
      {atpCandidates.map((u) => (
        <option key={u.id} value={u.id}>
          {u.full_name ?? u.email}
        </option>
      ))}
    </select>
  );

  const activeToggle = (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm text-zinc-700">
      <input
        type="checkbox"
        className="size-4"
        checked={active}
        onChange={(e) => setActive(e.target.checked)}
      />
      {active ? "Active" : "Inactive"}
    </label>
  );

  const saveButton = (
    <button
      type="button"
      onClick={save}
      disabled={pending}
      className={
        "rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 " +
        (variant === "card" ? "min-h-11 w-full" : "")
      }
    >
      {saved ? "Saved" : pending ? "Saving…" : "Save"}
    </button>
  );

  if (variant === "card") {
    return (
      <li className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="border-b border-zinc-100 pb-3">
          <p className="text-base font-semibold text-zinc-900">
            {user.full_name ?? "—"}
          </p>
          <p className="mt-0.5 break-all text-sm text-zinc-500">{user.email}</p>
        </div>
        <div className="mt-4 space-y-4">
          <AdminField label="Roles">{roleButtons}</AdminField>
          <AdminField label="Manager">{managerSelect}</AdminField>
          <AdminField label="ATP supervisor">{atpSupervisorField}</AdminField>
          <AdminField label="Account">{activeToggle}</AdminField>
          {saveButton}
        </div>
      </li>
    );
  }

  return (
    <tr className="hover:bg-zinc-50">
      <td className="px-4 py-3 text-zinc-800">{user.full_name ?? "—"}</td>
      <td className="px-4 py-3 text-xs text-zinc-500">{user.email}</td>
      <td className="px-4 py-3">{roleButtons}</td>
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
        {isAtp ? (
          <span className="text-xs italic text-zinc-400">self (ATP)</span>
        ) : (
          <select
            value={supervisingAtpId}
            onChange={(e) => setSupervisingAtpId(e.target.value)}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
          >
            <option value="">— none —</option>
            {atpCandidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name ?? u.email}
              </option>
            ))}
          </select>
        )}
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
      <td className="px-4 py-3 text-right">{saveButton}</td>
    </tr>
  );
}
