/**
 * The two intake jobs' work for one workspace (sub-phase 2.6a; owner decision
 * 90), run as the workspace's system user: both act for nobody (`CLAUDE.md`,
 * "Job identity").
 *
 * - The wake: snoozed requests whose day has come go back to new, in batches,
 *   each by a conditional update (still snoozed, still due), one counts-only
 *   `INTAKE_REQUESTS_WOKEN` entry per batch, and a bell to whoever snoozed
 *   each one while that person is still an ACTIVE member holding
 *   `intake.view`.
 * - The purge: decided requests whose decision is older than the window (90
 *   days; spam 7) are hard-deleted in batches, with one counts-only
 *   `INTAKE_REQUESTS_PURGED` entry per batch. The work item an accepted
 *   request became is untouched.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { IntakeRepository, INTAKE_JOB_BATCH } from '../repositories/IntakeRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { INBOUND_RETENTION_DAYS, INTAKE_PURGE_DAYS, INTAKE_SPAM_PURGE_DAYS } from '../domain/intake';
import { createIntakeNotifications } from '../notifications/intake';
import { intakeReaders } from './intake-request';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { resolveProjectVisibility } from '../policies/project-visibility';
import { IntakeEmailRepository } from '../repositories/IntakeEmailRepository';

const MS_PER_DAY = 86_400_000;
/** At most this many batches per workspace per run: the next run continues. */
const MAX_BATCHES = 20;

export async function wakeSnoozedRequests(ctx: RequestContext, today: Date): Promise<{ woken: number }> {
    let woken = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
        // guardrail-allow: n+1 — one transaction per bounded batch, so a long backlog commits as it goes.
        const r = await runInTenantContext(ctx, async (db) => {
            const due = await IntakeRepository.listDueSnoozed(db, ctx, today);
            if (due.length === 0) return { woken: [] as typeof due, more: false };
            const ids = new Set(await IntakeRepository.wake(db, ctx, due.map((d) => d.id), today));
            const done = due.filter((d) => ids.has(d.id));
            if (done.length > 0) {
                await logEvent(db, ctx, {
                    action: 'INTAKE_REQUESTS_WOKEN',
                    entityType: 'IntakeRequest',
                    entityId: done[0]!.id,
                    details: `Woke ${done.length} snoozed request(s)`,
                    detailsJson: { category: 'status_change', entityName: 'IntakeRequest', fromStatus: 'SNOOZED', toStatus: 'PENDING', reason: 'snooze_ended' },
                    metadata: { count: done.length, requestIds: done.map((d) => d.id) },
                });
            }
            return { woken: done, more: due.length === INTAKE_JOB_BATCH };
        });
        woken += r.woken.length;
        if (r.woken.length > 0 && ctx.tenantSlug) await ringWoken(ctx, ctx.tenantSlug, r.woken, today);
        if (!r.more) break;
    }
    return { woken };
}

async function ringWoken(
    ctx: RequestContext,
    tenantSlug: string,
    woken: ReadonlyArray<{ id: string; projectId: string; title: string; snoozedByUserId: string | null }>,
    today: Date,
): Promise<void> {
    await runInTenantContext(ctx, async (db) => {
        const snoozers = [...new Set(woken.map((w) => w.snoozedByUserId).filter((x): x is string => !!x))];
        if (snoozers.length === 0) return;
        const readers = await intakeReaders(db, ctx, snoozers);
        const projects = new Map((await ProjectRepository.list(db, ctx, resolveProjectVisibility(ctx), { includeArchived: true })).map((p) => [p.id, p.keyPrefix]));
        await createIntakeNotifications(
            db,
            ctx.tenantId,
            tenantSlug,
            'INTAKE_REQUEST_WOKEN',
            woken
                .filter((w) => w.snoozedByUserId && readers.has(w.snoozedByUserId) && projects.has(w.projectId))
                .map((w) => ({ requestId: w.id, projectKeyPrefix: projects.get(w.projectId)!, title: w.title, recipientUserIds: [w.snoozedByUserId!] })),
            { day: today.toISOString().slice(0, 10) },
        );
    });
}

export async function purgeDecidedRequests(ctx: RequestContext, now: Date = new Date()): Promise<{ purged: number }> {
    let purged = 0;
    const passes = [
        { spam: false, before: new Date(now.getTime() - INTAKE_PURGE_DAYS * MS_PER_DAY), statuses: ['ACCEPTED', 'DECLINED', 'MERGED'] as const },
        { spam: true, before: new Date(now.getTime() - INTAKE_SPAM_PURGE_DAYS * MS_PER_DAY), statuses: ['DECLINED'] as const },
    ];
    for (const pass of passes) {
        for (let batch = 0; batch < MAX_BATCHES; batch++) {
            // guardrail-allow: n+1 — one transaction per bounded batch.
            const n = await runInTenantContext(ctx, async (db) => {
                const count = await IntakeRepository.purgeDecided(db, ctx, pass);
                if (count > 0) {
                    await logEvent(db, ctx, {
                        action: 'INTAKE_REQUESTS_PURGED',
                        entityType: 'IntakeRequest',
                        entityId: ctx.tenantId,
                        details: `Purged ${count} decided request(s)`,
                        detailsJson: {
                            category: 'data_lifecycle',
                            operation: 'purged',
                            recordCount: count,
                            model: 'IntakeRequest',
                            reason: pass.spam ? 'spam_retention' : 'decided_retention',
                            graceDays: pass.spam ? INTAKE_SPAM_PURGE_DAYS : INTAKE_PURGE_DAYS,
                        },
                    });
                }
                return count;
            });
            purged += n;
            if (n < INTAKE_JOB_BATCH) break;
        }
    }
    // Settled inbound email deliveries (2.6c): a sender's lookup hash and
    // codes, kept 30 days for the throttle and for diagnosis.
    await runInTenantContext(ctx, async (db) => {
        const count = await IntakeEmailRepository.purgeInbound(db, ctx, new Date(now.getTime() - INBOUND_RETENTION_DAYS * MS_PER_DAY));
        if (count > 0) {
            await logEvent(db, ctx, {
                action: 'INTAKE_INBOUND_EMAILS_PURGED',
                entityType: 'IntakeInboundEmail',
                entityId: ctx.tenantId,
                details: `Purged ${count} settled inbound email deliveries`,
                detailsJson: { category: 'data_lifecycle', operation: 'purged', recordCount: count, model: 'IntakeInboundEmail', reason: 'inbound_retention', graceDays: INBOUND_RETENTION_DAYS },
            });
        }
    });
    return { purged };
}
