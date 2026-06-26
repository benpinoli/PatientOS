import Link from "next/link";
import { requireUser } from "@/lib/server-helpers";
import "./paperwork-theme.css";

export const dynamic = "force-dynamic";

export default async function PaperworkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Shares PatientOS auth; proxy.ts already redirects unauthenticated users.
  const { profile } = await requireUser();

  return (
    <div className="tron">
      <header className="border-b border-[var(--tron-line)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="tron-chip" title="Back to PatientOS">
              ← PatientOS
            </Link>
            <span className="text-lg font-bold tracking-[0.2em] tron-glow">
              PAPERWORK&nbsp;AI
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-[var(--tron-muted)]">
              {profile.full_name ?? profile.email}
            </span>
            <form action="/auth/signout" method="POST">
              <button type="submit" className="tron-btn">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="bg-[rgba(255,204,51,0.08)] px-4 py-1.5 text-center text-[11px] text-[var(--tron-amber)]">
          Synthetic data only — do not enter real patient information until the
          Gemini BAA and HIPAA storage controls are in place.
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
    </div>
  );
}
