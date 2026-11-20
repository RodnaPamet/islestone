/**
 * Request schemas for intake (sub-phase 2.6a). The body of a request sent
 * through a form is validated by the form's own compiled schema
 * (`compileIntakeRequestSchema`, `src/lib/intake/form-definition.ts`), not
 * here: the route takes it as JSON and the usecase parses it.
 */
import { z } from 'zod';

import { INTAKE_LIMITS } from '@/lib/intake/form-definition';
import { INTAKE_DECLINE_REASONS, INTAKE_VIEWS } from '@/lib/intake/types';
import { DateOnly } from '@/lib/schemas/work-item';

const Id = z.string().min(1).max(64);

export const IntakeListQuerySchema = z
    .object({
        view: z.enum(INTAKE_VIEWS).optional(),
        projectId: Id.optional(),
        formId: Id.optional(),
        cursor: z.string().max(500).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .strict();

export const IntakeFormListQuerySchema = z
    .object({
        projectId: Id.optional(),
        includeArchived: z.enum(['0', '1']).optional(),
    })
    .strict();

export const CreateIntakeFormSchema = z
    .object({
        projectId: Id,
        name: z.string().min(1).max(INTAKE_LIMITS.formName),
        /** Validated by `IntakeFormDefinitionSchema` in the usecase, after sanitising. */
        definition: z.unknown(),
        published: z.boolean().optional(),
        /** `PUBLIC` (anyone with the link, 2.6b) only while public forms are open on the deployment. */
        access: z.enum(['MEMBERS', 'PUBLIC']).optional(),
    })
    .strict();

export const UpdateIntakeFormSchema = z
    .object({
        name: z.string().min(1).max(INTAKE_LIMITS.formName).optional(),
        definition: z.unknown().optional(),
        published: z.boolean().optional(),
        archived: z.boolean().optional(),
        access: z.enum(['MEMBERS', 'PUBLIC']).optional(),
    })
    .strict()
    .refine(
        (b) => b.name !== undefined || b.definition !== undefined || b.published !== undefined || b.archived !== undefined || b.access !== undefined,
        'Give something to change.',
    );

export const SetProjectIntakeSchema = z
    .object({
        enabled: z.boolean(),
        notifyUserIds: z.array(Id).max(500).optional(),
        /** The project's email address takes mail (2.6c). */
        emailEnabled: z.boolean().optional(),
    })
    .strict();

/** An address to block or look up (2.6c): stored only as its lookup hash. */
const SenderAddress = z.string().trim().min(3).max(320).email();

export const BlockSenderSchema = z
    .object({
        email: SenderAddress,
        /** The project; null blocks the address across the workspace. */
        projectId: Id.nullable(),
    })
    .strict();

/** Find an address's blocks: a POST body, so the address never sits in a URL or an access log. */
export const FindBlockedSenderSchema = z.object({ email: SenderAddress }).strict();

export const EditIntakeRequestSchema = z
    .object({
        title: z.string().min(1).max(INTAKE_LIMITS.title).optional(),
        body: z.string().max(INTAKE_LIMITS.body).nullable().optional(),
    })
    .strict()
    .refine((b) => b.title !== undefined || b.body !== undefined, 'Give a title or text to change.');

export const AcceptIntakeRequestSchema = z
    .object({
        projectId: Id.optional(),
        typeId: Id,
        stateId: Id.optional(),
        priority: z.enum(['NONE', 'URGENT', 'HIGH', 'MEDIUM', 'LOW']).optional(),
        assigneeId: Id.nullable().optional(),
        labelIds: z.array(Id).max(50).optional(),
        cycleId: Id.nullable().optional(),
        /** The fields a type's field set may require (2.4b-b). */
        milestoneId: Id.nullable().optional(),
        waitingOnUserId: Id.nullable().optional(),
        startDate: DateOnly.nullable().optional(),
        dueDate: DateOnly.nullable().optional(),
        title: z.string().min(1).max(INTAKE_LIMITS.title).optional(),
        description: z.string().max(INTAKE_LIMITS.body * 2).nullable().optional(),
    })
    .strict();

export const DeclineIntakeRequestSchema = z
    .object({
        reason: z.enum(INTAKE_DECLINE_REASONS as unknown as ['NOT_PLANNED', 'OUT_OF_SCOPE', 'SPAM', 'OTHER']),
        explanation: z.string().max(2000).nullable().optional(),
        remark: z.string().max(2000).nullable().optional(),
        /** With SPAM only: block the requester's address on the project (2.6c; `intake.manage`). */
        blockSender: z.boolean().optional(),
    })
    .strict()
    .refine((b) => !b.blockSender || b.reason === 'SPAM', { message: 'Only a spam decline blocks the sender.', path: ['blockSender'] });

export const MergeIntakeRequestSchema = z.union([
    z.object({ workItemId: Id }).strict(),
    z.object({ requestId: Id }).strict(),
]);

export const SnoozeIntakeRequestSchema = z.object({ until: DateOnly }).strict();

export const MoveIntakeRequestSchema = z.object({ projectId: Id }).strict();
