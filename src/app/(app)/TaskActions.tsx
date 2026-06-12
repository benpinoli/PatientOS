"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LatestNoteSummary } from "@/lib/queries";
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
  compact = false,
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
  compact?: boolean;
}) {
  const ready = linkOptional || sentOtherMeans || linkDraft.trim().length > 0;
  const border =
    submitTone === "green"
      ? "border-emerald-200 bg-emerald-50/50"
      : "border-amber-200 bg-amber-50/50";
  const titleColor = submitTone === "green" ? "text-emerald-900" : "text-amber-900";

  return (
    <div
      className={
        "w-full rounded-lg border " +
        border +
        (compact ? " space-y-2 p-2" : " space-y-3 p-3")
      }
    >
      <p
        className={
          (compact ? "text-[10px] " : "text-xs ") +
          "font-semibold uppercase tracking-wide " +
          titleColor
        }
      >
        {title}
      </p>
      {!compact && <p className="text-sm text-zinc-600">{description}</p>}
      <label className={"block font-medium text-zinc-700 " + (compact ? "text-xs" : "text-sm")}>
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
          className={
            "mt-1 w-full rounded-md border border-zinc-300 bg-white shadow-sm " +
            (compact ? "px-2 py-1.5 text-sm" : "rounded-lg px-3 py-3 text-base")
          }
        />
      </label>
      {!linkOptional && (
        <label
          className={
            "flex items-center gap-2 rounded-md border border-zinc-200 bg-white text-zinc-700 " +
            (compact ? "min-h-8 px-2 py-1 text-xs" : "min-h-11 gap-3 rounded-lg px-3 py-2 text-sm")
          }
        >
          <input
            type="checkbox"
            className="size-3.5 shrink-0"
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
        compact={compact}
        onClick={onSubmit}
      />
      {!ready && !linkOptional && !compact && (
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
        "relative flex w-full flex-col " +
        (isCard ? "items-stretch gap-3" : "items-end gap-1.5")
      }
    >
      {error && (
        <p className="w-full rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div
        className={
          "flex w-full flex-wrap " +
          (isCard ? "justify-stretch gap-2" : "justify-end gap-1")
        }
      >
        {showStartTask && (
          <ActionButton
            disabled={pending}
            label="Start task"
            tone="primary-blue"
            fullWidth={isCard}
            compact={!isCard}
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
              compact={!isCard}
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
              compact={!isCard}
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
          compact={!isCard}
          onClick={() => {
            setShowHistory(false);
            setShowNotes((s) => !s);
          }}
        />
        <ActionButton
          disabled={pending}
          label="Link history"
          tone="secondary"
          fullWidth={isCard}
          compact={!isCard}
          onClick={() => {
            setShowNotes(false);
            setShowHistory((s) => !s);
          }}
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
          compact={!isCard}
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
          compact={!isCard}
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
          compact={!isCard}
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

export function LatestNoteCell({
  note,
  variant = "table",
}: {
  note?: LatestNoteSummary | null;
  variant?: "table" | "card";
}) {
  const body = note?.body?.trim();
  if (!body) {
    return <span className="text-xs text-zinc-400">No notes yet</span>;
  }
  const authorSuffix = note?.author_name ? ` — ${note.author_name}` : "";
  return (
    <p
      className={
        (variant === "card" ? "text-sm " : "text-xs ") +
        "line-clamp-2 break-words text-zinc-700"
      }
      title={body + authorSuffix}
    >
      {body}
    </p>
  );
}

export function LinkAndNoteCell({
  task,
  latestNote,
  variant = "table",
}: {
  task: Task;
  latestNote?: LatestNoteSummary | null;
  variant?: "table" | "card";
}) {
  if (variant === "card") {
    return (
      <div className="space-y-2">
        <LatestLinkCell task={task} variant="card" />
        <LatestNoteCell note={latestNote} variant="card" />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-1">
      <div className="min-w-0">
        <span className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">
          Link
        </span>
        <LatestLinkCell task={task} variant="table" />
      </div>
      <div className="min-w-0 border-t border-zinc-100 pt-1">
        <span className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">
          Note
        </span>
        <LatestNoteCell note={latestNote} variant="table" />
      </div>
    </div>
  );
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
  compact,
  onClick,
}: {
  label: string;
  tone: keyof typeof TONES;
  disabled: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex items-center justify-center rounded-md font-semibold transition disabled:opacity-50 " +
        (compact ? "min-h-8 px-2.5 py-1 text-xs" : "min-h-11 rounded-lg px-4 py-2.5 text-sm") +
        " " +
        TONES[tone] +
        (fullWidth ? " w-full flex-1 sm:flex-none sm:min-w-[7rem]" : compact ? " min-w-[4.5rem]" : " min-w-[5.5rem]")
      }
    >
      {label}
    </button>
  );
}

function popoverClass(isCard: boolean, side: "notes" | "history") {
  const base = "z-50 rounded-lg border border-zinc-200 bg-white shadow-xl ";
  if (isCard) {
    return (
      base +
      "fixed inset-x-3 bottom-3 max-h-[min(70vh,32rem)] overflow-y-auto p-4"
    );
  }
  // Table: open to the left so the panel stays in-row and doesn't cover the row below.
  const width = side === "notes" ? "w-72" : "w-64";
  return base + "absolute right-full top-0 mr-2 max-h-80 overflow-y-auto p-3 " + width;
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
      className={popoverClass(isCard, "history")}
      role="dialog"
      aria-label="Link history"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-900">Link history</span>
        <button
          type="button"
          onClick={onClose}
          className={
            "rounded-md border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50 " +
            (isCard ? "min-h-10 rounded-lg px-3" : "px-2 py-1 text-xs")
          }
        >
          Close
        </button>
      </div>
      {history === null ? (
        <p className="mt-2 text-xs text-zinc-500">Loading…</p>
      ) : history.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">No links recorded yet.</p>
      ) : (
        <ul className={"mt-2 " + (isCard ? "space-y-3" : "space-y-2")}>
          {history.map((e) => (
            <li
              key={e.id}
              className={
                "rounded-md border border-zinc-100 bg-zinc-50 " +
                (isCard ? "p-3 text-sm" : "p-2 text-xs")
              }
            >
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
              <div className="mt-0.5 text-[10px] text-zinc-500">
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
          className="mt-3 flex min-h-8 w-full items-center justify-center rounded-md border border-zinc-300 text-xs font-medium hover:bg-zinc-50"
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
    <div className={popoverClass(isCard, "notes")} role="dialog" aria-label="Notes">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-900">Notes</span>
        <button
          type="button"
          onClick={onClose}
          className={
            "rounded-md border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50 " +
            (isCard ? "min-h-10 rounded-lg px-3" : "px-2 py-1 text-xs")
          }
        >
          Close
        </button>
      </div>

      <div className={"space-y-2 " + (isCard ? "mt-3" : "mt-2")}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={isCard ? 3 : 2}
          placeholder="Add a note…"
          className={
            "w-full resize-y rounded-md border border-zinc-300 bg-white shadow-sm " +
            (isCard ? "px-3 py-2 text-sm" : "px-2 py-1.5 text-xs")
          }
        />
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onAddNote(draft, () => setDraft(""))}
          className={
            "inline-flex w-full items-center justify-center rounded-md bg-blue-600 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50 " +
            (isCard ? "min-h-10 px-4 text-sm" : "min-h-8 px-3 text-xs")
          }
        >
          Add note
        </button>
      </div>

      {notes === null ? (
        <p className={"text-zinc-500 " + (isCard ? "mt-4 text-sm" : "mt-2 text-xs")}>Loading…</p>
      ) : notes.length === 0 ? (
        <p className={"text-zinc-500 " + (isCard ? "mt-4 text-sm" : "mt-2 text-xs")}>No notes yet.</p>
      ) : (
        <ul className={"mt-2 " + (isCard ? "mt-4 space-y-3" : "space-y-2")}>
          {notes.map((n) => (
            <li
              key={n.id}
              className={
                "rounded-md border border-zinc-100 bg-zinc-50 " +
                (isCard ? "p-3 text-sm" : "p-2 text-xs")
              }
            >
              <p className="whitespace-pre-wrap break-words text-zinc-800">{n.body}</p>
              <div className="mt-0.5 text-[10px] text-zinc-500">
                {n.author_name ?? "Unknown"} · {new Date(n.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
