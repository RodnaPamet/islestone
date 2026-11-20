/**
 * Skip a step of the open round, or close one whose reviewers left (sub-phase
 * 2.8a; owner decision 150). Key: `work_items.edit`; the usecase admits only
 * the item's assignee, whoever sent the round, or an admin, and audits any
 * other refusal. `If-Match` (the round's version) optional.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { skipReviewStep } from '@/app-layer/usecases/review';
import { expectedVersionFrom } from '@/lib/http/if-match';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; stepId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        return jsonResponse(await skipReviewStep(ctx, params.workItemId, params.stepId, expectedVersionFrom(req)));
    }),
);
