"use client";

import { useMemo, useState } from "react";
import {
  evaluateCompleteness,
  getValueAtPath,
  setValueAtPath,
  type FieldStatus,
} from "@/lib/paperwork/schema";
import type { PaperworkPatientData } from "@/lib/db-types";
import { savePatientData } from "./actions";

function listToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  if (value.every((v) => typeof v === "string")) return value.join("\n");
  return JSON.stringify(value, null, 2);
}

function textToList(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to line parsing
    }
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function CompletenessPanel({
  patientId,
  data,
  onDataChange,
}: {
  patientId: string;
  data: PaperworkPatientData;
  onDataChange: (next: PaperworkPatientData) => void;
}) {
  const [draft, setDraft] = useState<PaperworkPatientData>(data);
  const [listBuffers, setListBuffers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Recompute completeness live as the user edits.
  const completeness = useMemo(() => evaluateCompleteness(draft), [draft]);

  const setField = (path: string, value: unknown) => {
    setDraft((prev) => setValueAtPath(prev as Record<string, unknown>, path, value));
    setSavedAt(null);
  };

  const commitListBuffer = (path: string) => {
    const raw = listBuffers[path];
    if (raw === undefined) return;
    setField(path, textToList(raw));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    // Commit any pending list edits first.
    let next = draft;
    for (const [path, raw] of Object.entries(listBuffers)) {
      next = setValueAtPath(next as Record<string, unknown>, path, textToList(raw));
    }
    setDraft(next);
    const result = await savePatientData(patientId, next);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setListBuffers({});
    setSavedAt(Date.now());
    onDataChange(next);
  };

  const pct =
    completeness.totalCount === 0
      ? 0
      : Math.round((completeness.knownCount / completeness.totalCount) * 100);

  return (
    <section className="tron-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="tron-panel-title">Patient Information</h2>
          <p className="mt-1 text-sm text-[var(--tron-muted)]">
            <span className="tron-ok">{completeness.knownCount}</span> known ·{" "}
            <span className="tron-bad">
              {completeness.totalCount - completeness.knownCount}
            </span>{" "}
            missing · {pct}% complete
          </p>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs tron-bad">{error}</span>}
          {savedAt && !error && (
            <span className="text-xs tron-ok">Saved</span>
          )}
          <button className="tron-btn" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(2,8,14,0.8)]">
        <div
          className="h-full rounded-full bg-[var(--tron-cyan)]"
          style={{ width: `${pct}%`, boxShadow: "0 0 10px var(--tron-cyan)" }}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {completeness.sections.map((section) => (
          <details key={section.key} className="tron-tile p-0" open>
            <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm">
              <span className="font-semibold text-[var(--tron-text)]">
                {section.label}
              </span>
              <span className="text-xs">
                <span className="tron-ok">{section.knownCount}</span>
                <span className="text-[var(--tron-muted)]">/{section.totalCount}</span>
              </span>
            </summary>
            <div className="tron-scroll max-h-72 space-y-2 overflow-auto px-3 pb-3">
              {section.fields.map((field) => (
                <FieldRow
                  key={field.path}
                  field={field}
                  draft={draft}
                  listBuffers={listBuffers}
                  onText={(v) => setField(field.path, v)}
                  onNumber={(v) => setField(field.path, v)}
                  onBoolean={(v) => setField(field.path, v)}
                  onListBuffer={(v) =>
                    setListBuffers((prev) => ({ ...prev, [field.path]: v }))
                  }
                  onListBlur={() => commitListBuffer(field.path)}
                />
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function FieldRow({
  field,
  draft,
  listBuffers,
  onText,
  onNumber,
  onBoolean,
  onListBuffer,
  onListBlur,
}: {
  field: FieldStatus;
  draft: PaperworkPatientData;
  listBuffers: Record<string, string>;
  onText: (v: string) => void;
  onNumber: (v: number | null) => void;
  onBoolean: (v: boolean) => void;
  onListBuffer: (v: string) => void;
  onListBlur: () => void;
}) {
  const value = getValueAtPath(draft, field.path);

  return (
    <div className="flex items-start gap-2">
      <span
        className={"mt-1.5 shrink-0 " + (field.known ? "tron-ok" : "tron-bad")}
        title={field.known ? "Known" : "Missing"}
        aria-label={field.known ? "Known" : "Missing"}
      >
        {field.known ? "✓" : "✗"}
      </span>
      <label className="block w-full">
        <span className="text-[11px] text-[var(--tron-muted)]">{field.label}</span>
        {field.kind === "boolean" ? (
          <div className="mt-0.5">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onBoolean(e.target.checked)}
              className="h-4 w-4 accent-[var(--tron-cyan)]"
            />
          </div>
        ) : field.kind === "number" ? (
          <input
            type="number"
            className="tron-input mt-0.5 text-sm"
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) =>
              onNumber(e.target.value === "" ? null : Number(e.target.value))
            }
          />
        ) : field.kind === "list" ? (
          <textarea
            className="tron-input mt-0.5 text-sm"
            rows={3}
            placeholder="One item per line"
            value={listBuffers[field.path] ?? listToText(value)}
            onChange={(e) => onListBuffer(e.target.value)}
            onBlur={onListBlur}
          />
        ) : (
          <input
            type="text"
            className="tron-input mt-0.5 text-sm"
            value={typeof value === "string" ? value : value == null ? "" : String(value)}
            onChange={(e) => onText(e.target.value)}
          />
        )}
      </label>
    </div>
  );
}
