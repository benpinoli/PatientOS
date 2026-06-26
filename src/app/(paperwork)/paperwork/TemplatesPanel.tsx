"use client";

import { useEffect, useRef, useState } from "react";
import type { PaperworkDocument, PaperworkTemplate } from "@/lib/db-types";
import { saveFilledDocument } from "./actions";
import { fileToBase64Payload, runPaperworkJob } from "./api";
import {
  downloadBlob,
  downloadDocsAsZip,
  htmlToPdfBlob,
  safePdfName,
} from "./pdf";

/** Filename without its extension, e.g. "CMS Face-to-Face.pdf" -> "CMS Face-to-Face". */
function baseName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "");
}

/** Scaled, non-interactive thumbnail of a template's HTML, filling its tile. */
function TemplatePreview({ html, name }: { html: string; name: string }) {
  const BASE = 740;
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / BASE);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden rounded bg-white"
      style={{ aspectRatio: "3 / 4" }}
    >
      <iframe
        title={name}
        sandbox=""
        scrolling="no"
        srcDoc={html}
        className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
        style={{
          width: `${BASE}px`,
          height: `${Math.round((BASE * 4) / 3)}px`,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}

export function TemplatesPanel({
  patientId,
  patientLabel,
  templates,
  onTemplatesChange,
  documents,
  onDocumentsChange,
}: {
  patientId: string | null;
  patientLabel?: string | null;
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedDoc = documents.find((d) => d.template_id === selectedId) ?? null;
  const filledDocs = documents;
  const busyDownload = downloadMsg !== null;

  const togglePicked = (docId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const downloadOne = async (doc: PaperworkDocument) => {
    setDownloadMsg("Building PDF…");
    setError(null);
    try {
      const blob = await htmlToPdfBlob(doc.filled_html);
      downloadBlob(blob, safePdfName(doc.template_name ?? "document"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF.");
    } finally {
      setDownloadMsg(null);
    }
  };

  const downloadPicked = async () => {
    const chosen = filledDocs.filter((d) => picked.has(d.id));
    if (chosen.length === 0) return;
    const folder = (patientLabel?.trim() || "Patient") + " - Filled Forms";
    setDownloadMsg(`Building ${chosen.length} PDF${chosen.length > 1 ? "s" : ""}…`);
    setError(null);
    try {
      await downloadDocsAsZip(
        chosen.map((d) => ({
          name: d.template_name ?? "document",
          html: d.filled_html,
        })),
        folder,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the folder.");
    } finally {
      setDownloadMsg(null);
    }
  };

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
          const doc = documents.find((d) => d.template_id === t.id) ?? null;
          const isSelected = selectedId === t.id;
          const hasPreview = Boolean(t.html?.trim());
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSelectedId(t.id);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(t.id);
                  setEditing(false);
                }
              }}
              className={
                "tron-tile relative flex cursor-pointer flex-col gap-1 p-2 text-center " +
                (isSelected ? "tron-tile-selected" : "")
              }
            >
              {doc && (
                <label
                  className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-white"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(doc.id)}
                    onChange={() => togglePicked(doc.id)}
                  />
                  select
                </label>
              )}
              {hasPreview ? (
                <TemplatePreview html={t.html} name={t.name} />
              ) : (
                <div
                  className="flex w-full items-center justify-center rounded bg-white text-3xl"
                  style={{ aspectRatio: "3 / 4" }}
                >
                  🧾
                </div>
              )}
              <span className="px-1 text-[11px] text-[var(--tron-text)]">{t.name}</span>
              {doc && <span className="text-[9px] tron-ok">filled</span>}
            </div>
          );
        })}
        {templates.length === 0 && (
          <p className="col-span-full py-6 text-center text-xs text-[var(--tron-muted)]">
            No templates yet. Upload a blank PDF to create an editable copy.
          </p>
        )}
      </div>

      {filledDocs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--tron-line)] pt-3">
          <span className="text-xs text-[var(--tron-muted)]">
            {picked.size} of {filledDocs.length} filled selected
          </span>
          <button
            className="tron-btn text-xs"
            onClick={() =>
              setPicked((prev) =>
                prev.size === filledDocs.length
                  ? new Set()
                  : new Set(filledDocs.map((d) => d.id)),
              )
            }
          >
            {picked.size === filledDocs.length ? "Clear" : "Select all"}
          </button>
          <button
            className="tron-btn text-xs"
            onClick={downloadPicked}
            disabled={picked.size === 0 || busyDownload}
          >
            {busyDownload ? downloadMsg : "Download selected as folder (.zip)"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs tron-bad">{error}</p>}

      {selectedId && (
        <div className="mt-4 flex flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <button className="tron-btn text-xs" onClick={fill} disabled={disabled || busyFill}>
              {busyFill ? `Filling… ${fillElapsed}s` : selectedDoc ? "Re-fill from patient data" : "Fill from patient data"}
            </button>
            {selectedDoc && !editing && (
              <>
                <button
                  className="tron-btn text-xs"
                  onClick={() => downloadOne(selectedDoc)}
                  disabled={busyDownload}
                >
                  {busyDownload ? downloadMsg : "Download PDF"}
                </button>
                <button className="tron-btn text-xs" onClick={startEdit}>
                  Edit HTML
                </button>
              </>
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
