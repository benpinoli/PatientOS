"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { ResponsibleRole, TaskTemplate } from "@/lib/db-types";
import { ROLE_LABEL } from "@/lib/format";
import { updateTaskTemplate } from "../actions";

const RESPONSIBLE_ROLES: ResponsibleRole[] = [
  "REP",
  "DOCTOR",
  "PT",
  "ATP",
  "FRONT_DESK",
];

function TemplateField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function AdminTemplateRow({
  template,
  canEdit,
  variant = "table",
}: {
  template: TaskTemplate;
  canEdit: boolean;
  variant?: "table" | "card";
}) {
  const [pending, start] = useTransition();
  const [label, setLabel] = useState(template.label);
  const [responsibleRole, setResponsibleRole] = useState(template.responsible_role);
  const [requiresAtpReview, setRequiresAtpReview] = useState(template.requires_atp_review);
  const [required, setRequired] = useState(template.required);
  const [defaultOrder, setDefaultOrder] = useState(String(template.default_order));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    start(async () => {
      setError(null);
      try {
        await updateTaskTemplate(template.id, {
          label,
          responsible_role: responsibleRole,
          requires_atp_review: requiresAtpReview,
          required,
          default_order: Number(defaultOrder),
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });

  if (!canEdit) {
    if (variant === "card") {
      return (
        <li className="px-4 py-3">
          <p className="text-sm font-medium text-zinc-900">
            <span className="text-zinc-400">#{template.default_order}</span> {template.label}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="font-medium uppercase text-zinc-400">Awaiting</dt>
              <dd className="mt-0.5 text-zinc-700">
                {ROLE_LABEL[template.responsible_role]}
              </dd>
            </div>
            <div>
              <dt className="font-medium uppercase text-zinc-400">ATP review</dt>
              <dd className="mt-0.5 text-zinc-700">
                {template.requires_atp_review ? "Yes" : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-medium uppercase text-zinc-400">Required</dt>
              <dd className="mt-0.5 text-zinc-700">{template.required ? "Yes" : "—"}</dd>
            </div>
          </dl>
        </li>
      );
    }
    return (
      <tr>
        <td className="px-4 py-2 text-xs text-zinc-500">{template.default_order}</td>
        <td className="px-4 py-2 text-zinc-800">{template.label}</td>
        <td className="px-4 py-2 text-xs text-zinc-500">
          {ROLE_LABEL[template.responsible_role]}
        </td>
        <td className="px-4 py-2 text-xs">
          {template.requires_atp_review ? "yes" : "—"}
        </td>
        <td className="px-4 py-2 text-xs">{template.required ? "yes" : "—"}</td>
      </tr>
    );
  }

  const orderInput = (
    <input
      type="number"
      min={1}
      value={defaultOrder}
      onChange={(e) => setDefaultOrder(e.target.value)}
      className={
        "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm " +
        (variant === "card" ? "min-h-11 w-20" : "w-16")
      }
    />
  );

  const labelInput = (
    <input
      type="text"
      value={label}
      onChange={(e) => setLabel(e.target.value)}
      className={
        "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm " +
        (variant === "card" ? "min-h-11 w-full" : "w-full min-w-[12rem]")
      }
    />
  );

  const roleSelect = (
    <select
      value={responsibleRole}
      onChange={(e) => setResponsibleRole(e.target.value as ResponsibleRole)}
      className={
        "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm " +
        (variant === "card" ? "min-h-11 w-full" : "")
      }
    >
      {RESPONSIBLE_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );

  const atpReviewCheck = (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4"
        checked={requiresAtpReview}
        onChange={(e) => setRequiresAtpReview(e.target.checked)}
      />
      ATP review
    </label>
  );

  const requiredCheck = (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4"
        checked={required}
        onChange={(e) => setRequired(e.target.checked)}
      />
      Required
    </label>
  );

  const saveButton = (
    <button
      type="button"
      onClick={save}
      disabled={pending}
      className={
        "rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 " +
        (variant === "card" ? "min-h-11 w-full" : "")
      }
    >
      {saved ? "Saved" : pending ? "Saving…" : "Save"}
    </button>
  );

  if (variant === "card") {
    return (
      <li className="border-b border-zinc-100 px-4 py-4 last:border-0">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <TemplateField label="Order">{orderInput}</TemplateField>
            <div className="min-w-0 flex-1">
              <TemplateField label="Label">{labelInput}</TemplateField>
            </div>
          </div>
          <TemplateField label="Awaiting">{roleSelect}</TemplateField>
          <div className="flex flex-wrap gap-4">
            {atpReviewCheck}
            {requiredCheck}
          </div>
          {error && (
            <p className="text-sm text-red-700">{error}</p>
          )}
          {saveButton}
        </div>
      </li>
    );
  }

  return (
    <tr className="hover:bg-zinc-50">
      <td className="px-3 py-2 align-top">{orderInput}</td>
      <td className="px-3 py-2 align-top">{labelInput}</td>
      <td className="px-3 py-2 align-top">{roleSelect}</td>
      <td className="px-3 py-2 align-top">{atpReviewCheck}</td>
      <td className="px-3 py-2 align-top">{requiredCheck}</td>
      <td className="px-3 py-2 align-top text-right">
        {error && (
          <p className="mb-1 max-w-[8rem] text-right text-xs text-red-700">{error}</p>
        )}
        {saveButton}
      </td>
    </tr>
  );
}
