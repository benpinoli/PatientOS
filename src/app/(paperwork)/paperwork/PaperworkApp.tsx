"use client";

import { useMemo, useState } from "react";
import type {
  PaperworkDocument,
  PaperworkJsonTemplate,
  PaperworkLogo,
  PaperworkPatientData,
  PaperworkTemplate,
  PayerTypeRecord,
} from "@/lib/db-types";
import { DEFAULT_DEFINITION, emptyPatientData } from "@/lib/paperwork/schema";
import type { JsonTemplateDefinition } from "@/lib/paperwork/template-def";
import { loadPatientPaperwork } from "./actions";
import type { PatientLite } from "./types";
import { CompletenessPanel } from "./CompletenessPanel";
import { InputFilesPanel } from "./InputFilesPanel";
import { TemplatesPanel } from "./TemplatesPanel";
import { JsonTemplatesPanel } from "./JsonTemplatesPanel";

/** Color for a completion percentage (red < 30, orange < 60, yellow < 90, green). */
function pctColor(pct: number): string {
  if (pct < 30) return "#ff4d4f";
  if (pct < 60) return "#ff9f43";
  if (pct < 90) return "#ffd93d";
  return "#36e07a";
}

function CompletionBadge({ pct }: { pct: number }) {
  const done = pct >= 100;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{
          backgroundColor: done ? "#36e07a" : "#ff4d4f",
          boxShadow: `0 0 6px ${done ? "#36e07a" : "#ff4d4f"}`,
        }}
        aria-hidden
      />
      <span className="text-xs font-semibold" style={{ color: pctColor(pct) }}>
        {pct}%
      </span>
      {done && (
        <span
          className="rounded px-1 text-[9px] font-bold uppercase"
          style={{ backgroundColor: "rgba(54,224,122,0.18)", color: "#36e07a" }}
        >
          complete
        </span>
      )}
    </span>
  );
}

export function PaperworkApp({
  patients,
  templates: initialTemplates,
  logos: initialLogos,
  jsonTemplates: initialJsonTemplates,
  payerTypes,
  initialTotalDownloads,
}: {
  patients: PatientLite[];
  templates: PaperworkTemplate[];
  logos: PaperworkLogo[];
  jsonTemplates: PaperworkJsonTemplate[];
  payerTypes: PayerTypeRecord[];
  initialTotalDownloads: number;
}) {
  const [tab, setTab] = useState<"patients" | "templates">("patients");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [patientData, setPatientData] = useState<PaperworkPatientData | null>(null);
  const [documents, setDocuments] = useState<PaperworkDocument[]>([]);
  const [templates, setTemplates] = useState<PaperworkTemplate[]>(initialTemplates);
  const [logos, setLogos] = useState<PaperworkLogo[]>(initialLogos);
  const [jsonTemplates, setJsonTemplates] =
    useState<PaperworkJsonTemplate[]>(initialJsonTemplates);
  const [dataVersion, setDataVersion] = useState(0);
  const [totalDownloads, setTotalDownloads] = useState(initialTotalDownloads);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPatient = patients.find((p) => p.id === selectedId) ?? null;

  // payer type -> default field definition (falls back to the built-in default).
  const defByType = useMemo(() => {
    const m = new Map<string, JsonTemplateDefinition>();
    for (const t of jsonTemplates) if (t.is_default) m.set(t.payer_type, t.definition);
    return m;
  }, [jsonTemplates]);

  const definitionFor = (payerType: string | null): JsonTemplateDefinition =>
    (payerType && defByType.get(payerType)) || DEFAULT_DEFINITION;

  const selectedDefinition = definitionFor(selectedPatient?.payer_type ?? null);

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
    const blank = emptyPatientData(definitionFor(patient.payer_type));
    if (!result.ok) {
      setError(result.error);
      setPatientData(blank);
      setDocuments([]);
      return;
    }
    setPatientData(
      Object.keys(result.value.data).length ? result.value.data : blank,
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
      {/* Top tabs + global all-time download counter */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={"tron-btn text-sm " + (tab === "patients" ? "tron-tile-selected" : "")}
          onClick={() => setTab("patients")}
        >
          Patients
        </button>
        <button
          className={"tron-btn text-sm " + (tab === "templates" ? "tron-tile-selected" : "")}
          onClick={() => setTab("templates")}
        >
          JSON Templates
        </button>
        <span
          className="ml-auto flex items-center gap-2 rounded-lg border border-[var(--tron-line)] px-3 py-1.5 text-xs"
          title="Total PDFs downloaded by everyone, all time"
        >
          <span className="text-[var(--tron-muted)]">PDFs downloaded (all time)</span>
          <span className="text-base font-bold tron-glow">
            {totalDownloads.toLocaleString()}
          </span>
        </span>
      </div>

      {tab === "templates" ? (
        <JsonTemplatesPanel
          payerTypes={payerTypes}
          templates={jsonTemplates}
          onTemplatesChange={setJsonTemplates}
        />
      ) : (
        <>
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
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-[var(--tron-text)] hover:bg-[rgba(46,242,255,0.08)]"
                      >
                        <span className="truncate">
                          {p.last_name}, {p.first_name}
                        </span>
                        <CompletionBadge pct={p.completion_pct} />
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
              {/* Input / Output panels — above the patient information checklist */}
              <div className="grid gap-5 lg:grid-cols-2">
                <InputFilesPanel patientId={selectedId} onExtracted={onExtracted} />
                <TemplatesPanel
                  patientId={selectedId}
                  patientLabel={
                    selectedPatient
                      ? `${selectedPatient.last_name}, ${selectedPatient.first_name}`
                      : null
                  }
                  templates={templates}
                  onTemplatesChange={setTemplates}
                  logos={logos}
                  onLogosChange={setLogos}
                  documents={documents}
                  onDocumentsChange={setDocuments}
                  onTotalDownloadsChange={setTotalDownloads}
                />
              </div>

              <CompletenessPanel
                key={`${selectedId}-${dataVersion}`}
                patientId={selectedId}
                data={patientData}
                definition={selectedDefinition}
                onDataChange={(next) => setPatientData(next)}
              />
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
        </>
      )}
    </div>
  );
}
