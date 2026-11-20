/**
 * A work item's marked answer (sub-phase 2.4b-c; ADR 0002 §15; owner
 * decisions 113 to 118). PUT marks a comment of the item as its answer
 * (an open item moves to a Done state in the same write); DELETE clears it
 * (the state stays). Key: `work_items.edit`; the usecase refuses an API key
 * (`NOT_A_PERSON`) and a type whose field set hides the answer. A
 * single-field change: `If-Match` optional (ADR 0002 §9).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { clearWorkItemAnswer, markWorkItemAnswer } from '@/app-layer/usecases/work-item-answer';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { MarkWorkItemAnswerSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, MarkWorkItemAnswerSchema);
        return jsonResponse(await markWorkItemAnswer(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        return jsonResponse(await clearWorkItemAnswer(ctx, params.workItemId, expectedVersionFrom(req)));
    }),
);
