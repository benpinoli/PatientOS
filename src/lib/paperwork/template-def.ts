// Editable JSON field-template definitions for Paperwork AI.
//
// A template "definition" describes the field STRUCTURE for a patient (payer)
// type: a list of sections, each with a list of fields. Each field has a dotted
// `path` (relative to its section key), a human label, a `kind` that drives the
// editor input + completeness logic, and optional `options` for `choice` fields.
//
// This module is intentionally dependency-free (pure types + builders) so it can
// be imported from both schema.ts and server actions without import cycles.

export type FieldKind = "text" | "number" | "boolean" | "list" | "date" | "choice";

export type JsonTemplateField = {
  /** Dotted path relative to the section key, e.g. "residing_address.street". */
  path: string;
  label: string;
  kind: FieldKind;
  /** Allowed values for `choice` fields. */
  options?: string[];
};

export type JsonTemplateSection = {
  key: string;
  label: string;
  fields: JsonTemplateField[];
};

export type JsonTemplateDefinition = {
  sections: JsonTemplateSection[];
};

/** Full dotted path into the patient JSON for a field within a section. */
export function fullFieldPath(sectionKey: string, fieldPath: string): string {
  return fieldPath ? `${sectionKey}.${fieldPath}` : sectionKey;
}

/** Immutably sets a dotted path, creating intermediate objects as needed. */
function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split(".");
  const clone: Record<string, unknown> = { ...obj };
  let cursor = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const existing = cursor[key];
    cursor[key] =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
  return clone;
}

/** Blank value for a freshly-created patient record (unrecorded leaves). */
function emptyValueForKind(kind: FieldKind): unknown {
  switch (kind) {
    case "number":
      return null;
    // Yes/No fields start unrecorded (null) so the checklist shows a red mark
    // until someone explicitly picks Yes or No.
    case "boolean":
      return null;
    case "list":
      return [];
    default:
      return "";
  }
}

/** Example/placeholder value used to teach the AI the expected shape + format. */
function exampleValueForKind(field: JsonTemplateField): unknown {
  switch (field.kind) {
    case "number":
      return null;
    case "boolean":
      return true;
    case "list":
      return [];
    case "date":
      return "YYYY-MM-DD";
    case "choice":
      return (field.options ?? []).join(" / ");
    default:
      return "";
  }
}

/** Builds an empty patient JSON skeleton (blank leaves) from a definition. */
export function buildEmptyData(
  def: JsonTemplateDefinition,
): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (const section of def.sections) {
    for (const field of section.fields) {
      out = setPath(
        out,
        fullFieldPath(section.key, field.path),
        emptyValueForKind(field.kind),
      );
    }
  }
  return out;
}

/** Builds the example JSON shape sent to the AI as the extraction contract. */
export function buildExampleShape(
  def: JsonTemplateDefinition,
): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (const section of def.sections) {
    for (const field of section.fields) {
      out = setPath(
        out,
        fullFieldPath(section.key, field.path),
        exampleValueForKind(field),
      );
    }
  }
  return out;
}

/** Total leaf-field count across all sections. */
export function countFields(def: JsonTemplateDefinition): number {
  return def.sections.reduce((n, s) => n + s.fields.length, 0);
}
