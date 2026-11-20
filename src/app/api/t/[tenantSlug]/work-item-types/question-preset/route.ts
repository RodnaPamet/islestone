/**
 * "Add the Question type" (sub-phase 2.4b-c; owner decision 116): a type
 * with its field set (due date and waiting on required, the answer shown),
 * in one transaction. Nothing is seeded. Key: `admin.manage`, as types are.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addQuestionType } from '@/app-layer/usecases/work-item-type';
import { AddQuestionTypeSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('admin.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, AddQuestionTypeSchema);
        return jsonResponse(await addQuestionType(ctx, input), { status: 201 });
    }),
);
