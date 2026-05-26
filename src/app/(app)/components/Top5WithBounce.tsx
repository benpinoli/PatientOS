"use client";

import { useEffect, useState } from "react";
import type { AppUser } from "@/lib/db-types";
import type { DashboardRow } from "@/lib/queries";
import { getActiveBounces, subscribeBounces } from "@/lib/bounce-store";
import { TaskQueueResponsive } from "./TaskQueueResponsive";

// Wraps the server-rendered Top 5 list with a client-side filter that hides
// tasks the current user has locally "bounced". When all 5 are bounced,
// shows an empty state with a hint that the user can un-bounce from the
// patient detail page.

export function Top5WithBounce({
  rows,
  profile,
}: {
  rows: DashboardRow[];
  profile: AppUser;
}) {
  const [bounceIds, setBounceIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sync = () => setBounceIds(new Set(Object.keys(getActiveBounces())));
    sync();
    return subscribeBounces(sync);
  }, []);

  const visible = rows.filter((r) => !bounceIds.has(r.id));
  const hiddenCount = rows.length - visible.length;

  return (
    <>
      <TaskQueueResponsive rows={visible} profile={profile} />
      {hiddenCount > 0 && (
        <p className="text-xs text-zinc-500">
          {hiddenCount} task{hiddenCount === 1 ? "" : "s"} bounced — un-bounce
          from the patient detail page to bring them back.
        </p>
      )}
    </>
  );
}
