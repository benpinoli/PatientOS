"use client";

// Client-side PDF + zip helpers for the filled paperwork documents.
//
// Filled documents are HTML strings. We render each one in an offscreen iframe
// (so its <head>/<style> applies) and rasterise it with html2canvas, then build
// a US Letter PDF with jsPDF. We deliberately do NOT use html2pdf.js's
// `.from(element)` helper: it clones only the <body> into the MAIN document,
// which drops every <head> <style> rule (.page widths, .row flex, the black
// section headers, our normalization) so the export looked nothing like the
// preview. Driving html2canvas on the iframe body keeps those styles.
// For bulk export we bundle the PDFs into a single .zip (a "folder") with JSZip.
// Libraries are loaded on demand from a CDN — same pattern as PdfThumbnail.

const HTML2CANVAS_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
const JSPDF_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
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
let html2canvasPromise: Promise<any> | null = null;
let jsPdfPromise: Promise<any> | null = null;
let jsZipPromise: Promise<any> | null = null;

function getHtml2canvas(): Promise<any> {
  if (!html2canvasPromise) {
    html2canvasPromise = loadScript(HTML2CANVAS_SRC).then(
      () => (window as any).html2canvas,
    );
  }
  return html2canvasPromise;
}

function getJsPDF(): Promise<any> {
  if (!jsPdfPromise) {
    jsPdfPromise = loadScript(JSPDF_SRC).then(
      () => (window as any).jspdf?.jsPDF ?? (window as any).jsPDF,
    );
  }
  return jsPdfPromise;
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
  html, body {
    margin: 0; padding: 0; background: #fff; color: #000;
    /* Clamp horizontal overflow so the rasteriser never captures a canvas
       wider than the page (which made the export shrink to a sliver). */
    overflow-x: hidden;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  /* Body is the full page (8.5in); padding gives the 0.5in printable margin.
     No auto-centering — that confused html2canvas and produced a blank page. */
  body { width: 8.5in; max-width: 100%; padding: 0.5in; box-sizing: border-box; }
  *, *::before, *::after { box-sizing: border-box; }
  /* Keep background colors (e.g. black section headers) in the rasterised PDF. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* min-width:0 lets flex children actually shrink/wrap instead of forcing the
     row wider than the page (one cause of text running off the right). */
  body * { max-width: 100%; min-width: 0; }
  img { max-width: 100%; height: auto; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  td, th { overflow-wrap: anywhere; word-break: break-word; }
  input, textarea, select { max-width: 100%; }
  /* The model often wraps whole sentences/questions in white-space:nowrap, which
     makes the text run off the page. Force normal wrapping everywhere EXCEPT
     textarea/pre (which need their own whitespace). Short units stay attached via
     non-breaking spaces, which still hold under white-space:normal. */
  body *:not(textarea):not(pre) { white-space: normal !important; }
  /* Let rows wrap to the page instead of overflowing. */
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

/**
 * Splits the rendered body (height `totalCss`, in CSS px) into page-sized slices
 * whose cut lines fall in the gaps BETWEEN elements, so no row/field/line is
 * split across a page boundary. Greedy: each page takes up to `pageHeightCss`,
 * then the break is pulled up above any element it would otherwise straddle.
 */
function computePageSlices(
  doc: Document,
  totalCss: number,
  pageHeightCss: number,
): { start: number; height: number }[] {
  const bodyTop = doc.body.getBoundingClientRect().top;
  // Atomic elements we must not cut through: those that fit within a page.
  const spans: { top: number; bottom: number }[] = [];
  doc.body.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const r = el.getBoundingClientRect();
    const top = r.top - bodyTop;
    const bottom = r.bottom - bodyTop;
    const h = bottom - top;
    if (h > 0 && h <= pageHeightCss) spans.push({ top, bottom });
  });

  const slices: { start: number; height: number }[] = [];
  let y = 0;
  let guard = 0;
  while (y < totalCss - 1 && guard++ < 2000) {
    const limit = y + pageHeightCss;
    if (limit >= totalCss) {
      slices.push({ start: y, height: totalCss - y });
      break;
    }
    // Pull the break up above any element it straddles (iterate to convergence).
    let breakY = limit;
    let changed = true;
    let inner = 0;
    while (changed && inner++ < 5000) {
      changed = false;
      for (const s of spans) {
        if (s.top > y && s.top < breakY && s.bottom > breakY) {
          breakY = s.top;
          changed = true;
        }
      }
    }
    // An element taller than a page (or starting at y) can't be avoided; fall
    // back to a hard cut at the page limit to keep making progress.
    if (breakY <= y) breakY = limit;
    slices.push({ start: y, height: breakY - y });
    y = breakY;
  }
  if (slices.length === 0) slices.push({ start: 0, height: totalCss });
  return slices;
}

/** Renders a full HTML document string to a US Letter PDF Blob. */
export async function htmlToPdfBlob(html: string): Promise<Blob> {
  const [html2canvas, jsPDF] = await Promise.all([
    getHtml2canvas(),
    getJsPDF(),
  ]);

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

    // Grow the iframe to the full content height so multi-page forms are fully
    // captured (html2canvas renders the body's complete scroll height).
    const fullHeight = Math.max(
      doc.body.scrollHeight,
      doc.documentElement.scrollHeight,
    );
    iframe.style.height = `${fullHeight}px`;
    await new Promise((r) => setTimeout(r, 50));

    const SCALE = 2;

    const pdf = new jsPDF({
      unit: "pt",
      format: "letter",
      orientation: "portrait",
    });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    // How many CSS px of body content fit on one Letter page (body is the full
    // 8.5in width mapped to pageW, so the same ratio gives the page height).
    const pageHeightCss = (pageH * RENDER_WIDTH) / pageW;

    // Compute page breaks that fall BETWEEN elements (rows/fields), never
    // through them, so a line is not cut across a page boundary.
    const slices = computePageSlices(doc, fullHeight, pageHeightCss);

    // Rasterise inside the iframe (its <head> styles apply here, unlike
    // html2pdf's clone-into-main-document approach).
    const canvas = await html2canvas(doc.body, {
      scale: SCALE,
      useCORS: true,
      backgroundColor: "#ffffff",
      width: RENDER_WIDTH,
      height: fullHeight,
      windowWidth: RENDER_WIDTH,
      windowHeight: fullHeight,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
    });

    slices.forEach((slice, i) => {
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.round(slice.height * SCALE);
      const ctx = sliceCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(
          canvas,
          0,
          Math.round(slice.start * SCALE),
          canvas.width,
          sliceCanvas.height,
          0,
          0,
          canvas.width,
          sliceCanvas.height,
        );
      }
      const imgData = sliceCanvas.toDataURL("image/jpeg", 0.96);
      const imgW = pageW;
      const imgH = (sliceCanvas.height * pageW) / sliceCanvas.width;
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, imgW, imgH);
    });

    return pdf.output("blob") as Blob;
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
