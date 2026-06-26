export type PatientLite = {
  id: string;
  first_name: string;
  last_name: string;
  drive_folder_url: string | null;
  /** Payer type code (e.g. MEDICARE) — selects the patient's JSON template. */
  payer_type: string | null;
  /** 0-100 completion of the patient's structured JSON (for the search bar). */
  completion_pct: number;
};
