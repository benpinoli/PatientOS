// Global tunable constants. Change these in one place; everywhere uses them.

/**
 * Default due-date offset, in days, applied to every task instantiated from
 * a template when a new patient is created. Every paperwork item is due
 * X days after the patient is added to the system.
 *
 * Tweak by changing this value and re-running future patient creation.
 * Existing tasks keep whatever due_date they were stamped with at
 * instantiation (intentional — snapshot rule).
 */
export const DEFAULT_DUE_DAYS = 14;
