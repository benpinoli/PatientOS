"use client";

import { useState } from "react";
import { updatePatientDriveFolder } from "../../actions";

export function DriveFolderEditor({
  patientId,
  initialUrl,
}: {
  patientId: string;
  initialUrl: string | null;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [savedUrl, setSavedUrl] = useState(initialUrl ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await updatePatientDriveFolder(patientId, url);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSavedUrl(url.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://drive.google.com/…"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        {error && <p className="text-xs text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => {
              setUrl(savedUrl);
              setEditing(false);
              setError(null);
            }}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {savedUrl ? (
        <a
          href={savedUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-blue-700 hover:underline"
        >
          Open Drive folder ↗
        </a>
      ) : (
        <span className="text-sm text-zinc-400">No link set</span>
      )}
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-zinc-500 hover:underline"
      >
        {savedUrl ? "Edit" : "Add link"}
      </button>
    </div>
  );
}
