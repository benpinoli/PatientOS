"use client";

import { useState } from "react";
import type { AppUser } from "@/lib/db-types";
import type { TaskWithLatestNote } from "@/lib/queries";
import type { PatientAssignment } from "@/lib/task-permissions";
import {
  canShowApproveButton,
  canShowMarkDone,
  canShowMarkDoneSigned,
} from "@/lib/task-permissions";
import {
  getTaskStatusClass,
  getTaskStatusLabel,
  ROLE_LABEL,
  isOverdue,
  formatDate,
} from "@/lib/format";
import { TaskActions, LinkAndNoteCell } from "../TaskActions";

export function PatientTaskTableRow({
  task,
  profile,
  patient,
  isNext,
}: {
  task: TaskWithLatestNote;
  profile: AppUser;
  patient: PatientAssignment;
  isNext: boolean;
}) {
  const [embeddedPanel, setEmbeddedPanel] = useState<"notes" | "history" | null>(null);
  const [expansionContainer, setExpansionContainer] = useState<HTMLDivElement | null>(null);

  const overdue = isOverdue(task.due_date);
  const hasWorkflow =
    canShowMarkDone(profile, patient, task) ||
    canShowApproveButton(profile, patient, task) ||
    canShowMarkDoneSigned(profile, patient, task);
  const showExpansionRow = hasWorkflow || embeddedPanel !== null;

  return (
    <>
      <tr className={"align-top " + (isNext ? "bg-amber-50" : "hover:bg-zinc-50")}>
        <td className="px-3 py-2 text-xs text-zinc-500">{task.order_index}</td>
        <td className="px-3 py-2">
          <div className="text-sm leading-snug text-zinc-800">{task.label}</div>
          {task.blocked_reason && (
            <div className="mt-0.5 text-xs italic text-red-600">
              Blocked: {task.blocked_reason}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-zinc-500">
          {ROLE_LABEL[task.responsible_role]}
        </td>
        <td className="px-3 py-2 text-xs">
          <span className={overdue ? "font-semibold text-red-700" : "text-zinc-600"}>
            {formatDate(task.due_date)}
            {overdue && " · late"}
          </span>
        </td>
        <td className="px-3 py-2">
          <span
            className={
              "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " +
              getTaskStatusClass(task.status)
            }
          >
            {getTaskStatusLabel(task.status)}
          </span>
        </td>
        <td className="max-w-[11rem] px-3 py-2">
          <LinkAndNoteCell task={task} latestNote={task.latest_note} />
        </td>
        <td className="relative px-3 py-2 text-right">
          <TaskActions
            task={task}
            profile={profile}
            patient={patient}
            layout="patient-table"
            embeddedPanel={embeddedPanel}
            onEmbeddedPanelChange={setEmbeddedPanel}
            expansionContainer={expansionContainer}
          />
        </td>
      </tr>
      {showExpansionRow && (
        <tr className={isNext ? "bg-amber-50" : "bg-zinc-50/60"}>
          <td colSpan={7} className="px-3 py-2">
            <div ref={setExpansionContainer} />
          </td>
        </tr>
      )}
    </>
  );
}
