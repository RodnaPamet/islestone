/**
 * Request schemas for review steps (sub-phase 2.8a; ADR 0009). Client-safe:
 * the step editor and the respond dialog (2.8b) validate with them too. The
 * expected round version is never a body field: it comes from `If-Match`
 * (`expectedVersionFrom`).
 *
 * Written fresh for Islestone.
 */
import { z } from 'zod';

import { REVIEW_LIMITS } from '@/app-layer/domain/review-steps';

const Id = z.string().min(1).max(64);

/** One step as the editor sends it: what it is, and whom it names. */
export const ReviewStepInputSchema = z
    .object({
        name: z.string().min(1).max(REVIEW_LIMITS.stepNameMax * 2),
        mode: z.enum(['ALL', 'ANY']),
        dueInWorkingDays: z.number().int().min(REVIEW_LIMITS.minDueInWorkingDays).max(REVIEW_LIMITS.maxDueInWorkingDays),
        memberIds: z.array(Id).max(REVIEW_LIMITS.maxMembersPerStep).default([]),
        recipientListIds: z.array(Id).max(REVIEW_LIMITS.maxListsPerStep).default([]),
    })
    .strict();

export type ReviewStepInput = z.infer<typeof ReviewStepInputSchema>;

/**
 * `PUT …/review/steps`: the steps not yet opened, in order. On a planned
 * round (or none yet) they are every step; on an open round, the steps that
 * follow the open one.
 */
export const SetReviewStepsSchema = z.object({ steps: z.array(ReviewStepInputSchema).max(REVIEW_LIMITS.maxSteps) }).strict();

/** `POST …/review/steps/:stepId/respond`: Signed off or Returned, with text (required to Return; decision 157). */
export const RespondToReviewSchema = z
    .object({
        outcome: z.enum(['SIGNED_OFF', 'RETURNED']),
        text: z.string().max(REVIEW_LIMITS.responseTextMax).nullable().optional(),
    })
    .strict();

/** `POST …/review/steps/:stepId/reviewers`: add one person to a step not yet ended. */
export const AddReviewerSchema = z.object({ userId: Id }).strict();
