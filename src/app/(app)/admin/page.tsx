import { redirect } from "next/navigation";
import { requireUser, isAdmin, hasRole } from "@/lib/server-helpers";
import { fetchPayerTypes } from "@/lib/queries";
import { AdminUserRow } from "./AdminUserRow";
import { AdminTaskTemplates } from "./AdminTaskTemplates";
import { AdminAddUserForm } from "./AdminAddUserForm";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { supabase, profile } = await requireUser();
  if (!isAdmin(profile)) redirect("/");

  const canEditTemplates =
    hasRole(profile, "BOSS") || hasRole(profile, "MANAGER");
  const canManageUsers = canEditTemplates;

  const [{ data: users }, { data: templates }, payerTypes] = await Promise.all([
    supabase.from("app_users").select("*").order("full_name"),
    supabase.from("task_templates").select("*").order("payer_type").order("default_order"),
    fetchPayerTypes(supabase),
  ]);

  const allUsers = users ?? [];
  const allTemplates = templates ?? [];
  const byType: Record<string, typeof allTemplates> = {};
  for (const t of allTemplates) {
    (byType[t.payer_type] ||= []).push(t);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold text-zinc-900">Users</h1>
        <p className="text-sm text-zinc-500">
          {canManageUsers
            ? "Add accounts, activate users, assign roles, or remove users with no patient assignments."
            : "Activate accounts and assign roles. Managers can add or remove users."}
        </p>

        {canManageUsers && <AdminAddUserForm />}

        <ul className="space-y-3 lg:hidden">
          {allUsers.map((u) => (
            <AdminUserRow
              key={u.id}
              user={u}
              allUsers={allUsers}
              variant="card"
              canManage={canManageUsers}
            />
          ))}
        </ul>

        <div className="hidden overflow-hidden rounded-lg border border-zinc-200 bg-white lg:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Roles</th>
                  <th className="px-4 py-2.5">Manager</th>
                  <th className="px-4 py-2.5">ATP supervisor</th>
                  <th className="px-4 py-2.5">Active</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {allUsers.map((u) => (
                  <AdminUserRow
                    key={u.id}
                    user={u}
                    allUsers={allUsers}
                    variant="table"
                    canManage={canManageUsers}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-900">Task templates</h2>
        <p className="text-sm text-zinc-500">
          {canEditTemplates
            ? "Add or remove patient types and checklist steps. Drag to reorder. New patients only — existing cases keep snapshotted tasks."
            : "View-only. Managers and bosses can edit templates."}
        </p>
        <AdminTaskTemplates
          payerTypes={payerTypes}
          byType={byType}
          canEdit={canEditTemplates}
        />
      </section>
    </div>
  );
}
