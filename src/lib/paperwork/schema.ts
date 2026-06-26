// Canonical patient JSON schema for Paperwork AI.
//
// `SCHEMA_FOR_PROMPT` mirrors JSON_Example/example_patient.json exactly: empty
// strings for free text, placeholder tokens ("YYYY-MM-DD") for dates, and
// slash-delimited option lists for enums. It serves two jobs:
//   1. The shape/контракт we ask Gemini to return when extracting a patient.
//   2. The structure we walk to compute "what we know vs. don't" for the UI.
//
// Keep this in sync with the example file if the schema evolves.

import type { PaperworkPatientData } from "@/lib/db-types";

export const SCHEMA_FOR_PROMPT = {
  patient_demographics: {
    last_name: "",
    first_name: "",
    middle_initial: "",
    date_of_birth: "YYYY-MM-DD",
    sex: "Male/Female",
    weight_lbs: null,
    height_inches: null,
    residing_address: {
      street: "",
      city: "",
      state: "",
      zip_code: "",
    },
    phone_number: "",
    place_of_service_code: "",
    facility_name_if_applicable: "",
  },
  insurance_billing: {
    primary_insurer_name: "",
    policy_id: "",
    group_number: "",
    medicare_number_hicn: "",
    medicaid_number: "",
    assignment_of_benefits_authorized: true,
    patient_signature_status: {
      physically_mentally_able_to_sign: true,
      reason_if_no: "",
      authorized_representative_name: "",
      authorized_representative_relationship: "",
    },
  },
  responsible_party: {
    name: "",
    relationship_to_patient: "",
    phone: "",
    address: {
      street: "",
      city: "",
      state: "",
      zip_code: "",
    },
  },
  clinical_status_diagnoses: {
    primary_justifying_diagnosis_icd10: [],
    complicating_conditions: [],
    mobility_status:
      "Bed Confined / Wheelchair Confined / Ambulatory w-assist / Ambulatory",
    prognosis: "Good / Fair / Poor",
    active_rehab_status: false,
    contractures_impair_functional_ability: false,
    skin_integrity_pressure_ulcers: {
      completely_immobile: false,
      limited_mobility_cannot_alleviate_pressure: false,
      has_pressure_ulcer_on_trunk_or_pelvis: false,
      ulcer_locations: [],
      impaired_nutritional_status: false,
      fecal_or_urinary_incontinence: "None / Fecal / Urinary / Both",
      altered_sensory_perception: false,
      compromised_circulatory_status: false,
    },
  },
  power_mobility_device_pmd_specifics: {
    date_of_face_to_face_visit: "YYYY-MM-DD",
    date_equipment_prescribed: "YYYY-MM-DD",
    estimated_length_of_need_months: 99,
    expected_outcome_goals: "",
    equipment_type_requested:
      "Group I Motorized Chair / Group II Motorized Chair / Group III Motorized Chair / Group I POV Scooter / Group II POV Scooter",
    seating_type: "captain seat / sling-solid / rehab seat",
    power_options: "None / Single Power Option / Multiple Power Option",
    specialty_evaluation_completed_by_pt_ot: false,
    ordered_accessories_hcpcs: [
      { code: "E2361", description: "22NF Batteries", quantity: 2 },
    ],
  },
  home_environmental_assessment: {
    evaluation_date: "YYYY-MM-DD",
    residence_type: "Single Story / Multi Story / Apt-Condo / Mobile Home",
    interior_ramps_required: false,
    beneficiary_aware_of_modification_responsibility: false,
    independent_utilization_possible: false,
    caregiver_willing_to_assist_if_needed: false,
    factors_rendering_mobility_device_unusable: false,
    factors_details: "",
    demonstrated_usability_locations: {
      bathroom: { accessible: false, comments: "" },
      bedroom: { accessible: false, comments: "" },
      hallways: { accessible: false, comments: "" },
      kitchen: { accessible: false, comments: "" },
    },
  },
  prescribing_physician_provider: {
    provider_name: "",
    title_credentials: "",
    npi_number: "",
    upin_number: "",
    phone_number: "",
    fax_number: "",
    address: {
      street: "",
      city: "",
      state: "",
      zip_code: "",
    },
    signature_on_file: false,
    date_signed: "YYYY-MM-DD",
  },
} as const;

const SECTION_LABELS: Record<string, string> = {
  patient_demographics: "Patient Demographics",
  insurance_billing: "Insurance & Billing",
  responsible_party: "Responsible Party",
  clinical_status_diagnoses: "Clinical Status & Diagnoses",
  power_mobility_device_pmd_specifics: "Power Mobility Device (PMD)",
  home_environmental_assessment: "Home Environmental Assessment",
  prescribing_physician_provider: "Prescribing Physician / Provider",
};

// Acronyms / tokens we want to render in a specific casing.
const LABEL_OVERRIDES: Record<string, string> = {
  icd10: "ICD-10",
  npi: "NPI",
  upin: "UPIN",
  hicn: "HICN",
  pmd: "PMD",
  hcpcs: "HCPCS",
  pov: "POV",
  pt: "PT",
  ot: "OT",
  id: "ID",
  zip: "ZIP",
  dob: "DOB",
  lbs: "(lbs)",
};

function humanizeSegment(segment: string): string {
  return segment
    .split("_")
    .map((word) => {
      const lower = word.toLowerCase();
      if (LABEL_OVERRIDES[lower]) return LABEL_OVERRIDES[lower];
      if (!word) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** Builds a readable label from the path segments below the section. */
function buildLabel(pathBelowSection: string[]): string {
  return pathBelowSection.map(humanizeSegment).join(" — ");
}

const DATE_PLACEHOLDER = "YYYY-MM-DD";

/** True when a string is a schema placeholder rather than a real value. */
function isPlaceholderString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  if (trimmed === DATE_PLACEHOLDER) return true;
  if (trimmed === "Male/Female") return true;
  // Slash-delimited option lists, e.g. "Good / Fair / Poor".
  if (trimmed.includes(" / ")) return true;
  return false;
}

/**
 * Decides whether a leaf value counts as "known".
 * - strings: known when non-empty and not a placeholder/option-list token
 * - numbers: known when not null/NaN
 * - booleans: a set boolean is treated as known (a value was provided)
 * - arrays: known when non-empty
 * - null/undefined: unknown
 */
function isLeafKnown(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return !isPlaceholderString(value);
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

export type FieldStatus = {
  /** Dotted path into the patient JSON, e.g. "patient_demographics.first_name". */
  path: string;
  label: string;
  known: boolean;
  value: unknown;
  /** "text" | "number" | "boolean" | "list" — drives the editor input. */
  kind: "text" | "number" | "boolean" | "list";
};

export type SectionCompleteness = {
  key: string;
  label: string;
  fields: FieldStatus[];
  knownCount: number;
  totalCount: number;
};

export type Completeness = {
  sections: SectionCompleteness[];
  knownCount: number;
  totalCount: number;
};

function leafKind(schemaValue: unknown): FieldStatus["kind"] {
  if (Array.isArray(schemaValue)) return "list";
  if (typeof schemaValue === "number") return "number";
  if (typeof schemaValue === "boolean") return "boolean";
  return "text";
}

/** Reads a dotted path out of an arbitrary object, returning undefined if absent. */
export function getValueAtPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Immutably sets a dotted path, creating intermediate objects as needed. */
export function setValueAtPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const keys = path.split(".");
  const clone: Record<string, unknown> = { ...(obj ?? {}) };
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
  return clone as T;
}

// Leaf detection in the schema: arrays are leaves; objects recurse.
function isSchemaLeaf(schemaValue: unknown): boolean {
  if (Array.isArray(schemaValue)) return true;
  if (schemaValue === null) return true;
  return typeof schemaValue !== "object";
}

function walkSection(
  sectionKey: string,
  schemaNode: Record<string, unknown>,
  data: unknown,
): FieldStatus[] {
  const fields: FieldStatus[] = [];

  const recurse = (
    node: Record<string, unknown>,
    pathSegments: string[],
    labelSegments: string[],
  ) => {
    for (const [key, schemaValue] of Object.entries(node)) {
      const nextPath = [...pathSegments, key];
      const nextLabels = [...labelSegments, key];
      if (isSchemaLeaf(schemaValue)) {
        const value = getValueAtPath(data, [sectionKey, ...nextPath].join("."));
        fields.push({
          path: [sectionKey, ...nextPath].join("."),
          label: buildLabel(nextLabels),
          known: isLeafKnown(value),
          value: value ?? null,
          kind: leafKind(schemaValue),
        });
      } else {
        recurse(schemaValue as Record<string, unknown>, nextPath, nextLabels);
      }
    }
  };

  recurse(schemaNode, [], []);
  return fields;
}

/** Computes the known/unknown checklist for a patient's structured JSON. */
export function evaluateCompleteness(data: PaperworkPatientData | null | undefined): Completeness {
  const sections: SectionCompleteness[] = [];
  let knownCount = 0;
  let totalCount = 0;

  for (const [sectionKey, schemaNode] of Object.entries(SCHEMA_FOR_PROMPT)) {
    const fields = walkSection(
      sectionKey,
      schemaNode as Record<string, unknown>,
      data ?? {},
    );
    const sectionKnown = fields.filter((f) => f.known).length;
    knownCount += sectionKnown;
    totalCount += fields.length;
    sections.push({
      key: sectionKey,
      label: SECTION_LABELS[sectionKey] ?? humanizeSegment(sectionKey),
      fields,
      knownCount: sectionKnown,
      totalCount: fields.length,
    });
  }

  return { sections, knownCount, totalCount };
}

/**
 * Deep-merges freshly extracted data over an existing record, preferring an
 * incoming value only when it is "known" so a new upload never blanks out a
 * field we already had. Arrays are replaced wholesale when the incoming array
 * is non-empty.
 */
export function mergePatientData(
  base: PaperworkPatientData | null | undefined,
  incoming: PaperworkPatientData | null | undefined,
): PaperworkPatientData {
  const merge = (b: unknown, i: unknown): unknown => {
    if (i === null || i === undefined) return b ?? null;
    if (Array.isArray(i)) return i.length > 0 ? i : (b ?? []);
    if (typeof i === "object") {
      const out: Record<string, unknown> = {
        ...((b && typeof b === "object" && !Array.isArray(b)
          ? (b as Record<string, unknown>)
          : {}) as Record<string, unknown>),
      };
      for (const [k, v] of Object.entries(i as Record<string, unknown>)) {
        out[k] = merge((b as Record<string, unknown> | undefined)?.[k], v);
      }
      return out;
    }
    // Scalars: take incoming only when it is a real (known) value.
    return isLeafKnown(i) ? i : (b ?? i);
  };
  return merge(base ?? {}, incoming ?? {}) as PaperworkPatientData;
}

/** Produces an empty patient JSON skeleton (blanked leaves) for a new record. */
export function emptyPatientData(): PaperworkPatientData {
  const blank = (node: unknown): unknown => {
    if (Array.isArray(node)) return [];
    if (node === null) return null;
    if (typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = blank(v);
      }
      return out;
    }
    if (typeof node === "string") return "";
    if (typeof node === "number") return null;
    // Yes/No fields start unrecorded (null) so the checklist shows a red ✗
    // until someone explicitly picks Yes or No.
    if (typeof node === "boolean") return null;
    return null;
  };
  return blank(SCHEMA_FOR_PROMPT) as PaperworkPatientData;
}
