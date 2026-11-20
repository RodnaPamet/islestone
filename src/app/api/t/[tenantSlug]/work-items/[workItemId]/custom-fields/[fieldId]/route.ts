/**
 * Set or clear one custom field's value on a work item (sub-phase 2.4,
 * `work_items.edit`). A single-field change (ADR 0002 §9): `If-Match` is
 * optional, the item's version increases, and a stale version is a 409 with
 * the current row.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setWorkItemCustomFieldValue } from '@/app-layer/usecases/custom-field';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetCustomFieldValueSchema } from '@/lib/schemas/custom-field';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; fieldId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetCustomFieldValueSchema);
        return jsonResponse(await setWorkItemCustomFieldValue(ctx, params.workItemId, params.fieldId, input.value, expectedVersionFrom(req)));
    }),
);
