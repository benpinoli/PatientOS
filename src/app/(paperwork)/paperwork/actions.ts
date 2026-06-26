"use server";

import { getSupabaseServer } from "@/lib/supabase/server";
import { evaluateCompleteness } from "@/lib/paperwork/schema";
import type {
  Completeness,
} from "@/lib/paperwork/schema";
import type {
  PaperworkDocument,
  PaperworkPatientData,
} from "@/lib/db-types";

export type PatientPaperwork = {
  data: PaperworkPatientData;
  completeness: Completeness;
  documents: PaperworkDocument[];
};

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function requireAuthedClient() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return { supabase, user };
}

/** Loads the structured JSON + filled documents for one patient. */
export async function loadPatientPaperwork(
  patientId: string,
): Promise<ActionResult<PatientPaperwork>> {
  try {
    const { supabase } = await requireAuthedClient();

    const [{ data: row }, { data: docs, error: docErr }] = await Promise.all([
      supabase
        .from("paperwork_patient_data")
        .select("data")
        .eq("patient_id", patientId)
        .maybeSingle(),
      supabase
        .from("paperwork_documents")
        .select("*")
        .eq("patient_id", patientId)
        .order("updated_at", { ascending: false }),
    ]);

    if (docErr) return { ok: false, error: docErr.message };

    const data = ((row?.data as PaperworkPatientData) ?? {}) as PaperworkPatientData;
    return {
      ok: true,
      value: {
        data,
        completeness: evaluateCompleteness(data),
        documents: (docs ?? []) as PaperworkDocument[],
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to load." };
  }
}

/** Saves the full structured JSON for a patient (used by the field editor). */
export async function savePatientData(
  patientId: string,
  data: PaperworkPatientData,
): Promise<ActionResult<Completeness>> {
  try {
    const { supabase, user } = await requireAuthedClient();
    const { error } = await supabase
      .from("paperwork_patient_data")
      .upsert(
        { patient_id: patientId, data, updated_by: user.id },
        { onConflict: "patient_id" },
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: evaluateCompleteness(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save." };
  }
}

/** Saves user edits to a filled document's HTML. */
export async function saveFilledDocument(
  documentId: string,
  html: string,
): Promise<ActionResult<true>> {
  try {
    const { supabase } = await requireAuthedClient();
    const { error } = await supabase
      .from("paperwork_documents")
      .update({ filled_html: html })
      .eq("id", documentId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save." };
  }
}
