/**
 * Job Schedules — BullMQ Repeatable Job Definitions
 *
 * Defines the cron patterns and repeatable options for every scheduled job.
 * These are registered once by `scripts/scheduler.ts` and then BullMQ
 * automatically enqueues jobs at the specified cadence.
 *
 * Schedule semantics:
 *   - health-check:              every 2 min (drives the worker heartbeat)
 *   - notification-outbox-flush: every 10 min (drain the email outbox)
 *   - audit-outbox-flush:        every 5 min (replay queued audit entries onto the chain)
 *   - cycle-rollover:            00:10 in NOTIFICATIONS_TZ (close ended cycles; 2.5a)
 *   - intake-snooze-wake:        08:00 in NOTIFICATIONS_TZ (snoozed requests come back; 2.6a)
 *   - intake-purge:              02:50 UTC (decided requests past retention; 2.6a)
 *   - work-item-recurrence:      00:30 in NOTIFICATIONS_TZ (make due repeats; 2.5d)
 *   - calendar-sync-dispatch:    every 15 min (calendar sync runs and teardowns; 3.3b)
 *
 * The two key rotations (`key-rotation`, `tenant-dek-rotation`) are started by
 * an operator through their admin routes and have no schedule.
 *
 * Times are UTC unless the entry sets a `tz`. BullMQ uses standard
 * cron syntax and evaluates the `pattern` in `tz` when supplied.
 *
 * Idempotency: do NOT rely on BullMQ's deterministic-jobId dedupe as the
 * exactly-once guarantee. `queue.ts` sets `removeOnComplete: 500`, so once a
 * completed job is evicted from the retained set its jobId is reusable and the
 * same logical occurrence CAN be enqueued twice — jobId dedupe holds only
 * WITHIN the retention window. Every job whose double-fire would be visible is
 * instead made durably idempotent at the work layer (e.g. the per-day
 * `dedupeKey` unique index on notification outbox rows, the conditional
 * `updateMany` claims in the schedulers). Any new scheduled job that must never
 * double-fire MUST carry its own durable idempotency key, not lean on the jobId.
 *
 * Copied from inflect-compliance `src/app-layer/jobs/schedules.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, with three of its entries
 * (`audit-outbox-flush` since sub-phase 1.5b).
 *
 * @module app-layer/jobs/schedules
 */
import { env } from '@/env';

import type { JobName } from './types';

export interface ScheduleDefinition {
    /** Job name — must match a key in JobPayloadMap */
    name: JobName;
    /** Cron pattern — evaluated in `tz` if set, otherwise UTC */
    pattern: string;
    /**
     * IANA timezone the cron `pattern` is evaluated in (DST-aware).
     * Omit for UTC. Passed straight into the BullMQ repeat options.
     */
    tz?: string;
    /** Human-readable description */
    description: string;
    /** Default payload for the repeatable job */
    defaultPayload: Record<string, unknown>;
    /** BullMQ repeat options */
    options?: {
        /** Timezone (default: UTC) */
        tz?: string;
        /** Max runs (undefined = forever) */
        limit?: number;
    };
}

/**
 * All scheduled jobs in the system.
 * Used by `scripts/scheduler.ts` to register repeatable jobs.
 */
export const SCHEDULED_JOBS: ScheduleDefinition[] = [
    {
        // FIRST deliberately, and on the shortest cadence in this file. This
        // job's only purpose is to give the worker something to complete on an
        // otherwise quiet queue, so `worker.on('completed')` fires and the
        // heartbeat key stays fresh — see `jobs/worker-heartbeat.ts`.
        //
        // In inflect-compliance the executor existed long before anything
        // dispatched it: it returned 'pong' to nobody, which is why a wedged
        // worker was invisible there.
        //
        // 2 minutes against an 8-minute TTL = four missed beats before the
        // container reports unhealthy. Changing this cron without changing the
        // TTL reddens `tests/guards/worker-heartbeat-wiring.test.ts`, which
        // parses the number out of this very line.
        name: 'health-check',
        pattern: '*/2 * * * *',   // every 2 minutes
        description: 'Drive the worker heartbeat: completing this job is what proves the worker is consuming, not merely running. Read jobs/worker-heartbeat.ts before changing the cadence — the TTL is derived from it.',
        defaultPayload: {},
    },
    {
        name: 'notification-outbox-flush',
        pattern: '*/10 * * * *',  // every 10 minutes
        // THE OUTBOX'S OWN CADENCE, and its only scheduled drain.
        //
        // In inflect-compliance the drain long lived at the tail of a daily
        // 06:00 evidence job, so every notification left at 06:00 UTC or not
        // that day at all, and a throw in an unrelated sweep pushed it a day
        // further. The delivery latency of a notification must not be a
        // function of another job's health, so it has its own schedule.
        //
        // Ten minutes rather than five or one: the drain is one indexed query
        // per tick when the queue is empty, but each non-empty pass holds a
        // worker slot for a send per row, and nothing in this product is
        // urgent at one-minute granularity. Ten bounds the worst case an
        // operator has to explain ("the mail is at most ten minutes behind the
        // event") without turning the worker into a poller.
        description: 'Drain PENDING notification emails to the configured provider. The outbox\'s only scheduled drain. Idempotent — each row is claimed before it is sent, so overlapping passes cannot double-send.',
        // Empty: no tenantId means drain every tenant's queue, which is what a
        // platform-level job must do. A tenant-scoped drain is the admin button
        // on the notification-settings page, which passes its own tenantId.
        defaultPayload: {},
    },
    {
        name: 'audit-outbox-flush',
        pattern: '*/5 * * * *',   // every 5 minutes
        // The audit trail's own drain, and why it exists at all.
        //
        // An audit write that cannot reach the hash chain (an AUTHZ_DENIED
        // under per-workspace lock contention, say) goes to `AuditOutbox`
        // instead of being swallowed, so the record is durable before the
        // response. That makes the entry SAFE; it does not yet make it
        // EVIDENCE. Without this schedule the outbox is a table that only
        // grows and the entry never appears in the trail — the original
        // defect, moved one table over.
        //
        // FIVE minutes rather than the notification drain's ten. The failure
        // being backed up is per-tenant advisory-lock contention, which clears
        // in seconds, so the queue should be short-lived. And the cost profile
        // is different: a pass is one indexed query when empty, and each
        // non-empty row is a local database append rather than an SMTP round
        // trip to a third party, so a shorter cadence does not risk the retry
        // storm that argument was about.
        //
        // Not one minute: a security entry arriving up to five minutes after
        // the event is a bound an operator can state plainly, and polling the
        // table twelve times an hour for a queue that is empty almost always
        // is the right trade against a worker slot.
        description: 'Replay queued audit entries onto the hash chain, oldest event first. A row that exhausts its attempts is parked FAILED, never deleted.',
        // Empty: every workspace's queue, as a platform-level drain must.
        defaultPayload: {},
    },
    {
        name: 'work-item-due-notification',
        pattern: '0 8 * * *',     // 08:00 in NOTIFICATIONS_TZ
        // In the reminder zone, so "due today" is the reader's today and the
        // bell lands at the start of their working day (DST-aware).
        tz: env.NOTIFICATIONS_TZ,
        description: 'In-app reminders for open, assigned work items due today, tomorrow or in seven days. Paged per workspace; idempotent through the dedupe key.',
        defaultPayload: {},
    },
    {
        name: 'work-item-purge',
        pattern: '30 2 * * *',    // 02:30 UTC
        // Off the hour, and away from the 08:00 reminder: a purge holds
        // write locks on the rows it removes.
        description: 'Hard-delete work items and projects soft-deleted more than WORK_ITEM_PURGE_DAYS (30) ago. Counts-only audit entry per workspace.',
        defaultPayload: {},
    },
    {
        name: 'calendar-sync-dispatch',
        pattern: '*/15 * * * *',  // every 15 minutes, UTC
        // Decision 233: calendars are read and pushed every quarter hour; a
        // change in Islestone is pushed within a minute by its own job.
        description: 'Queue one calendar sync run per live calendar connection and one teardown per connection being disconnected (at most 5,000 of each). Idempotent: a run is a reconcile.',
        defaultPayload: {},
    },
    {
        name: 'goal-purge',
        pattern: '35 2 * * *',    // 02:35 UTC
        // After the 02:30 work-item purge, off the hour (decision 219).
        description: 'Hard-delete goals and initiatives soft-deleted more than GOAL_PURGE_DAYS (30) ago; the database clears every link to them. Counts-only audit entry per workspace.',
        defaultPayload: {},
    },
    {
        name: 'page-purge',
        pattern: '50 2 * * *',    // 02:50 UTC
        // After the 02:30 work-item purge (docs/porting/maps/4.1.md, "Jobs").
        description: 'Hard-delete page groups soft-deleted more than PAGE_PURGE_DAYS (30) ago, with their content. Counts-only audit entry per workspace.',
        defaultPayload: {},
    },
    {
        name: 'page-sortkey-rebalance',
        pattern: '55 3 * * *',    // 03:55 UTC
        // After the work-item rebalance at 03:45, a quiet hour.
        description: 'Rewrite the sort keys of page sibling groups whose keys passed 64 characters, keeping their order.',
        defaultPayload: {},
    },
    {
        name: 'work-item-sortkey-rebalance',
        pattern: '45 3 * * *',    // 03:45 UTC
        description: 'Rewrite the sort keys of projects whose keys passed 64 characters, keeping their order.',
        defaultPayload: {},
    },
    {
        name: 'cycle-rollover',
        pattern: '10 0 * * *',    // 00:10 in NOTIFICATIONS_TZ
        // Just after midnight in the reminder zone, so a cycle's last day has
        // ended there (owner decision 64) and the moved items are in their new
        // cycle before anyone's working day; off the hour, before the 02:30
        // purge and the 08:00 reminders.
        tz: env.NOTIFICATIONS_TZ,
        description: 'Close ended cycles, move their unfinished items to the next cycle (or out of cycles), and keep each enabled cycle schedule filled. Idempotent: a cycle closes once.',
        defaultPayload: {},
    },
    {
        name: 'intake-snooze-wake',
        pattern: '5 8 * * *',     // 08:05 in NOTIFICATIONS_TZ
        // The reader's morning, beside the 08:00 due reminders but not on
        // the same minute (owner decision 90: back at 08:00 that day).
        tz: env.NOTIFICATIONS_TZ,
        description: 'Snoozed intake requests whose day has come go back to new, and whoever snoozed each is rung. Idempotent: the wake is conditional.',
        defaultPayload: {},
    },
    {
        name: 'intake-purge',
        pattern: '50 2 * * *',    // 02:50 UTC
        // After the 02:30 work-item purge, off the hour.
        description: 'Hard-delete intake requests decided more than 90 days ago, spam after 7 (owner decision 90). Counts-only audit entry per batch.',
        defaultPayload: {},
    },
    {
        name: 'work-item-recurrence',
        pattern: '30 0 * * *',    // 00:30 in NOTIFICATIONS_TZ
        // After the rollover (a new occurrence never lands in a cycle anyway)
        // and well before the 08:00 reminders, so a copy due within the lead
        // days is there when its due reminder runs (map 2.5, decision 68).
        tz: env.NOTIFICATIONS_TZ,
        description: 'Make each due occurrence of a repeating work item, as the person who set the repeat (re-resolved), or put the repeat on hold with the reason. Idempotent: an occurrence is claimed on its stamped date.',
        defaultPayload: {},
    },
    {
        name: 'notification-digest',
        pattern: '10 8 * * *',    // 08:10 in NOTIFICATIONS_TZ, after the due bells at 08:00
        tz: env.NOTIFICATIONS_TZ,
        description: 'One daily digest email per active member of each live workspace: their open work items due soon and the day\'s unread notifications of the types they receive daily (owner decision 133). Project visibility and the workspace\'s liveness are re-checked when it is built; idempotent through the outbox dedupe (per address and day).',
        defaultPayload: {},
    },
    {
        name: 'notification-purge',
        pattern: '10 3 * * *',    // 03:10 UTC
        description: 'Delete notifications marked Done more than 90 days ago and read ones more than 180 days ago; unread ones are kept (owner decision 135). Counts-only audit entry per workspace.',
        defaultPayload: {},
    },
    {
        name: 'timesheet-reminder',
        pattern: '20 9 * * 1',    // Mondays 09:20 in NOTIFICATIONS_TZ
        // The start of the working week, off the hour (decision 276: a Monday reminder).
        tz: env.NOTIFICATIONS_TZ,
        description: 'While "Timesheets need approval" is on, remind every member who recorded time last week and has not submitted it (one bell per person and week, under their preference). Writes no time; idempotent through the dedupe key.',
        defaultPayload: {},
    },
    {
        name: 'search-index-rebuild',
        pattern: '40 2 * * *',    // 02:40 in NOTIFICATIONS_TZ, a quiet hour, before the 03:10 purge
        tz: env.NOTIFICATIONS_TZ,
        description: 'Write the search vector of every description and live comment whose vector is missing or older than SEARCH_VECTOR_REVISION, in each live workspace, as its system user (ADR 0008; the backfill on first deploy and the rebuild after a configuration or dictionary change). Bounded pages; counts-only audit entry per workspace.',
        defaultPayload: {},
    },
];

/**
 * Job names this app once scheduled and no longer does.
 *
 * Removing an entry from {@link SCHEDULED_JOBS} does NOT remove its scheduler
 * from Redis — the scheduler outlives the code and keeps firing on its old
 * cadence, and `scripts/worker.ts` logs "no executor registered for job —
 * skipping" on every tick. Listing the name here is what authorises
 * `registerSchedules` to delete that scheduler on its next run (see
 * `register-schedules.ts`). The list is an ALLOWLIST, not a record: a name
 * absent from it is never deleted, so forgetting to add one costs you the log
 * noise, while adding the wrong one deletes a live schedule. The guard in
 * `tests/guards/scheduler-orphan-reconciliation.test.ts` refuses any name that
 * is also in SCHEDULED_JOBS for exactly that reason.
 *
 * These names are deliberately plain strings, not `JobName`. The whole point is
 * to name jobs that no longer exist in `JobPayloadMap` — typing this as
 * `JobName` would make it impossible to retire a job in the same change that
 * deletes its type.
 *
 * Entries may be dropped once every deployment has registered at least once
 * since the retirement, because by then no scheduler with that name survives
 * anywhere. Keep a dated note when you add one so a later reader can tell.
 *
 * Empty today, and that is the honest state — no scheduled job has been removed
 * since the reconciliation path was added. The first removal fills it in.
 */
export const RETIRED_SCHEDULED_JOB_NAMES: readonly string[] = [];
