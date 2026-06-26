"use client";

import { useEffect, useRef, useState } from "react";
import type { PayerTypeRecord, PaperworkJsonTemplate } from "@/lib/db-types";
import { payerTypeSectionTitle } from "@/lib/payer-types";
import { DEFAULT_DEFINITION } from "@/lib/paperwork/schema";
import { countFields } from "@/lib/paperwork/template-def";
import { createJsonTemplate } from "./actions";
import { JsonTemplateEditor } from "./JsonTemplateEditor";

const STANDARD_FIELD_COUNT = countFields(DEFAULT_DEFINITION);

export function JsonTemplatesPanel({
  payerTypes,
  templates,
  onTemplatesChange,
}: {
  payerTypes: PayerTypeRecord[];
  templates: PaperworkJsonTemplate[];
  onTemplatesChange: (next: PaperworkJsonTemplate[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  // Bring the editor into view whenever a template is opened/created, so the
  // result of "Create from standard fields" is never off-screen.
  useEffect(() => {
    if (selected && editorRef.current) {
      editorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedId, selected]);

  const createFromStandard = async (payerType: string, displayName: string) => {
    setBusyType(payerType);
    setError(null);
    const existing = templates.filter((t) => t.payer_type === payerType).length;
    // First template for a type becomes its default; extras are numbered copies.
    const name =
      existing === 0
        ? `${displayName} standard fields`
        : `${displayName} standard fields (${existing + 1})`;
    const result = await createJsonTemplate(payerType, name, DEFAULT_DEFINITION);
    setBusyType(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onTemplatesChange([...templates, result.value]);
    setSelectedId(result.value.id);
  };

  return (
    <section className="space-y-4">
      <div className="tron-panel p-4">
        <h2 className="tron-panel-title">JSON field templates</h2>
        <p className="mt-1 text-sm text-[var(--tron-muted)]">
          Define the patient-data fields tracked for each patient type. The
          template marked <span className="tron-ok">DEFAULT</span> drives the
          completeness checklist and AI extraction for that type. New templates
          start from the standard fields ({STANDARD_FIELD_COUNT} fields from the
          example schema). Editing a template does not change existing patient
          data.
        </p>
        {error && <p className="mt-2 text-sm tron-bad">{error}</p>}
      </div>

      {/* Patient-type picker — one card per type, in a responsive grid. */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {payerTypes.map((pt) => {
          const forType = templates.filter((t) => t.payer_type === pt.code);
          return (
            <div key={pt.code} className="tron-tile flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--tron-text)]">
                  {payerTypeSectionTitle(pt)}
                </h3>
                <span className="text-[11px] text-[var(--tron-muted)]">
                  {forType.length} template{forType.length === 1 ? "" : "s"}
                </span>
              </div>

              {forType.length === 0 ? (
                <p className="text-xs text-[var(--tron-muted)]">
                  No custom template — using the built-in standard fields.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {forType.map((t) => {
                    const isSel = selectedId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setSelectedId((prev) => (prev === t.id ? null : t.id))
                        }
                        className={
                          "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors " +
                          (isSel
                            ? "border-[var(--tron-cyan)] bg-[rgba(46,242,255,0.10)]"
                            : "border-[var(--tron-line)] hover:bg-[rgba(46,242,255,0.06)]")
                        }
                      >
                        <span className="truncate text-[var(--tron-text)]">
                          {t.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {t.is_default && (
                            <span className="tron-chip tron-ok text-[9px]">
                              DEFAULT
                            </span>
                          )}
                          <span className="text-[10px] text-[var(--tron-muted)]">
                            {countFields(t.definition)}f
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                className="tron-btn mt-auto text-xs"
                type="button"
                onClick={() => createFromStandard(pt.code, pt.display_name)}
                disabled={busyType === pt.code}
              >
                {busyType === pt.code ? "Creating…" : "+ Create from standard fields"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Detail — the selected template editor, in a two-column section layout. */}
      {selected && (
        <div ref={editorRef}>
          <JsonTemplateEditor
            key={selected.id}
            template={selected}
            onSaved={(next) =>
              onTemplatesChange(
                templates.map((x) =>
                  x.id === next.id
                    ? next
                    : next.is_default && x.payer_type === next.payer_type
                      ? { ...x, is_default: false }
                      : x,
                ),
              )
            }
            onDeleted={(id) => {
              onTemplatesChange(templates.filter((x) => x.id !== id));
              setSelectedId(null);
            }}
          />
        </div>
      )}
    </section>
  );
}
