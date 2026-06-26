"use client";

import { useState } from "react";
import type { PayerTypeRecord, PaperworkJsonTemplate } from "@/lib/db-types";
import { payerTypeSectionTitle } from "@/lib/payer-types";
import { DEFAULT_DEFINITION } from "@/lib/paperwork/schema";
import { countFields } from "@/lib/paperwork/template-def";
import { createJsonTemplate } from "./actions";
import { JsonTemplateEditor } from "./JsonTemplateEditor";

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

  const createFromDefault = async (payerType: string, name: string) => {
    setBusyType(payerType);
    setError(null);
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
    <section className="tron-panel space-y-4 p-4">
      <div>
        <h2 className="tron-panel-title">JSON field templates</h2>
        <p className="mt-1 text-sm text-[var(--tron-muted)]">
          Define the patient-data fields tracked for each patient type. The
          template marked DEFAULT drives the completeness checklist and AI
          extraction for that type. Editing a template does not change existing
          patient data.
        </p>
        {error && <p className="mt-2 text-xs tron-bad">{error}</p>}
      </div>

      {payerTypes.map((pt) => {
        const forType = templates.filter((t) => t.payer_type === pt.code);
        return (
          <div key={pt.code} className="rounded-lg border border-[var(--tron-line)] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--tron-text)]">
                {payerTypeSectionTitle(pt)}
              </h3>
              <span className="text-[11px] text-[var(--tron-muted)]">
                {forType.length} template{forType.length === 1 ? "" : "s"}
              </span>
              <button
                className="tron-btn ml-auto text-xs"
                type="button"
                onClick={() =>
                  createFromDefault(pt.code, `${pt.display_name} standard fields`)
                }
                disabled={busyType === pt.code}
              >
                {busyType === pt.code ? "Creating…" : "Create from standard fields"}
              </button>
            </div>

            {forType.length === 0 ? (
              <p className="text-xs text-[var(--tron-muted)]">
                No template yet — using the built-in standard fields (
                {countFields(DEFAULT_DEFINITION)} fields). Create one to customize.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {forType.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        setSelectedId((prev) => (prev === t.id ? null : t.id))
                      }
                      className={
                        "tron-chip text-xs " +
                        (selectedId === t.id ? "tron-tile-selected" : "")
                      }
                    >
                      {t.name}
                      {t.is_default ? " · default" : ""} ·{" "}
                      {countFields(t.definition)} fields
                    </button>
                  ))}
                </div>
                {forType
                  .filter((t) => t.id === selectedId)
                  .map((t) => (
                    <JsonTemplateEditor
                      key={t.id}
                      template={t}
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
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
