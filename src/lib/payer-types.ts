import type { PayerTypeRecord } from "@/lib/db-types";

export type PayerTypeRow = PayerTypeRecord;

/** Original v1 workflow types — always shown; cannot be deleted. */
export const BUILT_IN_PAYER_TYPE_CODES = [
  "COMMERCIAL",
  "MEDICAID",
  "MEDICARE",
] as const;

export type BuiltInPayerTypeCode = (typeof BUILT_IN_PAYER_TYPE_CODES)[number];

export const DEFAULT_PAYER_TYPES: PayerTypeRecord[] = [
  { code: "COMMERCIAL", display_name: "Insurance", sort_order: 1 },
  { code: "MEDICAID", display_name: "Medicaid", sort_order: 2 },
  { code: "MEDICARE", display_name: "Medicare", sort_order: 3 },
];

export function isBuiltInPayerType(code: string): code is BuiltInPayerTypeCode {
  return (BUILT_IN_PAYER_TYPE_CODES as readonly string[]).includes(code);
}

/** Built-in types first, then custom types from DB (deduped by code). */
export function mergePayerTypes(dbTypes: PayerTypeRecord[]): PayerTypeRecord[] {
  const byCode = new Map<string, PayerTypeRecord>();
  for (const d of DEFAULT_PAYER_TYPES) {
    byCode.set(d.code, { ...d });
  }
  for (const row of dbTypes) {
    if (!isBuiltInPayerType(row.code)) {
      byCode.set(row.code, row);
    }
  }
  return [...byCode.values()].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.display_name.localeCompare(b.display_name),
  );
}

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
