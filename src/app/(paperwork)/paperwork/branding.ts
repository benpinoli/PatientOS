// Branding/logo helpers shared by the paperwork UI.
//
// Converted templates store a small placeholder token where the org logo goes
// (keeping the large base64 logo out of the model round-trip). The real <img> is
// swapped in for previews here on the client; the worker does the same swap when
// it produces a filled document. Keep LOGO_TOKEN in sync with the worker.

export const LOGO_TOKEN = "__LOGO_IMG__";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Builds the branding block: the logo image and (optionally) the company name. */
export function logoBlock(
  dataUri: string | null | undefined,
  companyName?: string | null,
): string {
  const img = dataUri
    ? `<img src="${dataUri}" alt="Logo" style="max-height:72px;max-width:260px;object-fit:contain;" />`
    : "";
  const name = companyName?.trim()
    ? `<span style="font-size:20px;font-weight:700;line-height:1.2;">${escapeHtml(companyName.trim())}</span>`
    : "";
  if (!img && !name) return "";
  return `<span style="display:inline-flex;align-items:center;gap:12px;vertical-align:middle;">${img}${name}</span>`;
}

/** Replaces the logo placeholder token in template HTML with the branding block. */
export function embedLogo(
  html: string,
  logoDataUri: string | null | undefined,
  companyName?: string | null,
): string {
  if (!html) return html;
  return html.split(LOGO_TOKEN).join(logoBlock(logoDataUri, companyName));
}
