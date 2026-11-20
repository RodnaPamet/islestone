/**
 * Due-date windows the work-item views share (owner decision 54).
 *
 * Client-safe: My Work's copy names the window and the repository's `due=soon`
 * filter applies it, so the two cannot drift. Due dates are date-only
 * (`@db.Date`): the window is counted in whole days from the workspace's
 * today, never through a time zone of the reader's.
 *
 * Written fresh for Islestone.
 */

/** "Due soon": open, and due within this many days of today (overdue included). */
export const DUE_SOON_DAYS = 7;

/** The `due` list filters (`GET /work-items?due=`). */
export const DUE_FILTERS = ['overdue', 'next7d', 'soon'] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];
