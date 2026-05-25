import type { PayerType, TaskTemplate } from "@/lib/db-types";
import { AdminTemplateSection } from "./AdminTemplateSection";

const PAYER_SECTIONS: { type: PayerType; title: string }[] = [
  { type: "COMMERCIAL", title: "Insurance patients" },
  { type: "MEDICAID", title: "Medicaid patients" },
  { type: "MEDICARE", title: "Medicare patients" },
];

export function AdminTaskTemplates({
  byType,
  canEdit,
}: {
  byType: Record<string, TaskTemplate[]>;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      {PAYER_SECTIONS.map(({ type, title }) => (
        <AdminTemplateSection
          key={type}
          payerType={type}
          title={title}
          initialTemplates={byType[type] ?? []}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}
