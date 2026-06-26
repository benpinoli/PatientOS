"use client";

import { useState } from "react";
import type { PaperworkJsonTemplate } from "@/lib/db-types";
import type {
  FieldKind,
  JsonTemplateDefinition,
  JsonTemplateField,
  JsonTemplateSection,
} from "@/lib/paperwork/template-def";
import { deleteJsonTemplate, updateJsonTemplate } from "./actions";

const KINDS: { value: FieldKind; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "date", label: "Date" },
  { value: "choice", label: "Choice" },
  { value: "list", label: "List" },
];

/** snake_case key derived from a human label, for new field paths. */
function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

export function JsonTemplateEditor({
  template,
  onSaved,
  onDeleted,
}: {
  template: PaperworkJsonTemplate;
  onSaved: (next: PaperworkJsonTemplate) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(template.name);
  const [sections, setSections] = useState<JsonTemplateSection[]>(
    template.definition?.sections ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty =
    name !== template.name ||
    JSON.stringify(sections) !== JSON.stringify(template.definition?.sections ?? []);

  const fieldCount = sections.reduce((n, s) => n + s.fields.length, 0);

  const updateSection = (si: number, patch: Partial<JsonTemplateSection>) =>
    setSections((prev) => prev.map((s, i) => (i === si ? { ...s, ...patch } : s)));

  const updateField = (si: number, fi: number, patch: Partial<JsonTemplateField>) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === si
          ? { ...s, fields: s.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)) }
          : s,
      ),
    );

  const addField = (si: number) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === si
          ? {
              ...s,
              fields: [
                ...s.fields,
                { path: `field_${s.fields.length + 1}`, label: "New field", kind: "text" },
              ],
            }
          : s,
      ),
    );

  const removeField = (si: number, fi: number) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === si ? { ...s, fields: s.fields.filter((_, j) => j !== fi) } : s,
      ),
    );

  const addSection = () =>
    setSections((prev) => [
      ...prev,
      { key: `section_${prev.length + 1}`, label: "New section", fields: [] },
    ]);

  const removeSection = (si: number) =>
    setSections((prev) => prev.filter((_, i) => i !== si));

  const save = async () => {
    setSaving(true);
    setError(null);
    const definition: JsonTemplateDefinition = { sections };
    const result = await updateJsonTemplate(template.id, { name, definition });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSavedAt(Date.now());
    onSaved(result.value);
  };

  const setDefault = async () => {
    setError(null);
    const result = await updateJsonTemplate(template.id, { is_default: true });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(result.value);
  };

  const doDelete = async () => {
    setDeleting(true);
    setError(null);
    const result = await deleteJsonTemplate(template.id);
    setDeleting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirmDelete(false);
    onDeleted(template.id);
  };

  return (
    <div className="tron-panel p-4">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-[var(--tron-line)] pb-3">
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-[var(--tron-muted)]">
            Template name
          </span>
          <input
            className="tron-input max-w-md text-base font-semibold"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSavedAt(null);
            }}
            placeholder="Template name"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--tron-muted)]">
            {sections.length} section{sections.length === 1 ? "" : "s"} · {fieldCount}{" "}
            field{fieldCount === 1 ? "" : "s"}
          </span>
          {template.is_default ? (
            <span className="tron-chip tron-ok text-[10px]">DEFAULT</span>
          ) : (
            <button className="tron-btn text-xs" type="button" onClick={setDefault}>
              Set as default
            </button>
          )}
          {error && <span className="text-xs tron-bad">{error}</span>}
          {savedAt && !error && <span className="text-xs tron-ok">Saved ✓</span>}
          <button
            className="tron-btn text-sm"
            type="button"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            className="tron-btn tron-bad text-sm"
            type="button"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Sections — two-column split, like Patient Information */}
      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((section, si) => (
          <div key={si} className="tron-tile flex flex-col p-3">
            <div className="mb-2 flex items-center gap-2 border-b border-[var(--tron-line)] pb-2">
              <input
                className="tron-input flex-1 text-sm font-semibold"
                value={section.label}
                onChange={(e) => updateSection(si, { label: e.target.value })}
                placeholder="Section label"
              />
              <span className="shrink-0 text-[10px] text-[var(--tron-muted)]">
                {section.fields.length} field{section.fields.length === 1 ? "" : "s"}
              </span>
              <button
                className="tron-btn tron-bad shrink-0 text-[11px]"
                type="button"
                onClick={() => removeSection(si)}
                title="Remove section"
              >
                Remove
              </button>
            </div>

            <label className="mb-2 flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-[var(--tron-muted)]">
                Key
              </span>
              <input
                className="tron-input flex-1 text-[11px] text-[var(--tron-muted)]"
                value={section.key}
                onChange={(e) => updateSection(si, { key: slugify(e.target.value) })}
                placeholder="section_key"
                title="JSON key for this section"
              />
            </label>

            {/* Scrolls internally when the section has many fields, so a long
                section never stretches the whole column (matches the Patient
                Information panel). */}
            <div className="tron-scroll max-h-80 space-y-2 overflow-auto pr-1">
              {section.fields.map((field, fi) => (
                <div
                  key={fi}
                  className="rounded-lg border border-[var(--tron-line)] bg-[rgba(2,8,14,0.35)] p-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      className="tron-input flex-1 text-sm"
                      value={field.label}
                      onChange={(e) => updateField(si, fi, { label: e.target.value })}
                      onBlur={() => {
                        if (!field.path.trim())
                          updateField(si, fi, { path: slugify(field.label) });
                      }}
                      placeholder="Field label"
                    />
                    <button
                      className="tron-btn tron-bad shrink-0 text-[11px]"
                      type="button"
                      onClick={() => removeField(si, fi)}
                      title="Remove field"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <input
                      className="tron-input min-w-32 flex-1 text-[11px] text-[var(--tron-muted)]"
                      value={field.path}
                      onChange={(e) => updateField(si, fi, { path: e.target.value })}
                      placeholder="json_path"
                      title="JSON key/path within the section (dots allowed for nesting)"
                    />
                    <select
                      className="tron-input w-28 text-xs"
                      value={field.kind}
                      onChange={(e) =>
                        updateField(si, fi, { kind: e.target.value as FieldKind })
                      }
                    >
                      {KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {field.kind === "choice" && (
                    <input
                      className="tron-input mt-1.5 w-full text-[11px]"
                      value={(field.options ?? []).join(", ")}
                      onChange={(e) =>
                        updateField(si, fi, {
                          options: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Choices: Option A, Option B, …"
                    />
                  )}
                </div>
              ))}
            </div>
            {/* Add stays pinned below the scroll area so it's always reachable. */}
            <button
              className="tron-btn mt-2 w-full text-[11px]"
              type="button"
              onClick={() => addField(si)}
            >
              + Add field
            </button>
          </div>
        ))}
      </div>

      <button
        className="tron-btn mt-3 text-sm"
        type="button"
        onClick={addSection}
      >
        + Add section
      </button>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !deleting && setConfirmDelete(false)}
        >
          <div
            className="tron-panel w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="tron-panel-title mb-2">Delete JSON template?</h3>
            <p className="text-sm text-[var(--tron-text)]">
              Are you sure you want to delete{" "}
              <strong className="tron-glow">{template.name}</strong>? Existing
              patient data is not changed; only the field structure for new work is
              affected.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="tron-btn text-xs"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="tron-btn tron-bad text-xs"
                onClick={doDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
