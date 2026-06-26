# Paperwork AI — engineering notes & decision log

**Purpose of this file.** This is a self-contained design/decision record for the
"Paperwork AI" extension to the Choice Healthcare tracker. It is written so it can
be **fed verbatim into another AI** (or read by a new engineer) to understand *what
the subsystem does, how it is wired, and — most importantly — why each non-obvious
decision was made and what problem it solves.* Where a choice exists only because we
hit a concrete bug or platform limit, the bug is described alongside the fix so the
rationale is never mysterious.

Read order for full context: `CLAUDE.md` → `ARCHITECTURE.md` → this file. Ops/runbook
detail lives in `infra/aws/DEPLOYMENT.md` and `infra/aws/paperwork-worker/README.md`.

---

## 1. What Paperwork AI does

The base tracker (see `ARCHITECTURE.md`) is a per-patient checklist. Paperwork AI is a
bolt-on that uses Google Gemini to take the busywork out of the documents a rep has to
produce for a power-wheelchair prior-authorization:

1. **Extract** — upload one or more source PDFs (intake forms, chart notes). Gemini
   reads them and fills a canonical patient-data JSON (demographics, clinical, payer).
2. **Convert** — upload a blank payer form PDF; Gemini converts it into an **editable
   HTML form** (a reusable "template") that mirrors the original layout.
3. **Fill** — Gemini merges the patient JSON into a template, producing a filled HTML
   document the rep can review, hand-edit, and export to PDF.
4. **Export** — the browser renders the filled HTML to a pixel-faithful US-Letter PDF,
   singly or as a multi-document zip ("download as folder").

It is a productivity layer. It is **not** a document store (see §9) — generated HTML/PDF
lives in Postgres rows, and source bytes are passed through transiently, never persisted
as files in a bucket.

---

## 2. The big architectural decision: an out-of-band worker

### Problem
The app is hosted on **AWS Amplify**, whose SSR/compute runtime **hard-kills any request
at ~30 seconds** and AWS will not let you raise it
([amplify-hosting#3223](https://github.com/aws-amplify/amplify-hosting/issues/3223)).
Every Gemini call here — converting a whole form to HTML, or filling one — routinely
takes longer than 30s. So *any* design where the browser calls a Next.js server action
that calls Gemini is structurally doomed: it returns `Request timed out` /
`Unexpected end of JSON input` (a truncated response) no matter how good the prompt is.

### Solution: job queue + EC2 worker + client polling
We moved the long work off Amplify entirely:

```
Browser ──insert paperwork_jobs row (base64 file bytes inside)──▶ Postgres (EC2)
   ▲                                                                  │
   │ poll job status                          claim w/ SKIP LOCKED    ▼
   └──────────── DONE + result ◀──── paperwork-worker (EC2 container, no 30s cap)
                                       calls Gemini, writes paperwork_* tables
```

- **`paperwork_jobs`** (migration `0019`) is the queue. The browser inserts a row
  (kind = extract/convert/fill, plus the input payload, including uploaded file bytes as
  base64 *inside the row* — no storage bucket needed) and then polls that row.
- **The worker** (`infra/aws/paperwork-worker/worker.mjs`) is a small long-running Node
  container on the **same EC2 box as Supabase**, attached to the `supabase_default`
  Docker network. It talks to Postgres directly as the `postgres` superuser
  (**bypasses RLS** — see §8 for why that's acceptable), claims jobs with
  `FOR UPDATE SKIP LOCKED` (so you can run >1 replica safely), calls Gemini with no
  platform timeout, writes results into the real `paperwork_*` tables, and flips the job
  to `DONE` with a `result` payload (or `ERROR` with a message).
- **The browser** sees `DONE` and refreshes. Client-side poll timeout is generous
  (minutes), since the worker, not Amplify, owns the long call.

This is the single most important thing to understand about the subsystem: **the AI never
runs inside the Amplify request path.** If you ever see a new "timeout after ~30s" it
means something was wired to call Gemini from a server action again — don't; enqueue a job.

---

## 3. Data model (paperwork_* tables)

All added by migrations `0017`–`0022`. RLS is enabled on each (Postgres defaults new
tables to RLS **off**, which would be wide open — see `HANDOFF.md` footguns).

| Table | Migration | Holds |
|---|---|---|
| `paperwork_patient_data` | `0017` | The canonical patient JSON (one per patient). |
| `paperwork_templates` | `0017` | A converted editable form: the HTML + name + optional logo (`logo_data_uri`, `logo_company_name`). |
| `paperwork_documents` | `0017` | A filled document: `filled_html` for a (patient, template) pair. |
| `paperwork_source_files` | `0017` | Metadata for uploaded source PDFs (not the bytes). |
| `paperwork_jobs` | `0019` | The async job queue (see §2). |
| `paperwork_logos` | `0020`/`0021` | Reusable org logos + `company_name`, embeddable into templates. |
| `paperwork_json_templates` | `0022` | **Editable JSON *schemas*** selectable by payer type (1-to-many: many schemas per type, one default). Defines which sections/fields exist in the patient JSON for that patient type. |

Note the two distinct "template" concepts, which are easy to confuse:
- **`paperwork_templates`** = a *PDF form* turned into editable HTML (the output side).
- **`paperwork_json_templates`** = the *shape of the patient data JSON* (the input side),
  chosen by payer type. Editing one changes which blanks exist in the JSON, not the form.

---

## 4. The PDF export pipeline (and why it looks the way it does)

This is the area with the most hard-won, non-obvious code, all in
`src/app/(paperwork)/paperwork/pdf.ts`. A filled document is an **HTML string**. Turning
it into a faithful US-Letter PDF in the browser produced a long string of bugs; the
current pipeline is the accumulated set of fixes. Each design choice maps to a failure:

### 4.1 Don't use `html2pdf.js` `.from(element)` — drive `html2canvas` on an iframe
`html2pdf.js`'s helper clones only the `<body>` into the **main** document, which drops
every `<head><style>` rule (page widths, `.row` flex, black section headers, our
normalization). Result: the export looked nothing like the on-screen preview. **Fix:** we
write the HTML (with styles) into an **offscreen iframe**, let it lay out, then run
`html2canvas` directly on the iframe's `body` so its own styles apply, and assemble the
PDF with `jsPDF`.

### 4.2 Force US-Letter geometry with `PAGE_STYLE` (injected last so it wins)
The model emits arbitrary widths; lines/boxes spilled past 8.5×11. **Fix:** `injectPageStyle()`
appends a stylesheet (`PAGE_STYLE`) into the document `<head>` for **all three** surfaces
— preview, full-view editor, and export — so they match. Key rules and the bug each kills:
- `@page { size: letter }`, `body { width: 8.5in; padding: 0.5in; box-sizing: border-box }`
  — pins the page to Letter with a 0.5in printable margin. **No auto-centering** (`margin:auto`
  confused html2canvas and produced a blank/sliver page).
- `overflow-x: hidden` on html/body — stops the rasteriser from capturing a canvas wider
  than the page (which made the whole export shrink to a sliver).
- `body * { max-width: 100%; min-width: 0 }` — `min-width:0` lets flex children actually
  shrink/wrap instead of forcing a row wider than the page (text running off the right).
- `* { print-color-adjust: exact }` — keeps background colors (e.g. black section headers)
  in the raster; otherwise they dropped to white.
- `body *:not(textarea):not(pre) { white-space: normal !important }` — the model loves to
  wrap whole sentences in `white-space:nowrap`, which runs text off the page. We force
  normal wrapping everywhere except textarea/pre. Short units (e.g. "(inches)") are kept
  attached to their field via non-breaking spaces in the prompt instead (see §5).
- `flex-wrap:nowrap → wrap` override — lets rows wrap onto the page instead of overflowing.

### 4.3 Flatten form fields before rasterising (the "sinking text" bug)
**Symptom:** typed values showed in the preview, but in the download only the **top ~10%**
of each typed letter rendered — the text sank below its field and clipped. This is a known
`html2canvas` bug rendering text *inside* real `<input>/<textarea>/<select>`. **Fix:**
`flattenFormFields()` runs **only in the throwaway export iframe** right before capture and
replaces each control with a styled `<span>`/`<div>` holding its current value (checkboxes/
radios become Unicode glyphs ☐/☑/◯/◉). `copyFieldStyle()` copies the field's font, borders/
underline, width and padding so the static replacement looks identical. The live preview
and the saved HTML are untouched.

### 4.4 Transparent flattened-field background (the "white box eats the label" bug)
**Symptom:** the most recent fix. After flattening, your typed value rendered perfectly,
but the **label on the line above** was cut in half (you couldn't see the bottom of e.g.
"Address"). Cause: `copyFieldStyle` was copying the input's **white** background onto the
replacement span; the span's box is slightly taller than its text and overlaps upward into
the previous line, so the opaque white painted over the bottom of the label there (your
value, drawn on top, still looked fine — hence "white box behind my text, in front of the
label"). It only happened where a field sat close under a label. **Fix:** flattened fields
use `background: transparent` — forms sit on white paper anyway and the underline border
still draws. (`pdf.ts`, `copyFieldStyle`.)

### 4.5 Smart page breaks between elements
**Symptom:** multi-page forms cut a row/line in half across the page boundary. **Fix:**
`computePageSlices()` measures every element's box, then greedily slices the rendered
canvas at gaps **between** elements (pulling a break upward above anything it would
straddle) instead of at a fixed page height. An element taller than a page falls back to a
hard cut so progress is always made.

### 4.6 Bulk export = client-side zip
`downloadDocsAsZip()` renders each selected document to a PDF and bundles them with JSZip
into one `.zip` ("download as folder"), de-duping identical filenames. All client-side —
keeps PDF bytes off the server entirely.

---

## 5. Prompt-engineering decisions (worker.mjs)

These live in `infra/aws/paperwork-worker/worker.mjs`. The prompts are part of the
*engineering*, not incidental text — several bugs were prompt bugs:

- **Model = `gemini-3.1-flash-lite`.** We started on `gemini-2.5-flash`/`pro`, which were
  slow (multi-minute, often truncated → invalid JSON). Flash-Lite finishes the same job in
  <10s with valid output. Set via `GEMINI_MODEL` env.
- **`thinkingConfig.thinkingLevel = "LOW"`.** Gemini 3.x "thinking" added large latency for
  no quality gain here and contributed to 504/`DEADLINE_EXCEEDED`. Forced low.
- **Per-call hard timeout + retry** (`AbortSignal.timeout`, `httpOptions.timeout`,
  configurable `GEN_ATTEMPTS`/`GEN_TIMEOUT_MS`) — so one slow call fails fast and retries
  instead of hanging the whole job.
- **Balanced-JSON slicing** (`sliceBalancedJson`) — the model sometimes appends a stray
  trailing brace/junk after a valid object, which broke `JSON.parse`. We extract the first
  complete balanced object and ignore the rest. On parse failure we log `finishReason` and
  text length (never PHI) for diagnosis.
- **Dates come from the server clock, not the model.** The model hallucinated dates. The
  patient JSON deliberately carries **no** date for signature/completion fields; the worker
  injects the **current date** (timezone-aware via `Intl.DateTimeFormat`) for form-
  completion/signature fields, while clinical dates that genuinely exist in the source are
  preserved. The fill prompt is told to use the supplied date and not invent others.
- **"Leave blank over guess."** The fill prompt prioritizes leaving a field empty when the
  answer isn't supported by the data, rather than fabricating a plausible value.
- **Narrow composition allowance.** Forms ask for combined fields like "City/State/Zip"
  while the JSON stores `city`, `state`, `zip` separately, so they weren't filling. The
  prompt now explicitly *allows* combining separate address parts — a deliberately narrow
  loosening, not a general license to merge fields.
- **Layout fidelity for `templateToHtml`.** Targets a US-Letter container, resets
  `box-sizing/max-width`, and changes row layout from `flex-wrap:nowrap` to `wrap`, while
  keeping short label+input+unit clusters together via `&nbsp;` instead of `nowrap` on long
  text (which was forcing units like "(inches)" onto their own line). This pairs with the
  client `PAGE_STYLE` (§4.2) — belt and suspenders.

---

## 6. Auto-fill & data plumbing decisions

- **Patient name seeding** — `loadPatientPaperwork` (`page.tsx`) pulls the patient's
  `first_name`/`last_name` from the `patients` table and seeds them into the JSON's
  `patient_demographics` only when those fields are blank, so the rep doesn't retype known
  data and we never clobber a manual edit.
- **Logos + company name** — `paperwork_logos` stores reusable PNG/JPG logos as data URIs
  paired with a `company_name`; selecting one embeds it into a template's HTML (token-based)
  so branding from the original form carries onto generated PDFs. Logos have a delete button
  with an "are you sure?" confirm; company name is editable on an existing logo
  (`updateLogo`).
- **Completion %** — computed server-side in `page.tsx` from the JSON against the selected
  JSON-template schema (`isLeafKnown`/`mergePatientData`), surfaced in the patient search as
  a color-coded number + status circle (red <30, orange 30–60, yellow 60–90, green 90–100,
  "complete" badge at 100).

---

## 7. UI structure

`src/app/(paperwork)/paperwork/` — a top-level tabbed client app (`PaperworkApp.tsx`):
- **Patients tab** — search (with completion badge) → Input/Output PDF panels →
  `CompletenessPanel`. Output panel shows template previews (scaled iframes), per-doc
  download, multi-select + "download as folder", and a full-screen editor.
- **JSON Templates tab** — CRUD editor for `paperwork_json_templates` (sections/fields/
  kind/options) by payer type, mirroring the admin payer-type template editor; delete is
  guarded by an "are you sure?" confirm.
- Boolean fields render as **Yes/No toggle buttons** (clicking an already-selected button
  clears it back to "no value"), so an unanswered boolean shows a red ✗ instead of a
  misleading green ✓ — the original checkbox UI made every unanswered boolean look done.

---

## 8. Security / RLS posture

- The **worker connects as `postgres` (superuser) and bypasses RLS.** This is acceptable
  because it is server-side on the EC2 box, never reachable by clients, and only ever acts
  on a job a client was already allowed to enqueue. The browser path stays RLS-guarded:
  `paperwork_jobs` and the `paperwork_*` tables have policies tying rows to patients the
  user can see (`can_view_patient`/`can_write_patient`/`current_user_active` helpers).
- **No PHI in logs.** The worker logs only job ids, kinds, durations, and error messages —
  never names or field values. Same rule as the base app.
- **File bytes are transient.** Uploaded source bytes ride inside the job row as base64 and
  are not persisted to a storage bucket; this keeps v1 off a HIPAA-tier blob store (see §9).

---

## 9. Scope / known limits

- Still **synthetic-data-only** until the HIPAA hardening in `HANDOFF.md` is signed off.
- **No bucket storage of files** by design — generated HTML lives in Postgres, source bytes
  are pass-through. Direct upload to Box/OneDrive/Google Drive was discussed and deferred
  (BAA + connector work); for now the flow is download → upload manually.
- Generated forms are an *aid*: a human reviews/edits every filled document before use.
  Field-level accuracy depends on source quality; the prompts bias toward blank over guess.

---

## 10. Quick "why is it like this?" index

| You're wondering… | Answer | Where |
|---|---|---|
| Why a separate EC2 worker instead of a server action? | Amplify's hard ~30s cap kills long Gemini calls. | §2 |
| Why base64 bytes in a DB row, not a bucket? | Avoids a HIPAA-tier storage tier in v1. | §2, §9 |
| Why does export use html2canvas-on-iframe, not html2pdf? | html2pdf drops `<head>` styles → export ≠ preview. | §4.1 |
| Why replace inputs with spans before export? | html2canvas sinks/clips text inside real inputs. | §4.3 |
| Why transparent field backgrounds? | White field box painted over the label above it. | §4.4 |
| Why Flash-Lite + thinkingLevel LOW? | 2.5 models were slow/truncated; thinking added 504s. | §5 |
| Why does the date come from the server? | The model hallucinated dates. | §5 |
| Why two kinds of "template"? | PDF-form HTML vs. patient-JSON schema. | §3 |
