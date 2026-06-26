// Server-only Gemini integration for Paperwork AI.
//
// Three jobs:
//   1. extractPatientJson  — documents/text -> canonical patient JSON
//   2. templateToHtml      — a blank PDF -> editable HTML + required-field list
//   3. fillTemplate        — patient JSON + template -> filled HTML
//
// IMPORTANT: never import this from a client component. The API key is
// server-only. Until a Google Cloud / Vertex AI BAA is in place, only send
// SYNTHETIC patient data here.

import { GoogleGenAI } from "@google/genai";
import type { PaperworkPatientData, TemplateRequiredField } from "@/lib/db-types";
import { SCHEMA_FOR_PROMPT } from "@/lib/paperwork/schema";

export type InlineFile = { data: string; mimeType: string; name?: string };

type GeminiPart =
  | { text: string }
  | { inlineData: { data: string; mimeType: string } };

const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local (server-only).",
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

/** Strips ```json fences and parses, throwing a helpful error on failure. */
function parseJsonResponse<T>(raw: string | undefined, context: string): T {
  if (!raw) throw new Error(`Gemini returned an empty response for ${context}.`);
  let text = raw.trim();
  // Remove leading/trailing code fences if present.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  // Fall back to the first {...} or [...] block.
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const objMatch = text.match(/[{[][\s\S]*[}\]]/);
    if (objMatch) text = objMatch[0];
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Gemini returned invalid JSON for ${context}.`);
  }
}

function fileParts(files: InlineFile[]): GeminiPart[] {
  return files.map((f) => ({
    inlineData: { data: f.data, mimeType: f.mimeType },
  }));
}

// ---------------------------------------------------------------------------
// 1. Extraction: documents/text -> canonical patient JSON
// ---------------------------------------------------------------------------
export async function extractPatientJson(input: {
  files?: InlineFile[];
  text?: string;
}): Promise<PaperworkPatientData> {
  const ai = getClient();
  const schema = JSON.stringify(SCHEMA_FOR_PROMPT, null, 2);

  const instruction = [
    "You are a medical intake assistant for a power-wheelchair documentation workflow.",
    "Extract patient information from the provided documents and/or notes and return it",
    "as a single JSON object that EXACTLY matches the schema below (same keys, same nesting).",
    "Rules:",
    "- Return ONLY JSON. No prose, no code fences.",
    "- Use an empty string \"\" for unknown text fields, null for unknown numbers,",
    "  null for unknown yes/no (boolean) fields, and [] for unknown lists.",
    "  Only return true/false for a yes/no field when the source clearly states it.",
    "  Do not invent values.",
    "- For enum fields, choose one of the slash-delimited options shown in the schema",
    "  (return just the chosen value, not the option list).",
    "- Dates must be YYYY-MM-DD.",
    "",
    "SCHEMA:",
    schema,
  ].join("\n");

  const parts: GeminiPart[] = [{ text: instruction }];
  if (input.text && input.text.trim()) {
    parts.push({ text: `ADDITIONAL NOTES FROM USER:\n${input.text.trim()}` });
  }
  if (input.files?.length) parts.push(...fileParts(input.files));

  const res = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json", temperature: 0 },
  });

  return parseJsonResponse<PaperworkPatientData>(res.text, "patient extraction");
}

// ---------------------------------------------------------------------------
// 2. Template conversion: blank PDF -> editable HTML + required-field list
// ---------------------------------------------------------------------------
export async function templateToHtml(input: {
  file: InlineFile;
  name: string;
}): Promise<{ html: string; required_fields: TemplateRequiredField[] }> {
  const ai = getClient();
  const schema = JSON.stringify(SCHEMA_FOR_PROMPT, null, 2);

  const instruction = [
    "You convert a blank form (PDF or image) into an exact, editable HTML copy.",
    "Produce a self-contained HTML document that visually reproduces the form layout",
    "as closely as possible using inline CSS, and renders every blank the user must",
    "fill as an editable field: use <input>, <textarea>, <input type=checkbox>, etc.,",
    "each with a stable name attribute derived from its label.",
    "Then list every field that needs information.",
    "",
    "Return ONLY a JSON object of the form:",
    '{ "html": "<!doctype html>...", "required_fields": [ { "label": "...", "json_path": "section.key_or_null", "required": true } ] }',
    "For json_path, map the field to the canonical patient schema path when there is a",
    "clear match; otherwise use null. The canonical schema is:",
    schema,
  ].join("\n");

  const res = await ai.models.generateContent({
    // Flash (not pro) to stay under Amplify's ~30s SSR response limit. Pro is
    // markedly slower and reliably times out when generating a full HTML form.
    model: DEFAULT_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: instruction }, ...fileParts([input.file])],
      },
    ],
    config: { responseMimeType: "application/json", temperature: 0 },
  });

  const parsed = parseJsonResponse<{
    html?: string;
    required_fields?: TemplateRequiredField[];
  }>(res.text, "template conversion");

  return {
    html: parsed.html ?? "",
    required_fields: Array.isArray(parsed.required_fields)
      ? parsed.required_fields
      : [],
  };
}

// ---------------------------------------------------------------------------
// 3. Fill: patient JSON + template HTML -> filled HTML
// ---------------------------------------------------------------------------
export async function fillTemplate(input: {
  templateHtml: string;
  requiredFields: TemplateRequiredField[];
  patientData: PaperworkPatientData;
}): Promise<string> {
  const ai = getClient();

  const instruction = [
    "You fill a blank HTML form using a patient's structured JSON data.",
    "Return the SAME HTML document, unchanged in structure and styling, but with each",
    "editable field pre-populated from the patient JSON:",
    "- For <input>/<textarea>, set the value/text to the matching data.",
    "- For checkboxes/radios, add the checked attribute when the data is true/selected.",
    "- Leave a field blank if the data is unknown; never invent values.",
    "Use the field mapping (required_fields with json_path) as the primary guide, and",
    "fall back to matching by label when json_path is null.",
    "Return ONLY the HTML document. No prose, no code fences.",
    "",
    "REQUIRED FIELDS / MAPPING:",
    JSON.stringify(input.requiredFields, null, 2),
    "",
    "PATIENT JSON:",
    JSON.stringify(input.patientData, null, 2),
    "",
    "TEMPLATE HTML:",
    input.templateHtml,
  ].join("\n");

  const res = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: [{ role: "user", parts: [{ text: instruction }] }],
    config: { temperature: 0 },
  });

  let html = (res.text ?? "").trim();
  const fence = html.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  if (fence) html = fence[1].trim();
  return html;
}
