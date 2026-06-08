"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  fetchNotifications,
  markNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "./actions";

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function messageFor(item: NotificationItem): string {
  const actor = item.actor_name ?? "Someone";
  const label = item.task_label ? `“${item.task_label}”` : "a task";
  if (item.type === "TASK_APPROVED") return `${actor} approved ${label}`;
  return `${actor} submitted ${label} for review`;
}

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the badge in sync when the server re-renders the layout with a fresh count.
  useEffect(() => setCount(initialCount), [initialCount]);

  // Lazy-load the list whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    start(async () => {
      const rows = await fetchNotifications();
      setItems(rows);
      setCount(rows.filter((r) => !r.read_at).length);
    });
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onMarkAll = () =>
    start(async () => {
      await markNotificationsRead();
      setItems((prev) =>
        prev ? prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) : prev,
      );
      setCount(0);
      router.refresh();
    });

  const onItemClick = (item: NotificationItem) => {
    setOpen(false);
    if (!item.read_at) {
      setCount((c) => Math.max(0, c - 1));
      start(async () => {
        await markNotificationRead(item.id);
        router.refresh();
      });
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
        aria-expanded={open}
        className="relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-none text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Notifications"
            className="absolute right-0 top-full z-50 mt-2 max-h-[min(70vh,28rem)] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-xl"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-zinc-900">Notifications</span>
              <button
                type="button"
                onClick={onMarkAll}
                disabled={pending || count === 0}
                className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40"
              >
                Mark all read
              </button>
            </div>

            {items === null ? (
              <p className="mt-3 text-sm text-zinc-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">No notifications yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/patients/${item.patient_id}`}
                      onClick={() => onItemClick(item)}
                      className={
                        "block rounded-md px-2 py-2 text-sm hover:bg-zinc-50 " +
                        (item.read_at ? "" : "bg-blue-50/60")
                      }
                    >
                      <div className="flex items-start gap-2">
                        {!item.read_at && (
                          <span
                            aria-hidden
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-600"
                          />
                        )}
                        <div className={item.read_at ? "pl-4" : ""}>
                          <p className="text-zinc-800">{messageFor(item)}</p>
                          {item.patient_name && (
                            <p className="text-xs text-zinc-500">on {item.patient_name}</p>
                          )}
                          <p className="text-xs text-zinc-400">{timeAgo(item.created_at)}</p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
