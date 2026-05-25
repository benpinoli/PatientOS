/** ISO date string (YYYY-MM-DD) for Postgres `date` columns. */
export function toISODateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add N business days (Mon–Fri), excluding the start date. */
export function addBusinessDays(from: Date, businessDays: number): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  let added = 0;
  while (added < businessDays) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

export function dueDateAfterBusinessDays(businessDays: number, from = new Date()): string {
  return toISODateString(addBusinessDays(from, businessDays));
}
