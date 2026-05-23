"use client";

import { useState, useTransition } from "react";
import type { Task, TaskStatus } from "@/lib/db-types";
import { updateTaskStatus, setTaskPriority, updateTaskFields } from "./actions";

// Compact set of inline actions for one task row.
// Decides which buttons to show based on requires_atp_review + current status.
export function TaskActions({ task }: { task: Task }) {
  const [pending, start] = useTransition();
  const [showMenu, setShowMenu] = useState(false);

  const flip = (status: TaskStatus) =>
    start(() => updateTaskStatus(task.id, status));

  const buttons: { label: string; status: TaskStatus; tone: string }[] = [];

  if (task.status === "NOT_STARTED") {
    buttons.push({ label: "Start", status: "IN_PROGRESS", tone: "bg-blue-600 hover:bg-blue-500 text-white" });
  }
  if (task.status === "IN_PROGRESS" || task.status === "NOT_STARTED") {
    if (task.requires_atp_review) {
      buttons.push({ label: "Mark done", status: "DONE_PENDING_REVIEW", tone: "bg-amber-500 hover:bg-amber-400 text-white" });
    } else {
      buttons.push({ label: "Approve", status: "APPROVED", tone: "bg-emerald-600 hover:bg-emerald-500 text-white" });
    }
  }
  if (task.status === "DONE_PENDING_REVIEW") {
    // The server enforces who's actually allowed to flip this.
    buttons.push({ label: "Approve", status: "APPROVED", tone: "bg-emerald-600 hover:bg-emerald-500 text-white" });
  }
  if (task.status !== "BLOCKED" && task.status !== "APPROVED") {
    buttons.push({ label: "Block", status: "BLOCKED", tone: "border border-zinc-300 text-zinc-700 hover:bg-zinc-50" });
  }
  if (task.status === "BLOCKED") {
    buttons.push({ label: "Unblock", status: "IN_PROGRESS", tone: "border border-zinc-300 text-zinc-700 hover:bg-zinc-50" });
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {buttons.map((b) => (
        <button
          key={b.label}
          disabled={pending}
          onClick={() => flip(b.status)}
          className={"rounded px-2 py-1 text-xs font-medium transition disabled:opacity-50 " + b.tone}
        >
          {b.label}
        </button>
      ))}
      <button
        disabled={pending}
        onClick={() => setShowMenu((s) => !s)}
        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        ⋯
      </button>
      {showMenu && (
        <TaskInlineEditor task={task} onClose={() => setShowMenu(false)} />
      )}
    </div>
  );
}

function TaskInlineEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState(task.link ?? "");
  const [due, setDue] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState(task.priority?.toString() ?? "");

  const save = () =>
    start(async () => {
      await updateTaskFields(task.id, {
        link: link.trim() || null,
        due_date: due || null,
        priority: priority === "" ? null : Number(priority),
      });
      onClose();
    });

  const clearPriority = () => start(() => setTaskPriority(task.id, null));

  return (
    <div className="absolute right-4 z-10 mt-8 w-72 rounded-md border border-zinc-200 bg-white p-3 shadow-lg">
      <label className="block text-xs font-medium text-zinc-600">Link (URL)</label>
      <input
        type="url"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="https://"
        className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
      />
      <label className="mt-2 block text-xs font-medium text-zinc-600">Due date</label>
      <input
        type="date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
      />
      <label className="mt-2 block text-xs font-medium text-zinc-600">Priority (lower = higher)</label>
      <div className="flex gap-2">
        <input
          type="number"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
        />
        <button
          onClick={clearPriority}
          disabled={pending}
          className="mt-1 rounded border border-zinc-300 px-2 text-xs hover:bg-zinc-50"
        >
          Clear
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}
