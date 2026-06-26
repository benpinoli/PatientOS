"use server";

import { getSupabaseServer } from "@/lib/supabase/server";
import {
  evaluateCompleteness,
  getValueAtPath,
  setValueAtPath,
} from "@/lib/paperwork/schema";
import type {
  Completeness,
} from "@/lib/paperwork/schema";
import type {
  PaperworkDocument,
  PaperworkLogo,
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

/** True when a leaf string is absent/blank and should be auto-seeded. */
function isBlankLeaf(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Seeds the patient's demographic first/last name from the PatientOS patient
 * record into the structured JSON whenever those fields are still blank, so the
 * name is pre-filled on the checklist and carried onto filled documents. Returns
 * the (possibly updated) data and whether anything changed.
 */
function seedPatientName(
  data: PaperworkPatientData,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): { data: PaperworkPatientData; changed: boolean } {
  let next = data;
  let changed = false;
  const seed = (path: string, value: string | null | undefined) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return;
    if (isBlankLeaf(getValueAtPath(next, path))) {
      next = setValueAtPath(next, path, trimmed);
      changed = true;
    }
  };
  seed("patient_demographics.first_name", firstName);
  seed("patient_demographics.last_name", lastName);
  return { data: next, changed };
}

/** Loads the structured JSON + filled documents for one patient. */
export async function loadPatientPaperwork(
  patientId: string,
): Promise<ActionResult<PatientPaperwork>> {
  try {
    const { supabase, user } = await requireAuthedClient();

    const [{ data: row }, { data: docs, error: docErr }, { data: patient }] =
      await Promise.all([
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
        supabase
          .from("patients")
          .select("first_name, last_name")
          .eq("id", patientId)
          .maybeSingle(),
      ]);

    if (docErr) return { ok: false, error: docErr.message };

    const existing = ((row?.data as PaperworkPatientData) ?? {}) as PaperworkPatientData;
    const { data, changed } = seedPatientName(
      existing,
      patient?.first_name,
      patient?.last_name,
    );

    // Persist the seeded name so the fill worker (which reads from the DB) also
    // gets it. Best-effort: a write failure shouldn't block viewing the page.
    if (changed) {
      await supabase
        .from("paperwork_patient_data")
        .upsert(
          { patient_id: patientId, data, updated_by: user.id },
          { onConflict: "patient_id" },
        );
    }

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

/** Saves a branding logo (data URI) to the shared library. */
export async function saveLogo(
  name: string,
  dataUri: string,
  companyName?: string | null,
): Promise<ActionResult<PaperworkLogo>> {
  try {
    if (!dataUri.startsWith("data:image/")) {
      return { ok: false, error: "Please choose an image file (PNG, JPG, …)." };
    }
    // Guard against oversized logos bloating every template/document.
    if (dataUri.length > 2_000_000) {
      return { ok: false, error: "That image is too large — use a logo under ~1.5 MB." };
    }
    const { supabase, user } = await requireAuthedClient();
    const { data, error } = await supabase
      .from("paperwork_logos")
      .insert({
        name: name.trim() || "Logo",
        data_uri: dataUri,
        company_name: companyName?.trim() || null,
        created_by: user.id,
      })
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: data as PaperworkLogo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save logo." };
  }
}

/** Updates the company/organization name tied to an existing logo. */
export async function updateLogo(
  logoId: string,
  companyName: string | null,
): Promise<ActionResult<PaperworkLogo>> {
  try {
    const { supabase } = await requireAuthedClient();
    const { data, error } = await supabase
      .from("paperwork_logos")
      .update({ company_name: companyName?.trim() || null })
      .eq("id", logoId)
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: data as PaperworkLogo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update logo." };
  }
}

/** Deletes a branding logo from the shared library. */
export async function deleteLogo(logoId: string): Promise<ActionResult<true>> {
  try {
    const { supabase } = await requireAuthedClient();
    const { error } = await supabase
      .from("paperwork_logos")
      .delete()
      .eq("id", logoId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete logo." };
  }
}

/** Deletes a template from the shared library (affects all users). */
export async function deleteTemplate(
  templateId: string,
): Promise<ActionResult<true>> {
  try {
    const { supabase } = await requireAuthedClient();
    const { error } = await supabase
      .from("paperwork_templates")
      .delete()
      .eq("id", templateId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete." };
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
