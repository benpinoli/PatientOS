export type PayerTypeRow = {
  code: string;
  display_name: string;
  sort_order: number;
};

/** Uppercase slug for DB `payer_types.code`. */
export function normalizePayerTypeCode(input: string): string {
  const slug = input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "TYPE";
}

export function payerTypeSectionTitle(row: PayerTypeRow): string {
  const name = row.display_name.trim();
  if (/patients?$/i.test(name)) return name;
  return `${name} patients`;
}

export function payerTypeMatrixTitle(row: PayerTypeRow): string {
  const name = row.display_name.trim();
  if (/patients?$/i.test(name)) return name;
  return `${name} patients`;
}

export function payerTypeMatrixDescription(code: string, displayName: string): string {
  const known: Record<string, string> = {
    COMMERCIAL: "Commercial / private insurance workflows.",
    MEDICAID: "Nevada Medicaid Group 3 checklist.",
    MEDICARE: "Medicare workflow steps.",
  };
  return known[code] ?? `${displayName} workflow steps.`;
}
