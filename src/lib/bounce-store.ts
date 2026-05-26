"use client";

/**
 * Client-only "bounce" state — keeps a per-browser record of which tasks the
 * user has snoozed off the Top 5 dashboard, with an expiry timestamp.
 *
 * Why localStorage rather than the DB: we want this feature live today
 * without applying migration 0012 to the production database. Once the
 * AWS-hosted Supabase is up and 0012 lands, swap the implementation to
 * write `tasks.snoozed_until` instead.
 *
 * Trade-off: bounce state is per-browser, not synced across devices.
 */

const STORAGE_KEY = "bounce_v1";
const EVENT_NAME = "bounce-changed";

type BounceMap = Record<string, string>; // taskId -> ISO timestamp

function read(): BounceMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BounceMap;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function write(map: BounceMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new Event(EVENT_NAME));
}

function pruneExpired(map: BounceMap): BounceMap {
  const now = Date.now();
  const next: BounceMap = {};
  for (const [taskId, iso] of Object.entries(map)) {
    if (new Date(iso).getTime() > now) next[taskId] = iso;
  }
  return next;
}

/** Returns a snapshot of currently-active (unexpired) bounces. */
export function getActiveBounces(): BounceMap {
  const pruned = pruneExpired(read());
  return pruned;
}

/** Is this specific task currently bounced? */
export function isBounced(taskId: string): boolean {
  const map = getActiveBounces();
  return Boolean(map[taskId]);
}

/** When is this task scheduled to un-bounce? null if not bounced. */
export function bounceExpiryFor(taskId: string): Date | null {
  const map = getActiveBounces();
  const iso = map[taskId];
  return iso ? new Date(iso) : null;
}

/** Snooze a task for `days` days. */
export function bounce(taskId: string, days: number) {
  const map = pruneExpired(read());
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  map[taskId] = expiry.toISOString();
  write(map);
}

/** Clear a task's bounce immediately. */
export function unBounce(taskId: string) {
  const map = pruneExpired(read());
  delete map[taskId];
  write(map);
}

/**
 * Subscribe to bounce changes. Returns an unsubscribe fn. Fires when this
 * tab writes (via the dispatched event) and when another tab writes (via
 * the native `storage` event).
 */
export function subscribeBounces(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", handler);
  };
}
