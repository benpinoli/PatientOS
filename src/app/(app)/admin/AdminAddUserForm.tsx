"use client";

import { useState, useTransition } from "react";
import { createUserAccount } from "../actions";

export function AdminAddUserForm() {
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    start(async () => {
      try {
        await createUserAccount({
          email,
          password,
          full_name: fullName || undefined,
        });
        setEmail("");
        setPassword("");
        setFullName("");
        setDone(true);
        setTimeout(() => setDone(false), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create user");
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/80 p-4"
    >
      <p className="text-sm font-medium text-zinc-800">Add user</p>
      <p className="mt-1 text-xs text-zinc-500">
        Creates a sign-in with email and password. Account starts inactive until
        you activate it below.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs font-medium text-zinc-600">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-zinc-600">
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-zinc-600 sm:col-span-2">
          Full name (optional)
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {done && (
        <p className="mt-3 text-sm text-emerald-700">User created. Activate and assign roles below.</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 min-h-10 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Add user"}
      </button>
    </form>
  );
}
