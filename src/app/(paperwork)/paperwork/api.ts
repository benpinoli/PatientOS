// Client helper for the Paperwork AI API routes.
//
// The Amplify SSR runtime has a hard ~30s response timeout. Long Gemini calls
// (template conversion / fill on large forms) can exceed it; the function is
// killed and the browser receives an empty or non-JSON body. Calling
// `res.json()` on that throws the cryptic "Unexpected end of JSON input".
// This helper reads the body defensively and surfaces an actionable message.

const TIMEOUT_MESSAGE =
  "The AI request timed out (Amplify caps server responses at ~30s). " +
  "Large or multi-page documents can exceed it — try a shorter / single-page file.";

export async function readApiJson<T>(
  res: Response,
  action: string,
): Promise<T> {
  const raw = await res.text();

  if (!raw.trim()) {
    // Empty body: almost always the SSR timeout (504/502) or a hard crash.
    if (res.status === 502 || res.status === 504 || res.status === 408) {
      throw new Error(TIMEOUT_MESSAGE);
    }
    throw new Error(`${action} failed: empty response (status ${res.status}).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${action} failed: the server returned an unexpected response (status ${res.status}). ` +
        "This usually means the request timed out.",
    );
  }

  const body = parsed as { error?: string } & T;
  if (!res.ok) {
    throw new Error(body.error ?? `${action} failed (status ${res.status}).`);
  }
  return body as T;
}
