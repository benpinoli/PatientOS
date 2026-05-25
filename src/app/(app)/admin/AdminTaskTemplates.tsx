import type { PayerTypeRecord, TaskTemplate } from "@/lib/db-types";
import { payerTypeSectionTitle } from "@/lib/payer-types";
import { AdminAddPayerTypeForm } from "./AdminAddPayerTypeForm";
import { AdminTemplateSection } from "./AdminTemplateSection";

export function AdminTaskTemplates({
  payerTypes,
  byType,
  canEdit,
}: {
  payerTypes: PayerTypeRecord[];
  byType: Record<string, TaskTemplate[]>;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      {canEdit && <AdminAddPayerTypeForm />}
      {payerTypes.length === 0 ? (
        <p className="text-sm text-zinc-500">No patient types configured yet.</p>
      ) : (
        payerTypes.map((pt) => (
          <AdminTemplateSection
            key={pt.code}
            payerType={pt.code}
            title={payerTypeSectionTitle(pt)}
            initialTemplates={byType[pt.code] ?? []}
            canEdit={canEdit}
            canDeleteType={canEdit}
          />
        ))
      )}
    </div>
  );
}
