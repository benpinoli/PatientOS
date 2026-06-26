"use client";

import { useRef, useState } from "react";
import type { PaperworkPatientData } from "@/lib/db-types";
import { PdfThumbnail } from "./PdfThumbnail";
import { readApiJson } from "./api";

export function InputFilesPanel({
  patientId,
  onExtracted,
}: {
  patientId: string | null;
  onExtracted: (data: PaperworkPatientData) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | File[]) => {
    const next = Array.from(incoming);
    if (next.length) setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const extract = async () => {
    if (!patientId) return;
    if (files.length === 0 && !text.trim()) {
      setError("Add a file or type some information first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("patient_id", patientId);
      form.set("text", text);
      for (const file of files) form.append("files", file);
      const res = await fetch("/api/paperwork/extract", {
        method: "POST",
        body: form,
      });
      const json = await readApiJson<{ data: PaperworkPatientData }>(
        res,
        "Extraction",
      );
      onExtracted(json.data);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  };

  const disabled = !patientId;

  return (
    <section className="tron-panel flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="tron-panel-title">Input — Patient Documents</h2>
        <button
          className="tron-btn text-xs"
          onClick={extract}
          disabled={disabled || busy}
          title={disabled ? "Select a patient first" : undefined}
        >
          {busy ? "Reading…" : "Extract with AI"}
        </button>
      </div>

      <div
        className={
          "tron-dropzone flex min-h-28 flex-col items-center justify-center gap-2 p-4 text-center " +
          (dragActive ? "tron-dropzone-active" : "")
        }
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => !disabled && onDrop(e)}
      >
        <p className="text-sm text-[var(--tron-muted)]">
          Drag &amp; drop files here, or
        </p>
        <button
          className="tron-btn text-xs"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      <textarea
        className="tron-input mt-3 text-sm"
        rows={3}
        placeholder="…or type/paste patient information here"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
      />

      {error && <p className="mt-2 text-xs tron-bad">{error}</p>}

      <div className="tron-scroll mt-3 grid flex-1 grid-cols-2 gap-3 overflow-auto sm:grid-cols-3">
        {files.map((file, idx) => (
          <div key={`${file.name}-${idx}`} className="tron-tile overflow-hidden">
            <div className="aspect-[3/4] w-full bg-[rgba(2,8,14,0.9)]">
              <PdfThumbnail file={file} />
            </div>
            <div className="flex items-center justify-between gap-1 px-2 py-1">
              <span className="truncate text-[10px] text-[var(--tron-muted)]" title={file.name}>
                {file.name}
              </span>
              <button
                className="text-[10px] tron-bad"
                onClick={() => removeFile(idx)}
                aria-label="Remove file"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        {files.length === 0 && (
          <p className="col-span-full py-6 text-center text-xs text-[var(--tron-muted)]">
            Added files preview here.
          </p>
        )}
      </div>
    </section>
  );
}
