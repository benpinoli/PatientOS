"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AppUser, Task } from "@/lib/db-types";
import type { PatientAssignment } from "@/lib/task-permissions";
import {
  canDoRepWorkflow,
  canShowApproveButton,
  canShowMarkDone,
  canShowMarkDoneSigned,
  canShowStartTask,
} from "@/lib/task-permissions";
import { normalizeExternalUrl } from "@/lib/urls";
import {
  updateTaskStatus,
  setTaskPriority,
  completeTaskApproval,
  submitMarkDone,
  submitMarkDoneSigned,
  fetchTaskLinkHistory,
  fetchTaskNotes,
  addTaskNote,
  type TaskLinkEvent,
  type TaskNote,
} from "./actions";
import {
  bounce as bounceLocally,
  isBounced as isBouncedLocally,
  subscribeBounces,
  unBounce as unBounceLocally,
} from "@/lib/bounce-store";

const BOUNCE_DAYS = 3;

type TaskActionsProps = {
  task: Task;
  profile: AppUser;
  patient: PatientAssignment;
  layout?: "card" | "table";
};

function DocumentLinkPanel({
  title,
  description,
  linkDraft,
  setLinkDraft,
  sentOtherMeans,
  setSentOtherMeans,
  checkboxLabel,
  submitLabel,
  submitTone,
  disabled,
  pending,
  onSubmit,
  linkOptional = false,
}: {
  title: string;
  description: string;
  linkDraft: string;
  setLinkDraft: (v: string) => void;
  sentOtherMeans: boolean;
  setSentOtherMeans: (v: boolean) => void;
  checkboxLabel: string;
  submitLabel: string;
  submitTone: "amber" | "green";
  disabled: boolean;
  pending: boolean;
  onSubmit: () => void;
  linkOptional?: boolean;
}) {
  const ready = linkOptional || sentOtherMeans || linkDraft.trim().length > 0;
  const border =
    submitTone === "green"
      ? "border-emerald-200 bg-emerald-50/50"
      : "border-amber-200 bg-amber-50/50";
  const titleColor = submitTone === "green" ? "text-emerald-900" : "text-amber-900";

  return (
    <div className={"w-full space-y-3 rounded-lg border p-3 " + border}>
      <p className={"text-xs font-semibold uppercase tracking-wide " + titleColor}>
        {title}
      </p>
      <p className="text-sm text-zinc-600">{description}</p>
      <label className="block text-sm font-medium text-zinc-700">
        Document link
        <input
          type="url"
          inputMode="url"
          autoComplete="url"
          value={linkDraft}
          onChange={(e) => {
            setLinkDraft(e.target.value);
            if (e.target.value.trim()) setSentOtherMeans(false);
          }}
          placeholder="https://"
          className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base shadow-sm"
        />
      </label>
      {!linkOptional && (
        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            className="size-4 shrink-0"
            checked={sentOtherMeans}
            onChange={(e) => {
              setSentOtherMeans(e.target.checked);
              if (e.target.checked) setLinkDraft("");
            }}
          />
          {checkboxLabel}
        </label>
      )}
      <ActionButton
        disabled={pending || !ready || disabled}
        label={submitLabel}
        tone={submitTone === "green" ? "primary-green" : "primary-amber"}
        fullWidth
        onClick={onSubmit}
      />
      {!ready && !linkOptional && (
        <p className="text-xs text-zinc-500">Add a link or check the box above to continue.</p>
      )}
    </div>
  );
}

export function TaskActions({ task, profile, patient, layout = "table" }: TaskActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TaskLinkEvent[] | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState<TaskNote[] | null>(null);
  const [linkDraft, setLinkDraft] = useState(task.link ?? "");
  const [sentOtherMeans, setSentOtherMeans] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCard = layout === "card";
  const showApprove = canShowApproveButton(profile, patient, task);
  const showMarkDone = canShowMarkDone(profile, patient, task);
  const showMarkDoneSigned = canShowMarkDoneSigned(profile, patient, task);
  const showStartTask = canShowStartTask(profile, patient, task);
  const repWorkflow = canDoRepWorkflow(profile, patient);

  // Local-only snooze state (per-browser). Mirrors localStorage and re-renders
  // when another tab writes the bounce store too.
  const [bounced, setBounced] = useState(false);
  useEffect(() => {
    const sync = () => setBounced(isBouncedLocally(task.id));
    sync();
    return subscribeBounces(sync);
  }, [task.id]);

  useEffect(() => {
    if (!showHistory) return;
    start(async () => {
      const rows = await fetchTaskLinkHistory(task.id);
      setHistory(rows);
    });
  }, [showHistory, task.id]);

  useEffect(() => {
    if (!showHistory) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHistory(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showHistory]);

  useEffect(() => {
    if (!showNotes) return;
    start(async () => {
      const rows = await fetchTaskNotes(task.id);
      setNotes(rows);
    });
  }, [showNotes, task.id]);

  useEffect(() => {
    if (!showNotes) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowNotes(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showNotes]);

  const onAddNote = (body: string, onDone: () => void) =>
    start(async () => {
      setError(null);
      try {
        await addTaskNote(task.id, body);
        const rows = await fetchTaskNotes(task.id);
        setNotes(rows);
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save note");
      }
    });

  const afterMutation = () => router.refresh();

  const flip = (status: Task["status"]) =>
    start(async () => {
      setError(null);
      try {
        await updateTaskStatus(task.id, status);
        afterMutation();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
      }
    });

  const onMarkDone = () =>
    start(async () => {
      setError(null);
      try {
        await submitMarkDone(task.id, {
          link: linkDraft.trim() || null,
          sentOtherMeans,
        });
        setSentOtherMeans(false);
        afterMutation();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not mark done");
      }
    });

  const onApprove = () =>
    start(async () => {
      setError(null);
      try {
        await completeTaskApproval(task.id, {
          link: linkDraft.trim() || null,
          sentOtherMeans,
        });
        setSentOtherMeans(false);
        afterMutation();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Approval failed");
      }
    });

  const onMarkDoneSigned = () =>
    start(async () => {
      setError(null);
      try {
        await submitMarkDoneSigned(task.id, {
          link: linkDraft.trim() || null,
        });
        afterMutation();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not sign off");
      }
    });

  return (
    <div
      className={
        "relative flex w-full flex-col gap-3 " +
        (isCard ? "items-stretch" : "items-end")
      }
    >
      {error && (
        <p className="w-full rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div
        className={
          "flex w-full flex-wrap gap-2 " +
          (isCard ? "justify-stretch" : "justify-end")
        }
      >
        {showStartTask && (
          <ActionButton
            disabled={pending}
            label="Start task"
            tone="primary-blue"
            fullWidth={isCard}
            onClick={() => flip("IN_PROGRESS")}
          />
        )}
        {task.status !== "APPROVED" &&
          task.status !== "BLOCKED" &&
          (bounced ? (
            <ActionButton
              disabled={pending}
              label="Un-bounce"
              tone="secondary"
              fullWidth={isCard}
              onClick={() => {
                unBounceLocally(task.id);
                afterMutation();
              }}
            />
          ) : (
            <ActionButton
              disabled={pending}
              label={`Bounce ${BOUNCE_DAYS}d`}
              tone="secondary"
              fullWidth={isCard}
              onClick={() => {
                bounceLocally(task.id, BOUNCE_DAYS);
                afterMutation();
              }}
            />
          ))}
        <ActionButton
          disabled={pending}
          label="Notes"
          tone="secondary"
          fullWidth={isCard}
          onClick={() => setShowNotes((s) => !s)}
        />
        <ActionButton
          disabled={pending}
          label="Link history"
          tone="secondary"
          fullWidth={isCard}
          onClick={() => setShowHistory((s) => !s)}
        />
      </div>

      {showMarkDoneSigned && (
        <DocumentLinkPanel
          title="Mark as done (signed)"
          description="You are the rep and ATP on this case. Sign off when the paperwork is complete. You may add a document link."
          linkDraft={linkDraft}
          setLinkDraft={setLinkDraft}
          sentOtherMeans={false}
          setSentOtherMeans={() => {}}
          checkboxLabel=""
          submitLabel="Mark as done (signed)"
          submitTone="amber"
          disabled={false}
          pending={pending}
          onSubmit={onMarkDoneSigned}
          linkOptional
        />
      )}

      {showMarkDone && (
        <DocumentLinkPanel
          title="Mark done"
          description="Submit this step for ATP review. It stays pending until the assigned ATP approves — it will not show as approved until then."
          linkDraft={linkDraft}
          setLinkDraft={setLinkDraft}
          sentOtherMeans={sentOtherMeans}
          setSentOtherMeans={setSentOtherMeans}
          checkboxLabel="Document already sent (no link to paste)"
          submitLabel="Mark done"
          submitTone="amber"
          disabled={false}
          pending={pending}
          onSubmit={onMarkDone}
        />
      )}

      {showApprove && (
        <DocumentLinkPanel
          title="ATP Approve (signed)"
          description="Sign off on this step after the rep’s submission. Record the final document link or confirm it was sent another way."
          linkDraft={linkDraft}
          setLinkDraft={setLinkDraft}
          sentOtherMeans={sentOtherMeans}
          setSentOtherMeans={setSentOtherMeans}
          checkboxLabel="Sent via other means (no URL)"
          submitLabel="ATP Approve (signed)"
          submitTone="green"
          disabled={false}
          pending={pending}
          onSubmit={onApprove}
        />
      )}

      {showNotes && (
        <>
          <button
            type="button"
            aria-label="Close notes"
            className="fixed inset-0 z-40 bg-black/30 lg:hidden"
            onClick={() => setShowNotes(false)}
          />
          <NotesMenu
            notes={notes}
            pending={pending}
            isCard={isCard}
            onClose={() => setShowNotes(false)}
            onAddNote={onAddNote}
          />
        </>
      )}

      {showHistory && (
        <>
          <button
            type="button"
            aria-label="Close link history"
            className="fixed inset-0 z-40 bg-black/30 lg:hidden"
            onClick={() => setShowHistory(false)}
          />
          <LinkHistoryMenu
            history={history}
            pending={pending}
            task={task}
            isCard={isCard}
            onClose={() => setShowHistory(false)}
            onClearPriority={() => start(() => setTaskPriority(task.id, null))}
          />
        </>
      )}
    </div>
  );
}

export function LatestLinkCell({
  task,
  variant = "table",
}: {
  task: Task;
  variant?: "table" | "card";
}) {
  const href = normalizeExternalUrl(task.link);
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={
          variant === "card"
            ? "text-sm font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-2"
            : "block max-w-[12rem] truncate text-xs text-blue-600 hover:underline"
        }
        title={href}
      >
        {task.link}
      </a>
    );
  }
  return <span className="text-xs text-zinc-400">No link yet</span>;
}

const TONES = {
  "primary-blue": "bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700",
  "primary-amber": "bg-amber-500 text-white hover:bg-amber-400 active:bg-amber-600",
  "primary-green": "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700",
  secondary:
    "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100",
} as const;

function ActionButton({
  label,
  tone,
  disabled,
  fullWidth,
  onClick,
}: {
  label: string;
  tone: keyof typeof TONES;
  disabled: boolean;
  fullWidth?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 " +
        TONES[tone] +
        (fullWidth ? " w-full flex-1 sm:flex-none sm:min-w-[7rem]" : " min-w-[5.5rem]")
      }
    >
      {label}
    </button>
  );
}

function LinkHistoryMenu({
  history,
  pending,
  task,
  isCard,
  onClose,
  onClearPriority,
}: {
  history: TaskLinkEvent[] | null;
  pending: boolean;
  task: Task;
  isCard: boolean;
  onClose: () => void;
  onClearPriority: () => void;
}) {
  return (
    <div
      className={
        "z-50 rounded-lg border border-zinc-200 bg-white p-4 shadow-xl " +
        (isCard
          ? "fixed inset-x-3 bottom-3 max-h-[min(70vh,32rem)] overflow-y-auto"
          : "absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto")
      }
      role="dialog"
      aria-label="Link history"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-900">Link history</span>
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Close
        </button>
      </div>
      {history === null ? (
        <p className="mt-3 text-sm text-zinc-500">Loading…</p>
      ) : history.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No links recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {history.map((e) => (
            <li key={e.id} className="rounded-md border border-zinc-100 bg-zinc-50 p-3 text-sm">
              {e.via_other_means ? (
                <span className="text-zinc-700">Document already sent / other means</span>
              ) : (
                <a
                  href={normalizeExternalUrl(e.link)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-medium text-blue-600 hover:underline"
                >
                  {e.link}
                </a>
              )}
              <div className="mt-1 text-xs text-zinc-500">
                {new Date(e.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
      {task.priority != null && (
        <button
          type="button"
          disabled={pending}
          onClick={onClearPriority}
          className="mt-4 flex min-h-11 w-full items-center justify-center rounded-lg border border-zinc-300 text-sm font-medium hover:bg-zinc-50"
        >
          Clear manual priority ({task.priority})
        </button>
      )}
    </div>
  );
}

function NotesMenu({
  notes,
  pending,
  isCard,
  onClose,
  onAddNote,
}: {
  notes: TaskNote[] | null;
  pending: boolean;
  isCard: boolean;
  onClose: () => void;
  onAddNote: (body: string, onDone: () => void) => void;
}) {
  const [draft, setDraft] = useState("");
  const canSave = draft.trim().length > 0 && !pending;

  return (
    <div
      className={
        "z-50 rounded-lg border border-zinc-200 bg-white p-4 shadow-xl " +
        (isCard
          ? "fixed inset-x-3 bottom-3 max-h-[min(70vh,32rem)] overflow-y-auto"
          : "absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto")
      }
      role="dialog"
      aria-label="Notes"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-900">Notes</span>
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Close
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Add a note (e.g. why this task isn’t done yet)…"
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm"
        />
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onAddNote(draft, () => setDraft(""))}
          className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          Add note
        </button>
      </div>

      {notes === null ? (
        <p className="mt-4 text-sm text-zinc-500">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No notes yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-zinc-100 bg-zinc-50 p-3 text-sm">
              <p className="whitespace-pre-wrap break-words text-zinc-800">{n.body}</p>
              <div className="mt-1 text-xs text-zinc-500">
                {n.author_name ?? "Unknown"} · {new Date(n.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
