/**
 * A project's intake settings (sub-phase 2.6a; owner decisions 93 and 95):
 * whether it takes requests, and its notify list. Settings → Intake reads and
 * writes them under `intake.manage`. Turning intake on for the first time with
 * no notify list puts the person who turned it on on the list (decision 95).
 *
 * Sub-phase 2.7e (owner decision 142): the intake may name one recipient
 * list, the workspace's or the project's own and live when named, rung beside
 * the notify list's member rows; it is resolved when the bell is sent.
 *
 * Sub-phase 2.6c: the project's email address. Turning email on mints the
 * address the first time (`<token>@<INTAKE_EMAIL_DOMAIN>`), only while inbound
 * email is open on the deployment; generating a new address retires the old
 * one for good (audited `INTAKE_ADDRESS_ROTATED`).
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { IntakeEmailRepository } from '../repositories/IntakeEmailRepository';
import { IntakeRepository } from '../repositories/IntakeRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { RecipientListRepository } from '../repositories/RecipientListRepository';
import { assertCanManageIntake } from '../policies/intake.policies';
import { visibleProjects } from '../policies/project-visibility';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { intakeAddress, mintAddressToken } from '@/lib/intake/email/address';
import { intakeEmailDomain, isInboundEmailOpen } from '@/lib/intake/email/switch';
import type { ProjectIntakeSettings } from '@/lib/intake/types';

/** Every visible, live project with its intake (off when it has none), its notify list and its new requests. */
export async function listProjectIntakeSettings(ctx: RequestContext): Promise<ProjectIntakeSettings[]> {
    assertCanManageIntake(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const projects = await ProjectRepository.list(db, ctx, v);
        const ids = projects.map((p) => p.id);
        const [intakes, notify, pending, emails] = await Promise.all([
            IntakeRepository.listProjectIntakes(db, ctx, ids),
            IntakeRepository.listNotifyMembers(db, ctx, ids),
            IntakeRepository.countPendingByProject(db, ctx, v, ids),
            IntakeEmailRepository.listProjectEmails(db, ctx, ids),
        ]);
        const emailBy = new Map(emails.map((e) => [e.projectId, e]));
        const enabled = new Map(intakes.map((i) => [i.projectId, i.enabled]));
        const listBy = new Map(intakes.map((i) => [i.projectId, i.recipientListId]));
        const pendingBy = new Map(pending.map((p) => [p.projectId, p._count._all]));
        return projects.map((p) => ({
            projectId: p.id,
            projectName: p.name,
            keyPrefix: p.keyPrefix,
            enabled: enabled.get(p.id) ?? false,
            notifyUserIds: notify.filter((n) => n.projectId === p.id).map((n) => n.userId),
            recipientListId: listBy.get(p.id) ?? null,
            pendingCount: pendingBy.get(p.id) ?? 0,
            ...emailView(emailBy.get(p.id)),
        }));
    });
}

function emailView(e: { emailEnabled: boolean; emailToken: string | null } | undefined | null): { emailEnabled: boolean; emailAddress: string | null } {
    return { emailEnabled: e?.emailEnabled ?? false, emailAddress: e?.emailToken ? intakeAddress(e.emailToken, intakeEmailDomain()) : null };
}

export interface SetProjectIntakeInput {
    enabled: boolean;
    /** The whole notify list; absent leaves it as it is (or seeds it, see above). */
    notifyUserIds?: string[];
    /** Whether the project's email address takes mail (2.6c); absent leaves it. */
    emailEnabled?: boolean;
    /** The recipient list rung beside the notify list (2.7e); `null` names none, absent leaves it. */
    recipientListId?: string | null;
}

export async function setProjectIntake(ctx: RequestContext, projectId: string, input: SetProjectIntakeInput): Promise<ProjectIntakeSettings> {
    assertCanManageIntake(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
        if (!project) throw notFound('Project not found');
        if (project.archivedAt && input.enabled) throw badRequest(`${project.name} is archived and takes no requests.`);
        const before = await IntakeRepository.getProjectIntake(db, ctx, project.id);
        const current = (await IntakeRepository.listNotifyMembers(db, ctx, [project.id])).map((n) => n.userId);

        let notify = input.notifyUserIds ? [...new Set(input.notifyUserIds)] : current;
        if (input.notifyUserIds) {
            const active = await MembershipRepository.listActiveUserIds(db, ctx, notify);
            const missing = notify.filter((id) => !active.has(id));
            if (missing.length > 0) throw badRequest('Only active members of the workspace can be on the notify list.');
        } else if (!before && input.enabled && current.length === 0) {
            notify = [ctx.userId];
        }

        if (input.recipientListId) {
            // A live list of the workspace or of this project (decision 142).
            const list = await RecipientListRepository.getById(db, ctx, input.recipientListId);
            if (!list || (list.projectId !== null && list.projectId !== project.id)) throw badRequest('Choose a recipient list of the workspace or of this project.');
            if (list.archivedAt) throw badRequest(`The recipient list ${list.name} is archived.`);
        }

        const after = await IntakeRepository.upsertProjectIntake(db, ctx, project.id, input.enabled);
        if (notify !== current) await IntakeRepository.replaceNotifyMembers(db, ctx, project.id, notify);
        const listBefore = before?.recipientListId ?? null;
        const listAfter = input.recipientListId === undefined ? listBefore : input.recipientListId;
        if (listAfter !== listBefore) await IntakeRepository.setRecipientList(db, ctx, project.id, listAfter);
        const emailBefore = await IntakeEmailRepository.getProjectEmail(db, ctx, project.id);
        let email = emailBefore;
        if (input.emailEnabled !== undefined && input.emailEnabled !== (emailBefore?.emailEnabled ?? false)) {
            if (input.emailEnabled && !isInboundEmailOpen()) {
                throw new ConflictError('Inbound email is switched off on this deployment.', { reason: 'INBOUND_EMAIL_CLOSED' });
            }
            const minted = input.emailEnabled && !emailBefore?.emailToken ? { emailToken: mintAddressToken(), emailTokenRotatedAt: new Date() } : {};
            const updated = await IntakeEmailRepository.setProjectEmail(db, ctx, project.id, { emailEnabled: input.emailEnabled, ...minted });
            email = { ...emailBefore!, ...updated };
        }

        const changed: string[] = [];
        if ((before?.enabled ?? false) !== after.enabled) changed.push('enabled');
        if ([...notify].sort().join() !== [...current].sort().join()) changed.push('notifyList');
        if (listAfter !== listBefore) changed.push('recipientListId');
        if ((emailBefore?.emailEnabled ?? false) !== (email?.emailEnabled ?? false)) changed.push('emailEnabled');
        if (changed.length > 0) {
            await logEvent(db, ctx, {
                action: 'PROJECT_INTAKE_UPDATED',
                entityType: 'Project',
                entityId: project.id,
                details: `Changed the intake of project ${project.keyPrefix}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'ProjectIntake', operation: before ? 'updated' : 'created', changedFields: changed, summary: 'PROJECT_INTAKE_UPDATED' },
                metadata: { projectId: project.id, enabled: after.enabled, notifyCount: notify.length, recipientListId: listAfter, emailEnabled: email?.emailEnabled ?? false },
            });
        }
        const [pending] = await IntakeRepository.countPendingByProject(db, ctx, v, [project.id]);
        return {
            projectId: project.id,
            projectName: project.name,
            keyPrefix: project.keyPrefix,
            enabled: after.enabled,
            notifyUserIds: notify,
            recipientListId: listAfter,
            pendingCount: pending?._count._all ?? 0,
            ...emailView(email),
        };
    });
}

/**
 * Generate a new email address for a project (2.6c): the old one stops
 * working at once, and every reply address built on it with it. Turning email
 * on first mints one, so this is for an address that leaked or is abused.
 */
export async function rotateProjectIntakeAddress(ctx: RequestContext, projectId: string): Promise<ProjectIntakeSettings> {
    assertCanManageIntake(ctx);
    const project = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const p = await ProjectRepository.getVisible(db, ctx, v, projectId);
        if (!p) throw notFound('Project not found');
        const intake = await IntakeEmailRepository.getProjectEmail(db, ctx, p.id);
        if (!intake?.emailToken) throw new ConflictError('The project has no email address yet: turn its email on first.', { reason: 'NO_ADDRESS' });
        await IntakeEmailRepository.setProjectEmail(db, ctx, p.id, { emailToken: mintAddressToken(), emailTokenRotatedAt: new Date() });
        await logEvent(db, ctx, {
            action: 'INTAKE_ADDRESS_ROTATED',
            entityType: 'Project',
            entityId: p.id,
            details: `Generated a new intake email address for project ${p.keyPrefix}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'ProjectIntake', operation: 'updated', changedFields: ['emailToken'], summary: 'INTAKE_ADDRESS_ROTATED' },
            metadata: { projectId: p.id },
        });
        return p;
    });
    return (await listProjectIntakeSettings(ctx)).find((s) => s.projectId === project.id)!;
}
