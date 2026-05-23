import Link from "next/link";
import { requireUser, isAdmin } from "@/lib/server-helpers";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const admin = isAdmin(profile);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm font-semibold text-zinc-900">
              Choice Tracker
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600">
              <Link href="/" className="hover:text-zinc-900">Dashboard</Link>
              <Link href="/patients" className="hover:text-zinc-900">Patients</Link>
              <Link href="/patients/new" className="hover:text-zinc-900">New patient</Link>
              {admin && (
                <Link href="/admin" className="hover:text-zinc-900">Admin</Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-500">
              {profile.full_name ?? profile.email}{" "}
              <span className="text-zinc-400">
                ({profile.roles?.join(", ") || "no role"})
              </span>
            </span>
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        {!profile.active && (
          <div className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
            Your account is awaiting activation by an admin. You can browse, but
            data may be limited.
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
