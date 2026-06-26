"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders the first page of a file as a thumbnail.
 * - PDFs are rendered via pdf.js (worker loaded from a version-matched CDN to
 *   avoid bundler worker-resolution issues; failures fall back to a file card).
 * - Images are shown directly.
 * - Anything else gets a generic file card.
 */
export function PdfThumbnail({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = file.type.startsWith("image/");

  useEffect(() => {
    if (isImage) {
      const url = URL.createObjectURL(file);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (!isPdf) return;

    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
        const buffer = await file.arrayBuffer();
        if (cancelled) return;
        const doc = await pdfjs.getDocument({ data: buffer }).promise;
        const page = await doc.getPage(1);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, isPdf, isImage]);

  if (isImage && imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt={file.name} className="h-full w-full object-cover" />;
  }

  if (isPdf && !failed) {
    return <canvas ref={canvasRef} className="h-full w-full object-contain" />;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
      <span className="text-2xl">📄</span>
      <span className="px-1 text-[10px] text-[var(--tron-muted)]">
        {(file.name.split(".").pop() ?? "file").toUpperCase()}
      </span>
    </div>
  );
}
