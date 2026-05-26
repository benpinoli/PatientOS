"use client";

import { useState, useTransition } from "react";
import { deletePatient } from "../../actions";

// Two-step destructive confirmation:
//   1. Click "Delete patient" → opens the modal with the warning.
//   2. Type the patient's last name exactly → the final red button enables.
//   3. Click it → server action → redirect to /patients.
//
// The server action ALSO verifies the typed name as belt-and-suspenders
// in case someone calls the action without going through this UI.

export function DeletePatientButton({
  patientId,
  patientName,
  patientLastName,
}: {
  patientId: string;
  patientName: string;
  patientLastName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    setOpen(false);
    setConfirmed(false);
    setTyped("");
    setError(null);
  };

  const onDelete = () => {
    setError(null);
    start(async () => {
      try {
        await deletePatient(patientId, typed);
        // server action redirects on success — no further work here
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    });
  };

  const namesMatch =
    typed.trim().toLowerCase() === patientLastName.trim().toLowerCase();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Delete patient
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            {!confirmed ? (
              <>
                <h2 className="text-base font-semibold text-zinc-900">
                  Delete {patientName}?
                </h2>
                <p className="mt-2 text-sm text-zinc-600">
                  This permanently deletes the patient and every task on their
                  checklist. <strong>It cannot be undone.</strong>
                </p>
                <p className="mt-2 text-sm text-zinc-600">
                  Continue to the final confirmation?
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmed(true)}
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-zinc-900">
                  Type the patient&apos;s last name to confirm
                </h2>
                <p className="mt-2 text-sm text-zinc-600">
                  To delete {patientName} and all tasks, type
                  <code className="mx-1 rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-900">
                    {patientLastName}
                  </code>
                  below.
                </p>
                <input
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoFocus
                  placeholder={patientLastName}
                  className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                />
                {error && (
                  <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {error}
                  </p>
                )}
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={pending || !namesMatch}
                    onClick={onDelete}
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pending ? "Deleting…" : "Delete forever"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
