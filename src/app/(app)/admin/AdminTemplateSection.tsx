"use client";

import { useEffect, useState, useTransition } from "react";
import type { PayerType, TaskTemplate } from "@/lib/db-types";
import {
  createTaskTemplate,
  deletePayerType,
  reorderTaskTemplates,
} from "../actions";
import { AdminTemplateRow } from "./AdminTemplateRow";

function sortTemplates(templates: TaskTemplate[]) {
  return [...templates].sort((a, b) => a.default_order - b.default_order);
}

function moveItem<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

export function AdminTemplateSection({
  payerType,
  title,
  initialTemplates,
  canEdit,
  canDeleteType = false,
}: {
  payerType: PayerType;
  title: string;
  initialTemplates: TaskTemplate[];
  canEdit: boolean;
  canDeleteType?: boolean;
}) {
  const [items, setItems] = useState(() => sortTemplates(initialTemplates));
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [orderPending, startOrder] = useTransition();
  const [actionPending, startAction] = useTransition();

  useEffect(() => {
    setItems(sortTemplates(initialTemplates));
  }, [initialTemplates]);

  const handleDrop = (toIndex: number) => {
    if (dragIndex === null || dragIndex === toIndex) {
      setDragIndex(null);
      return;
    }
    const next = moveItem(items, dragIndex, toIndex);
    setItems(next);
    setDragIndex(null);
    setOrderError(null);

    startOrder(async () => {
      try {
        await reorderTaskTemplates(
          payerType,
          next.map((t) => t.id),
        );
      } catch (e) {
        setOrderError(e instanceof Error ? e.message : "Could not save order");
        setItems(sortTemplates(initialTemplates));
      }
    });
  };

  const addStep = () => {
    setTypeError(null);
    startAction(async () => {
      try {
        await createTaskTemplate(payerType);
      } catch (e) {
        setTypeError(e instanceof Error ? e.message : "Could not add step");
      }
    });
  };

  const removeType = () => {
    if (
      !confirm(
        `Delete "${title}" and all its checklist steps? This cannot be undone.`,
      )
    ) {
      return;
    }
    setTypeError(null);
    startAction(async () => {
      try {
        await deletePayerType(payerType);
      } catch (e) {
        setTypeError(e instanceof Error ? e.message : "Could not delete type");
      }
    });
  };

  const rowProps = (index: number) => ({
    orderNumber: index + 1,
    draggable: canEdit,
    isDragging: dragIndex === index,
    onDragStart: () => setDragIndex(index),
    onDragOver: () => {},
    onDrop: () => handleDrop(index),
  });

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
          {title}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <span className="text-xs text-zinc-500">Drag rows to reorder steps</span>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={addStep}
              disabled={actionPending}
              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              Add step
            </button>
          )}
          {canDeleteType && (
            <button
              type="button"
              onClick={removeType}
              disabled={actionPending}
              className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Delete type
            </button>
          )}
        </div>
      </div>

      {typeError && (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-800">
          {typeError}
        </p>
      )}
      {orderError && (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-800">
          {orderError}
        </p>
      )}
      {orderPending && (
        <p className="border-b border-zinc-100 bg-zinc-50 px-4 py-1.5 text-xs text-zinc-500">
          Saving order…
        </p>
      )}

      <ul className="lg:hidden">
        {items.map((t, index) => (
          <AdminTemplateRow
            key={t.id}
            template={t}
            payerType={payerType}
            canEdit={canEdit}
            variant="card"
            {...rowProps(index)}
          />
        ))}
      </ul>

      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[44rem] divide-y divide-zinc-200 text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="w-20 px-3 py-2">#</th>
              <th className="min-w-[12rem] px-3 py-2">Label</th>
              <th className="px-3 py-2">Final signature</th>
              <th className="px-3 py-2">ATP review</th>
              <th className="px-3 py-2">Required</th>
              {canEdit && <th className="w-36 px-3 py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {items.map((t, index) => (
              <AdminTemplateRow
                key={t.id}
                template={t}
                payerType={payerType}
                canEdit={canEdit}
                variant="table"
                {...rowProps(index)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
