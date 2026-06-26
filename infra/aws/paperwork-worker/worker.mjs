// Paperwork AI worker.
//
// Runs as a container on the EC2 Supabase Docker network (no Amplify 30s cap).
// Polls public.paperwork_jobs for PENDING rows, runs the matching Gemini call,
// persists results to the real paperwork_* tables, and writes the row's `result`
// so the browser (which is polling) can update its UI.
//
// Env:
//   GEMINI_API_KEY   (required)
//   GEMINI_MODEL     (optional, default gemini-3.1-flash-lite)
//   PGHOST           (default supabase-db)
//   PGPORT           (default 5432)
//   PGUSER           (default postgres)
//   PGPASSWORD       (required — POSTGRES_PASSWORD from the Supabase .env)
//   PGDATABASE       (default postgres)
//
// PHI: never log patient field values. Log only ids/kinds/status.

import pg from "pg";
import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
const POLL_MS = 1500;

if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Hard per-call timeout + retry. Without this a hung connection to the Gemini
// endpoint ("fetch failed") can stall for minutes, both failing the job and
// blocking the single-threaded queue behind it. Kept well under the browser's
// ~3 min polling window: worst case ~= TIMEOUT * ATTEMPTS + backoff.
const GEN_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 70000);
const GEN_ATTEMPTS = Number(process.env.GEMINI_ATTEMPTS ?? 2);
const GEN_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL ?? "LOW";

async function generateContent(params) {
  let lastErr;
  for (let attempt = 1; attempt <= GEN_ATTEMPTS; attempt++) {
    try {
      return await ai.models.generateContent({
        ...params,
        config: {
          // Gemini 3.x models "think" by default, which can take far longer than
          // the browser app (which runs flash-lite with minimal thinking) and blow
          // past the request deadline (504 DEADLINE_EXCEEDED). Keep thinking low so
          // these formatting/extraction tasks return in seconds. Callers may
          // override by setting their own thinkingConfig.
          thinkingConfig: { thinkingLevel: GEN_THINKING_LEVEL },
          ...(params.config ?? {}),
          abortSignal: AbortSignal.timeout(GEN_TIMEOUT_MS),
          httpOptions: {
            ...(params.config?.httpOptions ?? {}),
            timeout: GEN_TIMEOUT_MS,
          },
        },
      });
    } catch (e) {
      lastErr = e;
      console.error(
        `gemini attempt ${attempt}/${GEN_ATTEMPTS} failed: ${e?.message ?? e}`,
      );
      if (attempt < GEN_ATTEMPTS) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "supabase-db",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  // Accept either the PG* name or the Supabase .env name (POSTGRES_PASSWORD).
  password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? "postgres",
  max: 4,
});

pool.on("error", (err) => console.error("pg pool error:", err.message));

// ---------------------------------------------------------------------------
// Canonical schema (mirror of src/lib/paperwork/schema.ts) — used as the
// extraction contract and the merge reference.
// ---------------------------------------------------------------------------
const SCHEMA_FOR_PROMPT = {
  patient_demographics: {
    last_name: "", first_name: "", middle_initial: "", date_of_birth: "YYYY-MM-DD",
    sex: "Male/Female", weight_lbs: null, height_inches: null,
    residing_address: { street: "", city: "", state: "", zip_code: "" },
    phone_number: "", place_of_service_code: "", facility_name_if_applicable: "",
  },
  insurance_billing: {
    primary_insurer_name: "", policy_id: "", group_number: "",
    medicare_number_hicn: "", medicaid_number: "",
    assignment_of_benefits_authorized: true,
    patient_signature_status: {
      physically_mentally_able_to_sign: true, reason_if_no: "",
      authorized_representative_name: "", authorized_representative_relationship: "",
    },
  },
  responsible_party: {
    name: "", relationship_to_patient: "", phone: "",
    address: { street: "", city: "", state: "", zip_code: "" },
  },
  clinical_status_diagnoses: {
    primary_justifying_diagnosis_icd10: [], complicating_conditions: [],
    mobility_status: "Bed Confined / Wheelchair Confined / Ambulatory w-assist / Ambulatory",
    prognosis: "Good / Fair / Poor", active_rehab_status: false,
    contractures_impair_functional_ability: false,
    skin_integrity_pressure_ulcers: {
      completely_immobile: false, limited_mobility_cannot_alleviate_pressure: false,
      has_pressure_ulcer_on_trunk_or_pelvis: false, ulcer_locations: [],
      impaired_nutritional_status: false,
      fecal_or_urinary_incontinence: "None / Fecal / Urinary / Both",
      altered_sensory_perception: false, compromised_circulatory_status: false,
    },
  },
  power_mobility_device_pmd_specifics: {
    date_of_face_to_face_visit: "YYYY-MM-DD", date_equipment_prescribed: "YYYY-MM-DD",
    estimated_length_of_need_months: 99, expected_outcome_goals: "",
    equipment_type_requested: "Group I Motorized Chair / Group II Motorized Chair / Group III Motorized Chair / Group I POV Scooter / Group II POV Scooter",
    seating_type: "captain seat / sling-solid / rehab seat",
    power_options: "None / Single Power Option / Multiple Power Option",
    specialty_evaluation_completed_by_pt_ot: false,
    ordered_accessories_hcpcs: [{ code: "E2361", description: "22NF Batteries", quantity: 2 }],
  },
  home_environmental_assessment: {
    evaluation_date: "YYYY-MM-DD",
    residence_type: "Single Story / Multi Story / Apt-Condo / Mobile Home",
    interior_ramps_required: false, beneficiary_aware_of_modification_responsibility: false,
    independent_utilization_possible: false, caregiver_willing_to_assist_if_needed: false,
    factors_rendering_mobility_device_unusable: false, factors_details: "",
    demonstrated_usability_locations: {
      bathroom: { accessible: false, comments: "" },
      bedroom: { accessible: false, comments: "" },
      hallways: { accessible: false, comments: "" },
      kitchen: { accessible: false, comments: "" },
    },
  },
  prescribing_physician_provider: {
    provider_name: "", title_credentials: "", npi_number: "", upin_number: "",
    phone_number: "", fax_number: "",
    address: { street: "", city: "", state: "", zip_code: "" },
    signature_on_file: false, date_signed: "YYYY-MM-DD",
  },
};

// ---------------------------------------------------------------------------
// Merge helpers (mirror of schema.ts) so a new upload never blanks known data.
// ---------------------------------------------------------------------------
function isPlaceholderString(value) {
  const t = value.trim();
  return t === "" || t === "YYYY-MM-DD" || t === "Male/Female" || t.includes(" / ");
}
function isLeafKnown(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return !isPlaceholderString(value);
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
}
function mergePatientData(base, incoming) {
  const merge = (b, i) => {
    if (i === null || i === undefined) return b ?? null;
    if (Array.isArray(i)) return i.length > 0 ? i : (b ?? []);
    if (typeof i === "object") {
      const out = { ...(b && typeof b === "object" && !Array.isArray(b) ? b : {}) };
      for (const [k, v] of Object.entries(i)) out[k] = merge(b?.[k], v);
      return out;
    }
    return isLeafKnown(i) ? i : (b ?? i);
  };
  return merge(base ?? {}, incoming ?? {});
}

// ---------------------------------------------------------------------------
// JSON field templates: build the AI extraction shape from a saved definition
// (mirror of src/lib/paperwork/template-def.ts). Falls back to SCHEMA_FOR_PROMPT
// when a patient's type has no saved template.
// ---------------------------------------------------------------------------
function setPath(obj, path, value) {
  const keys = path.split(".");
  const clone = { ...obj };
  let cursor = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const existing = cursor[key];
    cursor[key] =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...existing }
        : {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return clone;
}
function exampleValueForKind(field) {
  switch (field.kind) {
    case "number":
      return null;
    case "boolean":
      return true;
    case "list":
      return [];
    case "date":
      return "YYYY-MM-DD";
    case "choice":
      return (field.options ?? []).join(" / ");
    default:
      return "";
  }
}
function buildExampleShape(def) {
  let out = {};
  for (const section of def?.sections ?? []) {
    for (const field of section.fields ?? []) {
      const p = field.path ? `${section.key}.${field.path}` : section.key;
      out = setPath(out, p, exampleValueForKind(field));
    }
  }
  return out;
}
async function schemaForPatient(patientId) {
  if (!patientId) return SCHEMA_FOR_PROMPT;
  try {
    const res = await pool.query(
      `select jt.definition
         from public.patients p
         join public.payers py on py.id = p.payer_id
         join public.paperwork_json_templates jt
           on jt.payer_type = py.type and jt.is_default
        where p.id = $1
        limit 1`,
      [patientId],
    );
    const def = res.rows[0]?.definition;
    if (def && Array.isArray(def.sections) && def.sections.length > 0) {
      return buildExampleShape(def);
    }
  } catch (e) {
    console.error("schemaForPatient error:", e.message);
  }
  return SCHEMA_FOR_PROMPT;
}

// ---------------------------------------------------------------------------
// Gemini calls (mirror of the former src/lib/paperwork/gemini.ts)
// ---------------------------------------------------------------------------
// Return the first *balanced* JSON value ({...} or [...]) found in `text`,
// ignoring any prose before it or trailing junk after it. Lite models sometimes
// emit a stray extra brace (e.g. "...}\n}") after the real object, which makes a
// naive JSON.parse fail even though the leading object is perfectly valid.
function sliceBalancedJson(text) {
  const start = text.search(/[{[]/);
  if (start < 0) return text;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function parseJson(raw, ctx) {
  if (!raw) throw new Error(`Gemini returned an empty response for ${ctx}.`);
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  text = sliceBalancedJson(text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON for ${ctx}.`);
  }
}
const fileParts = (files) =>
  (files ?? []).map((f) => ({ inlineData: { data: f.data, mimeType: f.mimeType } }));

// Branding: stored template HTML keeps this token where the org logo goes; the
// real <img> (large base64) + company name are swapped in only when
// rendering/filling so the base64 never passes back through the model.
// Keep in sync with src/app/(paperwork)/paperwork/branding.ts.
const LOGO_TOKEN = "__LOGO_IMG__";
const escapeHtml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const logoBlock = (dataUri, companyName) => {
  const img = dataUri
    ? `<img src="${dataUri}" alt="Logo" style="max-height:72px;max-width:260px;object-fit:contain;" />`
    : "";
  const name = companyName && companyName.trim()
    ? `<span style="font-size:20px;font-weight:700;line-height:1.2;">${escapeHtml(companyName.trim())}</span>`
    : "";
  if (!img && !name) return "";
  return `<span style="display:inline-flex;align-items:center;gap:12px;vertical-align:middle;">${img}${name}</span>`;
};
const embedLogo = (html, dataUri, companyName) =>
  !html ? html : html.split(LOGO_TOKEN).join(logoBlock(dataUri, companyName));

async function extractPatientJson({ files, text, schema }) {
  const instruction = [
    "You are a medical intake assistant for a power-wheelchair documentation workflow.",
    "Extract patient information from the provided documents and/or notes and return it",
    "as a single JSON object that EXACTLY matches the schema below (same keys, same nesting).",
    "Rules:",
    '- Return ONLY JSON. No prose, no code fences.',
    '- Use an empty string "" for unknown text fields, null for unknown numbers,',
    "  null for unknown yes/no (boolean) fields, and [] for unknown lists.",
    "  Only return true/false for a yes/no field when the source clearly states it.",
    "- IMPORTANT: Prefer leaving a field blank/empty over guessing. Only populate a",
    "  field when the source clearly and explicitly provides the value. Never infer,",
    "  approximate, fabricate, or use outside/general knowledge. When in any doubt,",
    "  leave the field empty.",
    "- Never invent dates. Only output a date that explicitly appears in the source.",
    "- For enum fields, choose one of the slash-delimited options shown in the schema",
    "  (return just the chosen value, not the option list).",
    "- Dates must be YYYY-MM-DD.",
    "",
    "SCHEMA:",
    JSON.stringify(schema ?? SCHEMA_FOR_PROMPT, null, 2),
  ].join("\n");

  const parts = [{ text: instruction }];
  if (text && text.trim()) parts.push({ text: `ADDITIONAL NOTES FROM USER:\n${text.trim()}` });
  if (files?.length) parts.push(...fileParts(files));

  const res = await generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json", temperature: 0 },
  });
  return parseJson(res.text, "patient extraction");
}

function ensureLogoToken(html) {
  // Make sure the branding token is present so the logo can be embedded later.
  if (html.includes(LOGO_TOKEN)) return html;
  const banner = `<div style="text-align:center;padding:8px 0;">${LOGO_TOKEN}</div>`;
  const bodyOpen = html.match(/<body[^>]*>/i);
  if (bodyOpen) {
    const idx = html.indexOf(bodyOpen[0]) + bodyOpen[0].length;
    return html.slice(0, idx) + banner + html.slice(idx);
  }
  return banner + html;
}

async function templateToHtml({ file, name, logoDataUri, logoCompanyName }) {
  const hasBranding = Boolean(logoDataUri || (logoCompanyName && logoCompanyName.trim()));
  const instruction = [
    "You convert a blank form (PDF or image) into an exact, editable HTML copy.",
    "Produce a self-contained HTML document that visually reproduces the form layout",
    "as closely as possible using inline CSS, and renders every blank the user must",
    "fill as an editable field: use <input>, <textarea>, <input type=checkbox>, etc.,",
    "each with a stable name attribute derived from its label.",
    "PAGE SIZE: target US Letter (8.5in x 11in). Wrap the entire form in a single",
    "page container styled width:7.5in; margin:0 auto; box-sizing:border-box (this is",
    "the printable area inside 0.5in margins). Include a <style> with",
    "* { box-sizing: border-box; max-width: 100%; } and img { max-width:100%; height:auto; }.",
    "NEVER use a fixed pixel width wider than the page (no width:800px and similar);",
    "size columns/inputs with % or flexible units so nothing extends past the page edge.",
    "LAYOUT FIDELITY: keep a SHORT trailing unit/suffix (e.g. '(in.)','(lbs)','%')",
    "attached to its input by joining them with a non-breaking space, e.g.",
    "<input ...>&nbsp;(in.). Do NOT put white-space:nowrap on fields, labels,",
    "questions, or any long text — long text MUST be allowed to wrap. Never wrap a",
    "whole sentence/question in a nowrap container. Reproduce the original's row",
    "structure: fields that appear on the same horizontal line of the original form",
    "should share a flex row (display:flex; gap; flex-wrap:wrap) so they sit together",
    "but can wrap onto the next line if they would otherwise run past the page edge;",
    "only start a brand-new row where the original form starts a new line.",
    "IMPORTANT — preserve ALL branding: reproduce the organization/company name,",
    "logos' text, addresses, form titles, headers, and footers exactly as they",
    "appear on the original, in the same positions. Do not drop letterhead text.",
    hasBranding
      ? `The organization's branding (logo and/or company name) will be inserted by the system. Put the EXACT token ${LOGO_TOKEN} (uppercase, no spaces, no markup) at the location where the original form's logo/letterhead appears (usually the top header). Do not output an <img>, base64, or the company name yourself — only the token.`
      : `Do not invent a logo image. Just reproduce any branding TEXT as plain HTML.`,
    "Then list every field that needs information.",
    "",
    "Return ONLY a JSON object of the form:",
    '{ "html": "<!doctype html>...", "required_fields": [ { "label": "...", "json_path": "section.key_or_null", "required": true } ] }',
    "For json_path, map the field to the canonical patient schema path when there is a",
    "clear match; otherwise use null. The canonical schema is:",
    JSON.stringify(SCHEMA_FOR_PROMPT, null, 2),
  ].join("\n");

  const res = await generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: instruction }, ...fileParts([file])] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0,
      maxOutputTokens: 65536,
    },
  });
  const finishReason = res.candidates?.[0]?.finishReason;
  let parsed;
  try {
    parsed = parseJson(res.text, "template conversion");
  } catch (e) {
    // No PHI on a blank template; log shape only to diagnose truncation/blocks.
    console.error(
      `template conversion parse failed: finishReason=${finishReason ?? "?"} textLen=${res.text?.length ?? 0}`,
    );
    throw e;
  }
  let html = parsed.html ?? "";
  if (hasBranding) html = ensureLogoToken(html);
  return {
    html,
    required_fields: Array.isArray(parsed.required_fields) ? parsed.required_fields : [],
    name,
  };
}

async function fillTemplate({ templateHtml, requiredFields, patientData }) {
  // Real date (clinic timezone) so the model never hallucinates "today".
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const instruction = [
    "You fill a blank HTML form using a patient's structured JSON data.",
    "Return the SAME HTML document, unchanged in structure and styling, but with each",
    "editable field pre-populated from the patient JSON:",
    "- For <input>/<textarea>, set the value/text to the matching data.",
    "- For checkboxes/radios, add the checked attribute when the data is true/selected.",
    `TODAY'S DATE is ${today} (YYYY-MM-DD).`,
    "- For fields that represent the date this form is completed or signed TODAY",
    "  (labels like 'Date', 'Today's Date', 'Date Signed', 'Signature Date'), fill",
    "  them with TODAY'S DATE above.",
    "- Do NOT use today's date for clinical dates such as date of birth, face-to-face",
    "  visit date, prescription date, or home evaluation date — those come ONLY from",
    "  the patient JSON.",
    "- IMPORTANT: Prefer leaving a field BLANK over guessing. Only fill a field when",
    "  the patient JSON (or, for a today's-date field, the date above) clearly",
    "  provides the value. Never infer, approximate, fabricate, or use outside",
    "  knowledge. A blank field is strongly preferred over a wrong or invented value.",
    "- Never invent dates of any kind.",
    "- EXCEPTION (allowed, not guessing): when a single form field combines values",
    "  the JSON stores separately, you MAY assemble it from those parts. For a",
    "  combined address box (labels like 'Address', 'City/State/Zip', 'City, State Zip'),",
    "  compose it from residing_address.street/city/state/zip_code (e.g. 'City, State Zip'),",
    "  using only the parts present in the JSON. The same applies to other obviously",
    "  combined fields (e.g. full name from first/last). Only use values that exist in",
    "  the JSON — do not invent any missing part.",
    `- Preserve any placeholder tokens such as ${LOGO_TOKEN} EXACTLY as-is; do not`,
    "  remove, move, or alter them.",
    "Use the field mapping (required_fields with json_path) as the primary guide, and",
    "fall back to matching by label when json_path is null.",
    "Return ONLY the HTML document. No prose, no code fences.",
    "",
    "REQUIRED FIELDS / MAPPING:",
    JSON.stringify(requiredFields ?? [], null, 2),
    "",
    "PATIENT JSON:",
    JSON.stringify(patientData ?? {}, null, 2),
    "",
    "TEMPLATE HTML:",
    templateHtml,
  ].join("\n");

  const res = await generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: instruction }] }],
    config: { temperature: 0 },
  });
  let html = (res.text ?? "").trim();
  const fence = html.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  if (fence) html = fence[1].trim();
  return html;
}

// ---------------------------------------------------------------------------
// Per-kind processing + persistence
// ---------------------------------------------------------------------------
async function processJob(job) {
  if (job.kind === "extract") {
    const schema = await schemaForPatient(job.patient_id);
    const incoming = await extractPatientJson({
      files: job.input?.files ?? [],
      text: job.input?.text ?? "",
      schema,
    });
    const existing = await pool.query(
      "select data from public.paperwork_patient_data where patient_id = $1",
      [job.patient_id],
    );
    const merged = mergePatientData(existing.rows[0]?.data ?? {}, incoming);
    await pool.query(
      `insert into public.paperwork_patient_data (patient_id, data, updated_by)
       values ($1, $2::jsonb, $3)
       on conflict (patient_id) do update
         set data = excluded.data, updated_by = excluded.updated_by`,
      [job.patient_id, JSON.stringify(merged), job.created_by],
    );
    return { data: merged };
  }

  if (job.kind === "template") {
    const logoDataUri = job.input.logoDataUri ?? null;
    const logoCompanyName = job.input.logoCompanyName ?? null;
    const tmpl = await templateToHtml({
      file: job.input.file,
      name: job.input.name,
      logoDataUri,
      logoCompanyName,
    });
    const inserted = await pool.query(
      `insert into public.paperwork_templates
         (name, html, required_fields, logo_data_uri, logo_company_name, created_by)
       values ($1, $2, $3::jsonb, $4, $5, $6)
       returning *`,
      [
        tmpl.name,
        tmpl.html,
        JSON.stringify(tmpl.required_fields),
        logoDataUri,
        logoCompanyName,
        job.created_by,
      ],
    );
    return { template: inserted.rows[0] };
  }

  if (job.kind === "fill") {
    const tmplRes = await pool.query(
      "select id, name, html, required_fields, logo_data_uri, logo_company_name from public.paperwork_templates where id = $1",
      [job.template_id],
    );
    if (!tmplRes.rows[0]) throw new Error("Template not found.");
    const tmpl = tmplRes.rows[0];

    const dataRes = await pool.query(
      "select data from public.paperwork_patient_data where patient_id = $1",
      [job.patient_id],
    );
    const patientData = dataRes.rows[0]?.data ?? {};

    // Fill using the token-bearing HTML (keeps the large logo out of the model),
    // then swap the real logo image into the finished document.
    const filledWithToken = await fillTemplate({
      templateHtml: tmpl.html,
      requiredFields: tmpl.required_fields,
      patientData,
    });
    const html = embedLogo(filledWithToken, tmpl.logo_data_uri, tmpl.logo_company_name);

    const doc = await pool.query(
      `insert into public.paperwork_documents
         (patient_id, template_id, template_name, filled_html, created_by)
       values ($1, $2, $3, $4, $5)
       on conflict (patient_id, template_id) do update
         set filled_html = excluded.filled_html,
             template_name = excluded.template_name,
             updated_at = now()
       returning *`,
      [job.patient_id, tmpl.id, tmpl.name, html, job.created_by],
    );
    return { document: doc.rows[0] };
  }

  throw new Error(`Unknown job kind: ${job.kind}`);
}

// Atomically claim the oldest PENDING job.
async function claimJob() {
  const res = await pool.query(
    `update public.paperwork_jobs
       set status = 'RUNNING', started_at = now()
     where id = (
       select id from public.paperwork_jobs
       where status = 'PENDING'
       order by created_at
       for update skip locked
       limit 1
     )
     returning *`,
  );
  return res.rows[0] ?? null;
}

async function loop() {
  for (;;) {
    let job = null;
    try {
      job = await claimJob();
    } catch (e) {
      console.error("claim error:", e.message);
      await sleep(POLL_MS * 3);
      continue;
    }

    if (!job) {
      await sleep(POLL_MS);
      continue;
    }

    const t0 = Date.now();
    console.log(`[job ${job.id}] kind=${job.kind} start`);
    try {
      const result = await processJob(job);
      await pool.query(
        `update public.paperwork_jobs
           set status = 'DONE', result = $2::jsonb, finished_at = now(), error = null
         where id = $1`,
        [job.id, JSON.stringify(result)],
      );
      console.log(`[job ${job.id}] DONE in ${Date.now() - t0}ms`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Worker failed.";
      console.error(`[job ${job.id}] ERROR in ${Date.now() - t0}ms: ${message}`);
      await pool.query(
        `update public.paperwork_jobs
           set status = 'ERROR', error = $2, finished_at = now()
         where id = $1`,
        [job.id, message],
      );
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`paperwork-worker started (model=${MODEL}, db=${process.env.PGHOST ?? "supabase-db"})`);
loop().catch((e) => {
  console.error("worker crashed:", e);
  process.exit(1);
});
