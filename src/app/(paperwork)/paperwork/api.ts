// Client helpers for Paperwork AI.
//
// Amplify's SSR runtime hard-caps responses at ~30s — too short for Gemini
// PDF->HTML conversion / fills. So the browser does NOT call a long API route.
// Instead it inserts a row into `paperwork_jobs` (RLS-guarded), then polls until
// a worker on the EC2 Supabase host (no 30s cap) processes it and writes the
// result. See supabase/migrations/0019_paperwork_jobs.sql and
// infra/aws/paperwork-worker/.

import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { PaperworkJobKind } from "@/lib/db-types";

export type InlineFilePayload = { name: string; mimeType: string; data: string };

/** Reads a File into a base64 payload (no data: prefix) for the job input. */
export async function fileToBase64Payload(file: File): Promise<InlineFilePayload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    data: btoa(binary),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes

/**
 * Enqueues an AI job and resolves with the worker's `result` payload once the
 * job reaches DONE. Throws with the worker's message on ERROR, or a friendly
 * message if it never completes in time.
 */
export async function runPaperworkJob<T = Record<string, unknown>>(args: {
  kind: PaperworkJobKind;
  patientId?: string | null;
  templateId?: string | null;
  input: Record<string, unknown>;
  onElapsed?: (seconds: number) => void;
  timeoutMs?: number;
}): Promise<T> {
  const supabase = getSupabaseBrowser();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session expired — please sign in again.");

  const { data: inserted, error: insertErr } = await supabase
    .from("paperwork_jobs")
    .insert({
      kind: args.kind,
      patient_id: args.patientId ?? null,
      template_id: args.templateId ?? null,
      input: args.input,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    throw new Error(insertErr?.message ?? "Could not queue the AI job.");
  }
  const jobId = (inserted as { id: string }).id;

  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    const elapsed = Date.now() - started;
    args.onElapsed?.(Math.round(elapsed / 1000));

    const { data: row, error } = await supabase
      .from("paperwork_jobs")
      .select("status, result, error")
      .eq("id", jobId)
      .single();

    if (error) throw new Error(error.message);
    if (row.status === "DONE") return (row.result ?? {}) as T;
    if (row.status === "ERROR") {
      throw new Error(row.error ?? "The AI job failed.");
    }
    if (elapsed > timeoutMs) {
      throw new Error(
        "The AI job is still running after 3 minutes. It may finish shortly — " +
          "reopen this patient/template in a moment, or try a smaller document.",
      );
    }
  }
}
