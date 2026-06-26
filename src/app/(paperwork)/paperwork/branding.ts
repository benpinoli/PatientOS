// Branding/logo helpers shared by the paperwork UI.
//
// Converted templates store a small placeholder token where the org logo goes
// (keeping the large base64 logo out of the model round-trip). The real <img> is
// swapped in for previews here on the client; the worker does the same swap when
// it produces a filled document. Keep LOGO_TOKEN in sync with the worker.

export const LOGO_TOKEN = "__LOGO_IMG__";

export function logoImgTag(dataUri: string): string {
  return `<img src="${dataUri}" alt="Logo" style="max-height:72px;max-width:260px;object-fit:contain;" />`;
}

/** Replaces the logo placeholder token in template HTML with the real image. */
export function embedLogo(
  html: string,
  logoDataUri: string | null | undefined,
): string {
  if (!html) return html;
  const replacement = logoDataUri ? logoImgTag(logoDataUri) : "";
  return html.split(LOGO_TOKEN).join(replacement);
}
