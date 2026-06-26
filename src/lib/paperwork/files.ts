import type { InlineFile } from "@/lib/paperwork/gemini";

/** Converts a web File (from FormData) into a base64 inline part for Gemini. */
export async function fileToInline(file: File): Promise<InlineFile> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return {
    data: buffer.toString("base64"),
    mimeType: file.type || "application/octet-stream",
    name: file.name,
  };
}

/** Slugs a filename so it is safe to use inside a storage object path. */
export function safeFileName(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_");
  return cleaned.slice(-120) || "file";
}
