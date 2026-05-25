import Link from "next/link";
import { requireUser, isAdmin } from "@/lib/server-helpers";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/patients", label: "Patients" },
  { href: "/patients/new", label: "New patient" },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const admin = isAdmin(profile);
  const navItems = admin ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-3">
              <Link href="/" className="text-base font-semibold text-zinc-900">
                Choice Tracker
              </Link>
              <form action="/auth/signout" method="POST" className="sm:hidden">
                <button
                  type="submit"
                  className="min-h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700"
                >
                  Sign out
                </button>
              </form>
            </div>
            <nav
              className="-mx-1 flex gap-1 overflow-x-auto pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:pb-0"
              aria-label="Main"
            >
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="shrink-0 rounded-lg px-3 py-2 font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="hidden items-center gap-3 text-sm sm:flex">
              <span className="max-w-[14rem] truncate text-zinc-500" title={profile.email ?? ""}>
                {profile.full_name ?? profile.email}{" "}
                <span className="text-zinc-400">
                  ({profile.roles?.join(", ") || "no role"})
                </span>
              </span>
              <form action="/auth/signout" method="POST">
                <button
                  type="submit"
                  className="min-h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
          <p className="mt-2 truncate text-xs text-zinc-500 sm:hidden">
            {profile.full_name ?? profile.email} ({profile.roles?.join(", ")})
          </p>
        </div>
        {!profile.active && (
          <div className="bg-amber-50 px-3 py-2 text-center text-xs text-amber-800 sm:px-4">
            Your account is awaiting activation by an admin. You can browse, but
            data may be limited.
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">{children}</main>
    </div>
  );
}
