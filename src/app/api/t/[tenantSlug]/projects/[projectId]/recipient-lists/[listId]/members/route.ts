/**
 * A project recipient list's people (sub-phase 2.7e; `projects.edit`,
 * decision 140): PUT sets the whole set, PATCH adds and removes people.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { changeRecipientListMembers, setRecipientListMembers } from '@/app-layer/usecases/recipient-list';
import { ChangeRecipientListMembersSchema, SetRecipientListMembersSchema } from '@/lib/schemas/recipient-list';
import { parseJsonBody } from '@/lib/validation/route';

type Params = { tenantSlug: string; projectId: string; listId: string };

export const PUT = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetRecipientListMembersSchema);
        return jsonResponse(await setRecipientListMembers(ctx, params.projectId, params.listId, input.userIds));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, ChangeRecipientListMembersSchema);
        return jsonResponse(await changeRecipientListMembers(ctx, params.projectId, params.listId, input));
    }),
);
