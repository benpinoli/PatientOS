"use client";

import { useRef, useState } from "react";
import type { PaperworkDocument, PaperworkTemplate } from "@/lib/db-types";
import { saveFilledDocument } from "./actions";
import { fileToBase64Payload, runPaperworkJob } from "./api";

/** Filename without its extension, e.g. "CMS Face-to-Face.pdf" -> "CMS Face-to-Face". */
function baseName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "");
}

export function TemplatesPanel({
  patientId,
  templates,
  onTemplatesChange,
  documents,
  onDocumentsChange,
}: {
  patientId: string | null;
  templates: PaperworkTemplate[];
  onTemplatesChange: (next: PaperworkTemplate[]) => void;
  documents: PaperworkDocument[];
  onDocumentsChange: (next: PaperworkDocument[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadElapsed, setUploadElapsed] = useState(0);
  const [busyFill, setBusyFill] = useState(false);
  const [fillElapsed, setFillElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editHtml, setEditHtml] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedDoc = documents.find((d) => d.template_id === selectedId) ?? null;

  const uploadTemplate = async () => {
    const file = fileRef.current?.files?.[0];
    if (!uploadName.trim() || !file) {
      setError("A template name and file are required.");
      return;
    }
    setBusyUpload(true);
    setUploadElapsed(0);
    setError(null);
    try {
      const filePayload = await fileToBase64Payload(file);
      const json = await runPaperworkJob<{ template: PaperworkTemplate }>({
        kind: "template",
        input: { name: uploadName.trim(), file: filePayload },
        onElapsed: setUploadElapsed,
      });
      const tmpl = json.template;
      onTemplatesChange([...templates, tmpl].sort((a, b) => a.name.localeCompare(b.name)));
      setUploadOpen(false);
      setUploadName("");
      if (fileRef.current) fileRef.current.value = "";
      setSelectedId(tmpl.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Template conversion failed.");
    } finally {
      setBusyUpload(false);
    }
  };

  const fill = async () => {
    if (!patientId || !selectedId) return;
    setBusyFill(true);
    setFillElapsed(0);
    setError(null);
    try {
      const json = await runPaperworkJob<{ document: PaperworkDocument }>({
        kind: "fill",
        patientId,
        templateId: selectedId,
        input: {},
        onElapsed: setFillElapsed,
      });
      const doc = json.document;
      const next = documents.filter((d) => d.template_id !== doc.template_id);
      onDocumentsChange([doc, ...next]);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fill failed.");
    } finally {
      setBusyFill(false);
    }
  };

  const startEdit = () => {
    if (!selectedDoc) return;
    setEditHtml(selectedDoc.filled_html);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selectedDoc) return;
    setSavingEdit(true);
    setError(null);
    const result = await saveFilledDocument(selectedDoc.id, editHtml);
    setSavingEdit(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDocumentsChange(
      documents.map((d) =>
        d.id === selectedDoc.id ? { ...d, filled_html: editHtml } : d,
      ),
    );
    setEditing(false);
  };

  const disabled = !patientId;

  return (
    <section className="tron-panel flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="tron-panel-title">Output — Templates</h2>
        <button className="tron-btn text-xs" onClick={() => setUploadOpen((v) => !v)}>
          {uploadOpen ? "Cancel" : "Upload template"}
        </button>
      </div>

      {uploadOpen && (
        <div className="tron-tile mb-3 space-y-2 p-3">
          <input
            className="tron-input text-sm"
            placeholder="Template name (e.g. CMS Face-to-Face)"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            className="block w-full text-xs text-[var(--tron-muted)]"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setUploadName(baseName(f.name));
            }}
          />
          <button className="tron-btn text-xs" onClick={uploadTemplate} disabled={busyUpload}>
            {busyUpload ? `Converting… ${uploadElapsed}s` : "Convert to editable copy"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {templates.map((t) => {
          const hasDoc = documents.some((d) => d.template_id === t.id);
          return (
            <button
              key={t.id}
              onClick={() => {
                setSelectedId(t.id);
                setEditing(false);
              }}
              className={
                "tron-tile flex aspect-[3/4] flex-col items-center justify-center gap-1 p-2 text-center " +
                (selectedId === t.id ? "tron-tile-selected" : "")
              }
            >
              <span className="text-2xl">🧾</span>
              <span className="px-1 text-[11px] text-[var(--tron-text)]">{t.name}</span>
              {hasDoc && <span className="text-[9px] tron-ok">filled</span>}
            </button>
          );
        })}
        {templates.length === 0 && (
          <p className="col-span-full py-6 text-center text-xs text-[var(--tron-muted)]">
            No templates yet. Upload a blank PDF to create an editable copy.
          </p>
        )}
      </div>

      {error && <p className="mt-2 text-xs tron-bad">{error}</p>}

      {selectedId && (
        <div className="mt-4 flex flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <button className="tron-btn text-xs" onClick={fill} disabled={disabled || busyFill}>
              {busyFill ? `Filling… ${fillElapsed}s` : selectedDoc ? "Re-fill from patient data" : "Fill from patient data"}
            </button>
            {selectedDoc && !editing && (
              <button className="tron-btn text-xs" onClick={startEdit}>
                Edit HTML
              </button>
            )}
            {editing && (
              <>
                <button className="tron-btn text-xs" onClick={saveEdit} disabled={savingEdit}>
                  {savingEdit ? "Saving…" : "Save"}
                </button>
                <button className="tron-btn text-xs" onClick={() => setEditing(false)}>
                  Close
                </button>
              </>
            )}
          </div>

          {editing ? (
            <textarea
              className="tron-input min-h-72 flex-1 font-mono text-xs"
              value={editHtml}
              onChange={(e) => setEditHtml(e.target.value)}
            />
          ) : selectedDoc ? (
            <iframe
              title="Filled document"
              className="min-h-96 flex-1 rounded-lg border border-[var(--tron-line)] bg-white"
              sandbox=""
              srcDoc={selectedDoc.filled_html}
            />
          ) : (
            <div className="flex min-h-48 flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--tron-line)] text-xs text-[var(--tron-muted)]">
              {disabled
                ? "Select a patient, then fill this template."
                : "Click “Fill from patient data” to generate this document."}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
