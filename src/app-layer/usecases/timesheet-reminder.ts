/**
 * The Monday reminder to submit last week (sub-phase 3.4c;
 * docs/porting/maps/3.4.md, "Jobs"; ADR 0012 §8; owner decision 276), for
 * one workspace, run by the `timesheet-reminder` job as the workspace's
 * system user. It writes bells only, never time or a timesheet (decision 278:
 * no job writes time).
 *
 * While approval is on, every ACTIVE member who still holds `time.track`,
 * recorded finished time dated in the week and has not submitted it (no
 * SUBMITTED or APPROVED row) gets one `TIMESHEET_REMINDER`, under their own
 * preference, deduplicated per person and week, linking to that week. A
 * RETURNED or WITHDRAWN week is reminded of too: it is not submitted.
 *
 * Written fresh for Islestone.
 */
import { createTimesheetNotifications } from '../notifications/timesheet';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { TimeEntryRepository } from '../repositories/TimeEntryRepository';
import { TimesheetRepository } from '../repositories/TimesheetRepository';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { permissionsForMembership } from '@/lib/permissions';
import { addDays, dateOnlyValue } from '@/lib/time/week';

/** The people one workspace's reminder reads, at most (a bound far above any team). */
export const REMINDER_PEOPLE_MAX = 5_000;

export async function remindWorkspaceToSubmit(ctx: RequestContext, input: { tenantSlug: string; weekStart: string }): Promise<{ reminded: number }> {
    return runInTenantContext(ctx, async (db) => {
        const settings = await TimesheetRepository.settings(db, ctx);
        if (!settings?.approvalRequired) return { reminded: 0 };
        const from = dateOnlyValue(input.weekStart);
        const people = await TimeEntryRepository.peopleWithTimeIn(db, ctx, from, dateOnlyValue(addDays(input.weekStart, 6)), REMINDER_PEOPLE_MAX);
        if (people.length === 0) return { reminded: 0 };
        const submitted = await TimesheetRepository.submittedFor(db, ctx, from, people);
        const owing = people.filter((id) => !submitted.has(id));
        const memberships = await MembershipRepository.activeMembershipsWithRoles(db, ctx, owing);
        const track = memberships.filter((m) => permissionsForMembership(m).time?.track === true).map((m) => m.userId);
        const out = await createTimesheetNotifications(
            db,
            ctx.tenantId,
            track.map((userId) => ({ userId, notice: { kind: 'reminder' as const, weekStart: input.weekStart }, linkUrl: `/t/${input.tenantSlug}/time?week=${input.weekStart}` })),
        );
        return { reminded: out.created };
    });
}
