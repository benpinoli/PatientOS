"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PaperworkDocument,
  PaperworkLogo,
  PaperworkTemplate,
} from "@/lib/db-types";
import {
  deleteLogo,
  deleteTemplate,
  recordPaperworkDownloads,
  saveFilledDocument,
  saveLogo,
  updateLogo,
} from "./actions";
import { fileToBase64Payload, runPaperworkJob } from "./api";
import { embedLogo } from "./branding";
import {
  downloadBlob,
  downloadDocsAsZip,
  htmlToPdfBlob,
  injectPageStyle,
  safePdfName,
} from "./pdf";

/** Reads an image File into a `data:` URI string. */
function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

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
  logos,
  onLogosChange,
  documents,
  onDocumentsChange,
  onTotalDownloadsChange,
}: {
  patientId: string | null;
  patientLabel?: string | null;
  templates: PaperworkTemplate[];
  onTemplatesChange: (next: PaperworkTemplate[]) => void;
  logos: PaperworkLogo[];
  onLogosChange: (next: PaperworkLogo[]) => void;
  documents: PaperworkDocument[];
  onDocumentsChange: (next: PaperworkDocument[]) => void;
  onTotalDownloadsChange: (total: number) => void;
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
  const [chosenFileName, setChosenFileName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<PaperworkTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [logoId, setLogoId] = useState<string>("");
  const [logoUploadOpen, setLogoUploadOpen] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoCompany, setLogoCompany] = useState("");
  const [busyLogo, setBusyLogo] = useState(false);
  const [confirmDeleteLogo, setConfirmDeleteLogo] = useState<PaperworkLogo | null>(null);
  const [deletingLogo, setDeletingLogo] = useState(false);
  const [companyDraft, setCompanyDraft] = useState("");
  const [savingCompany, setSavingCompany] = useState(false);
  const [fullView, setFullView] = useState(false);
  const [savingTyped, setSavingTyped] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const fullRef = useRef<HTMLIFrameElement>(null);

  const selectedLogo = logos.find((l) => l.id === logoId) ?? null;

  // Keep the editable company-name draft in sync with the selected logo.
  useEffect(() => {
    setCompanyDraft(selectedLogo?.company_name ?? "");
  }, [selectedLogo?.id, selectedLogo?.company_name]);

  // Close the full-view editor whenever the selected template changes.
  useEffect(() => {
    setFullView(false);
  }, [selectedId]);

  const selectedDoc = documents.find((d) => d.template_id === selectedId) ?? null;
  const selectedTemplate = templates.find((t) => t.id === selectedId) ?? null;
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

  /**
   * Serializes the live field values from a rendered iframe back into the HTML
   * string, so anything the user typed (text, checkboxes, signatures) is part of
   * the saved/downloaded document — not just the AI-filled values.
   */
  const captureHtmlFromIframe = (
    iframe: HTMLIFrameElement | null,
    fallback: string,
  ): string => {
    const doc = iframe?.contentDocument;
    if (!doc || !doc.body) return fallback;
    doc
      .querySelectorAll<HTMLInputElement>("input")
      .forEach((el) => {
        if (el.type === "checkbox" || el.type === "radio") {
          if (el.checked) el.setAttribute("checked", "");
          else el.removeAttribute("checked");
        } else {
          el.setAttribute("value", el.value);
        }
      });
    doc
      .querySelectorAll<HTMLTextAreaElement>("textarea")
      .forEach((el) => {
        el.textContent = el.value;
      });
    doc.querySelectorAll<HTMLSelectElement>("select").forEach((el) => {
      Array.from(el.options).forEach((opt) => {
        if (opt.selected) opt.setAttribute("selected", "");
        else opt.removeAttribute("selected");
      });
    });
    return `<!doctype html>${doc.documentElement.outerHTML}`;
  };

  /** HTML for `doc`, preferring live typed values when its iframe is open. */
  const htmlForDoc = (doc: PaperworkDocument): string => {
    if (selectedDoc && doc.id === selectedDoc.id) {
      const iframe = fullView ? fullRef.current : previewRef.current;
      return captureHtmlFromIframe(iframe, doc.filled_html);
    }
    return doc.filled_html;
  };

  /**
   * Records actual downloads (one per document) so a document only counts as
   * "filled" once its PDF is saved on the user's end, and bumps the global
   * all-time counter. Best-effort: a failure here doesn't undo the download.
   */
  const recordDownloads = async (docIds: string[]) => {
    if (docIds.length === 0) return;
    const result = await recordPaperworkDownloads(docIds);
    if (!result.ok) return;
    const { counts, total } = result.value;
    onTotalDownloadsChange(total);
    onDocumentsChange(
      documents.map((d) =>
        counts[d.id] != null ? { ...d, download_count: counts[d.id] } : d,
      ),
    );
  };

  const downloadOne = async (doc: PaperworkDocument) => {
    setDownloadMsg("Building PDF…");
    setError(null);
    try {
      const blob = await htmlToPdfBlob(htmlForDoc(doc));
      downloadBlob(blob, safePdfName(doc.template_name ?? "document"));
      await recordDownloads([doc.id]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF.");
    } finally {
      setDownloadMsg(null);
    }
  };

  /** Persists the currently typed-in field values back to the document. */
  const saveTyped = async (doc: PaperworkDocument) => {
    setSavingTyped(true);
    setError(null);
    const html = htmlForDoc(doc);
    const result = await saveFilledDocument(doc.id, html);
    setSavingTyped(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDocumentsChange(
      documents.map((d) => (d.id === doc.id ? { ...d, filled_html: html } : d)),
    );
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
      await recordDownloads(chosen.map((d) => d.id));
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
        input: {
          name: uploadName.trim(),
          file: filePayload,
          logoDataUri: selectedLogo?.data_uri ?? null,
          logoCompanyName: selectedLogo?.company_name ?? null,
        },
        onElapsed: setUploadElapsed,
      });
      const tmpl = json.template;
      onTemplatesChange([...templates, tmpl].sort((a, b) => a.name.localeCompare(b.name)));
      setUploadOpen(false);
      setUploadName("");
      setChosenFileName("");
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

  const saveNewLogo = async () => {
    if (!logoFile) {
      setError("Choose a logo image first.");
      return;
    }
    setBusyLogo(true);
    setError(null);
    try {
      const dataUri = await fileToDataUri(logoFile);
      const result = await saveLogo(baseName(logoFile.name), dataUri, logoCompany);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onLogosChange(
        [...logos, result.value].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setLogoId(result.value.id);
      setLogoUploadOpen(false);
      setLogoFile(null);
      setLogoCompany("");
      if (logoRef.current) logoRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the logo.");
    } finally {
      setBusyLogo(false);
    }
  };

  const saveCompanyName = async () => {
    if (!selectedLogo) return;
    setSavingCompany(true);
    setError(null);
    const result = await updateLogo(selectedLogo.id, companyDraft);
    setSavingCompany(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onLogosChange(
      logos.map((l) => (l.id === result.value.id ? result.value : l)),
    );
  };

  const confirmDeleteLogoNow = async () => {
    if (!confirmDeleteLogo) return;
    setDeletingLogo(true);
    setError(null);
    const result = await deleteLogo(confirmDeleteLogo.id);
    setDeletingLogo(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const deletedId = confirmDeleteLogo.id;
    onLogosChange(logos.filter((l) => l.id !== deletedId));
    if (logoId === deletedId) setLogoId("");
    setConfirmDeleteLogo(null);
  };

  const confirmDeleteTemplate = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    const result = await deleteTemplate(confirmDelete.id);
    setDeleting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const deletedId = confirmDelete.id;
    onTemplatesChange(templates.filter((t) => t.id !== deletedId));
    if (selectedId === deletedId) setSelectedId(null);
    setConfirmDelete(null);
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
          <div className="flex items-center gap-2">
            <button
              className="tron-btn text-xs"
              type="button"
              onClick={() => fileRef.current?.click()}
            >
              Choose File
            </button>
            <span className="truncate text-xs text-[var(--tron-muted)]" title={chosenFileName}>
              {chosenFileName || "No file chosen"}
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setChosenFileName(f.name);
                setUploadName(baseName(f.name));
              }
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--tron-muted)]">Branding logo:</span>
            <select
              className="tron-input max-w-44 text-xs"
              value={logoId}
              onChange={(e) => setLogoId(e.target.value)}
            >
              <option value="">No logo</option>
              {logos.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.company_name ? ` — ${l.company_name}` : ""}
                </option>
              ))}
            </select>
            <button
              className="tron-btn text-xs"
              type="button"
              onClick={() => setLogoUploadOpen((v) => !v)}
            >
              {logoUploadOpen ? "Cancel" : "Upload logo"}
            </button>
            {selectedLogo && (
              <button
                className="tron-btn tron-bad text-xs"
                type="button"
                onClick={() => setConfirmDeleteLogo(selectedLogo)}
              >
                Delete logo
              </button>
            )}
            {selectedLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedLogo.data_uri}
                alt={selectedLogo.name}
                className="h-7 max-w-24 rounded bg-white object-contain p-0.5"
              />
            )}
          </div>

          {selectedLogo && !logoUploadOpen && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--tron-muted)]">Company name:</span>
              <input
                className="tron-input max-w-56 text-xs"
                placeholder="Shown as the title on the form"
                value={companyDraft}
                onChange={(e) => setCompanyDraft(e.target.value)}
              />
              <button
                className="tron-btn text-xs"
                type="button"
                onClick={saveCompanyName}
                disabled={
                  savingCompany ||
                  companyDraft.trim() === (selectedLogo.company_name ?? "").trim()
                }
              >
                {savingCompany ? "Saving…" : "Save name"}
              </button>
            </div>
          )}

          {logoUploadOpen && (
            <div className="tron-tile space-y-2 p-2">
              <div className="flex items-center gap-2">
                <button
                  className="tron-btn text-xs"
                  type="button"
                  onClick={() => logoRef.current?.click()}
                >
                  Choose image
                </button>
                <span className="truncate text-xs text-[var(--tron-muted)]">
                  {logoFile ? logoFile.name : "No image chosen"}
                </span>
              </div>
              <input
                className="tron-input text-sm"
                placeholder="Company name (shown next to the logo)"
                value={logoCompany}
                onChange={(e) => setLogoCompany(e.target.value)}
              />
              <button
                className="tron-btn text-xs"
                type="button"
                onClick={saveNewLogo}
                disabled={busyLogo}
              >
                {busyLogo ? "Saving…" : "Save logo"}
              </button>
            </div>
          )}
          <input
            ref={logoRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setLogoFile(f);
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
                <TemplatePreview
                  html={embedLogo(t.html, t.logo_data_uri, t.logo_company_name)}
                  name={t.name}
                />
              ) : (
                <div
                  className="flex w-full items-center justify-center rounded bg-white text-3xl"
                  style={{ aspectRatio: "3 / 4" }}
                >
                  🧾
                </div>
              )}
              <span className="px-1 text-[11px] text-[var(--tron-text)]">{t.name}</span>
              {doc && doc.download_count > 0 && (
                <span className="text-[9px] tron-ok">
                  filled ×{doc.download_count}
                </span>
              )}
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
                  onClick={() => setFullView(true)}
                >
                  Open full view
                </button>
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
            {selectedTemplate && !editing && (
              <button
                className="tron-btn tron-bad ml-auto text-xs"
                onClick={() => setConfirmDelete(selectedTemplate)}
              >
                Delete template
              </button>
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
              ref={previewRef}
              title="Filled document"
              className="min-h-96 flex-1 rounded-lg border border-[var(--tron-line)] bg-white"
              sandbox="allow-same-origin"
              srcDoc={injectPageStyle(selectedDoc.filled_html)}
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

      {fullView && selectedDoc && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4">
          <div className="mx-auto flex w-full max-w-[860px] items-center gap-2 pb-3">
            <h3 className="tron-panel-title mr-auto truncate">
              {selectedDoc.template_name ?? "Document"}
            </h3>
            <button
              className="tron-btn text-xs"
              onClick={() => downloadOne(selectedDoc)}
              disabled={busyDownload}
            >
              {busyDownload ? downloadMsg : "Download PDF"}
            </button>
            <button
              className="tron-btn text-xs"
              onClick={() => saveTyped(selectedDoc)}
              disabled={savingTyped}
            >
              {savingTyped ? "Saving…" : "Save typed text"}
            </button>
            <button
              className="tron-btn text-xs"
              onClick={() => setFullView(false)}
            >
              Close
            </button>
          </div>
          <div className="mx-auto w-full max-w-[860px] flex-1 overflow-auto rounded-lg bg-neutral-300 p-4">
            <iframe
              ref={fullRef}
              title="Full view"
              sandbox="allow-same-origin"
              srcDoc={injectPageStyle(selectedDoc.filled_html)}
              className="mx-auto block border-0 bg-white shadow-lg"
              style={{ width: "816px", height: "1056px" }}
              onLoad={(e) => {
                const f = e.currentTarget;
                const d = f.contentDocument;
                if (d?.body) f.style.height = `${d.body.scrollHeight}px`;
              }}
            />
          </div>
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !deleting && setConfirmDelete(null)}
        >
          <div
            className="tron-panel w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="tron-panel-title mb-2">Delete template?</h3>
            <p className="text-sm text-[var(--tron-text)]">
              Are you sure you want to delete{" "}
              <strong className="tron-glow">{confirmDelete.name}</strong>? This
              removes it from the shared template library for everyone. Documents
              already filled from it are kept.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="tron-btn text-xs"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="tron-btn tron-bad text-xs"
                onClick={confirmDeleteTemplate}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteLogo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !deletingLogo && setConfirmDeleteLogo(null)}
        >
          <div
            className="tron-panel w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="tron-panel-title mb-2">Delete logo?</h3>
            <p className="text-sm text-[var(--tron-text)]">
              Are you sure you want to delete the logo{" "}
              <strong className="tron-glow">{confirmDeleteLogo.name}</strong> from
              the shared library? Templates already created with it keep their
              branding.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="tron-btn text-xs"
                onClick={() => setConfirmDeleteLogo(null)}
                disabled={deletingLogo}
              >
                Cancel
              </button>
              <button
                className="tron-btn tron-bad text-xs"
                onClick={confirmDeleteLogoNow}
                disabled={deletingLogo}
              >
                {deletingLogo ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
