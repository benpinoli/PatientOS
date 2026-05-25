"use client";

import { useState, useTransition } from "react";
import { createPayerType } from "../actions";

export function AdminAddPayerTypeForm() {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      try {
        await createPayerType(name);
        setName("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add type");
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/80 p-4"
    >
      <label className="min-w-[12rem] flex-1 text-xs font-medium text-zinc-600">
        New patient type
        <input
          type="text"
          required
          placeholder="e.g. Tricare"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="min-h-10 shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add type"}
      </button>
      {error && <p className="w-full text-sm text-red-700">{error}</p>}
    </form>
  );
}
