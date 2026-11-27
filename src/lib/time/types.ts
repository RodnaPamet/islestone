/**
 * Client-safe shapes of time tracking's pages (sub-phase 3.4b). Written
 * fresh for Islestone.
 */

/** What the Time pages offer the caller, asked on the server (`timeAffordances` in `time.policies.ts`). */
export interface TimeAffordances {
    /** Other people's time (`time.view`). */
    view: boolean;
    /** One's own time (`time.track`). */
    track: boolean;
    /** Others' weeks (`time.approve`; 3.4c's Timesheets). */
    approve: boolean;
    /** May add, change and delete one's own entries and use the timer: `track`, as a person. */
    record: boolean;
}
