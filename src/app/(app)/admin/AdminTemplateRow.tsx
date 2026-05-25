"use client";

import { useState, useTransition, type DragEvent, type ReactNode } from "react";
import type { PayerType, ResponsibleRole, TaskTemplate } from "@/lib/db-types";
import { ROLE_LABEL } from "@/lib/format";
import { deleteTaskTemplate, updateTaskTemplate } from "../actions";

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

function OrderBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-700">
      {n}
    </span>
  );
}

function DragHandle({ onDragStart }: { onDragStart: (e: DragEvent) => void }) {
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        onDragStart(e);
      }}
      className="inline-flex cursor-grab touch-none items-center justify-center rounded px-1 text-zinc-400 active:cursor-grabbing"
      aria-label="Drag to reorder"
      title="Drag to reorder"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="5" cy="4" r="1.25" />
        <circle cx="11" cy="4" r="1.25" />
        <circle cx="5" cy="8" r="1.25" />
        <circle cx="11" cy="8" r="1.25" />
        <circle cx="5" cy="12" r="1.25" />
        <circle cx="11" cy="12" r="1.25" />
      </svg>
    </span>
  );
}

export function AdminTemplateRow({
  template,
  payerType,
  orderNumber,
  canEdit,
  variant = "table",
  draggable = false,
  isDragging = false,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  template: TaskTemplate;
  payerType: PayerType;
  orderNumber: number;
  canEdit: boolean;
  variant?: "table" | "card";
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
}) {
  const [pending, start] = useTransition();
  const [label, setLabel] = useState(template.label);
  const [responsibleRole, setResponsibleRole] = useState(template.responsible_role);
  const [requiresAtpReview, setRequiresAtpReview] = useState(template.requires_atp_review);
  const [required, setRequired] = useState(template.required);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dropProps = draggable
    ? {
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragOver?.(e);
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          onDrop?.();
        },
      }
    : {};

  const handleDragStart = () => onDragStart?.();

  const save = () =>
    start(async () => {
      setError(null);
      try {
        await updateTaskTemplate(template.id, {
          label,
          responsible_role: responsibleRole,
          requires_atp_review: requiresAtpReview,
          required,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });

  const remove = () => {
    if (!confirm(`Delete step "${template.label}"?`)) return;
    start(async () => {
      setError(null);
      try {
        await deleteTaskTemplate(template.id, payerType);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    });
  };

  if (!canEdit) {
    if (variant === "card") {
      return (
        <li className="px-4 py-3">
          <p className="text-sm font-medium text-zinc-900">
            <span className="text-zinc-400">#{orderNumber}</span> {template.label}
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
        <td className="px-4 py-2 text-xs text-zinc-500">{orderNumber}</td>
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
        (variant === "card" ? "min-h-11 flex-1" : "")
      }
    >
      {saved ? "Saved" : pending ? "Saving…" : "Save"}
    </button>
  );

  const deleteButton = (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      className={
        "rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 " +
        (variant === "card" ? "min-h-11" : "")
      }
    >
      Delete
    </button>
  );

  const actionButtons = (
    <div className={variant === "card" ? "flex gap-2" : "flex flex-col items-end gap-1"}>
      <div className={variant === "table" ? "flex gap-1" : "flex w-full gap-2"}>
        {saveButton}
        {deleteButton}
      </div>
    </div>
  );

  const rowClass =
    (variant === "card"
      ? "border-b border-zinc-100 px-4 py-4 last:border-0 "
      : "hover:bg-zinc-50 ") +
    (isDragging ? "opacity-40" : "");

  if (variant === "card") {
    return (
      <li className={rowClass} {...dropProps}>
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-1 pt-1">
            {draggable && <DragHandle onDragStart={handleDragStart} />}
            <OrderBadge n={orderNumber} />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <TemplateField label="Label">{labelInput}</TemplateField>
            <TemplateField label="Awaiting">{roleSelect}</TemplateField>
            <div className="flex flex-wrap gap-4">
              {atpReviewCheck}
              {requiredCheck}
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            {actionButtons}
          </div>
        </div>
      </li>
    );
  }

  return (
    <tr className={rowClass} {...dropProps}>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1">
          {draggable && <DragHandle onDragStart={handleDragStart} />}
          <OrderBadge n={orderNumber} />
        </div>
      </td>
      <td className="px-3 py-2 align-top">{labelInput}</td>
      <td className="px-3 py-2 align-top">{roleSelect}</td>
      <td className="px-3 py-2 align-top">{atpReviewCheck}</td>
      <td className="px-3 py-2 align-top">{requiredCheck}</td>
      <td className="px-3 py-2 align-top text-right">
        {error && (
          <p className="mb-1 max-w-[8rem] text-right text-xs text-red-700">{error}</p>
        )}
        {actionButtons}
      </td>
    </tr>
  );
}
