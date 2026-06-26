import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { extractPatientJson, type InlineFile } from "@/lib/paperwork/gemini";
import { fileToInline, safeFileName } from "@/lib/paperwork/files";
import {
  evaluateCompleteness,
  mergePatientData,
} from "@/lib/paperwork/schema";
import type { PaperworkPatientData } from "@/lib/db-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE_BUCKET = "paperwork-source";

// Documents/text -> canonical patient JSON, merged into the stored record.
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const patientId = String(form.get("patient_id") ?? "").trim();
  if (!patientId) {
    return NextResponse.json({ error: "patient_id is required." }, { status: 400 });
  }
  const text = String(form.get("text") ?? "");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!text.trim() && files.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one file or some text to extract from." },
      { status: 400 },
    );
  }

  let inline: InlineFile[] = [];
  try {
    inline = await Promise.all(files.map(fileToInline));
  } catch {
    return NextResponse.json({ error: "Could not read uploaded files." }, { status: 400 });
  }

  let extracted: PaperworkPatientData;
  try {
    extracted = await extractPatientJson({ files: inline, text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gemini extraction failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Merge over any existing record so repeat uploads accumulate.
  const { data: existing } = await supabase
    .from("paperwork_patient_data")
    .select("data")
    .eq("patient_id", patientId)
    .maybeSingle();

  const merged = mergePatientData(
    (existing?.data as PaperworkPatientData) ?? null,
    extracted,
  );

  const { error: upsertErr } = await supabase
    .from("paperwork_patient_data")
    .upsert(
      { patient_id: patientId, data: merged, updated_by: user.id },
      { onConflict: "patient_id" },
    );

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 403 });
  }

  // Best-effort: persist the uploaded source files (bytes + metadata).
  for (const file of files) {
    try {
      const path = `${patientId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error: storageErr } = await supabase.storage
        .from(SOURCE_BUCKET)
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (!storageErr) {
        await supabase.from("paperwork_source_files").insert({
          patient_id: patientId,
          storage_path: path,
          filename: file.name,
          mime: file.type || null,
          uploaded_by: user.id,
        });
      }
    } catch {
      // Storage may be unconfigured in some environments; extraction still
      // succeeds without the original bytes.
    }
  }

  return NextResponse.json({
    data: merged,
    completeness: evaluateCompleteness(merged),
  });
}
