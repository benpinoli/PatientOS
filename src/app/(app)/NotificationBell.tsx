"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notificationMessage } from "@/lib/notifications";
import {
  fetchNotificationBellState,
  markNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "./actions";

const POLL_MS = 20_000;

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

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const { count: nextCount, items: nextItems } = await fetchNotificationBellState();
    setCount(nextCount);
    setItems(nextItems);
    return nextCount;
  }, []);

  useEffect(() => setCount(initialCount), [initialCount]);

  // Poll for new notifications while the app is open.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!cancelled) await refresh();
      } catch {
        /* ignore transient network errors */
      }
    };
    void run();
    const id = window.setInterval(run, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refresh]);

  // Re-render relative timestamps every minute.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Refresh when the panel opens (immediate fetch on top of poll).
  useEffect(() => {
    if (!open) return;
    start(async () => {
      await refresh();
    });
  }, [open, refresh]);

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
          <span
            aria-hidden
            className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white shadow-sm ring-2 ring-white"
          >
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
              <span className="text-sm font-semibold text-zinc-900">Recent activity</span>
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
              <p className="mt-3 text-sm text-zinc-500">
                No activity yet. Updates on shared patients appear here when your partner
                works a task.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/patients/${item.patient_id}`}
                      onClick={() => onItemClick(item)}
                      className={
                        "block rounded-lg border px-3 py-2.5 transition hover:border-zinc-300 hover:bg-zinc-50 " +
                        (item.read_at
                          ? "border-zinc-200 bg-white"
                          : "border-blue-200 bg-blue-50/50")
                      }
                    >
                      <p className="text-sm leading-snug text-zinc-900">
                        {notificationMessage(item.type, item.actor_name, item.task_label)}
                      </p>
                      {item.patient_name && (
                        <p className="mt-0.5 text-xs text-zinc-600">{item.patient_name}</p>
                      )}
                      <p className="mt-1 text-xs text-zinc-400">{timeAgo(item.created_at)}</p>
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
