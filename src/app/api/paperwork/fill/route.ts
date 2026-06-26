import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { fillTemplate } from "@/lib/paperwork/gemini";
import type {
  PaperworkPatientData,
  PaperworkTemplate,
} from "@/lib/db-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// patient JSON + template -> filled HTML, persisted per patient+template.
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { patient_id?: string; template_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const patientId = (body.patient_id ?? "").trim();
  const templateId = (body.template_id ?? "").trim();
  if (!patientId || !templateId) {
    return NextResponse.json(
      { error: "patient_id and template_id are required." },
      { status: 400 },
    );
  }

  const [{ data: template }, { data: patientRow }] = await Promise.all([
    supabase
      .from("paperwork_templates")
      .select("*")
      .eq("id", templateId)
      .maybeSingle(),
    supabase
      .from("paperwork_patient_data")
      .select("data")
      .eq("patient_id", patientId)
      .maybeSingle(),
  ]);

  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const tmpl = template as PaperworkTemplate;
  const patientData = ((patientRow?.data as PaperworkPatientData) ?? {}) as PaperworkPatientData;

  let filledHtml: string;
  try {
    filledHtml = await fillTemplate({
      templateHtml: tmpl.html,
      requiredFields: tmpl.required_fields ?? [],
      patientData,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gemini fill failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: document, error } = await supabase
    .from("paperwork_documents")
    .upsert(
      {
        patient_id: patientId,
        template_id: templateId,
        template_name: tmpl.name,
        filled_html: filledHtml,
        status: "DRAFT",
        created_by: user.id,
      },
      { onConflict: "patient_id,template_id" },
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({ document });
}
