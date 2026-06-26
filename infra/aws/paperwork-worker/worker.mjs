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
// Gemini calls (mirror of the former src/lib/paperwork/gemini.ts)
// ---------------------------------------------------------------------------
function parseJson(raw, ctx) {
  if (!raw) throw new Error(`Gemini returned an empty response for ${ctx}.`);
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const m = text.match(/[{[][\s\S]*[}\]]/);
    if (m) text = m[0];
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON for ${ctx}.`);
  }
}
const fileParts = (files) =>
  (files ?? []).map((f) => ({ inlineData: { data: f.data, mimeType: f.mimeType } }));

async function extractPatientJson({ files, text }) {
  const instruction = [
    "You are a medical intake assistant for a power-wheelchair documentation workflow.",
    "Extract patient information from the provided documents and/or notes and return it",
    "as a single JSON object that EXACTLY matches the schema below (same keys, same nesting).",
    "Rules:",
    '- Return ONLY JSON. No prose, no code fences.',
    '- Use an empty string "" for unknown text fields, null for unknown numbers,',
    "  null for unknown yes/no (boolean) fields, and [] for unknown lists.",
    "  Only return true/false for a yes/no field when the source clearly states it.",
    "  Do not invent values.",
    "- For enum fields, choose one of the slash-delimited options shown in the schema",
    "  (return just the chosen value, not the option list).",
    "- Dates must be YYYY-MM-DD.",
    "",
    "SCHEMA:",
    JSON.stringify(SCHEMA_FOR_PROMPT, null, 2),
  ].join("\n");

  const parts = [{ text: instruction }];
  if (text && text.trim()) parts.push({ text: `ADDITIONAL NOTES FROM USER:\n${text.trim()}` });
  if (files?.length) parts.push(...fileParts(files));

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json", temperature: 0 },
  });
  return parseJson(res.text, "patient extraction");
}

async function templateToHtml({ file, name }) {
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
    JSON.stringify(SCHEMA_FOR_PROMPT, null, 2),
  ].join("\n");

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: instruction }, ...fileParts([file])] }],
    config: { responseMimeType: "application/json", temperature: 0 },
  });
  const parsed = parseJson(res.text, "template conversion");
  return {
    html: parsed.html ?? "",
    required_fields: Array.isArray(parsed.required_fields) ? parsed.required_fields : [],
    name,
  };
}

async function fillTemplate({ templateHtml, requiredFields, patientData }) {
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
    JSON.stringify(requiredFields ?? [], null, 2),
    "",
    "PATIENT JSON:",
    JSON.stringify(patientData ?? {}, null, 2),
    "",
    "TEMPLATE HTML:",
    templateHtml,
  ].join("\n");

  const res = await ai.models.generateContent({
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
    const incoming = await extractPatientJson({
      files: job.input?.files ?? [],
      text: job.input?.text ?? "",
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
    const tmpl = await templateToHtml({
      file: job.input.file,
      name: job.input.name,
    });
    const inserted = await pool.query(
      `insert into public.paperwork_templates (name, html, required_fields, created_by)
       values ($1, $2, $3::jsonb, $4)
       returning *`,
      [tmpl.name, tmpl.html, JSON.stringify(tmpl.required_fields), job.created_by],
    );
    return { template: inserted.rows[0] };
  }

  if (job.kind === "fill") {
    const tmplRes = await pool.query(
      "select id, name, html, required_fields from public.paperwork_templates where id = $1",
      [job.template_id],
    );
    if (!tmplRes.rows[0]) throw new Error("Template not found.");
    const tmpl = tmplRes.rows[0];

    const dataRes = await pool.query(
      "select data from public.paperwork_patient_data where patient_id = $1",
      [job.patient_id],
    );
    const patientData = dataRes.rows[0]?.data ?? {};

    const html = await fillTemplate({
      templateHtml: tmpl.html,
      requiredFields: tmpl.required_fields,
      patientData,
    });

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
