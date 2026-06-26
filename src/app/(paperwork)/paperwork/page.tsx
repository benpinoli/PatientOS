import { requireUser } from "@/lib/server-helpers";
import type { PaperworkTemplate } from "@/lib/db-types";
import { PaperworkApp } from "./PaperworkApp";
import type { PatientLite } from "./types";

export const dynamic = "force-dynamic";

export default async function PaperworkPage() {
  const { supabase } = await requireUser();

  const [{ data: patients }, { data: templates }] = await Promise.all([
    supabase
      .from("patients")
      .select("id, first_name, last_name, drive_folder_url")
      .order("last_name", { ascending: true }),
    supabase
      .from("paperwork_templates")
      .select("*")
      .order("name", { ascending: true }),
  ]);

  return (
    <PaperworkApp
      patients={(patients ?? []) as PatientLite[]}
      templates={(templates ?? []) as PaperworkTemplate[]}
    />
  );
}
