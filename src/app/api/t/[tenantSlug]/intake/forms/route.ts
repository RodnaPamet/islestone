/**
 * Intake forms (sub-phase 2.6a): the forms of the visible projects
 * (`intake.view`) and a new form (`intake.manage`, Owners and Admins;
 * decision 92). Every form is for signed-in members until 2.6b.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createIntakeForm, listIntakeForms } from '@/app-layer/usecases/intake-form';
import { CreateIntakeFormSchema, IntakeFormListQuerySchema } from '@/lib/schemas/intake';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('intake.view', async (req: NextRequest, _args, ctx) => {
        const q = IntakeFormListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listIntakeForms(ctx, { projectId: q.projectId, includeArchived: q.includeArchived === '1' }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('intake.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateIntakeFormSchema);
        return jsonResponse(await createIntakeForm(ctx, input), { status: 201 });
    }),
);
