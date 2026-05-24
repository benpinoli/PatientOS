import { redirect } from "next/navigation";
import { requireUser, isAdmin } from "@/lib/server-helpers";
import { AdminUserRow } from "./AdminUserRow";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { supabase, profile } = await requireUser();
  if (!isAdmin(profile)) redirect("/");

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
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <table className="w-full divide-y divide-zinc-200 text-sm">
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
                <AdminUserRow key={u.id} user={u} allUsers={allUsers} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-900">Task templates</h2>
        <p className="text-sm text-zinc-500">
          Read-only in v1. Editing templates does NOT rewrite tasks on
          in-flight patients (fields are snapshotted at instantiation).
        </p>
        {Object.keys(byType).sort().map((type) => (
          <div key={type} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              {type}
            </div>
            <table className="w-full divide-y divide-zinc-200 text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2 w-10">#</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2">Awaiting</th>
                  <th className="px-4 py-2">ATP review</th>
                  <th className="px-4 py-2">Required</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {byType[type].map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2 text-xs text-zinc-500">{t.default_order}</td>
                    <td className="px-4 py-2 text-zinc-800">{t.label}</td>
                    <td className="px-4 py-2 text-xs text-zinc-500">{t.responsible_role}</td>
                    <td className="px-4 py-2 text-xs">{t.requires_atp_review ? "yes" : "—"}</td>
                    <td className="px-4 py-2 text-xs">{t.required ? "yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </div>
  );
}
