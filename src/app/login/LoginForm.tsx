"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { AuthProviderConfig } from "@/lib/auth-providers";

export function LoginForm({
  next,
  error,
  providers,
}: {
  next: string;
  error?: string;
  providers: AuthProviderConfig[];
}) {
  const supabase = getSupabaseBrowser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const oauth = async (provider: "azure" | "google") => {
    setBusy(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    if (error) {
      setLocalError(error.message);
      setBusy(false);
    }
  };

  const passwordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLocalError(error.message);
      setBusy(false);
      return;
    }
    window.location.href = next;
  };

  const oauthProviders = providers.filter((p) => p.provider !== "email");
  const emailEnabled = providers.some((p) => p.provider === "email");

  return (
    <div className="mt-6 space-y-3">
      {(error || localError) && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {localError ?? error}
        </div>
      )}

      {oauthProviders.map((p) => (
        <button
          key={p.provider}
          type="button"
          disabled={busy}
          onClick={() => oauth(p.provider as "azure" | "google")}
          className={
            "w-full rounded-md px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 " +
            (p.primary
              ? "bg-zinc-900 text-white hover:bg-zinc-800"
              : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50")
          }
        >
          {p.label}
        </button>
      ))}

      {emailEnabled && oauthProviders.length > 0 && (
        <div className="flex items-center gap-3 py-2 text-xs text-zinc-400">
          <div className="h-px flex-1 bg-zinc-200" />
          or
          <div className="h-px flex-1 bg-zinc-200" />
        </div>
      )}

      {emailEnabled && (
        <form onSubmit={passwordSignIn} className="space-y-2">
          <input
            type="email"
            required
            placeholder="email@choice.example"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            required
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
          >
            Sign in with password
          </button>
          <p className="text-xs text-zinc-400">
            Seed users: deanne / matt / steve / tara / jack @ choice.example
            (password <code>password123</code>).
          </p>
        </form>
      )}
    </div>
  );
}
