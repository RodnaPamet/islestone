/**
 * The goal and initiative limits the forms and the request schemas share
 * (sub-phase 3.2; the CHECKs in migration `20261215120000`). Client-safe:
 * `src/lib/schemas/goal.ts` reaches the server's env through its imports, so
 * the forms read the numbers from here.
 */

/** A goal's title, an outcome stated as a sentence (CHECK 1..200). */
export const GOAL_TITLE_MAX = 200;
/** An initiative's name, like a project's (CHECK 1..120). */
export const INITIATIVE_NAME_MAX = 120;
/** A description's longest length before encryption. */
export const GOAL_DESCRIPTION_MAX = 10_000;
