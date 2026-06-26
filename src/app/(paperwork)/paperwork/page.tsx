import { requireUser } from "@/lib/server-helpers";
import { fetchPayerTypes } from "@/lib/queries";
import type {
  PaperworkJsonTemplate,
  PaperworkLogo,
  PaperworkPatientData,
  PaperworkTemplate,
} from "@/lib/db-types";
import {
  DEFAULT_DEFINITION,
  evaluateCompleteness,
} from "@/lib/paperwork/schema";
import type { JsonTemplateDefinition } from "@/lib/paperwork/template-def";
import { PaperworkApp } from "./PaperworkApp";
import type { PatientLite } from "./types";

export const dynamic = "force-dynamic";

export default async function PaperworkPage() {
  const { supabase } = await requireUser();

  const [
    { data: patientRows },
    { data: templates },
    { data: logos },
    { data: jsonTemplates },
    { data: patientData },
    payerTypes,
  ] = await Promise.all([
    supabase
      .from("patients")
      .select("id, first_name, last_name, drive_folder_url, payers(type)")
      .order("last_name", { ascending: true }),
    supabase.from("paperwork_templates").select("*").order("name", { ascending: true }),
    supabase.from("paperwork_logos").select("*").order("name", { ascending: true }),
    supabase
      .from("paperwork_json_templates")
      .select("*")
      .order("name", { ascending: true }),
    supabase.from("paperwork_patient_data").select("patient_id, data"),
    fetchPayerTypes(supabase),
  ]);

  const jsonTpls = (jsonTemplates ?? []) as PaperworkJsonTemplate[];

  // payer type -> default field definition (falls back to the built-in default).
  const defByType = new Map<string, JsonTemplateDefinition>();
  for (const t of jsonTpls) {
    if (t.is_default) defByType.set(t.payer_type, t.definition);
  }
  const definitionFor = (payerType: string | null): JsonTemplateDefinition =>
    (payerType && defByType.get(payerType)) || DEFAULT_DEFINITION;

  // patient id -> structured JSON, for computing completion in the search bar.
  const dataByPatient = new Map<string, PaperworkPatientData>();
  for (const row of (patientData ?? []) as { patient_id: string; data: PaperworkPatientData }[]) {
    dataByPatient.set(row.patient_id, row.data ?? {});
  }

  const patients: PatientLite[] = (
    (patientRows ?? []) as Array<{
      id: string;
      first_name: string;
      last_name: string;
      drive_folder_url: string | null;
      payers: { type: string } | { type: string }[] | null;
    }>
  ).map((p) => {
    const payer = Array.isArray(p.payers) ? p.payers[0] : p.payers;
    const payerType = payer?.type ?? null;
    const c = evaluateCompleteness(
      dataByPatient.get(p.id) ?? {},
      definitionFor(payerType),
    );
    const pct = c.totalCount === 0 ? 0 : Math.round((c.knownCount / c.totalCount) * 100);
    return {
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      drive_folder_url: p.drive_folder_url,
      payer_type: payerType,
      completion_pct: pct,
    };
  });

  return (
    <PaperworkApp
      patients={patients}
      templates={(templates ?? []) as PaperworkTemplate[]}
      logos={(logos ?? []) as PaperworkLogo[]}
      jsonTemplates={jsonTpls}
      payerTypes={payerTypes}
    />
  );
}
