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
  PaperworkJsonTemplate,
  PaperworkLogo,
  PaperworkPatientData,
} from "@/lib/db-types";
import type { JsonTemplateDefinition } from "@/lib/paperwork/template-def";

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

/** Creates a JSON field template for a patient type (first for a type = default). */
export async function createJsonTemplate(
  payerType: string,
  name: string,
  definition: JsonTemplateDefinition,
): Promise<ActionResult<PaperworkJsonTemplate>> {
  try {
    const { supabase, user } = await requireAuthedClient();
    const { count } = await supabase
      .from("paperwork_json_templates")
      .select("id", { count: "exact", head: true })
      .eq("payer_type", payerType);
    const { data, error } = await supabase
      .from("paperwork_json_templates")
      .insert({
        payer_type: payerType,
        name: name.trim() || "Template",
        definition,
        is_default: (count ?? 0) === 0,
        created_by: user.id,
      })
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: data as PaperworkJsonTemplate };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create template." };
  }
}

/** Updates a JSON field template; setting it default unsets others of its type. */
export async function updateJsonTemplate(
  id: string,
  patch: { name?: string; definition?: JsonTemplateDefinition; is_default?: boolean },
): Promise<ActionResult<PaperworkJsonTemplate>> {
  try {
    const { supabase } = await requireAuthedClient();

    if (patch.is_default) {
      const { data: row } = await supabase
        .from("paperwork_json_templates")
        .select("payer_type")
        .eq("id", id)
        .maybeSingle();
      if (row?.payer_type) {
        // Clear the current default for this type before promoting this one,
        // to satisfy the one-default-per-type unique index.
        await supabase
          .from("paperwork_json_templates")
          .update({ is_default: false })
          .eq("payer_type", row.payer_type)
          .neq("id", id);
      }
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) update.name = patch.name.trim() || "Template";
    if (patch.definition !== undefined) update.definition = patch.definition;
    if (patch.is_default !== undefined) update.is_default = patch.is_default;

    const { data, error } = await supabase
      .from("paperwork_json_templates")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: data as PaperworkJsonTemplate };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update template." };
  }
}

/** Deletes a JSON field template. */
export async function deleteJsonTemplate(id: string): Promise<ActionResult<true>> {
  try {
    const { supabase } = await requireAuthedClient();
    const { error } = await supabase
      .from("paperwork_json_templates")
      .delete()
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete template." };
  }
}

/**
 * Records one download for each given document and returns the updated
 * per-document counts plus the new global all-time total. A document only counts
 * as "filled" once it has been downloaded, so the UI calls this after a PDF
 * (single or each one inside a folder/zip) is actually saved on the user's end.
 */
export async function recordPaperworkDownloads(
  documentIds: string[],
): Promise<ActionResult<{ counts: Record<string, number>; total: number }>> {
  try {
    if (documentIds.length === 0) {
      return { ok: true, value: { counts: {}, total: 0 } };
    }
    const { supabase } = await requireAuthedClient();
    const { data, error } = await supabase.rpc("record_paperwork_downloads", {
      p_doc_ids: documentIds,
    });
    if (error) return { ok: false, error: error.message };

    const rows = (data ?? []) as Array<{
      document_id: string | null;
      download_count: number | null;
      total_downloads: number | string | null;
    }>;
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      total = Number(r.total_downloads ?? total);
      if (r.document_id && r.download_count != null) {
        counts[r.document_id] = r.download_count;
      }
    }
    return { ok: true, value: { counts, total } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to record download.",
    };
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
