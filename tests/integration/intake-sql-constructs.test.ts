/**
 * What migration `20261125120100_intake_core` adds beyond Prisma (sub-phase
 * 2.6a), each checked in the catalogue AND by its bite: the CHECKs that keep
 * an intake request's status and its columns in step, the form's caps, and
 * the archive-only privilege on forms and project intake.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { seedWorkWorld, type WorkWorld } from '../helpers/work-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `insql${Date.now().toString(36)}`;

describeFn('intake: SQL constructs', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let userId = '';
    let world: WorkWorld;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await prisma.tenant.create({ data: { name: TAG, slug: TAG } })).id;
        userId = (await prisma.user.create({ data: { email: `${TAG}@example.test` } })).id;
        await prisma.tenantMembership.create({ data: { tenantId, userId, role: 'OWNER' } });
        world = await seedWorkWorld(prisma, tenantId, { keyPrefix: 'INS' });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const request = (data: Partial<Prisma.IntakeRequestUncheckedCreateInput>) =>
        prisma.intakeRequest.create({
            data: { tenantId, projectId: world.projectId, channel: 'INTERNAL_FORM', title: 'A request', requesterUserId: userId, ...data },
        });

    it('the catalogue holds every CHECK', async () => {
        const rows = await prisma.$queryRaw<Array<{ conname: string }>>`
            SELECT conname::text AS conname FROM pg_constraint
             WHERE conrelid IN ('"IntakeRequest"'::regclass, '"IntakeForm"'::regclass) AND contype = 'c'`;
        expect(rows.map((r) => r.conname).sort()).toEqual([
            'IntakeForm_daily_cap_range',
            'IntakeForm_name_length',
            'IntakeRequest_accepted_has_item',
            'IntakeRequest_decided_when_decided',
            'IntakeRequest_declined_has_reason',
            'IntakeRequest_internal_has_requester',
            'IntakeRequest_merged_has_one_target',
            'IntakeRequest_not_merged_into_itself',
            'IntakeRequest_snoozed_has_date',
            'IntakeRequest_title_length',
        ]);
    });

    it('a pending request stores; each status refuses the wrong columns', async () => {
        await expect(request({})).resolves.toMatchObject({ status: 'PENDING' });
        const now = new Date();
        await expect(request({ title: '' })).rejects.toThrow(/IntakeRequest_title_length/);
        await expect(request({ title: 'x'.repeat(201) })).rejects.toThrow(/IntakeRequest_title_length/);
        await expect(request({ requesterUserId: null })).rejects.toThrow(/IntakeRequest_internal_has_requester/);
        await expect(request({ status: 'ACCEPTED', decidedAt: now })).rejects.toThrow(/IntakeRequest_accepted_has_item/);
        await expect(request({ status: 'ACCEPTED', workItemId: 'w1' })).rejects.toThrow(/IntakeRequest_decided_when_decided/);
        await expect(request({ status: 'PENDING', decidedAt: now })).rejects.toThrow(/IntakeRequest_decided_when_decided/);
        await expect(request({ status: 'SNOOZED' })).rejects.toThrow(/IntakeRequest_snoozed_has_date/);
        await expect(request({ snoozedUntil: new Date('2030-01-01T00:00:00Z') })).rejects.toThrow(/IntakeRequest_snoozed_has_date/);
        await expect(request({ status: 'DECLINED', decidedAt: now })).rejects.toThrow(/IntakeRequest_declined_has_reason/);
        await expect(request({ declineReason: 'SPAM' })).rejects.toThrow(/IntakeRequest_declined_has_reason/);
        await expect(request({ status: 'MERGED', decidedAt: now })).rejects.toThrow(/IntakeRequest_merged_has_one_target/);
        await expect(
            request({ status: 'MERGED', decidedAt: now, mergedIntoWorkItemId: 'w1', mergedIntoRequestId: 'r1' }),
        ).rejects.toThrow(/IntakeRequest_merged_has_one_target/);
        await expect(request({ mergedIntoWorkItemId: 'w1' })).rejects.toThrow(/IntakeRequest_merged_has_one_target/);
        await expect(request({ id: 'self-merge', status: 'MERGED', decidedAt: now, mergedIntoRequestId: 'self-merge' })).rejects.toThrow(
            /IntakeRequest_not_merged_into_itself/,
        );
        // And each status with its columns stores.
        await expect(request({ status: 'ACCEPTED', decidedAt: now, workItemId: 'w1' })).resolves.toBeTruthy();
        await expect(request({ status: 'DECLINED', decidedAt: now, declineReason: 'SPAM' })).resolves.toBeTruthy();
        await expect(request({ status: 'MERGED', decidedAt: now, mergedIntoRequestId: 'r1' })).resolves.toBeTruthy();
        await expect(request({ status: 'SNOOZED', snoozedUntil: new Date('2030-01-01T00:00:00Z') })).resolves.toBeTruthy();
    });

    it('a form refuses a blank or long name and a daily cap outside 1 to 5,000', async () => {
        const form = (data: Partial<Prisma.IntakeFormUncheckedCreateInput>) =>
            prisma.intakeForm.create({
                data: { tenantId, projectId: world.projectId, name: 'F', publicId: `${TAG}-${Math.random()}`, definitionJson: {}, createdByUserId: userId, ...data },
            });
        await expect(form({ name: '' })).rejects.toThrow(/IntakeForm_name_length/);
        await expect(form({ name: 'n'.repeat(101) })).rejects.toThrow(/IntakeForm_name_length/);
        await expect(form({ name: 'cap0', dailyCap: 0 })).rejects.toThrow(/IntakeForm_daily_cap_range/);
        await expect(form({ name: 'capbig', dailyCap: 5001 })).rejects.toThrow(/IntakeForm_daily_cap_range/);
        await expect(form({ name: 'ok', dailyCap: 5000 })).resolves.toBeTruthy();
    });

    it('app_user holds no DELETE on forms and project intake, and DELETE on requests and the notify list', async () => {
        const held = async (table: string, privilege: string) =>
            (await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT has_table_privilege('app_user', $1, $2) AS ok`, `"${table}"`, privilege))[0]!.ok;
        expect(await held('IntakeForm', 'DELETE')).toBe(false);
        expect(await held('ProjectIntake', 'DELETE')).toBe(false);
        expect(await held('IntakeForm', 'UPDATE')).toBe(true);
        expect(await held('IntakeRequest', 'DELETE')).toBe(true);
        expect(await held('IntakeNotifyMember', 'DELETE')).toBe(true);
    });

    it("a project's purge removes its forms and requests in one statement (NO ACTION on the form link)", async () => {
        const other = await seedWorkWorld(prisma, tenantId, { keyPrefix: 'INP' });
        const form = await prisma.intakeForm.create({
            data: { tenantId, projectId: other.projectId, name: 'Doomed', publicId: `${TAG}-doomed`, definitionJson: {}, createdByUserId: userId },
        });
        await prisma.intakeRequest.create({
            data: { tenantId, projectId: other.projectId, channel: 'INTERNAL_FORM', formId: form.id, title: 'x', requesterUserId: userId },
        });
        await prisma.project.delete({ where: { id: other.projectId } });
        expect(await prisma.intakeForm.count({ where: { projectId: other.projectId } })).toBe(0);
        expect(await prisma.intakeRequest.count({ where: { projectId: other.projectId } })).toBe(0);
    });
});
