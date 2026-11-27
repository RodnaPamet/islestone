/**
 * The H2 permission matrix's expected table (owner decisions 175 and 176;
 * `docs/porting/maps/H2.md`, part 3): every tenant API route and method under
 * `src/app/api/t/[tenantSlug]/`, against OWNER, ADMIN, MEMBER, VIEWER, GUEST
 * and two custom roles, with the outcome each one must get.
 *
 * WRITTEN BY HAND. Nothing here is computed from `src/lib/permissions.ts`,
 * `src/lib/security/route-permissions.ts` or a route file: a table derived
 * from the code under test proves nothing. Each row says what the documented
 * rule (CLAUDE.md, the owner decisions, the ADRs) says the role gets; the
 * suites under this folder drive the real route handler and compare.
 *
 * This module is PURE (no database, no app imports beyond types), so the
 * population guard (`tests/guards/permission-matrix-population.test.ts`) can
 * read it in the unit project: every route file and exported method on disk
 * must have at least one row, and every row must name a route and method
 * that exists. A new tenant route without a row fails CI.
 *
 * Outcomes (one per cell):
 *   - `ok`       2xx; no `AUTHZ_DENIED` row for the request; a list row's
 *                `reveals` id is in the response.
 *   - `empty`    2xx, and the `reveals` text is NOT in the response: another
 *                member's notification in the caller's bell, or a change to
 *                another member's own row that changes nothing (`"updated":1`
 *                absent).
 *   - `denied`   403 from `requirePermission`: exactly one `AUTHZ_DENIED` row
 *                for the request, on entity `Permission`, naming `key`.
 *   - `refused`  403 decided past the route's key (the usecase): no
 *                `Permission` row; one other `AUTHZ_DENIED` row when the
 *                row's `refusedAudit` is true (the default), none when false.
 *   - `hidden`   404: the subject is not visible to the caller. (No cell
 *                expects it today; 8.4's guest cells will, for a project
 *                outside a guest's grant.)
 *   - `archived` 409 with `details.reason` `PROJECT_ARCHIVED`: admitted, the
 *                project refuses writes.
 *
 * GUEST cells (decisions 176 and 204) are tagged `until: '8.4'` with `g(...)`:
 * they assert today's rule, a guest sees nothing and does nothing. A guest
 * holds no key, so on every keyed route its cell is `denied` (audited); only
 * the key-free, self-service rows (its own notifications and preferences, its
 * own MFA and sessions) answer it. The tripwire (`guestTripwire` below, run by
 * the population guard) fails once 8.4 changes who a guest may see or what it
 * holds while any guest cell still carries the tag, and before then fails a
 * tagged cell on a keyed row that is not `denied`.
 *
 * The two custom roles (decision 175):
 *   - MEMBER_NO_EDIT       built on MEMBER with `work_items.edit` off: a
 *                          custom role narrowing Member. (The map proposed
 *                          "work_items.delete off", but MEMBER holds no
 *                          `work_items.delete`, so that role would equal
 *                          MEMBER and narrow nothing; `work_items.edit` is the
 *                          key most item routes take.)
 *   - VIEWER_PLUS_COMMENT  built on VIEWER with `work_items.comment` on: a
 *                          custom role widening Viewer.
 */

export const MATRIX_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST', 'MEMBER_NO_EDIT', 'VIEWER_PLUS_COMMENT'] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number];

export const OUTCOMES = ['ok', 'empty', 'denied', 'refused', 'hidden', 'archived'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** The GUEST tag (decision 176): today's rule, to be rewritten when roadmap 8.4 gives guests projects. */
export const GUEST_UNTIL = '8.4';
export interface GuestCell {
    readonly outcome: Outcome;
    readonly until: typeof GUEST_UNTIL;
}
export type Cell = Outcome | GuestCell;
export type Cells = Readonly<Record<MatrixRole, Cell>>;

export const outcomeOf = (cell: Cell): Outcome => (typeof cell === 'string' ? cell : cell.outcome);
export const isTaggedGuestCell = (cell: Cell): cell is GuestCell => typeof cell !== 'string' && cell.until === GUEST_UNTIL;

/** A GUEST cell, tagged until 8.4. */
export const g = (outcome: Outcome): GuestCell => ({ outcome, until: GUEST_UNTIL });

/** Cells in role order: OWNER, ADMIN, MEMBER, VIEWER, GUEST, MEMBER_NO_EDIT, VIEWER_PLUS_COMMENT. */
export function c(owner: Outcome, admin: Outcome, member: Outcome, viewer: Outcome, guest: GuestCell, memberNoEdit: Outcome, viewerPlusComment: Outcome): Cells {
    return { OWNER: owner, ADMIN: admin, MEMBER: member, VIEWER: viewer, GUEST: guest, MEMBER_NO_EDIT: memberNoEdit, VIEWER_PLUS_COMMENT: viewerPlusComment };
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export const METHODS: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** The ids a row acts on: the shared world's, overridden by a fresh fixture's. Keys are route parameter names where they can be. */
export type Subject = Readonly<Record<string, string>>;

/**
 * A fresh subject, built per cell by the harness (a destructive write must
 * not consume the shared world). Each name is implemented in `harness.ts`.
 */
export type FixtureName =
    | 'item'
    | 'itemWithDue'
    | 'itemWithRecurrence'
    | 'deletedItem'
    | 'itemWithLink'
    | 'itemWithRelation'
    | 'itemWithLabel'
    | 'itemWatchedByAnn'
    | 'ownComment'
    | 'othersComment'
    | 'question'
    | 'answered'
    | 'reviewPlanned'
    | 'reviewOpen'
    | 'reviewOpenNamingCaller'
    | 'reviewCallerNamedThenAssigned'
    | 'reviewSentByCaller'
    | 'reviewCallerIsAssignee'
    | 'freshProject'
    | 'deletedProject'
    | 'freshOption'
    | 'freshMilestone'
    | 'freshGoal'
    | 'finishedGoal'
    | 'deletedGoal'
    | 'freshPage'
    | 'deletedPage'
    | 'freshInitiative'
    | 'finishedInitiative'
    | 'deletedInitiative'
    | 'freshItemTemplate'
    | 'freshProjectList'
    | 'archivedProjectList'
    | 'freshWorkspaceList'
    | 'archivedWorkspaceList'
    | 'freshTeam'
    | 'teamWithCalendar'
    | 'teamHoliday'
    | 'workspaceHoliday'
    | 'freshState'
    | 'freshLabel'
    | 'freshCycle'
    | 'freshProjectTemplate'
    | 'ownView'
    | 'freshSharedView'
    | 'ownDashboard'
    | 'freshSharedDashboard'
    | 'freshRequest'
    | 'declinedRequest'
    | 'freshBlocked'
    | 'currencySet'
    | 'futureRate'
    | 'ownNotification'
    | 'othersNotification'
    | 'freshInvite'
    | 'freshMember'
    | 'freshCustomRole'
    | 'memberSession'
    | 'ownMfaEnrollment'
    | 'ownVerifiedMfa'
    | 'freshForm'
    | 'annMfaEnrollment'
    | 'calendarSyncOn'
    | 'ownCalendarConnection'
    | 'ownRemovedCalendar'
    | 'keyRotationJob'
    | 'dekRotationJob'
    | 'ownTimeEntry'
    | 'othersTimeEntry'
    | 'ownTimer'
    | 'approvalOn'
    | 'annSubmittedTimesheet'
    | 'annApprovedTimesheet'
    | 'ownSubmittedTimesheet'
    | 'ownTimeOff'
    | 'annTimeOff'
    | 'futureCapacity'
    | 'annOverWeek';

/** The matrix's route roots: one integration file each (map part 3, "Shape"). */
export type MatrixRoot = 'work-items' | 'reviews' | 'projects' | 'configuration' | 'intake' | 'notifications' | 'admin-security' | 'time' | 'workload' | 'analytics' | 'pages';

export interface MatrixRow {
    /** Relative to `src/app/api/t/[tenantSlug]/`. */
    readonly route: string;
    readonly method: Method;
    /** The key the route's `requirePermission` takes, written by hand; null for a route with none (self-service, usecase-gated). */
    readonly key: string | null;
    /** What the row acts on, in words. */
    readonly subject: string;
    readonly fixture?: FixtureName;
    /** Overrides of the parameters derived from the route's `[name]` segments (each read from the subject by its name). */
    readonly params?: (s: Subject) => Record<string, string>;
    readonly query?: (s: Subject) => Record<string, string>;
    readonly body?: (s: Subject) => unknown;
    readonly ifMatch?: (s: Subject) => string;
    /** An id the response carries for a caller who may see the subject (lists). */
    readonly reveals?: (s: Subject) => string;
    /** For `refused` cells: does the refusal write an `AUTHZ_DENIED` row? Default true. */
    readonly refusedAudit?: boolean;
    readonly expect: Cells;
}

// ─── Hand-written patterns ──────────────────────────────────────────────
// Each names who holds what, as the decisions state it; never computed.

/**
 * A GUEST on any keyed route: refused by `requirePermission`, audited (owner decision 204: until 8.4 a guest
 * holds no key, so it reads nothing, not even workspace configuration or the roster, and writes nothing).
 */
const GUEST_DENIED = g('denied');
/** A read under `work_items.view` / `projects.view` of something in a visible project: every workspace-wide role. */
const READ = c('ok', 'ok', 'ok', 'ok', GUEST_DENIED, 'ok', 'ok');
/** A list filtered by project visibility: every workspace-wide role sees the subject. */
const LIST = c('ok', 'ok', 'ok', 'ok', GUEST_DENIED, 'ok', 'ok');
/**
 * A workspace-level read under a key every workspace-wide role holds, touching no project (teams, types,
 * labels, cycles, working calendars, workspace recipient lists, the roster). The H2d open question, decided
 * by decision 204: a GUEST is refused these too.
 */
const WS_READ = c('ok', 'ok', 'ok', 'ok', GUEST_DENIED, 'ok', 'ok');
/** `work_items.edit`: OWNER, ADMIN, MEMBER; the narrowed member has lost it. */
const ITEM_EDIT = c('ok', 'ok', 'ok', 'denied', g('denied'), 'denied', 'denied');
/** `work_items.assign`: OWNER, ADMIN, MEMBER and the narrowed member. */
const ITEM_ASSIGN = c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'denied');
/** `work_items.delete`: OWNER and ADMIN only. */
const ITEM_DELETE = c('ok', 'ok', 'denied', 'denied', g('denied'), 'denied', 'denied');
/** `projects.edit` / `projects.create` / `cycles.manage`: OWNER, ADMIN, MEMBER and the narrowed member. */
const MEMBER_WRITE = c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'denied');
/** `admin.manage`, `admin.members`, `projects.archive`, `intake.manage`: OWNER and ADMIN. */
const ADMIN = c('ok', 'ok', 'denied', 'denied', g('denied'), 'denied', 'denied');
/** `admin.tenant_lifecycle`: OWNER only. */
const OWNER_ONLY = c('ok', 'denied', 'denied', 'denied', g('denied'), 'denied', 'denied');
/** `intake.view` / `intake.triage`: OWNER, ADMIN, MEMBER and the narrowed member. */
const INTAKE = c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'denied');
/**
 * The caller's own rows (notifications, preferences, MFA, sessions; key-free, self-service): every member,
 * a GUEST too. Decision 204 keeps exactly these open to a guest before 8.4.
 */
const SELF = c('ok', 'ok', 'ok', 'ok', g('ok'), 'ok', 'ok');
/**
 * `time.track` (decision 265): OWNER, ADMIN, MEMBER and the narrowed member (time never rides on
 * `work_items.edit`); a VIEWER views time but records none, and the widened viewer neither.
 */
const TRACK = c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'denied');
/** `time.approve` (decision 265): OWNER and ADMIN; no built-in Member or Viewer, nor either custom role. */
const APPROVE = c('ok', 'ok', 'denied', 'denied', g('denied'), 'denied', 'denied');
/** `workload.view` and `workload.time_off` (decision 298): every built-in role but a guest, and both custom roles. */
const WORKLOAD = c('ok', 'ok', 'ok', 'ok', g('denied'), 'ok', 'ok');
/**
 * The ways to rebalance (3.5c, decision 299): read under `workload.view`, present only for a caller who may
 * assign work items or change their dates (the narrowed member still assigns); `empty` asserts their absence.
 */
const REBALANCE = c('ok', 'ok', 'ok', 'empty', g('denied'), 'ok', 'empty');
/** `workload.manage` (decision 298): OWNER and ADMIN. */
const WORKLOAD_MANAGE = c('ok', 'ok', 'denied', 'denied', g('denied'), 'denied', 'denied');
/**
 * Another member's time off under `workload.time_off` (decision 288): the route admits every holder, and the
 * usecase refuses all but `workload.manage` with an audited 403.
 */
const OTHERS_TIME_OFF = c('ok', 'ok', 'refused', 'refused', g('denied'), 'refused', 'refused');
/**
 * Another member's time-off type (decision 287): the response carries `"type"` only for a holder of
 * `workload.manage`; every other reader gets the dates and hours with the key absent (`empty`).
 */
const OTHERS_TYPE = c('ok', 'ok', 'empty', 'empty', g('denied'), 'empty', 'empty');

/** `time.rates` (decisions 265 and 274): OWNER and ADMIN; never a Member or Viewer, nor either custom role. */
const RATES = c('ok', 'ok', 'denied', 'denied', g('denied'), 'denied', 'denied');
/** `analytics.view` (decision 329): every built-in role but a guest, and both custom roles (their bases, MEMBER and VIEWER, hold it). */
const ANALYTICS = c('ok', 'ok', 'ok', 'ok', g('denied'), 'ok', 'ok');

/**
 * Other people's time-waiting rows and the totals (decisions 329 and 335): the response carries `"people"` and
 * `"totals"` only for a holder of `analytics.people`, OWNER and ADMIN; every other reader gets its own row with
 * both keys absent (`empty`), both custom roles included (their bases, MEMBER and VIEWER, do not hold it).
 */
const ANALYTICS_PEOPLE = c('ok', 'ok', 'empty', 'empty', g('denied'), 'empty', 'empty');

/**
 * A shared dashboard saved (decisions 326 and 329): the route admits every `analytics.view` holder, and the
 * usecase refuses all but `analytics.share` holders (OWNER, ADMIN, MEMBER and the narrowed member) with an
 * audited 403; a VIEWER and the widened viewer keep personal dashboards only.
 */
const ANALYTICS_SHARE = c('ok', 'ok', 'ok', 'refused', g('denied'), 'ok', 'refused');
/** Another member's shared dashboard changed (decision 326): only its creator changes one; every other reader is refused, audited. */
const DASHBOARD_CREATOR_ONLY = c('refused', 'refused', 'refused', 'refused', g('denied'), 'refused', 'refused');
/** Another member's shared dashboard deleted (decision 326): an Owner or Admin moderating (`DASHBOARD_MODERATED`); every other reader refused. */
const DASHBOARD_MODERATE = c('ok', 'ok', 'refused', 'refused', g('denied'), 'refused', 'refused');

/** One widget, as a layout write sends it. */
const ONE_WIDGET = { type: 'COUNTS', config: { scope: { filters: {} }, window: { kind: 'weeks', weeks: 12 } }, position: { x: 0, y: 0 }, size: { w: 12, h: 3 } };

/** A write into an archived project by a caller the key admits. */
const ARCHIVED_ITEM_EDIT = c('archived', 'archived', 'archived', 'denied', g('denied'), 'denied', 'denied');

// ─── Body helpers (pure) ────────────────────────────────────────────────

/** A date `n` days after 2050-01-01 (date-only). */
export function day(n: number): string {
    return new Date(Date.UTC(2050, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
}
/** The Monday `n` weeks after 2001-01-01 (a Monday): a week long past, so it may be submitted (3.4c). */
export function pastWeek(n: number): string {
    return new Date(Date.UTC(2001, 0, 1) + n * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday `n` weeks after 2050-01-03, a Monday (date-only). */
export function monday(n: number): string {
    return day(2 + 7 * n);
}
/**
 * The Monday of the week after this one (date-only, UTC): a workload cell's week (3.5b), never before the current
 * week in any zone a workspace calendar may be read in.
 */
export function nextWeekMonday(): string {
    const now = new Date();
    const back = (now.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back + 7)).toISOString().slice(0, 10);
}
/** Letters for a key prefix from a number (A, B, …, Z, BA, …). */
export function letters(n: number): string {
    let out = '';
    let v = n;
    do {
        out = String.fromCharCode(65 + (v % 26)) + out;
        v = Math.floor(v / 26);
    } while (v > 0);
    return out;
}
const n = (s: Subject) => Number(s.seq);

const W = 'work-items/[workItemId]';
const RV = `${W}/review`;
const PJ = 'projects/[projectId]';

// ─── The table ──────────────────────────────────────────────────────────

export const MATRIX: Readonly<Record<MatrixRoot, readonly MatrixRow[]>> = {
    'work-items': [
        { route: 'work-items/route.ts', method: 'GET', key: 'work_items.view', subject: 'the live list', reveals: (s) => s.workItemId, expect: LIST },
        {
            route: 'work-items/route.ts', method: 'POST', key: 'work_items.create', subject: 'a create in a visible project',
            body: (s) => ({ projectId: s.projectId, typeId: s.typeId, title: `matrix create ${s.seq}` }),
            refusedAudit: false,
            expect: c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'denied'),
        },
        {
            route: 'work-items/route.ts', method: 'POST', key: 'work_items.create', subject: 'a create in an archived project',
            body: (s) => ({ projectId: s.archivedProjectId, typeId: s.typeId, title: `matrix archived ${s.seq}` }),
            refusedAudit: false,
            expect: c('archived', 'archived', 'archived', 'denied', g('denied'), 'archived', 'denied'),
        },
        { route: 'work-items/deleted/route.ts', method: 'GET', key: 'work_items.delete', subject: 'the Deleted view', expect: ITEM_DELETE },
        // Counts over what the caller sees.
        { route: 'work-items/metrics/route.ts', method: 'GET', key: 'work_items.view', subject: 'the counts', expect: WS_READ },
        { route: 'work-items/timeline/route.ts', method: 'GET', key: 'work_items.view', subject: 'the timeline of the live items (3.1b)', reveals: (s) => s.workItemId, expect: LIST },
        {
            route: 'work-items/calendar/route.ts', method: 'GET', key: 'work_items.view', subject: 'the calendar of a window holding a dated item (3.3a)',
            fixture: 'itemWithDue', query: () => ({ from: '2051-05-15', to: '2051-06-15' }), reveals: (s) => s.workItemId, expect: LIST,
        },
        { route: 'work-items/by-key/[key]/route.ts', method: 'GET', key: 'work_items.view', subject: 'an item by its key', expect: READ },
        { route: 'work-items/bulk/assign/route.ts', method: 'POST', key: 'work_items.assign', subject: 'a fresh item', fixture: 'item', body: (s) => ({ workItemIds: [s.workItemId], assigneeId: s.annId }), expect: ITEM_ASSIGN },
        { route: 'work-items/bulk/state/route.ts', method: 'POST', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: (s) => ({ workItemIds: [s.workItemId], stateCategory: 'STARTED' }), expect: ITEM_EDIT },
        { route: 'work-items/bulk/due/route.ts', method: 'POST', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: (s) => ({ workItemIds: [s.workItemId], dueDate: '2051-01-02' }), expect: ITEM_EDIT },
        // A change of dates from the timeline (3.1c, decision 194): a fresh item is at version 1.
        {
            route: 'work-items/bulk/dates/route.ts', method: 'POST', key: 'work_items.edit', subject: "a fresh item's dates (3.1c)", fixture: 'item',
            body: (s) => ({ dragged: { id: s.workItemId, version: 1, startDate: '2051-01-02', dueDate: '2051-01-09' }, pushed: [] }),
            expect: ITEM_EDIT,
        },
        {
            route: 'work-items/bulk/dates/route.ts', method: 'POST', key: 'work_items.edit', subject: 'an item in an archived project (3.1c)',
            body: (s) => ({ dragged: { id: s.archivedItemId, version: 1, startDate: '2051-01-02', dueDate: '2051-01-09' }, pushed: [] }),
            expect: ARCHIVED_ITEM_EDIT,
        },
        { route: 'work-items/bulk/delete/route.ts', method: 'POST', key: 'work_items.delete', subject: 'a fresh item', fixture: 'item', body: (s) => ({ workItemIds: [s.workItemId] }), expect: ITEM_DELETE },
        { route: `${W}/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item in a visible project', expect: READ },
        { route: `${W}/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item in an archived project (reads allowed)', params: (s) => ({ workItemId: s.archivedItemId }), expect: READ },
        { route: `${W}/route.ts`, method: 'PATCH', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: () => ({ priority: 'LOW' }), expect: ITEM_EDIT },
        { route: `${W}/route.ts`, method: 'PATCH', key: 'work_items.edit', subject: 'an item in an archived project', params: (s) => ({ workItemId: s.archivedItemId }), body: () => ({ priority: 'LOW' }), expect: ARCHIVED_ITEM_EDIT },
        { route: `${W}/route.ts`, method: 'DELETE', key: 'work_items.delete', subject: 'a fresh item', fixture: 'item', expect: ITEM_DELETE },
        { route: `${W}/state/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: (s) => ({ stateId: s.startedStateId }), expect: ITEM_EDIT },
        { route: `${W}/assign/route.ts`, method: 'POST', key: 'work_items.assign', subject: 'a fresh item', fixture: 'item', body: (s) => ({ assigneeId: s.annId }), expect: ITEM_ASSIGN },
        { route: `${W}/restore/route.ts`, method: 'POST', key: 'work_items.delete', subject: 'a deleted item', fixture: 'deletedItem', expect: ITEM_DELETE },
        { route: `${W}/activity/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item', expect: READ },
        { route: `${W}/sub-items/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item', expect: READ },
        { route: `${W}/move/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'a fresh item, reordered', fixture: 'item', body: (s) => ({ position: { afterId: s.sharedItemId } }), expect: ITEM_EDIT },
        { route: `${W}/comments/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item', expect: READ },
        {
            route: `${W}/comments/route.ts`, method: 'POST', key: 'work_items.comment', subject: 'a comment on a visible item', body: (s) => ({ body: `matrix comment ${s.seq}` }),
            // The widened viewer comments; a plain VIEWER does not.
            expect: c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'ok'),
        },
        {
            route: `${W}/comments/route.ts`, method: 'POST', key: 'work_items.comment', subject: 'a comment on an item in an archived project',
            params: (s) => ({ workItemId: s.archivedItemId }), body: (s) => ({ body: `matrix archived comment ${s.seq}` }),
            expect: c('archived', 'archived', 'archived', 'denied', g('denied'), 'archived', 'archived'),
        },
        {
            route: `${W}/comments/[commentId]/route.ts`, method: 'PATCH', key: 'work_items.comment', subject: "the caller's own comment", fixture: 'ownComment', body: () => ({ body: 'edited by its author' }),
            expect: c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'ok'),
        },
        {
            route: `${W}/comments/[commentId]/route.ts`, method: 'PATCH', key: 'work_items.comment', subject: "another member's comment", fixture: 'othersComment', body: () => ({ body: 'edited by someone else' }),
            // Only the author edits (owner decision, 2026-11-19), an admin included; the refusal is audited.
            expect: c('refused', 'refused', 'refused', 'denied', g('denied'), 'refused', 'refused'),
        },
        {
            route: `${W}/comments/[commentId]/route.ts`, method: 'DELETE', key: 'work_items.comment', subject: "the caller's own comment", fixture: 'ownComment',
            expect: c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'ok'),
        },
        {
            route: `${W}/comments/[commentId]/route.ts`, method: 'DELETE', key: 'work_items.comment', subject: "another member's comment", fixture: 'othersComment',
            // An admin moderates; anyone else is refused, audited.
            expect: c('ok', 'ok', 'refused', 'denied', g('denied'), 'refused', 'refused'),
        },
        { route: `${W}/watchers/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item', expect: READ },
        { route: `${W}/watchers/route.ts`, method: 'POST', key: 'work_items.view', subject: 'the caller watching a visible item (self)', expect: READ },
        { route: `${W}/watchers/route.ts`, method: 'DELETE', key: 'work_items.view', subject: 'the caller unwatching a visible item (self)', expect: READ },
        { route: `${W}/watchers/[userId]/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'another member made a watcher', fixture: 'item', params: (s) => ({ userId: s.annId }), expect: ITEM_EDIT },
        { route: `${W}/watchers/[userId]/route.ts`, method: 'DELETE', key: 'work_items.edit', subject: 'another member removed as a watcher', fixture: 'itemWatchedByAnn', expect: ITEM_EDIT },
        { route: `${W}/watchers/recipient-list/route.ts`, method: 'POST', key: 'work_items.edit', subject: "a project's recipient list copied to a fresh item", fixture: 'item', body: (s) => ({ listId: s.projectListId }), expect: ITEM_EDIT },
        { route: `${W}/links/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item', expect: READ },
        { route: `${W}/links/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: () => ({ type: 'URL', location: 'https://example.com/matrix' }), expect: ITEM_EDIT },
        { route: `${W}/links/[linkId]/route.ts`, method: 'DELETE', key: 'work_items.edit', subject: "a fresh item's link", fixture: 'itemWithLink', expect: ITEM_EDIT },
        { route: `${W}/relations/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item', expect: READ },
        { route: `${W}/relations/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'a fresh item related to the shared one', fixture: 'item', body: (s) => ({ type: 'RELATES', toId: s.sharedItemId }), expect: ITEM_EDIT },
        { route: `${W}/relations/[relationId]/route.ts`, method: 'DELETE', key: 'work_items.edit', subject: "a fresh item's relation", fixture: 'itemWithRelation', expect: ITEM_EDIT },
        { route: `${W}/labels/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: (s) => ({ labelIds: [s.labelId] }), expect: ITEM_EDIT },
        { route: `${W}/labels/[labelId]/route.ts`, method: 'DELETE', key: 'work_items.edit', subject: "a fresh item's label", fixture: 'itemWithLabel', expect: ITEM_EDIT },
        { route: `${W}/custom-fields/[fieldId]/route.ts`, method: 'PUT', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: (s) => ({ value: s.optionId }), expect: ITEM_EDIT },
        { route: `${W}/cycle/route.ts`, method: 'PUT', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: (s) => ({ cycleId: s.cycleId }), expect: ITEM_EDIT },
        { route: `${W}/milestone/route.ts`, method: 'PUT', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: (s) => ({ milestoneId: s.milestoneId }), expect: ITEM_EDIT },
        { route: `${W}/waiting-on/route.ts`, method: 'PUT', key: 'work_items.edit', subject: 'a fresh item', fixture: 'item', body: (s) => ({ userId: s.annId }), expect: ITEM_EDIT },
        { route: `${W}/recurrence/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item', expect: READ },
        {
            route: `${W}/recurrence/route.ts`, method: 'PUT', key: 'work_items.create', subject: 'a fresh item with a due date', fixture: 'itemWithDue', body: () => ({ frequency: 'WEEKLY' }),
            // Decision 72: the route takes work_items.create and the usecase asserts work_items.edit too.
            // The narrowed member holds create, not edit: refused, unaudited.
            refusedAudit: false,
            expect: c('ok', 'ok', 'ok', 'denied', g('denied'), 'refused', 'denied'),
        },
        { route: `${W}/recurrence/route.ts`, method: 'DELETE', key: 'work_items.edit', subject: "a fresh item's repeat", fixture: 'itemWithRecurrence', expect: ITEM_EDIT },
        { route: `${W}/answer/route.ts`, method: 'PUT', key: 'work_items.edit', subject: 'a fresh question and a comment on it', fixture: 'question', body: (s) => ({ commentId: s.commentId }), expect: ITEM_EDIT },
        { route: `${W}/answer/route.ts`, method: 'DELETE', key: 'work_items.edit', subject: 'a fresh answered question', fixture: 'answered', expect: ITEM_EDIT },
        // Sub-phase 3.2a (decision 211): an item's goal is a work-item field; naming one also asks goals.view.
        { route: `${W}/goal/route.ts`, method: 'PUT', key: 'work_items.edit', subject: 'a fresh item and a goal', fixture: 'item', body: (s) => ({ goalId: s.goalId }), expect: ITEM_EDIT },
        // Sub-phase 3.4a (decision 257): an item's estimate is a work-item field, in its team's unit (the matrix team estimates in points).
        { route: `${W}/estimate/route.ts`, method: 'PUT', key: 'work_items.edit', subject: 'a fresh item of a team that estimates', fixture: 'item', body: () => ({ value: 3, unit: 'POINTS' }), expect: ITEM_EDIT },
        { route: `${W}/ancestry/route.ts`, method: 'GET', key: 'work_items.view', subject: "an item's ancestry", expect: READ },
    ],

    reviews: [
        { route: `${RV}/route.ts`, method: 'GET', key: 'work_items.view', subject: 'an item with an open round', fixture: 'reviewOpen', expect: READ },
        {
            route: `${RV}/steps/route.ts`, method: 'PUT', key: 'work_items.edit', subject: 'a fresh item assigned to another member', fixture: 'item',
            body: (s) => ({ steps: [{ name: 'Check', mode: 'ALL', dueInWorkingDays: 2, memberIds: [s.raeId] }] }),
            expect: ITEM_EDIT,
        },
        { route: `${RV}/send/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'a planned round', fixture: 'reviewPlanned', expect: ITEM_EDIT },
        { route: `${RV}/withdraw/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'an open round', fixture: 'reviewOpen', expect: ITEM_EDIT },
        {
            route: `${RV}/steps/[stepId]/respond/route.ts`, method: 'POST', key: 'work_items.view', subject: 'an open step naming the caller', fixture: 'reviewOpenNamingCaller',
            body: () => ({ outcome: 'SIGNED_OFF' }),
            // Decision 160: the read key and being named.
            expect: c('ok', 'ok', 'ok', 'ok', g('denied'), 'ok', 'ok'),
        },
        {
            route: `${RV}/steps/[stepId]/respond/route.ts`, method: 'POST', key: 'work_items.view', subject: 'an open step that named the caller, who was then made the assignee',
            fixture: 'reviewCallerNamedThenAssigned', body: () => ({ outcome: 'SIGNED_OFF' }),
            // Decision 158: the assignee never reviews; the refusal is audited.
            expect: c('refused', 'refused', 'refused', 'refused', g('denied'), 'refused', 'refused'),
        },
        {
            route: `${RV}/steps/[stepId]/respond/route.ts`, method: 'POST', key: 'work_items.view', subject: 'an open step not naming the caller', fixture: 'reviewOpen',
            body: () => ({ outcome: 'SIGNED_OFF' }),
            expect: c('refused', 'refused', 'refused', 'refused', g('denied'), 'refused', 'refused'),
        },
        {
            route: `${RV}/steps/[stepId]/skip/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'an open step sent by another, the item assigned to another', fixture: 'reviewOpen',
            // Decision 150: the assignee, the sender or admin.manage; a member without standing is refused, audited.
            expect: c('ok', 'ok', 'refused', 'denied', g('denied'), 'denied', 'denied'),
        },
        {
            route: `${RV}/steps/[stepId]/skip/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'an open step the caller sent', fixture: 'reviewSentByCaller',
            expect: ITEM_EDIT,
        },
        {
            route: `${RV}/steps/[stepId]/skip/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'an open step on an item assigned to the caller', fixture: 'reviewCallerIsAssignee',
            expect: ITEM_EDIT,
        },
        { route: `${RV}/steps/[stepId]/reviewers/route.ts`, method: 'POST', key: 'work_items.edit', subject: 'an open step', fixture: 'reviewOpen', body: (s) => ({ userId: s.samId }), expect: ITEM_EDIT },
        {
            route: `${RV}/steps/[stepId]/reviewers/[userId]/route.ts`, method: 'DELETE', key: 'work_items.edit', subject: 'a pending reviewer of a step sent by another, the item assigned to another', fixture: 'reviewOpen',
            expect: c('ok', 'ok', 'refused', 'denied', g('denied'), 'denied', 'denied'),
        },
        {
            route: `${RV}/steps/[stepId]/reviewers/[userId]/route.ts`, method: 'DELETE', key: 'work_items.edit', subject: 'a pending reviewer of a step the caller sent', fixture: 'reviewSentByCaller',
            expect: ITEM_EDIT,
        },
        { route: 'work-item-types/[typeId]/review-steps/route.ts', method: 'GET', key: 'projects.view', subject: "a type's default review steps", expect: WS_READ },
        {
            route: 'work-item-types/[typeId]/review-steps/route.ts', method: 'PUT', key: 'admin.manage', subject: "a type's default review steps",
            body: () => ({ reviewRequiredForDone: false, steps: [] }), expect: ADMIN,
        },
    ],

    projects: [
        { route: 'projects/route.ts', method: 'GET', key: 'projects.view', subject: 'the project list', reveals: (s) => s.projectId, expect: LIST },
        { route: 'projects/route.ts', method: 'POST', key: 'projects.create', subject: 'a new project', body: (s) => ({ teamId: s.teamId, name: `Matrix ${s.seq}`, keyPrefix: `MX${letters(n(s))}` }), expect: MEMBER_WRITE },
        { route: `${PJ}/route.ts`, method: 'GET', key: 'projects.view', subject: 'a visible project', expect: READ },
        { route: `${PJ}/route.ts`, method: 'PATCH', key: 'projects.edit', subject: 'a visible project', body: (s) => ({ name: `Renamed ${s.seq}` }), expect: c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'denied') },
        { route: `${PJ}/route.ts`, method: 'DELETE', key: 'projects.archive', subject: 'a fresh project', fixture: 'freshProject', expect: ADMIN },
        { route: `${PJ}/archive/route.ts`, method: 'POST', key: 'projects.archive', subject: 'a fresh project', fixture: 'freshProject', body: () => ({ archived: true }), expect: ADMIN },
        { route: `${PJ}/restore/route.ts`, method: 'POST', key: 'projects.archive', subject: 'a deleted project', fixture: 'deletedProject', expect: ADMIN },
        { route: `${PJ}/custom-fields/route.ts`, method: 'GET', key: 'projects.view', subject: "a project's fields", expect: READ },
        { route: `${PJ}/custom-fields/route.ts`, method: 'POST', key: 'projects.edit', subject: 'a new field', body: (s) => ({ name: `Field ${s.seq}`, type: 'NUMBER' }), expect: MEMBER_WRITE },
        { route: `${PJ}/custom-fields/[fieldId]/route.ts`, method: 'PATCH', key: 'projects.edit', subject: 'a field', body: (s) => ({ name: `Stage ${s.seq}` }), expect: MEMBER_WRITE },
        { route: `${PJ}/custom-fields/[fieldId]/options/route.ts`, method: 'POST', key: 'projects.edit', subject: "a field's new option", body: (s) => ({ name: `Opt ${s.seq}` }), expect: MEMBER_WRITE },
        { route: `${PJ}/custom-fields/[fieldId]/options/[optionId]/route.ts`, method: 'PATCH', key: 'projects.edit', subject: 'an option', body: () => ({ color: '#123456' }), expect: MEMBER_WRITE },
        { route: `${PJ}/custom-fields/[fieldId]/options/[optionId]/route.ts`, method: 'DELETE', key: 'projects.edit', subject: 'a fresh, unused option', fixture: 'freshOption', expect: MEMBER_WRITE },
        { route: `${PJ}/milestones/route.ts`, method: 'GET', key: 'projects.view', subject: "a project's milestones", expect: READ },
        { route: `${PJ}/milestones/route.ts`, method: 'POST', key: 'projects.edit', subject: 'a new milestone', body: (s) => ({ name: `Milestone ${s.seq}` }), expect: MEMBER_WRITE },
        { route: `${PJ}/milestones/[milestoneId]/route.ts`, method: 'PATCH', key: 'projects.edit', subject: 'a milestone', body: () => ({ dueDate: '2051-03-01' }), expect: MEMBER_WRITE },
        { route: `${PJ}/milestones/[milestoneId]/route.ts`, method: 'DELETE', key: 'projects.edit', subject: 'a fresh milestone', fixture: 'freshMilestone', expect: MEMBER_WRITE },
        { route: `${PJ}/type-fields/route.ts`, method: 'GET', key: 'projects.view', subject: "a project's custom-field rules", expect: READ },
        { route: `${PJ}/type-fields/route.ts`, method: 'PUT', key: 'projects.edit', subject: "a type's rule for a field", body: (s) => ({ typeId: s.typeId, customFieldId: s.fieldId, requirement: 'OPTIONAL' }), expect: MEMBER_WRITE },
        { route: `${PJ}/work-item-templates/route.ts`, method: 'GET', key: 'projects.view', subject: "a project's item templates", expect: READ },
        { route: `${PJ}/work-item-templates/route.ts`, method: 'POST', key: 'projects.edit', subject: 'a new item template', body: (s) => ({ name: `Template ${s.seq}`, title: 'From the matrix' }), expect: MEMBER_WRITE },
        { route: `${PJ}/work-item-templates/[templateId]/route.ts`, method: 'PATCH', key: 'projects.edit', subject: 'an item template', body: () => ({ dueInDays: 3 }), expect: MEMBER_WRITE },
        { route: `${PJ}/work-item-templates/[templateId]/route.ts`, method: 'DELETE', key: 'projects.edit', subject: 'a fresh item template', fixture: 'freshItemTemplate', expect: MEMBER_WRITE },
        { route: `${PJ}/recipient-lists/route.ts`, method: 'GET', key: 'projects.view', subject: "a project's recipient lists", expect: READ },
        { route: `${PJ}/recipient-lists/route.ts`, method: 'POST', key: 'projects.edit', subject: 'a new project list', body: (s) => ({ name: `List ${s.seq}` }), expect: MEMBER_WRITE },
        { route: `${PJ}/recipient-lists/[listId]/route.ts`, method: 'GET', key: 'projects.view', subject: "a project's list", params: (s) => ({ listId: s.projectListId }), expect: READ },
        { route: `${PJ}/recipient-lists/[listId]/route.ts`, method: 'PATCH', key: 'projects.edit', subject: "a project's list", params: (s) => ({ listId: s.projectListId }), body: () => ({ description: 'Desk' }), expect: MEMBER_WRITE },
        { route: `${PJ}/recipient-lists/[listId]/members/route.ts`, method: 'PUT', key: 'projects.edit', subject: "a project's list", params: (s) => ({ listId: s.projectListId }), body: (s) => ({ userIds: [s.annId] }), expect: MEMBER_WRITE },
        { route: `${PJ}/recipient-lists/[listId]/members/route.ts`, method: 'PATCH', key: 'projects.edit', subject: "a project's list", params: (s) => ({ listId: s.projectListId }), body: (s) => ({ add: [s.raeId] }), expect: MEMBER_WRITE },
        { route: `${PJ}/recipient-lists/[listId]/archive/route.ts`, method: 'POST', key: 'projects.edit', subject: "a fresh project list", fixture: 'freshProjectList', expect: MEMBER_WRITE },
        { route: `${PJ}/recipient-lists/[listId]/restore/route.ts`, method: 'POST', key: 'projects.edit', subject: "an archived project list", fixture: 'archivedProjectList', expect: MEMBER_WRITE },
        { route: `${PJ}/intake/route.ts`, method: 'PUT', key: 'intake.manage', subject: "a project's intake", body: () => ({ enabled: true }), expect: ADMIN },
        { route: `${PJ}/intake/email-address/route.ts`, method: 'POST', key: 'intake.manage', subject: "a project's intake address", expect: ADMIN },
        // Sub-phase 3.2a: a project's initiative is a project field (projects.edit); naming one also asks goals.view,
        // which every role holding projects.edit holds.
        { route: `${PJ}/initiative/route.ts`, method: 'PUT', key: 'projects.edit', subject: "a project's initiative", body: (s) => ({ initiativeId: s.initiativeId }), expect: MEMBER_WRITE },
    ],

    configuration: [
        // Sub-phase 3.2a (decision 213): goals.view for every workspace-wide role; goals.manage for Owners, Admins
        // and Members (the narrowed member keeps it: only work_items.edit is off); a Guest nothing (decision 204).
        { route: 'goals/route.ts', method: 'GET', key: 'goals.view', subject: 'the goals', reveals: (s) => s.goalId, expect: WS_READ },
        { route: 'goals/route.ts', method: 'POST', key: 'goals.manage', subject: 'a new goal', body: (s) => ({ title: `Goal ${s.seq}` }), expect: MEMBER_WRITE },
        { route: 'goals/[goalId]/route.ts', method: 'GET', key: 'goals.view', subject: 'a goal', expect: WS_READ },
        { route: 'goals/[goalId]/route.ts', method: 'PATCH', key: 'goals.manage', subject: 'a goal', body: () => ({ dueDate: '2051-06-30' }), expect: MEMBER_WRITE },
        { route: 'goals/[goalId]/route.ts', method: 'DELETE', key: 'goals.manage', subject: 'a fresh goal', fixture: 'freshGoal', expect: MEMBER_WRITE },
        { route: 'goals/[goalId]/archive/route.ts', method: 'POST', key: 'goals.manage', subject: 'a fresh completed goal', fixture: 'finishedGoal', body: () => ({ archived: true }), expect: MEMBER_WRITE },
        { route: 'goals/[goalId]/restore/route.ts', method: 'POST', key: 'goals.manage', subject: 'a fresh deleted goal', fixture: 'deletedGoal', expect: MEMBER_WRITE },
        // Sub-phase 3.2b (decisions 205 and 214): health is set by a person holding goals.manage.
        { route: 'goals/[goalId]/health/route.ts', method: 'PUT', key: 'goals.manage', subject: "a goal's health", body: () => ({ health: 'AT_RISK' }), expect: MEMBER_WRITE },
        { route: 'initiatives/route.ts', method: 'GET', key: 'goals.view', subject: 'the initiatives', reveals: (s) => s.initiativeId, expect: WS_READ },
        { route: 'initiatives/route.ts', method: 'POST', key: 'goals.manage', subject: 'a new initiative', body: (s) => ({ name: `Initiative ${s.seq}`, goalId: s.goalId }), expect: MEMBER_WRITE },
        { route: 'initiatives/[initiativeId]/route.ts', method: 'GET', key: 'goals.view', subject: 'an initiative', expect: WS_READ },
        { route: 'initiatives/[initiativeId]/route.ts', method: 'PATCH', key: 'goals.manage', subject: 'an initiative', body: () => ({ dueDate: '2051-05-31' }), expect: MEMBER_WRITE },
        { route: 'initiatives/[initiativeId]/route.ts', method: 'DELETE', key: 'goals.manage', subject: 'a fresh initiative', fixture: 'freshInitiative', expect: MEMBER_WRITE },
        { route: 'initiatives/[initiativeId]/archive/route.ts', method: 'POST', key: 'goals.manage', subject: 'a fresh cancelled initiative', fixture: 'finishedInitiative', body: () => ({ archived: true }), expect: MEMBER_WRITE },
        { route: 'initiatives/[initiativeId]/restore/route.ts', method: 'POST', key: 'goals.manage', subject: 'a fresh deleted initiative', fixture: 'deletedInitiative', expect: MEMBER_WRITE },
        { route: 'initiatives/[initiativeId]/health/route.ts', method: 'PUT', key: 'goals.manage', subject: "an initiative's health", body: () => ({ health: 'ON_TRACK' }), expect: MEMBER_WRITE },
        // Sub-phase 3.2c (decisions 215 to 217): the roadmap reads under goals.view, and asks projects.view too,
        // which every role holding goals.view holds.
        { route: 'roadmap/route.ts', method: 'GET', key: 'goals.view', subject: 'the roadmap', reveals: (s) => s.initiativeId, expect: WS_READ },
        { route: 'teams/route.ts', method: 'GET', key: 'projects.view', subject: 'the teams', expect: WS_READ },
        { route: 'teams/route.ts', method: 'POST', key: 'admin.manage', subject: 'a new team', body: (s) => ({ name: `Team ${s.seq}` }), expect: ADMIN },
        { route: 'teams/[teamId]/route.ts', method: 'GET', key: 'projects.view', subject: 'a team', expect: WS_READ },
        { route: 'teams/[teamId]/route.ts', method: 'PATCH', key: 'admin.manage', subject: 'a team', body: (s) => ({ name: `Core ${s.seq}` }), expect: ADMIN },
        { route: 'teams/[teamId]/route.ts', method: 'DELETE', key: 'admin.manage', subject: 'a fresh team with no projects', fixture: 'freshTeam', expect: ADMIN },
        { route: 'teams/[teamId]/workflow-states/route.ts', method: 'GET', key: 'projects.view', subject: "a team's states", expect: WS_READ },
        { route: 'teams/[teamId]/workflow-states/route.ts', method: 'POST', key: 'admin.manage', subject: 'a new state', body: (s) => ({ name: `QA ${s.seq}`, category: 'STARTED' }), expect: ADMIN },
        { route: 'teams/[teamId]/workflow-states/[stateId]/route.ts', method: 'PATCH', key: 'admin.manage', subject: 'a state', params: (s) => ({ stateId: s.startedStateId }), body: (s) => ({ name: `In progress ${s.seq}` }), expect: ADMIN },
        { route: 'teams/[teamId]/workflow-states/[stateId]/route.ts', method: 'DELETE', key: 'admin.manage', subject: 'a fresh, unused state', fixture: 'freshState', expect: ADMIN },
        { route: 'teams/[teamId]/cycle-schedule/route.ts', method: 'GET', key: 'cycles.view', subject: "a team's schedule", expect: WS_READ },
        {
            route: 'teams/[teamId]/cycle-schedule/route.ts', method: 'PUT', key: 'cycles.manage', subject: "a team's schedule (off)",
            body: () => ({ enabled: false, lengthWeeks: 2, firstStartsOn: '2052-02-05', upcomingCount: 2, rollover: 'NEXT_CYCLE' }),
            expect: MEMBER_WRITE,
        },
        // Working calendars (3.1a, decision 193): managed under admin.manage, read under projects.view.
        { route: 'working-calendar/route.ts', method: 'GET', key: 'projects.view', subject: "the workspace's and teams' working calendars", expect: WS_READ },
        { route: 'working-calendar/route.ts', method: 'PUT', key: 'admin.manage', subject: "the workspace's working calendar", body: () => ({ timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4, 5] }), expect: ADMIN },
        { route: 'working-calendar/holidays/route.ts', method: 'POST', key: 'admin.manage', subject: "a holiday on the workspace's calendar", body: (s) => ({ holidays: [{ day: day(n(s)), name: `Holiday ${s.seq}` }] }), expect: ADMIN },
        { route: 'working-calendar/holidays/[holidayId]/route.ts', method: 'DELETE', key: 'admin.manage', subject: "a fresh holiday on the workspace's calendar", fixture: 'workspaceHoliday', expect: ADMIN },
        { route: 'teams/[teamId]/working-calendar/route.ts', method: 'GET', key: 'projects.view', subject: "a team's working calendar", expect: WS_READ },
        { route: 'teams/[teamId]/working-calendar/route.ts', method: 'PUT', key: 'admin.manage', subject: "a team's own working calendar", body: () => ({ timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4] }), expect: ADMIN },
        { route: 'teams/[teamId]/working-calendar/route.ts', method: 'DELETE', key: 'admin.manage', subject: "a fresh team's own working calendar", fixture: 'teamWithCalendar', expect: ADMIN },
        { route: 'teams/[teamId]/working-calendar/holidays/route.ts', method: 'POST', key: 'admin.manage', subject: "a holiday on a team's own calendar", fixture: 'teamWithCalendar', body: (s) => ({ holidays: [{ day: day(n(s)), name: `Team holiday ${s.seq}` }] }), expect: ADMIN },
        { route: 'teams/[teamId]/working-calendar/holidays/[holidayId]/route.ts', method: 'DELETE', key: 'admin.manage', subject: "a fresh holiday on a team's own calendar", fixture: 'teamHoliday', expect: ADMIN },
        { route: 'cycles/route.ts', method: 'GET', key: 'cycles.view', subject: 'the cycles', expect: WS_READ },
        { route: 'cycles/route.ts', method: 'POST', key: 'cycles.manage', subject: 'a new one-day cycle', body: (s) => ({ teamId: s.teamId, startsOn: day(2 * n(s)), endsOn: day(2 * n(s)) }), expect: MEMBER_WRITE },
        { route: 'cycles/[cycleId]/route.ts', method: 'GET', key: 'cycles.view', subject: 'a cycle', expect: WS_READ },
        { route: 'cycles/[cycleId]/route.ts', method: 'PATCH', key: 'cycles.manage', subject: 'a cycle', body: (s) => ({ name: `Cycle ${s.seq}` }), expect: MEMBER_WRITE },
        { route: 'cycles/[cycleId]/route.ts', method: 'DELETE', key: 'cycles.manage', subject: 'a fresh cycle', fixture: 'freshCycle', expect: MEMBER_WRITE },
        // Counts only what the caller sees.
        { route: 'cycles/[cycleId]/burn-up/route.ts', method: 'GET', key: 'cycles.view', subject: "a cycle's burn-up", expect: WS_READ },
        { route: 'work-item-types/route.ts', method: 'GET', key: 'projects.view', subject: 'the types', expect: WS_READ },
        { route: 'work-item-types/route.ts', method: 'POST', key: 'admin.manage', subject: 'a new type', body: (s) => ({ name: `Type ${s.seq}` }), expect: ADMIN },
        { route: 'work-item-types/[typeId]/route.ts', method: 'PATCH', key: 'admin.manage', subject: 'a type', body: () => ({ color: '#ff0000' }), expect: ADMIN },
        { route: 'work-item-types/question-preset/route.ts', method: 'POST', key: 'admin.manage', subject: 'the Question type', body: (s) => ({ name: `Question ${s.seq}` }), expect: ADMIN },
        { route: 'work-item-types/[typeId]/fields/route.ts', method: 'GET', key: 'projects.view', subject: "a type's built-in rules", expect: WS_READ },
        { route: 'work-item-types/[typeId]/fields/route.ts', method: 'PUT', key: 'admin.manage', subject: "a type's built-in rule", body: () => ({ field: 'startDate', requirement: 'OPTIONAL' }), expect: ADMIN },
        { route: 'labels/route.ts', method: 'GET', key: 'projects.view', subject: 'the labels', expect: WS_READ },
        { route: 'labels/route.ts', method: 'POST', key: 'admin.manage', subject: 'a new label', body: (s) => ({ name: `Label ${s.seq}` }), expect: ADMIN },
        { route: 'labels/[labelId]/route.ts', method: 'PATCH', key: 'admin.manage', subject: 'a label', body: () => ({ color: '#00ff00' }), expect: ADMIN },
        { route: 'labels/[labelId]/route.ts', method: 'DELETE', key: 'admin.manage', subject: 'a fresh label', fixture: 'freshLabel', expect: ADMIN },
        // Listed and used under projects.create (decision 71): the members who may create a project.
        { route: 'project-templates/route.ts', method: 'GET', key: 'projects.create', subject: 'the project templates', expect: c('ok', 'ok', 'ok', 'denied', g('denied'), 'ok', 'denied') },
        { route: 'project-templates/route.ts', method: 'POST', key: 'admin.manage', subject: 'a project saved as a template', body: (s) => ({ fromProjectId: s.projectId, name: `Saved ${s.seq}` }), expect: ADMIN },
        { route: 'project-templates/[templateId]/route.ts', method: 'PATCH', key: 'admin.manage', subject: 'a project template', params: (s) => ({ templateId: s.projectTemplateId }), body: () => ({ archived: false }), expect: ADMIN },
        { route: 'project-templates/[templateId]/route.ts', method: 'DELETE', key: 'admin.manage', subject: 'a fresh project template', fixture: 'freshProjectTemplate', expect: ADMIN },
        { route: 'recipient-lists/route.ts', method: 'GET', key: 'projects.view', subject: "the workspace's lists", expect: WS_READ },
        { route: 'recipient-lists/route.ts', method: 'POST', key: 'admin.manage', subject: 'a new workspace list', body: (s) => ({ name: `List ${s.seq}` }), expect: ADMIN },
        { route: 'recipient-lists/[listId]/route.ts', method: 'GET', key: 'projects.view', subject: 'a workspace list', params: (s) => ({ listId: s.workspaceListId }), expect: WS_READ },
        { route: 'recipient-lists/[listId]/route.ts', method: 'PATCH', key: 'admin.manage', subject: 'a workspace list', params: (s) => ({ listId: s.workspaceListId }), body: () => ({ description: 'Who signs off' }), expect: ADMIN },
        { route: 'recipient-lists/[listId]/members/route.ts', method: 'PUT', key: 'admin.manage', subject: 'a workspace list', params: (s) => ({ listId: s.workspaceListId }), body: (s) => ({ userIds: [s.annId] }), expect: ADMIN },
        { route: 'recipient-lists/[listId]/members/route.ts', method: 'PATCH', key: 'admin.manage', subject: 'a workspace list', params: (s) => ({ listId: s.workspaceListId }), body: (s) => ({ add: [s.raeId] }), expect: ADMIN },
        { route: 'recipient-lists/[listId]/archive/route.ts', method: 'POST', key: 'admin.manage', subject: 'a fresh workspace list', fixture: 'freshWorkspaceList', expect: ADMIN },
        { route: 'recipient-lists/[listId]/restore/route.ts', method: 'POST', key: 'admin.manage', subject: 'an archived workspace list', fixture: 'archivedWorkspaceList', expect: ADMIN },
        // The pickers' roster: every workspace-wide member reads it, names and emails; never a GUEST (decision 204).
        { route: 'users/assignable/route.ts', method: 'GET', key: 'work_items.view', subject: 'the member roster', expect: WS_READ },
        { route: 'search/route.ts', method: 'GET', key: 'projects.view', subject: 'a search matching a visible item', query: (s) => ({ q: s.searchTerm }), reveals: (s) => s.sharedItemId, expect: LIST },
        { route: 'views/route.ts', method: 'GET', key: 'views.view', subject: 'the saved views', reveals: (s) => s.viewId, expect: c('ok', 'ok', 'ok', 'ok', g('denied'), 'ok', 'ok') },
        {
            route: 'views/route.ts', method: 'POST', key: 'views.create', subject: 'a personal view',
            body: (s) => ({ name: `Mine ${s.seq}`, visibility: 'PERSONAL', config: { filters: {} } }),
            // Decision 60: a VIEWER saves its own personal views.
            expect: c('ok', 'ok', 'ok', 'ok', g('denied'), 'ok', 'ok'),
        },
        {
            route: 'views/route.ts', method: 'POST', key: 'views.create', subject: 'a shared view',
            body: (s) => ({ name: `Ours ${s.seq}`, visibility: 'SHARED', config: { filters: {} } }),
            // Decision 60: no views.share for a VIEWER; refused past the key, audited.
            expect: c('ok', 'ok', 'ok', 'refused', g('denied'), 'ok', 'refused'),
        },
        { route: 'views/[viewId]/route.ts', method: 'GET', key: 'views.view', subject: "another member's shared view", expect: c('ok', 'ok', 'ok', 'ok', g('denied'), 'ok', 'ok') },
        {
            route: 'views/[viewId]/route.ts', method: 'PATCH', key: 'views.edit', subject: "another member's shared view", body: () => ({ name: 'Renamed view' }),
            // Decision 59: only the creator changes a view; an admin never edits one.
            expect: c('refused', 'refused', 'refused', 'refused', g('denied'), 'refused', 'refused'),
        },
        { route: 'views/[viewId]/route.ts', method: 'PATCH', key: 'views.edit', subject: "the caller's own personal view", fixture: 'ownView', body: () => ({ name: 'Mine, renamed' }), expect: c('ok', 'ok', 'ok', 'ok', g('denied'), 'ok', 'ok') },
        {
            route: 'views/[viewId]/route.ts', method: 'DELETE', key: 'views.edit', subject: "another member's fresh shared view", fixture: 'freshSharedView',
            // An admin deletes a shared view (moderated); anyone else is refused.
            expect: c('ok', 'ok', 'refused', 'refused', g('denied'), 'refused', 'refused'),
        },
        { route: 'views/[viewId]/route.ts', method: 'DELETE', key: 'views.edit', subject: "the caller's own personal view", fixture: 'ownView', expect: c('ok', 'ok', 'ok', 'ok', g('denied'), 'ok', 'ok') },
    ],

    intake: [
        { route: 'intake/requests/route.ts', method: 'GET', key: 'intake.view', subject: 'the requests', reveals: (s) => s.requestId, expect: INTAKE },
        { route: 'intake/requests/count/route.ts', method: 'GET', key: 'intake.view', subject: 'the pending count', expect: INTAKE },
        { route: 'intake/requests/[requestId]/route.ts', method: 'GET', key: 'intake.view', subject: 'a request', expect: INTAKE },
        { route: 'intake/requests/[requestId]/route.ts', method: 'PATCH', key: 'intake.triage', subject: 'a fresh request', fixture: 'freshRequest', ifMatch: (s) => s.version, body: () => ({ title: 'Retitled' }), expect: INTAKE },
        // Accept also needs work_items.create (decision 92), which every intake.triage holder here has.
        { route: 'intake/requests/[requestId]/accept/route.ts', method: 'POST', key: 'intake.triage', subject: 'a fresh request', fixture: 'freshRequest', ifMatch: (s) => s.version, body: (s) => ({ typeId: s.typeId }), expect: INTAKE },
        { route: 'intake/requests/[requestId]/decline/route.ts', method: 'POST', key: 'intake.triage', subject: 'a fresh request', fixture: 'freshRequest', ifMatch: (s) => s.version, body: () => ({ reason: 'OTHER' }), expect: INTAKE },
        { route: 'intake/requests/[requestId]/merge/route.ts', method: 'POST', key: 'intake.triage', subject: 'a fresh request into a visible item', fixture: 'freshRequest', ifMatch: (s) => s.version, body: (s) => ({ workItemId: s.sharedItemId }), expect: INTAKE },
        { route: 'intake/requests/[requestId]/snooze/route.ts', method: 'POST', key: 'intake.triage', subject: 'a fresh request', fixture: 'freshRequest', ifMatch: (s) => s.version, body: () => ({ until: '2099-01-01' }), expect: INTAKE },
        { route: 'intake/requests/[requestId]/move/route.ts', method: 'POST', key: 'intake.triage', subject: 'a fresh request to another project with intake', fixture: 'freshRequest', ifMatch: (s) => s.version, body: (s) => ({ projectId: s.otherProjectId }), expect: INTAKE },
        { route: 'intake/requests/[requestId]/reopen/route.ts', method: 'POST', key: 'intake.triage', subject: 'a declined request', fixture: 'declinedRequest', ifMatch: (s) => s.version, expect: INTAKE },
        { route: 'intake/forms/route.ts', method: 'GET', key: 'intake.view', subject: 'the forms', reveals: (s) => s.formId, expect: INTAKE },
        { route: 'intake/forms/route.ts', method: 'POST', key: 'intake.manage', subject: 'a new form', body: (s) => ({ projectId: s.projectId, name: `Form ${s.seq}`, definition: { fields: [] } }), expect: ADMIN },
        { route: 'intake/forms/[formId]/route.ts', method: 'GET', key: 'intake.view', subject: 'a form', expect: INTAKE },
        { route: 'intake/forms/[formId]/route.ts', method: 'PATCH', key: 'intake.manage', subject: 'a fresh form', fixture: 'freshForm', ifMatch: (s) => s.version, body: (s) => ({ name: `Form renamed ${s.seq}` }), expect: ADMIN },
        // Sending through an open form takes projects.view: every member that sees the project (decision 92).
        { route: 'intake/forms/[formId]/requests/route.ts', method: 'POST', key: 'projects.view', subject: 'a request through an open form', body: (s) => ({ title: `via the matrix ${s.seq}`, answers: {} }), expect: READ },
        { route: 'intake/open-forms/route.ts', method: 'GET', key: 'projects.view', subject: 'the open forms', reveals: (s) => s.formId, expect: LIST },
        { route: 'intake/projects/route.ts', method: 'GET', key: 'intake.manage', subject: "every project's intake settings", expect: ADMIN },
        { route: 'intake/blocked-senders/route.ts', method: 'GET', key: 'intake.manage', subject: 'the blocked senders', expect: ADMIN },
        { route: 'intake/blocked-senders/route.ts', method: 'POST', key: 'intake.manage', subject: 'a new blocked sender', body: (s) => ({ email: `spam-${s.seq}@example.test`, projectId: s.projectId }), expect: ADMIN },
        { route: 'intake/blocked-senders/find/route.ts', method: 'POST', key: 'intake.manage', subject: 'a lookup by address', body: () => ({ email: 'spam@example.test' }), expect: ADMIN },
        { route: 'intake/blocked-senders/[blockedId]/route.ts', method: 'DELETE', key: 'intake.manage', subject: 'a fresh blocked sender', fixture: 'freshBlocked', expect: ADMIN },
    ],

    notifications: [
        // A member manages their own (2.7c): no key, the repository's user predicate.
        { route: 'notifications/route.ts', method: 'GET', key: null, subject: "the caller's bell", fixture: 'ownNotification', reveals: (s) => s.id, expect: SELF },
        // Another member's row is never the caller's: absent from the bell, and a change to it changes nothing (the repository's user predicate).
        { route: 'notifications/route.ts', method: 'GET', key: null, subject: "another member's notification, in the caller's bell", fixture: 'othersNotification', reveals: (s) => s.id, expect: c('empty', 'empty', 'empty', 'empty', g('empty'), 'empty', 'empty') },
        { route: 'notifications/route.ts', method: 'GET', key: null, subject: "the caller's Inbox", fixture: 'ownNotification', query: () => ({ view: 'all' }), reveals: (s) => s.id, expect: SELF },
        { route: 'notifications/stream/route.ts', method: 'GET', key: null, subject: "the caller's stream", expect: SELF },
        { route: 'notifications/[id]/route.ts', method: 'PUT', key: null, subject: "the caller's own notification", fixture: 'ownNotification', body: () => ({}), expect: SELF },
        { route: 'notifications/[id]/route.ts', method: 'PATCH', key: null, subject: "the caller's own notification", fixture: 'ownNotification', body: () => ({ read: true, done: true }), reveals: () => '"updated":1', expect: SELF },
        { route: 'notifications/[id]/route.ts', method: 'PATCH', key: null, subject: "another member's notification", fixture: 'othersNotification', body: () => ({ read: true, done: true }), reveals: () => '"updated":1', expect: c('empty', 'empty', 'empty', 'empty', g('empty'), 'empty', 'empty') },
        { route: 'notifications/bulk/route.ts', method: 'POST', key: null, subject: "the caller's notifications", body: () => ({ action: 'mark-all-read' }), expect: SELF },
        { route: 'notification-preferences/route.ts', method: 'GET', key: null, subject: "the caller's preferences", expect: SELF },
        { route: 'notification-preferences/route.ts', method: 'PUT', key: null, subject: "the caller's preferences", body: () => ({ rows: [{ type: 'WORK_ITEM_ASSIGNED', inApp: true, email: 'OFF' }] }), expect: SELF },
        // Roadmap 3.3b (decisions 234 and 235): a member's own calendar connection under work_items.view (Viewers
        // included, a read-only feed; a guest nothing, decision 204), keyed off the caller.
        { route: 'calendar-sync/connect/route.ts', method: 'POST', key: 'work_items.view', subject: "the caller's Google calendar connection", fixture: 'calendarSyncOn', query: () => ({ provider: 'google' }), expect: READ },
        { route: 'calendar-sync/connections/route.ts', method: 'GET', key: 'work_items.view', subject: "the caller's calendar connections", expect: READ },
        { route: 'calendar-sync/connections/route.ts', method: 'POST', key: 'work_items.view', subject: "the caller's own deleted Islestone calendar, recreated (3.3c)", fixture: 'ownRemovedCalendar', query: () => ({ provider: 'google' }), body: () => ({ action: 'recreate' }), expect: READ },
        { route: 'calendar-sync/connections/route.ts', method: 'DELETE', key: 'work_items.view', subject: "the caller's own calendar connection", fixture: 'ownCalendarConnection', query: () => ({ provider: 'google' }), expect: READ },
        // The workspace's switch and Microsoft's admin consent under integrations.manage: Owners and Admins (decision 234).
        { route: 'calendar-sync/settings/route.ts', method: 'GET', key: 'integrations.manage', subject: "the workspace's calendar sync settings", expect: ADMIN },
        { route: 'calendar-sync/settings/route.ts', method: 'PUT', key: 'integrations.manage', subject: "the workspace's calendar sync switch", fixture: 'calendarSyncOn', body: () => ({ syncEnabled: true }), expect: ADMIN },
        { route: 'calendar-sync/microsoft-consent/route.ts', method: 'POST', key: 'integrations.manage', subject: "Microsoft 365's admin consent, started", fixture: 'calendarSyncOn', expect: ADMIN },
        { route: 'calendar-sync/microsoft-consent/route.ts', method: 'DELETE', key: 'integrations.manage', subject: "Microsoft 365's admin consent, withdrawn", expect: ADMIN },
        { route: 'notification-settings/route.ts', method: 'GET', key: 'admin.manage', subject: "the workspace's notification settings", expect: ADMIN },
        { route: 'notification-settings/route.ts', method: 'PUT', key: 'admin.manage', subject: "the workspace's notification settings", body: () => ({ enabled: true }), expect: ADMIN },
        { route: 'notification-settings/run-job/route.ts', method: 'POST', key: 'admin.manage', subject: "the workspace's outbox", body: () => ({ jobType: 'processOutbox' }), expect: ADMIN },
    ],

    'admin-security': [
        { route: 'admin/invites/route.ts', method: 'GET', key: 'admin.members', subject: 'the pending invites', expect: ADMIN },
        { route: 'admin/invites/route.ts', method: 'POST', key: 'admin.members', subject: 'a new invite', body: (s) => ({ email: `invitee-${s.seq}@example.test`, role: 'MEMBER' }), expect: ADMIN },
        { route: 'admin/invites/[inviteId]/route.ts', method: 'DELETE', key: 'admin.members', subject: 'a fresh invite', fixture: 'freshInvite', expect: ADMIN },
        { route: 'admin/members/route.ts', method: 'GET', key: 'admin.members', subject: 'the members', expect: ADMIN },
        { route: 'admin/members/route.ts', method: 'POST', key: 'admin.members', subject: 'a new invite from the members page', body: (s) => ({ email: `member-${s.seq}@example.test`, role: 'VIEWER' }), expect: ADMIN },
        { route: 'admin/members/[membershipId]/route.ts', method: 'PATCH', key: 'admin.members', subject: "a fresh member's role", fixture: 'freshMember', body: () => ({ role: 'VIEWER' }), expect: ADMIN },
        { route: 'admin/members/[membershipId]/route.ts', method: 'DELETE', key: 'admin.members', subject: 'a fresh member', fixture: 'freshMember', expect: ADMIN },
        { route: 'admin/members/[membershipId]/deactivate/route.ts', method: 'POST', key: 'admin.members', subject: 'a fresh member', fixture: 'freshMember', expect: ADMIN },
        { route: 'admin/roles/route.ts', method: 'GET', key: 'admin.manage', subject: 'the custom roles', expect: ADMIN },
        { route: 'admin/roles/route.ts', method: 'POST', key: 'admin.manage', subject: 'a new custom role', body: (s) => ({ name: `Role ${s.seq}`, baseRole: 'VIEWER', grantsJson: JSON.parse(s.viewerGrants) as unknown }), expect: ADMIN },
        { route: 'admin/roles/[roleId]/route.ts', method: 'PATCH', key: 'admin.manage', subject: 'a fresh custom role', fixture: 'freshCustomRole', body: () => ({ description: 'Changed by the matrix' }), expect: ADMIN },
        { route: 'admin/roles/[roleId]/route.ts', method: 'DELETE', key: 'admin.manage', subject: 'a fresh custom role', fixture: 'freshCustomRole', expect: ADMIN },
        { route: 'admin/search-index/rebuild/route.ts', method: 'POST', key: 'admin.manage', subject: 'a forced rebuild', expect: ADMIN },
        { route: 'admin/security-settings/route.ts', method: 'GET', key: 'admin.manage', subject: "the workspace's security settings", expect: ADMIN },
        { route: 'admin/security-settings/route.ts', method: 'PUT', key: 'admin.manage', subject: "the workspace's security settings", body: () => ({ mfaFailClosed: false }), expect: ADMIN },
        { route: 'admin/sessions/route.ts', method: 'GET', key: 'admin.members', subject: "the workspace's sessions", expect: ADMIN },
        { route: 'admin/sessions/route.ts', method: 'DELETE', key: 'admin.members', subject: "a member's session", fixture: 'memberSession', body: (s) => ({ sessionId: s.sessionId }), expect: ADMIN },
        { route: 'admin/settings/route.ts', method: 'GET', key: 'admin.manage', subject: "the workspace's settings", expect: ADMIN },
        { route: 'admin/key-rotation/route.ts', method: 'POST', key: 'admin.tenant_lifecycle', subject: 'a master-key rotation', expect: OWNER_ONLY },
        { route: 'admin/key-rotation/route.ts', method: 'GET', key: 'admin.tenant_lifecycle', subject: "a rotation job's status", fixture: 'keyRotationJob', query: (s) => ({ jobId: s.jobId }), expect: OWNER_ONLY },
        { route: 'admin/tenant-dek-rotation/route.ts', method: 'GET', key: 'admin.tenant_lifecycle', subject: "a DEK rotation job's status", fixture: 'dekRotationJob', query: (s) => ({ jobId: s.jobId }), expect: OWNER_ONLY },
        // Last in the file: an OWNER's call rotates the workspace's DEK.
        { route: 'admin/tenant-dek-rotation/route.ts', method: 'POST', key: 'admin.tenant_lifecycle', subject: "the workspace's DEK", expect: OWNER_ONLY },
        { route: 'security/mfa/policy/route.ts', method: 'GET', key: null, subject: "the workspace's MFA policy", expect: SELF },
        { route: 'security/mfa/policy/route.ts', method: 'PUT', key: 'admin.manage', subject: "the workspace's MFA policy", body: () => ({ mfaPolicy: 'OPTIONAL' }), expect: ADMIN },
        { route: 'security/mfa/enroll/route.ts', method: 'GET', key: null, subject: "the caller's MFA status", expect: SELF },
        { route: 'security/mfa/enroll/start/route.ts', method: 'POST', key: null, subject: "the caller's enrolment", expect: SELF },
        { route: 'security/mfa/enroll/verify/route.ts', method: 'POST', key: null, subject: "the caller's enrolment, a wrong code", fixture: 'ownMfaEnrollment', body: () => ({ code: '000000' }), expect: SELF },
        { route: 'security/mfa/enroll/route.ts', method: 'DELETE', key: null, subject: "the caller's own enrolment", fixture: 'ownMfaEnrollment', expect: SELF },
        {
            route: 'security/mfa/enroll/route.ts', method: 'DELETE', key: null, subject: "another member's enrolment", fixture: 'annMfaEnrollment', body: (s) => ({ targetUserId: s.annId }),
            // An admin resets a member's second factor; anyone else is refused.
            refusedAudit: false,
            expect: c('ok', 'ok', 'refused', 'refused', g('refused'), 'refused', 'refused'),
        },
        { route: 'security/mfa/challenge/verify/route.ts', method: 'POST', key: null, subject: "the caller's challenge, a wrong code", fixture: 'ownVerifiedMfa', body: () => ({ code: '000000' }), expect: SELF },
        { route: 'security/sessions/revoke-current/route.ts', method: 'POST', key: null, subject: "the caller's other sessions", expect: SELF },
        { route: 'security/sessions/revoke-all/route.ts', method: 'POST', key: 'admin.members', subject: "every member's sessions", expect: ADMIN },
        { route: 'security/sessions/revoke-user/route.ts', method: 'POST', key: 'admin.members', subject: "a member's sessions", body: (s) => ({ targetUserId: s.annId }), expect: ADMIN },
    ],

    // Sub-phase 3.4b (decisions 265 to 267 and 278): time.track records one's own time; nothing rides on
    // work_items.edit, so the narrowed member records time and a Viewer does not.
    time: [
        { route: 'time-entries/route.ts', method: 'GET', key: 'time.track', subject: "the caller's own week", query: (s) => ({ week: day(Number(s.seq)) }), expect: TRACK },
        {
            route: 'time-entries/route.ts', method: 'GET', key: 'time.track', subject: "another member's week (decision 266: time.approve)",
            query: (s) => ({ week: day(Number(s.seq)), userId: s.annId }),
            expect: c('ok', 'ok', 'refused', 'denied', g('denied'), 'refused', 'denied'),
        },
        {
            route: 'time-entries/route.ts', method: 'POST', key: 'time.track', subject: 'time added to a visible item',
            body: (s) => ({ workItemId: s.sharedItemId, workDate: day(Number(s.seq)), minutes: 15 }), expect: TRACK,
        },
        {
            route: 'time-entries/route.ts', method: 'POST', key: 'time.track', subject: 'time added to an item in an archived project (decision 261)',
            body: (s) => ({ workItemId: s.archivedItemId, workDate: day(Number(s.seq)), minutes: 15 }),
            expect: c('archived', 'archived', 'archived', 'denied', g('denied'), 'archived', 'denied'),
        },
        { route: 'time-entries/[timeEntryId]/route.ts', method: 'PATCH', key: 'time.track', subject: "the caller's own entry", fixture: 'ownTimeEntry', body: () => ({ minutes: 20 }), expect: TRACK },
        {
            route: 'time-entries/[timeEntryId]/route.ts', method: 'PATCH', key: 'time.track', subject: "another member's entry (decision 267: a 404)", fixture: 'othersTimeEntry', body: () => ({ minutes: 20 }),
            expect: c('hidden', 'hidden', 'hidden', 'denied', g('denied'), 'hidden', 'denied'),
        },
        { route: 'time-entries/[timeEntryId]/route.ts', method: 'DELETE', key: 'time.track', subject: "the caller's own entry", fixture: 'ownTimeEntry', expect: TRACK },
        {
            route: 'time-entries/[timeEntryId]/route.ts', method: 'DELETE', key: 'time.track', subject: "another member's entry (decision 267: a 404)", fixture: 'othersTimeEntry',
            expect: c('hidden', 'hidden', 'hidden', 'denied', g('denied'), 'hidden', 'denied'),
        },
        { route: 'time-entries/timer/route.ts', method: 'GET', key: 'time.track', subject: "the caller's running timer", fixture: 'ownTimer', expect: TRACK },
        { route: 'time-entries/timer/route.ts', method: 'POST', key: 'time.track', subject: 'a timer started on a visible item', body: (s) => ({ workItemId: s.sharedItemId, timeZone: 'Europe/Sofia' }), expect: TRACK },
        { route: 'time-entries/timer/stop/route.ts', method: 'POST', key: 'time.track', subject: "the caller's running timer, stopped", fixture: 'ownTimer', body: () => ({}), expect: TRACK },
        // An item's time (decision 266): read under work_items.view; time.view (every built-in role but a guest) or time.track.
        { route: `${W}/time/route.ts`, method: 'GET', key: 'work_items.view', subject: "an item's time", expect: READ },
        // Sub-phase 3.4c (decisions 256, 266, 268 to 270): the settings read under time.view, changed under
        // admin.manage; a person submits and takes back their own week (time.track); time.approve decides a
        // member's week, never one's own (refused past the key, audited).
        { route: 'time-settings/route.ts', method: 'GET', key: 'time.view', subject: 'the time tracking settings', expect: READ },
        { route: 'time-settings/route.ts', method: 'PUT', key: 'admin.manage', subject: 'approval turned on', body: () => ({ approvalRequired: true }), expect: ADMIN },
        { route: 'timesheets/route.ts', method: 'GET', key: 'time.approve', subject: 'the weeks waiting for a decision', fixture: 'annSubmittedTimesheet', reveals: (s) => s.timesheetId, expect: APPROVE },
        { route: 'timesheets/route.ts', method: 'POST', key: 'time.track', subject: "the caller's own past week, submitted", fixture: 'approvalOn', body: (s) => ({ week: pastWeek(n(s)) }), expect: TRACK },
        { route: 'timesheets/week/route.ts', method: 'GET', key: 'time.track', subject: "the caller's own week's status", query: (s) => ({ week: pastWeek(n(s)) }), expect: TRACK },
        {
            route: 'timesheets/week/route.ts', method: 'GET', key: 'time.track', subject: "another member's week's status (decision 266: time.approve)",
            query: (s) => ({ week: pastWeek(n(s)), userId: s.annId }),
            expect: c('ok', 'ok', 'refused', 'denied', g('denied'), 'refused', 'denied'),
        },
        { route: 'timesheets/[timesheetId]/route.ts', method: 'GET', key: 'time.approve', subject: "a member's submitted week", fixture: 'annSubmittedTimesheet', expect: APPROVE },
        { route: 'timesheets/[timesheetId]/withdraw/route.ts', method: 'POST', key: 'time.track', subject: "the caller's own submitted week, taken back", fixture: 'ownSubmittedTimesheet', expect: TRACK },
        {
            route: 'timesheets/[timesheetId]/withdraw/route.ts', method: 'POST', key: 'time.track', subject: "another member's submitted week (a 404)", fixture: 'annSubmittedTimesheet',
            expect: c('hidden', 'hidden', 'hidden', 'denied', g('denied'), 'hidden', 'denied'),
        },
        { route: 'timesheets/[timesheetId]/approve/route.ts', method: 'POST', key: 'time.approve', subject: "a member's submitted week, approved", fixture: 'annSubmittedTimesheet', expect: APPROVE },
        {
            route: 'timesheets/[timesheetId]/approve/route.ts', method: 'POST', key: 'time.approve', subject: "the caller's own submitted week (decision 269: never one's own)", fixture: 'ownSubmittedTimesheet',
            expect: c('refused', 'refused', 'denied', 'denied', g('denied'), 'denied', 'denied'),
        },
        {
            route: 'timesheets/[timesheetId]/return/route.ts', method: 'POST', key: 'time.approve', subject: "a member's submitted week, returned", fixture: 'annSubmittedTimesheet',
            body: () => ({ explanation: 'Monday is missing.' }), expect: APPROVE,
        },
        {
            route: 'timesheets/[timesheetId]/reopen/route.ts', method: 'POST', key: 'time.approve', subject: "a member's approved week, reopened", fixture: 'annApprovedTimesheet',
            body: () => ({ explanation: 'Wrong project on Tuesday.' }), expect: APPROVE,
        },
        // Sub-phase 3.4d (decisions 271 to 275): money under time.rates (OWNER and ADMIN); Time totals and the
        // export under time.view (every workspace-wide role), amounts in them only for time.rates.
        { route: 'billable-rates/route.ts', method: 'GET', key: 'time.rates', subject: "every rate of the workspace and its currency", expect: RATES },
        {
            route: 'billable-rates/workspace/route.ts', method: 'PUT', key: 'time.rates', subject: "the workspace's rate from a date", fixture: 'currencySet',
            body: (s) => ({ effectiveFrom: day(n(s)), hourlyRateMinor: 10_000 }), expect: RATES,
        },
        { route: 'billable-rates/[rateId]/route.ts', method: 'DELETE', key: 'time.rates', subject: 'a rate whose date has not come, removed', fixture: 'futureRate', expect: RATES },
        {
            route: 'projects/[projectId]/billable-rates/route.ts', method: 'PUT', key: 'time.rates', subject: "a visible project's rate from a date", fixture: 'currencySet',
            body: (s) => ({ effectiveFrom: day(n(s)), hourlyRateMinor: 15_000 }), expect: RATES,
        },
        {
            route: 'projects/[projectId]/billable-default/route.ts', method: 'PUT', key: 'time.rates', subject: "a visible project's new time made billable by default",
            body: () => ({ billableByDefault: true }), expect: RATES,
        },
        {
            route: 'members/[userId]/billable-rates/route.ts', method: 'PUT', key: 'time.rates', subject: "an active member's rate from a date", fixture: 'currencySet',
            params: (s) => ({ userId: s.annId! }), body: (s) => ({ effectiveFrom: day(n(s)), hourlyRateMinor: 9_000 }), expect: RATES,
        },
        { route: 'time-totals/route.ts', method: 'GET', key: 'time.view', subject: 'the totals of a month, by project', query: () => ({ from: day(0), to: day(27), groupBy: 'project' }), expect: READ },
        { route: 'time-totals/export/route.ts', method: 'GET', key: 'time.view', subject: 'the entries of a month as CSV', query: () => ({ from: day(0), to: day(27), format: 'csv' }), expect: READ },
    ],

    // Sub-phase 3.5a (decisions 284 to 300): workload.view and workload.time_off for every built-in role but a
    // guest (a Viewer records its own time off, decision 298), workload.manage for Owners and Admins. The
    // time-off type (decision 287) is in a response only for the person and workload.manage: `reveals` is the
    // JSON key, so `empty` asserts the key's absence.
    workload: [
        { route: 'workload/route.ts', method: 'GET', key: 'workload.view', subject: 'capacity per person per week', reveals: (s) => s.annId!, expect: WORKLOAD },
        {
            route: 'workload/cell/route.ts', method: 'GET', key: 'workload.view', subject: "the items that fill a member's week (3.5b); never a type",
            query: (s) => ({ userId: s.annId!, week: nextWeekMonday() }), reveals: (s) => s.annId!, expect: WORKLOAD,
        },
        {
            // Sub-phase 3.5c (decision 299): the ways to rebalance an over-capacity week are worked out for a
            // person who could make the write (`work_items.assign` or `work_items.edit`); a Viewer and the
            // widened viewer read the week without them. `reveals` is an "Assign to" option's key.
            route: 'workload/cell/route.ts', method: 'GET', key: 'workload.view', subject: "an over-capacity week's ways to rebalance (3.5c)", fixture: 'annOverWeek',
            query: (s) => ({ userId: s.annId!, week: nextWeekMonday() }), reveals: () => '"assignTo":[{', expect: REBALANCE,
        },
        { route: 'workload/members/route.ts', method: 'GET', key: 'workload.manage', subject: "Settings → Workload's members", expect: WORKLOAD_MANAGE },
        { route: 'workload-settings/route.ts', method: 'GET', key: 'workload.view', subject: 'the default weekly capacity', expect: WORKLOAD },
        { route: 'workload-settings/route.ts', method: 'PUT', key: 'workload.manage', subject: 'the default weekly capacity, changed', body: () => ({ defaultWeeklyMinutes: 2400 }), expect: WORKLOAD_MANAGE },
        { route: 'members/[userId]/capacity/route.ts', method: 'GET', key: 'workload.view', subject: "a member's capacity rows", params: (s) => ({ userId: s.annId! }), expect: WORKLOAD },
        {
            route: 'members/[userId]/capacity/route.ts', method: 'PUT', key: 'workload.manage', subject: "a member's capacity from a Monday",
            params: (s) => ({ userId: s.annId! }), body: (s) => ({ effectiveFrom: monday(Number(s.seq)), weeklyMinutes: 1800, calendarTeamId: null }), expect: WORKLOAD_MANAGE,
        },
        { route: 'members/[userId]/capacity/[capacityId]/route.ts', method: 'DELETE', key: 'workload.manage', subject: 'a future capacity change, removed', fixture: 'futureCapacity', expect: WORKLOAD_MANAGE },
        {
            route: 'time-off/route.ts', method: 'GET', key: 'workload.view', subject: "the caller's own time off, with its type", fixture: 'ownTimeOff',
            query: (s) => ({ from: s.timeOffDay!, to: s.timeOffDay! }), reveals: () => '"type":', expect: WORKLOAD,
        },
        {
            route: 'time-off/route.ts', method: 'GET', key: 'workload.view', subject: "another member's time off: the type only for workload.manage (decision 287)", fixture: 'annTimeOff',
            query: (s) => ({ from: s.timeOffDay!, to: s.timeOffDay!, userId: s.timeOffUserId! }), reveals: () => '"type":', expect: OTHERS_TYPE,
        },
        {
            route: 'time-off/days/route.ts', method: 'PUT', key: 'workload.time_off', subject: "the caller's own time off, recorded",
            body: (s) => ({ days: [{ day: day(Number(s.seq)), minutes: null, type: 'VACATION' }] }), expect: WORKLOAD,
        },
        {
            route: 'time-off/days/route.ts', method: 'PUT', key: 'workload.time_off', subject: "another member's time off, recorded (decision 288: workload.manage)",
            body: (s) => ({ userId: s.annId, days: [{ day: day(Number(s.seq)), minutes: 120, type: 'OTHER' }] }), expect: OTHERS_TIME_OFF,
        },
        {
            route: 'time-off/days/remove/route.ts', method: 'POST', key: 'workload.time_off', subject: "the caller's own time off, removed", fixture: 'ownTimeOff',
            body: (s) => ({ days: [{ day: s.timeOffDay, version: 1 }] }), expect: WORKLOAD,
        },
        {
            route: 'time-off/days/remove/route.ts', method: 'POST', key: 'workload.time_off', subject: "another member's time off, removed (decision 288: workload.manage)", fixture: 'annTimeOff',
            body: (s) => ({ userId: s.timeOffUserId, days: [{ day: s.timeOffDay, version: 1 }] }), expect: OTHERS_TIME_OFF,
        },
    ],

    // Sub-phases 3.6a and 3.6b (decisions 329 to 331): the analytics reads over the transition record, analytics.view for
    // every built-in role but a guest; each reads only the projects the caller sees.
    analytics: [
        { route: 'analytics/counts/route.ts', method: 'GET', key: 'analytics.view', subject: 'open, started, done and created counts', query: () => ({ from: '2026-01-05', to: '2026-03-01' }), expect: ANALYTICS },
        {
            route: 'analytics/throughput/route.ts', method: 'GET', key: 'analytics.view', subject: 'throughput per week',
            query: () => ({ from: '2026-01-05', to: '2026-03-01', bin: 'week' }), expect: ANALYTICS,
        },
        {
            route: 'analytics/durations/route.ts', method: 'GET', key: 'analytics.view', subject: 'cycle time with age',
            query: () => ({ from: '2026-01-05', to: '2026-03-01', measure: 'cycle' }), expect: ANALYTICS,
        },
        {
            route: 'analytics/flow/route.ts', method: 'GET', key: 'analytics.view', subject: 'cumulative flow and the burn-up',
            query: () => ({ from: '2026-01-05', to: '2026-03-01', burnUp: '1' }), expect: ANALYTICS,
        },
        // Sub-phase 3.6b (decisions 317, 329, 332 and 335): time waiting. Every reader gets its own row; other
        // people's rows and the totals only with analytics.people.
        {
            route: 'analytics/waiting/route.ts', method: 'GET', key: 'analytics.view', subject: "time waiting: the caller's own row",
            query: () => ({ from: '2026-01-05', to: '2026-03-01' }), reveals: () => '"self":', expect: ANALYTICS,
        },
        {
            route: 'analytics/waiting/route.ts', method: 'GET', key: 'analytics.view', subject: "time waiting: other people's rows (decision 329: analytics.people)",
            query: () => ({ from: '2026-01-05', to: '2026-03-01' }), reveals: () => '"people":', expect: ANALYTICS_PEOPLE,
        },
        {
            route: 'analytics/waiting/route.ts', method: 'GET', key: 'analytics.view', subject: 'time waiting: the totals (decision 335: analytics.people, in any scope)',
            query: () => ({ from: '2026-01-05', to: '2026-03-01' }), reveals: () => '"totals":', expect: ANALYTICS_PEOPLE,
        },
        // Sub-phase 3.6c (decisions 318 to 325): the forecast, the same key; a refusal is a 200 too.
        {
            route: 'analytics/forecast/route.ts', method: 'GET', key: 'analytics.view', subject: 'a forecast of open items',
            query: () => ({ historyWeeks: '12', share: '100' }), expect: ANALYTICS,
        },
        // Sub-phase 3.6d (decisions 326 to 329): dashboards, every route under analytics.view; analytics.share for a
        // shared one and the creator alone to change one, both decided (and audited) by the usecase.
        { route: 'dashboards/route.ts', method: 'GET', key: 'analytics.view', subject: "the caller's dashboards and every shared one", reveals: (s) => s.dashboardId, expect: ANALYTICS },
        { route: 'dashboards/route.ts', method: 'POST', key: 'analytics.view', subject: 'a personal dashboard', body: () => ({ name: 'My dashboard', visibility: 'PERSONAL' }), expect: ANALYTICS },
        {
            route: 'dashboards/route.ts', method: 'POST', key: 'analytics.view', subject: 'a shared dashboard (decision 329: analytics.share)',
            body: () => ({ name: 'Team dashboard', visibility: 'SHARED', widgets: [ONE_WIDGET] }), expect: ANALYTICS_SHARE,
        },
        { route: 'dashboards/[dashboardId]/route.ts', method: 'GET', key: 'analytics.view', subject: "another member's shared dashboard", expect: ANALYTICS },
        { route: 'dashboards/[dashboardId]/route.ts', method: 'GET', key: 'analytics.view', subject: "the caller's own personal dashboard", fixture: 'ownDashboard', expect: ANALYTICS },
        {
            route: 'dashboards/[dashboardId]/route.ts', method: 'PATCH', key: 'analytics.view', subject: "another member's shared dashboard (decision 326: its creator only)",
            body: () => ({ name: 'Renamed' }), expect: DASHBOARD_CREATOR_ONLY,
        },
        {
            route: 'dashboards/[dashboardId]/route.ts', method: 'PATCH', key: 'analytics.view', subject: "the caller's own personal dashboard", fixture: 'ownDashboard',
            body: () => ({ name: 'Mine, renamed' }), ifMatch: (s) => s.version!, expect: ANALYTICS,
        },
        {
            route: 'dashboards/[dashboardId]/widgets/route.ts', method: 'PUT', key: 'analytics.view', subject: "the caller's own personal dashboard's widgets", fixture: 'ownDashboard',
            body: () => ({ widgets: [ONE_WIDGET] }), ifMatch: (s) => s.version!, expect: ANALYTICS,
        },
        {
            route: 'dashboards/[dashboardId]/widgets/route.ts', method: 'PUT', key: 'analytics.view', subject: "another member's shared dashboard's widgets (decision 326: its creator only)", fixture: 'freshSharedDashboard',
            body: () => ({ widgets: [ONE_WIDGET] }), ifMatch: (s) => s.version!, expect: DASHBOARD_CREATOR_ONLY,
        },
        {
            route: 'dashboards/[dashboardId]/route.ts', method: 'DELETE', key: 'analytics.view', subject: "another member's fresh shared dashboard (decision 326: an Owner or Admin moderates)", fixture: 'freshSharedDashboard',
            expect: DASHBOARD_MODERATE,
        },
        { route: 'dashboards/[dashboardId]/route.ts', method: 'DELETE', key: 'analytics.view', subject: "the caller's own personal dashboard", fixture: 'ownDashboard', expect: ANALYTICS },
    ],
    // Sub-phase 4.1a (decision 339): pages.view for every workspace-wide role (decision 342: a page is readable
    // exactly when its tree is); pages.create, edit and delete for Owners, Admins and Members, so the narrowed member
    // keeps them (its base is MEMBER) and the widened viewer has none (its base is VIEWER). A GUEST holds no key (204).
    pages: [
        { route: 'pages/route.ts', method: 'GET', key: 'pages.view', subject: "the workspace's tree", query: () => ({ scope: 'workspace' }), reveals: (s) => s.pageId, expect: WS_READ },
        { route: 'pages/route.ts', method: 'GET', key: 'pages.view', subject: "a project's tree", query: (s) => ({ projectId: s.projectId }), reveals: (s) => s.projectPageId, expect: READ },
        { route: 'pages/route.ts', method: 'POST', key: 'pages.create', subject: 'a new workspace page', body: (s) => ({ projectId: null, title: `Page ${s.seq}` }), expect: MEMBER_WRITE },
        {
            route: 'pages/route.ts', method: 'POST', key: 'pages.create', subject: 'a new page in an archived project',
            body: (s) => ({ projectId: s.archivedProjectId, title: `Archived ${s.seq}` }),
            refusedAudit: false,
            expect: c('archived', 'archived', 'archived', 'denied', g('denied'), 'archived', 'denied'),
        },
        { route: 'pages/search/route.ts', method: 'GET', key: 'pages.view', subject: 'pages by title', query: () => ({ q: 'zebra' }), reveals: (s) => s.pageId, expect: WS_READ },
        { route: 'pages/deleted/route.ts', method: 'GET', key: 'pages.delete', subject: "the workspace tree's Deleted list", query: () => ({ scope: 'workspace' }), expect: MEMBER_WRITE },
        { route: 'pages/[pageId]/route.ts', method: 'GET', key: 'pages.view', subject: 'a workspace page', expect: WS_READ },
        { route: 'pages/[pageId]/route.ts', method: 'PATCH', key: 'pages.edit', subject: 'a fresh page', fixture: 'freshPage', ifMatch: (s) => s.version!, body: (s) => ({ title: `Renamed ${s.seq}` }), expect: MEMBER_WRITE },
        { route: 'pages/[pageId]/route.ts', method: 'DELETE', key: 'pages.delete', subject: 'a fresh page', fixture: 'freshPage', expect: MEMBER_WRITE },
        { route: 'pages/[pageId]/move/route.ts', method: 'POST', key: 'pages.edit', subject: 'a fresh page', fixture: 'freshPage', body: (s) => ({ projectId: s.projectId, parentId: null }), expect: MEMBER_WRITE },
        { route: 'pages/[pageId]/restore/route.ts', method: 'POST', key: 'pages.delete', subject: 'a fresh deleted page', fixture: 'deletedPage', expect: MEMBER_WRITE },
    ],
};

export const ALL_ROWS: readonly (MatrixRow & { root: MatrixRoot })[] = (Object.keys(MATRIX) as MatrixRoot[]).flatMap((root) => MATRIX[root].map((r) => ({ ...r, root })));

// ─── The population and the guest tripwire (pure; the guard runs them) ───

export const TENANT_API_ROOT = 'src/app/api/t/[tenantSlug]/';

/** The exported HTTP methods of a route file's source. */
export function exportedMethods(source: string): Method[] {
    // Comments do not export anything (a line comment, a block comment; route files hold no URL strings at line start).
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return METHODS.filter((m) => new RegExp(`export\\s+(?:const\\s+${m}\\b|(?:async\\s+)?function\\s+${m}\\b)`).test(code));
}

/**
 * Compare the routes on disk with the table. `files` maps a repo-relative
 * `route.ts` path under {@link TENANT_API_ROOT} to its source. Returns the
 * route-method pairs with no row and the rows naming nothing on disk.
 */
export function populationGaps(files: ReadonlyMap<string, string>, rows: readonly Pick<MatrixRow, 'route' | 'method'>[]): { missing: string[]; stale: string[] } {
    const onDisk = new Set<string>();
    for (const [file, source] of files) {
        if (!file.startsWith(TENANT_API_ROOT) || !file.endsWith('/route.ts')) continue;
        const route = file.slice(TENANT_API_ROOT.length);
        for (const m of exportedMethods(source)) onDisk.add(`${m} ${route}`);
    }
    const inTable = new Set(rows.map((r) => `${r.method} ${r.route}`));
    return {
        missing: [...onDisk].filter((k) => !inTable.has(k)).sort(),
        stale: [...inTable].filter((k) => !onDisk.has(k)).sort(),
    };
}

/** What the code says about guests today (read by the guard from the real modules). */
export interface GuestRuleState {
    /** `resolveProjectVisibility` for a GUEST: `GRANTED` with no project. */
    readonly guestSeesNoProject: boolean;
    /** `ASSIGNABLE_TENANT_ROLES` leaves GUEST out. */
    readonly guestUnassignable: boolean;
    /**
     * Decision 204: a GUEST holds no permission key (`getPermissionsForRole('GUEST')`, and a GUEST
     * membership carrying a custom role through `permissionsForMembership`), stays GUEST on the
     * coarse ladder whatever custom role it carries, and its coarse tier is read-only (the
     * self-service routes ask `canRead` and no key).
     */
    readonly guestHoldsNothing: boolean;
    /** The fingerprint of the visibility rule's code ({@link PRE_8_4_VISIBILITY_SHA}). */
    readonly visibilitySourceSha: string;
}

/** A GUEST cell as the tripwire reads it: the row's name, its route key (null: key-free, self-service) and the cell. */
export interface GuestCellEntry {
    readonly name: string;
    readonly key: string | null;
    readonly cell: Cell;
}

/**
 * The guest tripwire (decisions 176 and 204). While every signal says guests
 * are as they were before 8.4, every GUEST cell must carry the `until: '8.4'`
 * tag, and a tagged cell on a keyed row must be `denied` (a guest holds no
 * key, so `requirePermission` refuses it, audited). Once 8.4 changes any
 * signal (a guest given projects or a key, the role made assignable, the
 * visibility functions rewritten), every tagged cell is a failure until it is
 * rewritten for the new rule and its tag removed.
 */
export function guestTripwire(state: GuestRuleState, pinnedSha: string, cells: readonly GuestCellEntry[]): string[] {
    const arrived = !state.guestSeesNoProject || !state.guestUnassignable || !state.guestHoldsNothing || state.visibilitySourceSha !== pinnedSha;
    if (arrived) {
        return cells
            .filter((x) => isTaggedGuestCell(x.cell))
            .map((x) => `${x.name}: the GUEST cell is tagged until 8.4, and guests' rule has changed (project visibility, permission keys, assignability or the visibility functions). Rewrite the cell for the new rule and remove its tag.`);
    }
    return [
        ...cells
            .filter((x) => !isTaggedGuestCell(x.cell))
            .map((x) => `${x.name}: a GUEST cell must be tagged until 8.4 (g(...)) while a guest sees no project (decision 176).`),
        ...cells
            .filter((x) => isTaggedGuestCell(x.cell) && x.key !== null && outcomeOf(x.cell) !== 'denied')
            .map((x) => `${x.name}: a guest holds no key until 8.4 (decision 204), so its cell on a route keyed \`${x.key}\` must be denied.`),
    ];
}

/**
 * The fingerprint of the pre-8.4 guest rule: the sha256 of
 * `ALL_PROJECT_ROLES`, `visibleProjects` and `resolveProjectVisibility` in
 * `src/app-layer/policies/project-visibility.ts`, comments dropped and
 * whitespace collapsed (`visibilityFingerprint` in the guard). 8.4 reads the
 * grant table there ("Takes the transaction client so 8.4 can read the grant
 * table here"), so its change trips every tagged guest cell. Never update
 * this value without rewriting the guest cells: it is the tripwire. (What a
 * guest HOLDS is the `guestHoldsNothing` signal, read from the running
 * permission code, not hashed.)
 */
export const PRE_8_4_VISIBILITY_SHA = '639c2f460d458db8e1b353b07a987b28fc80ddd7320bedbf7bbd624f1f329966';
