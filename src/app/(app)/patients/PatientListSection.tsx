import { PatientTable, type PatientListRow } from "./PatientTable";

export function PatientListSection({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: PatientListRow[];
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
      <p className="text-sm text-zinc-500">{description}</p>
      <PatientTable rows={rows} />
    </section>
  );
}
