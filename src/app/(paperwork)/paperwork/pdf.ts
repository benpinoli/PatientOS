"use client";

// Client-side PDF + zip helpers for the filled paperwork documents.
//
// Filled documents are HTML strings. We render each one in an offscreen iframe
// (so its <head>/<style> applies) and rasterise it to a PDF with html2pdf.js.
// For bulk export we bundle the PDFs into a single .zip (a "folder") with JSZip.
// Both libraries are loaded on demand from a CDN — same pattern as PdfThumbnail.

const HTML2PDF_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.3/html2pdf.bundle.min.js";
const JSZIP_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error(`Failed to load ${src}`)),
      );
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let html2pdfPromise: Promise<any> | null = null;
let jsZipPromise: Promise<any> | null = null;

function getHtml2pdf(): Promise<any> {
  if (!html2pdfPromise) {
    html2pdfPromise = loadScript(HTML2PDF_SRC).then(
      () => (window as any).html2pdf,
    );
  }
  return html2pdfPromise;
}

function getJsZip(): Promise<any> {
  if (!jsZipPromise) {
    jsZipPromise = loadScript(JSZIP_SRC).then(() => (window as any).JSZip);
  }
  return jsZipPromise;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** US Letter width in CSS px at 96dpi (8.5in). */
const RENDER_WIDTH = 816;

/**
 * Page geometry forced onto every rendered/exported document so it always lands
 * on US Letter (8.5x11) with consistent margins, regardless of whatever width
 * the model happened to emit. Applied to the preview, the full-view editor, and
 * the PDF export so all three match.
 */
export const PAGE_STYLE = `
  @page { size: letter; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: 7.5in; margin: 0 auto; padding: 0.5in 0; box-sizing: border-box; }
  *, *::before, *::after { box-sizing: border-box; }
  body * { max-width: 100%; }
  img { max-width: 100%; height: auto; }
  /* Let rows wrap to the page instead of overflowing; label+input+unit
     clusters keep their own nowrap so units never detach. */
  [style*="flex-wrap:nowrap"], [style*="flex-wrap: nowrap"] { flex-wrap: wrap !important; }
`;

/**
 * Injects {@link PAGE_STYLE} into an HTML document string so its geometry is
 * normalized to US Letter. The style is appended last (after the document's own
 * <style>) so it wins on conflicting rules.
 */
export function injectPageStyle(html: string): string {
  const tag = `<style data-paperwork-page>${PAGE_STYLE}</style>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${tag}</head>`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/(<body[^>]*>)/i, `$1${tag}`);
  }
  return tag + html;
}

/** Renders a full HTML document string to a US Letter PDF Blob. */
export async function htmlToPdfBlob(html: string): Promise<Blob> {
  const html2pdf = await getHtml2pdf();

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = `${RENDER_WIDTH}px`;
  iframe.style.height = `${Math.round((RENDER_WIDTH * 11) / 8.5)}px`;
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Could not prepare the document for export.");
    doc.open();
    doc.write(injectPageStyle(html));
    doc.close();
    // Give the iframe a moment to lay out fonts/images before rasterising.
    await new Promise((r) => setTimeout(r, 400));

    const opt = {
      // Margins live in PAGE_STYLE (body padding) so they can't double up.
      margin: 0,
      image: { type: "jpeg", quality: 0.96 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: RENDER_WIDTH,
      },
      jsPDF: { unit: "pt", format: "letter", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] },
    };

    return (await html2pdf()
      .set(opt)
      .from(doc.body)
      .outputPdf("blob")) as Blob;
  } finally {
    iframe.remove();
  }
}

/** Triggers a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Sanitises a label into a safe `*.pdf` filename. */
export function safePdfName(name: string): string {
  const base =
    name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "document";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

/** Renders several documents to PDFs and downloads them as one zipped folder. */
export async function downloadDocsAsZip(
  docs: { name: string; html: string }[],
  folderName: string,
): Promise<void> {
  const JSZip = await getJsZip();
  const zip = new JSZip();
  const folder = zip.folder(folderName) ?? zip;

  const used = new Set<string>();
  for (const d of docs) {
    let fname = safePdfName(d.name);
    // De-dupe identical names within the zip.
    if (used.has(fname)) {
      const stem = fname.replace(/\.pdf$/i, "");
      let n = 2;
      while (used.has(`${stem} (${n}).pdf`)) n += 1;
      fname = `${stem} (${n}).pdf`;
    }
    used.add(fname);
    const blob = await htmlToPdfBlob(d.html);
    folder.file(fname, blob);
  }

  const out: Blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(out, `${folderName}.zip`);
}
