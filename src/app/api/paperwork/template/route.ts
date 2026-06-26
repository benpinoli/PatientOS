import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { templateToHtml } from "@/lib/paperwork/gemini";
import { fileToInline, safeFileName } from "@/lib/paperwork/files";
import type { PaperworkTemplate } from "@/lib/db-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TEMPLATE_BUCKET = "paperwork-templates";

// A blank template (PDF/image) -> editable HTML + required-field list, stored
// in the shared template library.
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

  const name = String(form.get("name") ?? "").trim();
  const file = form.get("file");
  if (!name) return NextResponse.json({ error: "A template name is required." }, { status: 400 });
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A template file is required." }, { status: 400 });
  }

  let inline;
  try {
    inline = await fileToInline(file);
  } catch {
    return NextResponse.json({ error: "Could not read the template file." }, { status: 400 });
  }

  let converted: { html: string; required_fields: PaperworkTemplate["required_fields"] };
  try {
    converted = await templateToHtml({ file: inline, name });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gemini template conversion failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const templateId = crypto.randomUUID();

  // Best-effort: keep the original blank PDF in the templates bucket.
  let sourcePath: string | null = null;
  try {
    const path = `${templateId}/${safeFileName(file.name)}`;
    const { error: storageErr } = await supabase.storage
      .from(TEMPLATE_BUCKET)
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (!storageErr) sourcePath = path;
  } catch {
    // Storage optional.
  }

  const { data: template, error } = await supabase
    .from("paperwork_templates")
    .insert({
      id: templateId,
      name,
      source_path: sourcePath,
      source_mime: file.type || null,
      html: converted.html,
      required_fields: converted.required_fields,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({ template });
}
