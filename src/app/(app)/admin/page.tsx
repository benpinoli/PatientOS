import { redirect } from "next/navigation";
import { requireUser, isAdmin, hasRole } from "@/lib/server-helpers";
import { AdminUserRow } from "./AdminUserRow";
import { AdminTaskTemplates } from "./AdminTaskTemplates";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { supabase, profile } = await requireUser();
  if (!isAdmin(profile)) redirect("/");

  const canEditTemplates =
    hasRole(profile, "BOSS") || hasRole(profile, "MANAGER");

  const [{ data: users }, { data: templates }] = await Promise.all([
    supabase.from("app_users").select("*").order("full_name"),
    supabase.from("task_templates").select("*").order("payer_type").order("default_order"),
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
          Activate accounts and assign roles + reporting structure. New
          sign-ins land here as inactive REPs until you flip them on.
        </p>

        <ul className="space-y-3 lg:hidden">
          {allUsers.map((u) => (
            <AdminUserRow key={u.id} user={u} allUsers={allUsers} variant="card" />
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
                  <th className="px-4 py-2.5 text-right">Save</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {allUsers.map((u) => (
                  <AdminUserRow key={u.id} user={u} allUsers={allUsers} variant="table" />
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
            ? "Edit steps and drag to reorder (numbers update automatically). New patients only — existing cases keep snapshotted tasks."
            : "View-only. Managers and bosses can edit templates."}
        </p>
        <AdminTaskTemplates byType={byType} canEdit={canEditTemplates} />
      </section>
    </div>
  );
}
