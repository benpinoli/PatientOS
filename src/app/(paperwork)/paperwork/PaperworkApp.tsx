"use client";

import { useMemo, useState } from "react";
import type {
  PaperworkDocument,
  PaperworkPatientData,
  PaperworkTemplate,
} from "@/lib/db-types";
import { emptyPatientData } from "@/lib/paperwork/schema";
import { loadPatientPaperwork } from "./actions";
import type { PatientLite } from "./types";
import { CompletenessPanel } from "./CompletenessPanel";
import { InputFilesPanel } from "./InputFilesPanel";
import { TemplatesPanel } from "./TemplatesPanel";

export function PaperworkApp({
  patients,
  templates: initialTemplates,
}: {
  patients: PatientLite[];
  templates: PaperworkTemplate[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [patientData, setPatientData] = useState<PaperworkPatientData | null>(null);
  const [documents, setDocuments] = useState<PaperworkDocument[]>([]);
  const [templates, setTemplates] = useState<PaperworkTemplate[]>(initialTemplates);
  const [dataVersion, setDataVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPatient = patients.find((p) => p.id === selectedId) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? patients.filter((p) =>
          `${p.last_name}, ${p.first_name}`.toLowerCase().includes(needle),
        )
      : patients;
    return list.slice(0, 20);
  }, [patients, query]);

  const selectPatient = async (patient: PatientLite) => {
    setSelectedId(patient.id);
    setQuery(`${patient.last_name}, ${patient.first_name}`);
    setOpen(false);
    setLoading(true);
    setError(null);
    const result = await loadPatientPaperwork(patient.id);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setPatientData(emptyPatientData());
      setDocuments([]);
      return;
    }
    setPatientData(
      Object.keys(result.value.data).length ? result.value.data : emptyPatientData(),
    );
    setDocuments(result.value.documents);
    setDataVersion((v) => v + 1);
  };

  const onExtracted = (data: PaperworkPatientData) => {
    setPatientData(data);
    setDataVersion((v) => v + 1);
  };

  return (
    <div className="space-y-5">
      {/* Patient search bar */}
      <div className="tron-panel relative p-4">
        <label className="tron-panel-title">Patient</label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="relative min-w-64 flex-1">
            <input
              className="tron-input"
              placeholder="Search patients by name…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
            />
            {open && matches.length > 0 && (
              <div className="tron-scroll absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[var(--tron-line)] bg-[var(--tron-panel)] shadow-xl">
                {matches.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectPatient(p)}
                    className="block w-full px-3 py-2 text-left text-sm text-[var(--tron-text)] hover:bg-[rgba(46,242,255,0.08)]"
                  >
                    {p.last_name}, {p.first_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedPatient?.drive_folder_url ? (
            <a
              className="tron-link text-sm"
              href={selectedPatient.drive_folder_url}
              target="_blank"
              rel="noreferrer"
            >
              Open Drive folder ↗
            </a>
          ) : selectedPatient ? (
            <span className="text-xs text-[var(--tron-muted)]">
              No Drive folder link set in PatientOS
            </span>
          ) : null}
        </div>
        {loading && (
          <p className="mt-2 text-xs text-[var(--tron-muted)]">Loading patient…</p>
        )}
        {error && <p className="mt-2 text-xs tron-bad">{error}</p>}
      </div>

      {selectedId && patientData && (
        <>
          <CompletenessPanel
            key={`${selectedId}-${dataVersion}`}
            patientId={selectedId}
            data={patientData}
            onDataChange={(next) => setPatientData(next)}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <InputFilesPanel patientId={selectedId} onExtracted={onExtracted} />
            <TemplatesPanel
              patientId={selectedId}
              templates={templates}
              onTemplatesChange={setTemplates}
              documents={documents}
              onDocumentsChange={setDocuments}
            />
          </div>
        </>
      )}

      {!selectedId && (
        <div className="tron-panel p-10 text-center">
          <p className="text-lg tron-glow">Select a patient to begin</p>
          <p className="mt-2 text-sm text-[var(--tron-muted)]">
            Search above, then upload documents on the left and fill templates on
            the right.
          </p>
        </div>
      )}
    </div>
  );
}
